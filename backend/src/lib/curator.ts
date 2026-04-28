// Rolling outline curator. Runs periodically (every ~30 s) over the full
// transcript-so-far + the current outline and re-generates a structured,
// hierarchical study outline.
//
// Why this is different from llm.ts (per-chunk note extraction):
//   - llm.ts produces flat one-liners per chunk → "stream of bullets". Once
//     written, never refined. Lacks hierarchy and re-interpretation.
//   - curator.ts produces a structured tree (sections → key terms / examples
//     / points) and REPLACES the previous tree on every run, so as more of
//     the lecture is heard, the outline gets reorganised, terms get fuller
//     definitions, and earlier sections get tightened.
//
// This matches how students actually take notes: you don't keep adding new
// bullets forever; you periodically re-group, expand definitions, slot
// examples under the right concept. Doing the same with the LLM gives the
// student a polished, evolving outline instead of a chronological log.
//
// Trade-off: a curator run is more expensive than a chunk-extraction run
// (input is the full transcript, not a 10 s slice). We mitigate by running
// it every N chunks (e.g. 3 = ~30 s), not every chunk, so for a 1 h lecture
// we go from ~360 LLM calls to ~120 — a net REDUCTION in call count even
// though each call uses more tokens.

import OpenAI from 'openai'

export interface OutlineKeyTerm {
  term: string
  definition: string
  ts: number       // absolute video time in seconds
}

export interface OutlineExample {
  text: string
  ts: number
}

export interface OutlinePoint {
  text: string
  ts: number
  important: boolean   // ★ definitions / formulas / conclusions / lecturer-emphasised points
}

export interface OutlineSection {
  heading: string
  ts: number              // when this section started in the video
  summary: string         // 1-2 sentence section summary
  key_terms: OutlineKeyTerm[]
  examples: OutlineExample[]
  points: OutlinePoint[]
}

export interface Outline {
  title: string           // overall lecture topic — refines as more is heard
  sections: OutlineSection[]
}

export interface CuratorRequest {
  /** Whole transcript so far, time-bucketed per chunk so the LLM can
   * estimate timestamps for each insight. */
  bucketedTranscript: { ts: number; text: string }[]
  /** The previous outline, if any. The LLM is asked to refine, not start
   * from scratch — gives it stability across runs. */
  previousOutline: Outline | null
}

const SYSTEM_PROMPT = `あなたは大学生の代わりに講義のノートを作成し、講義が進むにつれてノートを継続的に改善するアシスタントです。
学生がこのノートだけを見て試験勉強できるレベルの質を目指す。

入力:
- bucketedTranscript: これまでの講義の文字起こし(時刻付き)。新しいチャンクほど後ろに来る。
- previousOutline: 前回までに作成されたノート構造(JSON)。なければ null。

仕事:
- 全ての文字起こしを総合的に分析し、講義全体の構造を理解する
- セクション(主題)単位でグループ化する。同じトピックが複数チャンクに分散していたら 1 つのセクションに統合する
- 各セクションに以下を含める:
  - heading: 簡潔な見出し (1 行)
  - ts: そのセクションが講義で初めて出現した秒数
  - summary: 1〜2 文でそのセクションの要旨
  - key_terms: 用語の定義 (term, definition, ts) — 必ず正確に。聞き間違いがあれば文脈から修正する
  - examples: 講師が挙げた具体例 (text, ts)
  - points: 重要なポイント (text, ts, important: true は定義/公式/結論/強調された事項)
- previousOutline がある場合は、それを土台にして発展・統合・修正する。古い情報を捨てるのではなく洗練する
- 不正確な転写(例:「サスナビリティ」→「サステナビリティ」)は文脈から判断して正しい表記に統一する

ノートの質を高めるルール:
1. 階層を保つ。複数チャンクで述べられた概念はマージして 1 つのセクションに
2. 講師の論理の流れ(導入 → 定義 → 例 → 含意 など)を反映する
3. 重複を削除する。同じことが 2 つのセクションに書かれていたら 1 つに集約
4. text は日本語で簡潔に(1 行 80 文字以内)。要約・凝縮する
5. important: true は控えめに使う(定義/公式/結論/明示的に強調された箇所のみ)
6. ts は bucketedTranscript の時刻情報から推定する整数秒
7. 出力は以下の JSON 構造のみ。説明文・Markdown は禁止:

{
  "title": "<講義全体の主題, 1 行>",
  "sections": [
    {
      "heading": "<セクション見出し>",
      "ts": <秒>,
      "summary": "<1〜2 文の要旨>",
      "key_terms": [{ "term": "...", "definition": "...", "ts": <秒> }],
      "examples": [{ "text": "...", "ts": <秒> }],
      "points": [{ "text": "...", "ts": <秒>, "important": <bool> }]
    }
  ]
}

8. transcript がまだ短くて構造が見えない場合でも、現時点で見えるトピックを 1 セクションにまとめて出力する。空の sections は許容しない(transcript が完全に空の場合のみ空配列)。`

let _client: OpenAI | undefined
function client(): OpenAI {
  if (!_client) {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) throw new Error('GROQ_API_KEY not set — required for curator')
    _client = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' })
  }
  return _client
}

const PRIMARY = 'llama-3.3-70b-versatile'
const FALLBACK = 'llama-3.1-8b-instant'
const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 600

function isRetryable(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return msg.includes('503') || msg.includes('500') || msg.includes('429')
    || msg.includes('overloaded') || msg.includes('high demand') || msg.includes('service unavailable')
}

async function generateOnce(modelName: string, userPrompt: string): Promise<Outline> {
  const res = await client().chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,   // a touch warmer than per-chunk; structure benefits from a bit of creative re-grouping
  })
  const text = res.choices[0]?.message?.content ?? '{}'
  const parsed = JSON.parse(text) as Partial<Outline>
  return {
    title: typeof parsed.title === 'string' ? parsed.title : '',
    sections: Array.isArray(parsed.sections) ? parsed.sections.map(normaliseSection) : [],
  }
}

function normaliseSection(s: Partial<OutlineSection>): OutlineSection {
  return {
    heading: typeof s.heading === 'string' ? s.heading : '',
    ts: typeof s.ts === 'number' ? Math.max(0, Math.round(s.ts)) : 0,
    summary: typeof s.summary === 'string' ? s.summary : '',
    key_terms: Array.isArray(s.key_terms) ? s.key_terms.map(t => ({
      term: typeof t.term === 'string' ? t.term : '',
      definition: typeof t.definition === 'string' ? t.definition : '',
      ts: typeof t.ts === 'number' ? Math.max(0, Math.round(t.ts)) : 0,
    })).filter(t => t.term && t.definition) : [],
    examples: Array.isArray(s.examples) ? s.examples.map(e => ({
      text: typeof e.text === 'string' ? e.text : '',
      ts: typeof e.ts === 'number' ? Math.max(0, Math.round(e.ts)) : 0,
    })).filter(e => e.text) : [],
    points: Array.isArray(s.points) ? s.points.map(p => ({
      text: typeof p.text === 'string' ? p.text : '',
      ts: typeof p.ts === 'number' ? Math.max(0, Math.round(p.ts)) : 0,
      important: !!p.important,
    })).filter(p => p.text) : [],
  }
}

export async function curateOutline(req: CuratorRequest): Promise<Outline> {
  // Build the prompt body. Time-bucket the transcript so the LLM can
  // pinpoint when concepts were introduced.
  const transcriptText = req.bucketedTranscript
    .map(b => `[${formatHHMMSS(b.ts)}] ${b.text}`)
    .join('\n')

  const previousOutlineJson = req.previousOutline
    ? JSON.stringify(req.previousOutline, null, 2)
    : 'null'

  const userPrompt = `bucketedTranscript:
${transcriptText}

previousOutline:
${previousOutlineJson}`

  // Try primary, fall back to lite on transient errors.
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await generateOnce(PRIMARY, userPrompt)
    } catch (e) {
      lastErr = e
      if (attempt === MAX_ATTEMPTS - 1 || !isRetryable(e)) break
      const delay = BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 200)
      // eslint-disable-next-line no-console
      console.warn(`[curator:${PRIMARY}] retry ${attempt + 1}/${MAX_ATTEMPTS - 1} after ${delay}ms:`, e instanceof Error ? e.message : e)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  if (lastErr && isRetryable(lastErr)) {
    // eslint-disable-next-line no-console
    console.warn(`[curator] ${PRIMARY} exhausted; falling back to ${FALLBACK}`)
    return await generateOnce(FALLBACK, userPrompt)
  }
  throw lastErr
}

function formatHHMMSS(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

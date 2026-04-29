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
  /** The previous outline, if any. Provided as a HINT only — the prompt
   * explicitly tells the model not to copy it verbatim and to feel free
   * to reorganise / rename / merge / drop sections based on the latest
   * transcript. */
  previousOutline: Outline | null
  /** When true, drop the previousOutline hint and force a full
   * from-scratch reorganisation. We do this every 5th run so the model
   * gets a clean rewrite opportunity even if it's been too conservative
   * about touching old sections in the incremental runs. */
  forceFullRewrite?: boolean
}

const SYSTEM_PROMPT = `あなたは大学生のために講義の「生きたノート (Living Document)」を作成・**書き換える**アシスタントです。
学生がこのノートだけを見て試験勉強できるレベルの質を目指します。
このノートは試験のためだけでなく、学生が「最も覚えるべき・忘れたくない」内容を後で読み返すためのものです。

★★★ もっとも重要な原則: ノートは「追加していく」ものではなく、「毎回 書き直す」ものです ★★★

入力:
- bucketedTranscript: これまでの講義の文字起こし全体(時刻付き)。これが現時点の真実。
- previousOutline: 前回(おそらく 30 秒前)に作成されたノート構造(JSON)。**過去の自分の試案にすぎない**。

仕事の進め方:
1. previousOutline は「前の試案」「ヒント」として参考にする程度で、**そのままコピーしてはいけない**
2. bucketedTranscript 全体を最初から最後まで読み直し、講義の論理構造を**今の理解**で再構築する
3. 講義が進むと文脈が深まり、最初に見えていた構造より良い構造が見えることが多い:
   - 序盤に「Section A: 持続可能性」があったが、後で「サステナビリティの 4 つの次元」と判明したら **再分類**
   - 序盤の定義が曖昧だったが、後で明確になったら **書き直す**
   - 別々のセクションが実は同じテーマだったら **マージ**
   - 不要だったセクションは **削除**
   - セクションの順序を講師の論理に合わせて **再配置**
4. 同じトピックが複数チャンクに分散していたら 1 つのセクションに統合する
5. 不正確な転写(例:「サスナビリティ」→「サステナビリティ」、「政府させて」→「サステナビリティ」)は文脈から判断して正しい表記に統一する
6. **同じノートを 2 回出力する必要はない** — 毎回ゼロから「現在の最良のノート」を書き直すつもりで

各セクションには以下を含める:
  - heading: 簡潔な見出し (1 行) — 講義の進行に応じて見出しも書き直す
  - ts: そのセクションが講義で初めて出現した秒数 (bucketedTranscript の時刻から推定)
  - summary: 1〜2 文でそのセクションの要旨 — 後の文脈で深まったら書き直す
  - key_terms: 用語の定義 (term, definition, ts) — 文脈が深まれば定義も拡充
  - examples: 講師が挙げた具体例 (text, ts)
  - points: 重要なポイント (text, ts, important: true は定義/公式/結論/強調された事項)

質のルール:
1. **階層を保つ**: 複数チャンクで述べられた概念はマージして 1 つのセクションに
2. **講師の論理の流れ**: 導入 → 定義 → 例 → 含意 → 結論 などを反映
3. **重複削除**: 同じことが 2 つのセクションに書かれていたら 1 つに集約
4. **凝縮**: text は日本語で簡潔に(1 行 80 文字以内)
5. **important: true は控えめに**(定義 / 公式 / 結論 / 明示的に強調された箇所のみ)
6. **ts は整数秒**(bucketedTranscript の時刻情報から推定)
7. **空疎な発話のみ**(「えー」「あー」「ですよね」だけ)の場合のみ空 sections を返す。それ以外は必ず構造化する

出力フォーマット (この JSON のみ。説明文・Markdown は禁止):

{
  "title": "<講義全体の主題, 1 行 — 講義が進むと より精度の高いタイトルに更新>",
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

★ 再度確認: previousOutline をそっくりそのまま返してはいけない。新しい transcript を踏まえて、各セクションの内容・構造・順序を **必ず吟味して書き直す**。`

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

  // Drop the previous outline entirely on a full-rewrite run so the model
  // can't anchor to the old structure even subconsciously. Otherwise pass
  // it as a hint with a strong "this is a draft, rewrite freely" framing.
  const previousOutlineJson = req.forceFullRewrite || !req.previousOutline
    ? 'null (this is a full rewrite — produce the best possible outline from scratch)'
    : JSON.stringify(req.previousOutline, null, 2)

  const userPrompt = `bucketedTranscript:
${transcriptText}

previousOutline (前の試案 — 自由に書き直し / 再分類 / マージ / 削除すること):
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

// LLM-as-judge for curated outlines.
//
// Why this exists: improving the curator prompt without an objective
// scoring function is guesswork. Two human observers reading the same
// outline disagree about quality; one Claude session and the next disagree
// even more. This module turns "is the outline good?" into a number, so
// changes can be regression-tested and A/B-compared.
//
// Design choices:
//   - Same Groq Llama family as the curator. Using a different LLM family
//     (e.g., a Gemini judge for Llama curator) sounds like a good idea —
//     reduces correlated bias — but it means a second vendor key and a
//     second free-tier quota. We can revisit if intra-family bias shows up
//     in practice; for now same-family is pragmatic.
//   - JSON-schema structured response. We need machine-readable scores to
//     drive automation; free-form prose would force regex parsing.
//   - 5 axes (coverage / accuracy / hierarchy / conciseness / importance)
//     plus a derived overall score. Each axis is 0-10 with 5 calibrated as
//     "average for this kind of system" — we want headroom to detect both
//     improvements and regressions.
//   - Issues + wins arrays so the judge surfaces SPECIFIC problems, not
//     just numbers. These are the seeds for the next prompt iteration.

import OpenAI from 'openai'
import type { Outline } from './curator.js'

export interface JudgeAxisScores {
  coverage: number          // 0-10. Does the outline cover the lecture's key concepts?
  accuracy: number          // 0-10. Are claims, definitions, and timestamps faithful to the transcript?
  hierarchy: number         // 0-10. Are sections / sub-items grouped sensibly, no orphans, no duplicates?
  conciseness: number       // 0-10. Are bullets tight, or padded / repetitive?
  importance: number        // 0-10. Is `important: true` used appropriately (definitions, conclusions, emphasised points)?
  provenance: number        // 0-10. Are AI-supplemented items correctly flagged as from:'inferred' (vs from:'transcript' for paraphrase)? NOT included in overall weight.
}

export interface JudgeResult extends JudgeAxisScores {
  overall: number           // 0-10. Weighted average; the prompt asks the judge to compute it.
  issues: string[]          // Specific problems with the outline; seeds for the next iteration.
  wins: string[]            // What the outline did well; preserves these in future prompt edits.
}

export interface JudgeRequest {
  /** Time-bucketed transcript (same shape passed to the curator). */
  bucketedTranscript: { ts: number; text: string }[]
  /** The outline being judged. */
  outline: Outline
  /** Optional: a previousOutline to also judge stability of revisions. */
  previousOutline?: Outline | null
}

const JUDGE_MODEL = 'llama-3.3-70b-versatile'
const FALLBACK_MODEL = 'llama-3.1-8b-instant'

const SYSTEM_PROMPT = `あなたは大学講義のリアルタイム要約システムを評価する厳しい採点者です。
出力された outline (講義ノート) と元の transcript を照らし合わせ、6 軸で 0-10 点を付ける。

採点基準:
- coverage (網羅性): transcript の主要概念のうち何 % が outline に反映されているか。漏れているテーマがあれば issues に列挙。
- accuracy (正確性): outline の主張・定義・タイムスタンプが transcript と一致するか。誤った主張・幻覚・聞き間違い由来の誤定義は accuracy 減点。
- hierarchy (構造): セクション分けが論理的か。重複、孤立した bullet、誤ったグルーピングは減点。
- conciseness (簡潔性): bullet が要約されているか。冗長・繰り返しは減点。逆に短すぎて意味不明も減点。
- importance (重要度マーキング): important:true が定義・公式・結論・明示的に強調された箇所に使われているか。乱発・欠落どちらも減点。
- provenance (出典管理): from: 'inferred' 項目が以下を満たすか。0-10。
  - 必要なケースのみ追加: 講師が定義なしに使った用語 / 明白な論理ジャンプ — それ以外の追加は減点
  - 事実的に正確: 推測・不確実情報は大幅減点
  - 1 section につき inferred が 2 個を超えれば軽い減点
  - 全項目に対する inferred 比率が 15% を超えれば軽い減点
  - 全ての inferred 項目に from: 'inferred' flag が付いている (欠落で減点)
  - slot fit: 授業 type と埋まった slot が整合 — procedural 授業で procedure_steps が空で argument_chain だけ埋まれば減点

評価指針:
- 5 点を「平均的なシステムが出すであろう品質」と calibrate する。本当に優秀なら 8-9 点を、欠陥が複数あれば 3-4 点をつけて構わない。
- issues は **具体的に**: 「coverage が低い」ではなく「『ガバナンス』の定義が transcript で 03:20 に出るが outline に欠落」と書く。
- wins も具体的に: 「全 5 主題のうち 4 主題でセクション化が論理的」のように。
- overall は 5 軸を以下の重み付けで合算: coverage 0.25, accuracy 0.30, hierarchy 0.20, conciseness 0.15, importance 0.10。
- provenance は overall に含まれない (別軸として保存)。

出力は以下の JSON のみ:

{
  "coverage": <0-10>,
  "accuracy": <0-10>,
  "hierarchy": <0-10>,
  "conciseness": <0-10>,
  "importance": <0-10>,
  "provenance": <0-10>,
  "overall": <0-10>,
  "issues": ["...", "..."],
  "wins": ["...", "..."]
}`

let _client: OpenAI | undefined
function client(): OpenAI {
  if (!_client) {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) throw new Error('GROQ_API_KEY not set — required for judge')
    _client = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' })
  }
  return _client
}

async function judgeOnce(modelName: string, userPrompt: string): Promise<JudgeResult> {
  // Same GPT-5-family constraint as curator.ts: GPT-5 nano / mini /
  // standard reject anything other than the default temperature. Older
  // models (Llama, Claude, GPT-4o family) still accept temperature: 0
  // for deterministic scoring, so we keep that branch intact.
  const isGpt5Family = modelName.startsWith('gpt-5')
  const res = await client().chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    ...(isGpt5Family ? {} : { temperature: 0 }),
  })
  const text = res.choices[0]?.message?.content ?? '{}'
  const parsed = JSON.parse(text) as Partial<JudgeResult>
  return {
    coverage: clamp(parsed.coverage ?? 0),
    accuracy: clamp(parsed.accuracy ?? 0),
    hierarchy: clamp(parsed.hierarchy ?? 0),
    conciseness: clamp(parsed.conciseness ?? 0),
    importance: clamp(parsed.importance ?? 0),
    // provenance defaults to 0 until Task 10 adds the axis to SYSTEM_PROMPT.
    // Task 11 will also handle default-on-missing for loaded baseline JSON.
    provenance: clamp(parsed.provenance ?? 0),
    overall: clamp(parsed.overall ?? 0),
    issues: Array.isArray(parsed.issues) ? parsed.issues.filter(s => typeof s === 'string') : [],
    wins: Array.isArray(parsed.wins) ? parsed.wins.filter(s => typeof s === 'string') : [],
  }
}

function clamp(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10))
}

// Same TPM budget concern as curator.ts. Judge prompt also includes the
// full outline JSON (which can run 2-4 K tokens for a long lecture), so
// the transcript budget here has to be smaller than curator's. Empirically
// 10 K characters lands the total request around 9-11 K tokens, comfortably
// under the 12 K free-tier cap with a margin for any retry the SDK does.
const JUDGE_TRANSCRIPT_CHAR_BUDGET = 10_000

export async function judgeOutline(req: JudgeRequest): Promise<JudgeResult> {
  // Tail-window the transcript so we stay under the Groq TPM cap on long
  // lectures. The judge gets the most recent material in full; older
  // material is summarised by the outline anyway, which the judge can
  // also see.
  const reversedKept: typeof req.bucketedTranscript = []
  let used = 0
  for (let i = req.bucketedTranscript.length - 1; i >= 0; i--) {
    const cost = req.bucketedTranscript[i].text.length + 12
    if (reversedKept.length > 0 && used + cost > JUDGE_TRANSCRIPT_CHAR_BUDGET) break
    reversedKept.push(req.bucketedTranscript[i])
    used += cost
  }
  const included = reversedKept.reverse()
  const droppedCount = req.bucketedTranscript.length - included.length
  const transcript = included
    .map(b => `[${formatHHMMSS(b.ts)}] ${b.text}`)
    .join('\n')
    + (droppedCount > 0 ? `\n\n[NOTE: 古い ${droppedCount} 個のチャンクは省略 — outline で評価]` : '')
  const outlineJson = JSON.stringify(req.outline, null, 2)
  const prevSection = req.previousOutline
    ? `\n\nprevious outline (一回前のバージョン, 構造の安定性も採点に加味):\n${JSON.stringify(req.previousOutline, null, 2)}`
    : ''
  const userPrompt = `transcript:
${transcript}

outline (採点対象):
${outlineJson}${prevSection}`

  try {
    return await judgeOnce(JUDGE_MODEL, userPrompt)
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
    const retryable = msg.includes('429') || msg.includes('503') || msg.includes('500')
    if (!retryable) throw e
    // eslint-disable-next-line no-console
    console.warn(`[judge] ${JUDGE_MODEL} failed; falling back to ${FALLBACK_MODEL}`)
    return await judgeOnce(FALLBACK_MODEL, userPrompt)
  }
}

function formatHHMMSS(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

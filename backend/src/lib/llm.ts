import OpenAI from 'openai'

export interface NoteItem {
  ts: number          // seconds from video start
  text: string
  important: boolean
}

export interface SummaryRequest {
  newTranscript: string
  priorContext: string  // last N notes joined
  startTimeSec: number  // absolute time of newTranscript start
}

export interface SummaryResult {
  notes: NoteItem[]
}

export function formatTimestamp(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const SYSTEM_PROMPT = `あなたは大学の講義をリアルタイムで聞きながら、学習ノートを作成するアシスタントです。
学生がノートをサボれるよう、講義の流れを追える充実したノートを作るのが目的です。

入力:
- これまでのノート(priorContext)
- 直近の講義音声の文字起こし(newTranscript)
- 新規分の動画開始時刻 (startTimeSec, 秒)

ノート化すべき内容(積極的に拾う):
- 講義のテーマ・トピックの導入
- 用語の定義・説明
- 重要な概念・公式・結論
- 講師の主張・解釈
- 具体例・事例の要点
- 講師が強調・繰り返している箇所
- 質問の投げかけ・章立て

出力ルール:
1. newTranscript の長さに応じて 1〜3 件抽出する。空疎な発話(「えー」「あー」「ですよね」だけ等) でない限り、必ず 1 件以上抽出する。
2. 各ノートに ts (秒, 整数) を含める。startTimeSec を起点に、newTranscript 内での出現順から相対時刻を推定する。
3. important: true は (a) 定義 / 公式 / 結論 / 強調された重要事項。それ以外は false。
4. text は日本語で簡潔に (1 行 60 文字以内)。直接引用ではなく要約・凝縮する。語尾の「です・ます」も省略可。
5. priorContext に既出の内容と完全重複は避ける。ただし「定義の発展」「具体例の追加」など補足は新規ノートとして可。
6. 出力は以下の JSON のみ。説明文・Markdown は禁止:

{ "notes": [ { "ts": <秒>, "text": "<要約>", "important": <boolean> } ] }

7. newTranscript が完全に内容のない発話のみの場合のみ { "notes": [] } を返す。それ以外は必ず抽出する。`

// Retry transient server errors with exponential backoff before giving up.
// Keeps the per-chunk failure rate low without adding meaningful latency on
// the happy path.
const MAX_ATTEMPTS = 4
const BASE_DELAY_MS = 600

function isRetryableLLMError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return (
    msg.includes('503') ||
    msg.includes('service unavailable') ||
    msg.includes('500') ||
    msg.includes('internal') ||
    msg.includes('overloaded') ||
    msg.includes('high demand') ||
    msg.includes('429') // rate-limited; backoff often clears it
  )
}

// We use Groq's hosted Llama 3.3 70B as the primary summarisation model and
// keep Gemini-shaped function names for backwards compatibility. Why Groq
// instead of Gemini for the LLM step too:
//   - Single-vendor: STT + LLM share one API key + one rate-limit pool, so
//     the operator only manages one secret.
//   - Free tier far more generous than Gemini's free tier (which hit
//     "limit: 0" for both 2.0-flash and 2.0-flash-lite during testing —
//     the new-account Gemini free tier is unusably tight): Groq Llama
//     3.3 70B is 30 RPM / 6,000 RPD / 12,000 TPM on the free tier,
//     covering ~16 h/day of 10-second-chunked lecture for a single user.
//   - Japanese quality on Llama 3.3 70B is competitive with Gemini Flash
//     for summarisation tasks; the prompt is simple enough that model
//     differences mostly disappear.
//   - Fallback: Llama 3.1 8B Instant — same provider, lower-cost, useful
//     when the primary hits a transient 5xx or its own ceiling.
const PRIMARY_MODEL = 'llama-3.3-70b-versatile'
const FALLBACK_MODEL = 'llama-3.1-8b-instant'

// Groq exposes an OpenAI-compatible chat completions endpoint, so we
// reuse the OpenAI SDK and target Groq's baseURL. The same SDK is also
// used in stt.ts (with a separate client instance there).
let _client: OpenAI | undefined
function client(): OpenAI {
  if (!_client) {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) throw new Error('GROQ_API_KEY not set — required for LLM summarisation')
    _client = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' })
  }
  return _client
}

async function generateWithModel(
  modelName: string,
  userPrompt: string,
  attempts: number,
): Promise<SummaryResult> {
  let lastErr: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await client().chat.completions.create({
        model: modelName,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        // JSON mode — Groq's Llama models support response_format: 'json_object'
        // when the system prompt contains the literal word "JSON" (which ours
        // does, in the schema example).
        response_format: { type: 'json_object' },
        temperature: 0.2,
      })
      const text = res.choices[0]?.message?.content ?? '{}'
      const parsed = JSON.parse(text) as SummaryResult
      return { notes: Array.isArray(parsed.notes) ? parsed.notes : [] }
    } catch (e) {
      lastErr = e
      if (attempt === attempts - 1 || !isRetryableLLMError(e)) break
      const delay = BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 250)
      // eslint-disable-next-line no-console
      console.warn(`[llm:${modelName}] retry ${attempt + 1}/${attempts - 1} after ${delay}ms:`, e instanceof Error ? e.message : e)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastErr
}

export async function summarizeChunk(req: SummaryRequest): Promise<SummaryResult> {
  const userPrompt = `priorContext:
${req.priorContext || '(なし)'}

startTimeSec: ${req.startTimeSec}

newTranscript:
${req.newTranscript}`

  try {
    return await generateWithModel(PRIMARY_MODEL, userPrompt, MAX_ATTEMPTS)
  } catch (e) {
    if (!isRetryableLLMError(e)) throw e
    // eslint-disable-next-line no-console
    console.warn(`[llm] ${PRIMARY_MODEL} exhausted; falling back to ${FALLBACK_MODEL}`)
    return await generateWithModel(FALLBACK_MODEL, userPrompt, 2)
  }
}

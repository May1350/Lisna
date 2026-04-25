import { GoogleGenerativeAI } from '@google/generative-ai'

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

const SYSTEM_PROMPT = `あなたは大学の講義内容を要点ノートに変換するアシスタントです。

入力:
- これまでの要点ノート(コンテキスト)
- 直近の講義音声の文字起こし(新規分)
- 新規分の講義内動画開始時刻 (秒)

出力ルール:
1. 新規分の中から、学習価値の高い要点を 1〜5件抽出する
2. 各要点は出現タイミング(秒)を含める。文字起こし内では順序通りに出現するため、ts は startTimeSec を起点に推定する
3. 重要度を判定: 定義/公式/結論/重要事項 = important: true、それ以外 = false
4. 出力は必ず以下の JSON のみ。説明文や Markdown は禁止。

{ "notes": [ { "ts": <秒, 整数>, "text": "<日本語の要点1行>", "important": <boolean> } ] }

5. text は日本語で、簡潔に(1行 60 文字以内)。
6. 既に priorContext に含まれている内容は重複させない。
7. 新規分にノート抽出に値する内容がない場合は { "notes": [] } を返す。`

let _client: GoogleGenerativeAI | undefined
function client(): GoogleGenerativeAI {
  if (!_client) _client = new GoogleGenerativeAI(process.env.GOOGLE_GENAI_API_KEY!)
  return _client
}

export async function summarizeChunk(req: SummaryRequest): Promise<SummaryResult> {
  const model = client().getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: 'application/json' },
  })
  const userPrompt = `priorContext:
${req.priorContext || '(なし)'}

startTimeSec: ${req.startTimeSec}

newTranscript:
${req.newTranscript}`

  const res = await model.generateContent(userPrompt)
  const text = res.response.text()
  const parsed = JSON.parse(text) as SummaryResult
  return { notes: Array.isArray(parsed.notes) ? parsed.notes : [] }
}

import OpenAI from 'openai'

export interface TranscriptResult {
  text: string
  language?: string
}

let _client: OpenAI | undefined
function client(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _client
}

export async function transcribeChunk(
  audio: ArrayBuffer,
  mime: string,
  hintLanguage?: string
): Promise<TranscriptResult> {
  if (audio.byteLength === 0) throw new Error('Audio buffer is empty')
  const file = new File([audio], 'chunk.webm', { type: mime })
  const res = await client().audio.transcriptions.create({
    file,
    model: 'gpt-4o-mini-transcribe',
    language: hintLanguage,
    response_format: 'json',
  })
  return { text: res.text }
}

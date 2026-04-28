import OpenAI from 'openai'

// We deliberately speak to Groq via the OpenAI SDK — Groq exposes an
// OpenAI-compatible REST shape, so the only thing that changes vs. the old
// OpenAI-direct setup is the baseURL and the model name. The SDK does NOT
// validate the host, so this works cleanly.
//
// Why Groq Whisper Large-v3 over OpenAI gpt-4o-mini-transcribe:
//   - Free tier covers ~8h/day of audio (28,800 sec/day on whisper-large-v3),
//     which is plenty for an individual student / small beta.
//   - Whisper Large-v3 has lower Japanese WER (~5-7%) than the previous
//     gpt-4o-mini-transcribe (~6-8%), so this is a quality upgrade too.
//   - Drop-in replacement: same .audio.transcriptions.create call.
//
// Falls back to OpenAI if GROQ_API_KEY is unset (defense in depth — local dev
// or future revert without code change).

export interface TranscriptResult {
  text: string
  language?: string
}

interface SttBackend {
  client: OpenAI
  model: string
  provider: 'groq' | 'openai'
}

let _backend: SttBackend | undefined

function backend(): SttBackend {
  if (_backend) return _backend
  const groqKey = process.env.GROQ_API_KEY
  if (groqKey) {
    _backend = {
      client: new OpenAI({ apiKey: groqKey, baseURL: 'https://api.groq.com/openai/v1' }),
      model: 'whisper-large-v3',
      provider: 'groq',
    }
  } else {
    _backend = {
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      model: 'gpt-4o-mini-transcribe',
      provider: 'openai',
    }
  }
  return _backend
}

// Map MIME → filename extension. Groq routes the upload to its demuxer based
// on the filename suffix in the multipart form, so picking the right
// extension matters: 'audio/wav' → '.wav', 'audio/webm' → '.webm', etc.
function extensionFor(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase()
  switch (base) {
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav': return 'wav'
    case 'audio/mp3':
    case 'audio/mpeg': return 'mp3'
    case 'audio/mp4':
    case 'audio/m4a':
    case 'audio/x-m4a': return 'm4a'
    case 'audio/ogg':
    case 'audio/opus': return 'ogg'
    case 'audio/webm': return 'webm'
    default: return 'webm'
  }
}

export async function transcribeChunk(
  audio: ArrayBuffer,
  mime: string,
  hintLanguage?: string
): Promise<TranscriptResult> {
  if (audio.byteLength === 0) throw new Error('Audio buffer is empty')
  const ext = extensionFor(mime)
  // Strip codec qualifier ('audio/webm;codecs=opus' → 'audio/webm'); Groq
  // dislikes the qualifier in the multipart Content-Type header.
  const cleanMime = mime.split(';')[0].trim()
  const file = new File([audio], `chunk.${ext}`, { type: cleanMime })
  const b = backend()
  const res = await b.client.audio.transcriptions.create({
    file,
    model: b.model,
    language: hintLanguage,
    response_format: 'json',
  })
  return { text: res.text }
}

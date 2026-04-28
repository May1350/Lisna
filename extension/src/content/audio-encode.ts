// WebM/Opus → WAV(PCM 16-bit mono 16kHz) converter.
//
// Why we do this client-side: Groq's Whisper endpoint runs the audio through
// ffmpeg, and MediaRecorder-produced WebM fragments (especially after our
// stop()/start() chunking pattern) trigger "could not process file" 400s on
// Groq even though OpenAI's gpt-4o-mini-transcribe accepted them. WAV is
// universally parseable — no demuxer ambiguity. Whisper internally resamples
// everything to 16 kHz mono, so encoding to that target now also reduces
// bandwidth (15 s WAV @ 16 kHz mono 16-bit ≈ 480 KB; we were sending 240 KB
// Opus, so ~2× bandwidth — still well within Groq's 25 MB/file limit).
//
// Decoding via AudioContext.decodeAudioData is robust: if it CAN'T decode the
// WebM blob, that's an early signal the chunk itself is malformed and no STT
// would have accepted it anyway, so we surface the error instead of silently
// dropping.

const TARGET_SAMPLE_RATE = 16000  // Whisper's native rate
const TARGET_CHANNELS = 1         // mono

let _ctx: AudioContext | null = null
function audioCtx(): AudioContext {
  // Reuse a single AudioContext for the lifetime of capture — creating one
  // per chunk is wasteful and can hit the per-page AudioContext cap (Chrome
  // limits to ~6 simultaneously alive contexts).
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext()
  }
  return _ctx
}

export async function webmBlobToWav(webm: Blob): Promise<Blob> {
  const buf = await webm.arrayBuffer()
  // decodeAudioData mutates / detaches the buffer, so pass a fresh copy if
  // we're going to retain the original anywhere. Here we don't, so just pass.
  const audioBuf = await audioCtx().decodeAudioData(buf)
  const mono16k = downmixAndResample(audioBuf, TARGET_SAMPLE_RATE, TARGET_CHANNELS)
  return encodeWavBlob(mono16k, TARGET_SAMPLE_RATE, TARGET_CHANNELS)
}

// Downmix to mono (avg channels) + linear-resample to targetSampleRate.
// Linear resampling is "good enough" for speech — Whisper is robust to
// minor aliasing and we're going from typical 48 kHz down to 16 kHz, which
// is a clean 3:1 ratio with little energy above 8 kHz that matters for
// speech.
function downmixAndResample(
  buffer: AudioBuffer,
  targetSampleRate: number,
  targetChannels: number,
): Float32Array {
  const srcRate = buffer.sampleRate
  const srcLen = buffer.length
  // 1) downmix to mono
  let mono: Float32Array
  if (buffer.numberOfChannels === 1) {
    mono = buffer.getChannelData(0)
  } else {
    mono = new Float32Array(srcLen)
    const channels: Float32Array[] = []
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
    const inv = 1 / buffer.numberOfChannels
    for (let i = 0; i < srcLen; i++) {
      let sum = 0
      for (let c = 0; c < channels.length; c++) sum += channels[c][i]
      mono[i] = sum * inv
    }
  }
  // 2) resample to target rate (linear interpolation)
  if (srcRate === targetSampleRate) return mono
  const ratio = srcRate / targetSampleRate
  const dstLen = Math.floor(srcLen / ratio)
  const dst = new Float32Array(dstLen)
  for (let i = 0; i < dstLen; i++) {
    const srcIndex = i * ratio
    const i0 = Math.floor(srcIndex)
    const i1 = Math.min(i0 + 1, srcLen - 1)
    const t = srcIndex - i0
    dst[i] = mono[i0] * (1 - t) + mono[i1] * t
  }
  // targetChannels is currently always 1; keeping the signature for
  // future-proofing.
  void targetChannels
  return dst
}

// Standard 44-byte RIFF WAV header followed by little-endian 16-bit PCM.
function encodeWavBlob(samples: Float32Array, sampleRate: number, numChannels: number): Blob {
  const numFrames = samples.length / numChannels
  const bytesPerSample = 2
  const dataSize = numFrames * numChannels * bytesPerSample
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)
  let pos = 0
  const writeStr = (s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(pos++, s.charCodeAt(i))
  }
  const writeU32 = (n: number): void => { view.setUint32(pos, n, true); pos += 4 }
  const writeU16 = (n: number): void => { view.setUint16(pos, n, true); pos += 2 }

  writeStr('RIFF')
  writeU32(36 + dataSize)
  writeStr('WAVE')
  writeStr('fmt ')
  writeU32(16)                                        // fmt chunk size
  writeU16(1)                                         // PCM format
  writeU16(numChannels)
  writeU32(sampleRate)
  writeU32(sampleRate * numChannels * bytesPerSample) // byte rate
  writeU16(numChannels * bytesPerSample)              // block align
  writeU16(16)                                        // bits per sample
  writeStr('data')
  writeU32(dataSize)

  // Float32 [-1, 1] → Int16 LE
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    pos += 2
  }
  return new Blob([buf], { type: 'audio/wav' })
}

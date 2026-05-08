// WAV (PCM 16-bit mono 16kHz) encoding helpers used by audio-capture.ts.
//
// History: this file used to also export `webmBlobToWav` for converting
// MediaRecorder WebM/Opus blobs into WAV. The current capture path
// (audio-capture.ts) feeds the AudioContext directly via Web Audio's
// ScriptProcessor — no WebM ever exists — so the WebM→WAV converter
// was deleted along with `audioCtx()`. Only `downmixAndResample` and
// `encodeWavBlob` remain because audio-capture still wraps its raw
// Float32 PCM in `AudioBufferLike` and pipes it through these
// functions to produce the final WAV blob the backend expects.

// Minimal AudioBuffer-shaped interface so callers can pass a thin
// wrapper around a raw Float32Array (the continuous-capture path in
// audio-capture.ts) without allocating a fresh real AudioBuffer just
// to get resampled.
export interface AudioBufferLike {
  length: number
  numberOfChannels: number
  sampleRate: number
  getChannelData(channel: number): Float32Array
}

// Downmix to mono (avg channels) + linear-resample to targetSampleRate.
// Linear resampling is "good enough" for speech — Whisper is robust to
// minor aliasing and we're going from typical 48 kHz down to 16 kHz, which
// is a clean 3:1 ratio with little energy above 8 kHz that matters for
// speech.
export function downmixAndResample(
  buffer: AudioBufferLike,
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
export function encodeWavBlob(samples: Float32Array, sampleRate: number, numChannels: number): Blob {
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

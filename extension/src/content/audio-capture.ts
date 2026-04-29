// Continuous-stream audio capture, used by the content script to feed STT.
//
// Why we do NOT use MediaRecorder anymore (the previous implementation):
//   The old loop was `recorder.start() → 10s → requestData() → stop() → start()`.
//   That stop/start cycle has a small (~50 ms) gap during which the audio
//   track is not being captured, so syllables fall on the floor right at
//   each chunk boundary. The user sees this as "live captions cut off
//   between chunks" — text restarts mid-word every 10 seconds.
//
// New approach: Web Audio API.
//   1. AudioContext.createMediaStreamSource(video.captureStream().audio)
//      → continuous Float32 PCM samples, no internal buffering boundaries.
//   2. ScriptProcessorNode (deprecated but still supported in all current
//      Chromium-based browsers) emits a callback with each ~4096-sample
//      buffer, which we accumulate.
//   3. Every CHUNK_DURATION_MS milliseconds of accumulated audio we flush:
//      downmix to mono → resample to 16 kHz → encode as 16-bit WAV → emit
//      via onChunk.
//   The capture is uninterrupted across chunk boundaries, so no audio is
//   lost between chunks. The chunk boundaries are pure clock-driven flushes
//   on a continuous stream.
//
//   NOTE on ScriptProcessor deprecation: AudioWorklet is the modern
//   replacement, but it requires a separate worklet module, MessagePort
//   plumbing, and a CSP-compatible blob URL — all extra ceremony for the
//   same outcome. ScriptProcessor still works fine in Chrome and is the
//   right pragmatic choice for this extension.

import { encodeWavBlob, downmixAndResample, type AudioBufferLike } from './audio-encode'

export interface AudioChunk {
  startTimeSec: number
  durationSec: number
  blob: Blob
  mime: string
}

const CHUNK_DURATION_MS = 10_000
const TARGET_SAMPLE_RATE = 16_000   // Whisper's native rate
const SCRIPT_PROCESSOR_BUFFER = 4096

interface ProcessorNodeWithDisconnect {
  disconnect(): void
  onaudioprocess: ((e: AudioProcessingEvent) => void) | null
}

export class AudioCapture {
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ProcessorNodeWithDisconnect | null = null
  private samples: Float32Array[] = []
  private samplesAccum = 0
  private targetSampleCount = 0
  private chunkStartedAtVideoTime = 0
  private chunkStartedAtRealTime = 0
  private active = false

  constructor(
    private video: HTMLVideoElement,
    private onChunk: (c: AudioChunk) => void,
  ) {}

  start(): void {
    const stream = this.video.captureStream()
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) throw new Error('No audio track in video')
    const audioStream = new MediaStream(audioTracks)

    // Default sample rate (often 48000). We resample to TARGET_SAMPLE_RATE
    // at flush time. Specifying a custom sampleRate to the constructor
    // would also work but Chrome silently ignores it for MediaStream
    // sources, so do the resample explicitly.
    const ctx = new AudioContext()
    this.ctx = ctx
    this.source = ctx.createMediaStreamSource(audioStream)

    // ScriptProcessor is deprecated but still functions. Buffer size 4096
    // means callbacks fire ~every 85 ms at 48 kHz — plenty fine-grained
    // for chunk-flush bookkeeping.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc = (ctx as any).createScriptProcessor(SCRIPT_PROCESSOR_BUFFER, 1, 1) as ProcessorNodeWithDisconnect & ScriptProcessorNode
    this.processor = proc
    this.targetSampleCount = Math.round(ctx.sampleRate * (CHUNK_DURATION_MS / 1000))
    this.chunkStartedAtVideoTime = this.video.currentTime
    this.chunkStartedAtRealTime = Date.now()
    this.active = true

    proc.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.active) return
      const input = e.inputBuffer.getChannelData(0)
      // The buffer is reused by the audio thread, so copy out.
      const copy = new Float32Array(input.length)
      copy.set(input)
      this.samples.push(copy)
      this.samplesAccum += input.length
      if (this.samplesAccum >= this.targetSampleCount) {
        // We're on the audio thread here (well, dispatched from it). Run
        // the encode + emit asynchronously so the audio-process callback
        // returns immediately and we don't drop any samples.
        const samplesAtFlush = this.samples
        const sampleCountAtFlush = this.samplesAccum
        const startVideo = this.chunkStartedAtVideoTime
        const realDurationMs = Date.now() - this.chunkStartedAtRealTime
        // Reset accumulator BEFORE async work so subsequent buffers
        // accumulate into a fresh window, not the one we just snapshotted.
        this.samples = []
        this.samplesAccum = 0
        this.chunkStartedAtVideoTime = this.video.currentTime
        this.chunkStartedAtRealTime = Date.now()
        const sourceSampleRate = ctx.sampleRate
        void this.encodeAndEmit(samplesAtFlush, sampleCountAtFlush, sourceSampleRate, startVideo, realDurationMs / 1000)
      }
    }

    this.source.connect(proc)
    // ScriptProcessor only fires onaudioprocess when connected to a
    // destination. Connecting to ctx.destination would also play the
    // audio out the speakers (unwanted feedback). Trick: connect to a
    // zero-gain node so the data flows but isn't audible.
    const muted = ctx.createGain()
    muted.gain.value = 0
    proc.connect(muted as unknown as AudioNode)
    muted.connect(ctx.destination)
  }

  private async encodeAndEmit(
    samplesArr: Float32Array[],
    totalLength: number,
    sourceSampleRate: number,
    startTimeSec: number,
    durationSec: number,
  ): Promise<void> {
    try {
      // Concatenate the small ScriptProcessor buffers into one Float32Array.
      const flat = new Float32Array(totalLength)
      let offset = 0
      for (const s of samplesArr) {
        flat.set(s, offset)
        offset += s.length
      }
      // Downmix is a no-op (already mono from the input channel) but the
      // resample step matters: source is typically 48 kHz, target 16 kHz.
      const resampled = downmixAndResample(
        wrapAsAudioBuffer(flat, sourceSampleRate),
        TARGET_SAMPLE_RATE,
        1,
      )
      const wav = encodeWavBlob(resampled, TARGET_SAMPLE_RATE, 1)
      // Defensive: drop chunks that came out absurdly small. This used to
      // happen with MediaRecorder when capture started while the video was
      // paused; with the continuous Web Audio path it's rarer but still
      // possible if the user pauses for most of a 10 s window.
      if (wav.size < 80_000) {
        // eslint-disable-next-line no-console
        console.warn('[SH:audio-capture] dropping near-empty chunk', { size: wav.size, durationSec })
        return
      }
      this.onChunk({
        startTimeSec,
        durationSec,
        blob: wav,
        mime: 'audio/wav',
      })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[SH:audio-capture] encode failed; dropping chunk', e)
    }
  }

  stop(): void {
    this.active = false
    try { this.processor?.disconnect() } catch { /* ignore */ }
    try { this.source?.disconnect() } catch { /* ignore */ }
    try { void this.ctx?.close() } catch { /* ignore */ }
    this.processor = null
    this.source = null
    this.ctx = null
    this.samples = []
    this.samplesAccum = 0
  }
}

// Helper: wrap a raw Float32Array of mono samples into the minimal
// AudioBuffer-shaped interface that downmixAndResample accepts. Avoids a
// real AudioBuffer allocation; downmixAndResample only reads .length,
// .numberOfChannels, .sampleRate and .getChannelData(0).
function wrapAsAudioBuffer(samples: Float32Array, sampleRate: number): AudioBufferLike {
  return {
    length: samples.length,
    numberOfChannels: 1,
    sampleRate,
    getChannelData: () => samples,
  }
}

export async function blobToBase64(b: Blob): Promise<string> {
  const buf = await b.arrayBuffer()
  let s = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

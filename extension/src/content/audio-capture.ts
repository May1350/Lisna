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
// First chunk is short (2 s) so the user sees a transcript line and
// adopts the canonical session id within ~3–4 s of clicking start
// (2 s capture + 1–2 s STT) instead of ~13–18 s. Subsequent chunks
// revert to CHUNK_DURATION_MS so we don't blow up STT cost or per-chunk
// overhead. 2 s is the floor where Whisper still produces useful output —
// shorter than that and segments become noisy / hallucination-prone.
const FIRST_CHUNK_DURATION_MS = 2_000
const TARGET_SAMPLE_RATE = 16_000   // Whisper's native rate
const SCRIPT_PROCESSOR_BUFFER = 4096
// Scrub-detection threshold. Between two consecutive onaudioprocess
// ticks the video should only advance by `tick_interval × playbackRate`
// — about 85 ms at default settings, even at 4× playback it's just
// 340 ms. A jump larger than this means the user grabbed the scrubber
// and seeked. 2 s is well above the noise floor and below the smallest
// realistic scrub.
const SCRUB_JUMP_SEC = 2

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
  private chunksFlushed = 0
  private chunkStartedAtVideoTime = 0
  // Last video.currentTime we saw in onaudioprocess. Used to detect
  // scrubs: between consecutive ticks (~85 ms apart) the video time
  // should only advance by ~85 ms × playbackRate. A jump larger than
  // SCRUB_JUMP_SEC means the user dragged the scrubber.
  private lastObservedVideoTime = -1
  private active = false

  constructor(
    private video: HTMLVideoElement,
    private onChunk: (c: AudioChunk) => void,
  ) {}

  start(): void {
    // Idempotence guard. Without this a double-call would create a
    // second AudioContext + MediaStreamAudioSourceNode + ScriptProcessor
    // and lose the reference to the first set, leaking the original
    // AudioContext (Chrome caps simultaneous AudioContexts at ~6 per
    // page, after which new() throws). Caller is expected to stop()
    // first if they want to restart capture.
    if (this.active) {
      // eslint-disable-next-line no-console
      console.warn('[SH:audio-capture] start() called while already active; ignoring')
      return
    }

    // If a previous start() threw mid-setup we may hold partial state
    // (this.ctx set but this.active === false). Tear it down so this
    // attempt begins from a clean slate — otherwise the user is stuck
    // in a permanent stale state where every retry would bail out.
    if (this.ctx) {
      // eslint-disable-next-line no-console
      console.warn('[SH:audio-capture] cleaning stale partial state from prior failed start()')
      try { this.stop() } catch { /* ignore */ }
    }

    try {
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
    // First chunk uses the smaller window so the user sees a transcript
    // within seconds of clicking start. After it flushes, encodeAndEmit
    // bumps targetSampleCount up to CHUNK_DURATION_MS for steady-state.
    this.chunksFlushed = 0
    this.targetSampleCount = Math.round(ctx.sampleRate * (FIRST_CHUNK_DURATION_MS / 1000))
    this.chunkStartedAtVideoTime = this.video.currentTime
    this.active = true

    proc.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.active) return

      // Pause guard. video.captureStream() keeps the audio MediaStream
      // track open while the underlying <video> is paused, and Chrome
      // continues to deliver zero-amplitude buffers at the source sample
      // rate. If we let those accumulate two things go wrong:
      //
      //   1. The chunk's `start_time_sec` (= chunkStartedAtVideoTime) is
      //      pinned to the pause point, but the chunk's *content* starts
      //      mixing in whatever real audio comes when the user resumes.
      //      So the transcript ts the curator sees no longer matches the
      //      moment the words were spoken — timestamps appear to drift
      //      while paused.
      //   2. realDurationMs grows during pause → over-counts quota for
      //      audio that contains nothing.
      //
      // Skip processing entirely while paused. The accumulator stays
      // exactly where it was, so when playback resumes the in-flight
      // chunk just continues. That keeps `start_time_sec` accurate and
      // quota-honest.
      const cur = this.video.currentTime
      if (this.video.paused) {
        // Update the watermark so the resume tick doesn't see a "jump"
        // from where we last observed → where we are now (same place).
        this.lastObservedVideoTime = cur
        return
      }

      // Scrub guard. We can't compute "expected" video time from sample
      // count alone — at 2× playback the video advances 2 s of content
      // per 1 s of wall clock while sample rate is unchanged, so a
      // sample-rate-based estimate would always lag and falsely trigger
      // the guard (this is what was breaking 2× playback entirely:
      // every chunk was reset before it could fill, so no chunks ever
      // fired and the modal stayed in "処理中..." forever).
      //
      // Correct approach: just watch for sudden jumps in video time
      // between consecutive ticks. Tick interval is ~85 ms, even at
      // 4× playback that's only ~340 ms of video content per tick.
      // A jump of >2 s means the user scrubbed. Drop the in-flight
      // chunk's samples (they're audio from a different segment) and
      // re-anchor at the new position.
      if (this.lastObservedVideoTime >= 0
          && Math.abs(cur - this.lastObservedVideoTime) > SCRUB_JUMP_SEC) {
        this.samples = []
        this.samplesAccum = 0
        this.chunkStartedAtVideoTime = cur
        this.lastObservedVideoTime = cur
        return
      }
      this.lastObservedVideoTime = cur

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
        // Use the audio's *content* duration, not wall-clock. With the
        // pause/scrub guards above the wall clock can be wildly longer
        // than the actual audio content (e.g. user paused for 5 min
        // mid-chunk then resumed). Quota is billed on duration_sec, so
        // drifting it would over-charge the user for content they never
        // heard. Sample-count divided by sample-rate is always exact.
        const audioDurationSec = sampleCountAtFlush / ctx.sampleRate
        // Reset accumulator BEFORE async work so subsequent buffers
        // accumulate into a fresh window, not the one we just snapshotted.
        this.samples = []
        this.samplesAccum = 0
        this.chunkStartedAtVideoTime = this.video.currentTime
        // Switch to steady-state window after the first (short) flush.
        this.chunksFlushed += 1
        if (this.chunksFlushed === 1) {
          this.targetSampleCount = Math.round(ctx.sampleRate * (CHUNK_DURATION_MS / 1000))
        }
        const sourceSampleRate = ctx.sampleRate
        void this.encodeAndEmit(samplesAtFlush, sampleCountAtFlush, sourceSampleRate, startVideo, audioDurationSec)
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
    } catch (e) {
      // Tear down whatever was partially constructed before re-throwing
      // so the next start() begins from a clean state instead of being
      // permanently rejected by the stale-partial-state guard above.
      try { this.stop() } catch { /* best effort */ }
      throw e
    }
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
      // Defensive: drop chunks that came out absurdly small relative to
      // their nominal duration. Nominal WAV bytes = 16 kHz × 2 bytes ×
      // duration; we tolerate ≥40% of that. Using duration (not a fixed
      // 80 KB floor) lets the same guard work for both the 3 s first
      // chunk and the 10 s steady-state chunks.
      const minBytes = Math.floor(TARGET_SAMPLE_RATE * 2 * durationSec * 0.4)
      if (wav.size < minBytes) {
        // eslint-disable-next-line no-console
        console.warn('[SH:audio-capture] dropping near-empty chunk', { size: wav.size, minBytes, durationSec })
        return
      }
      // Silence guard. video.captureStream() keeps emitting 0-amplitude
      // samples while the video is paused, so we'd happily ship 320 KB of
      // zeros to STT and then watch Whisper hallucinate "you / Thanks for
      // watching" into the live caption strip. Skip the chunk if the RMS
      // amplitude is below the noise floor — this catches paused-video,
      // muted-tab, and dead-air-between-segments cases at the source.
      let sumSq = 0
      for (let i = 0; i < flat.length; i++) sumSq += flat[i] * flat[i]
      const rms = Math.sqrt(sumSq / Math.max(1, flat.length))
      // 0.003 ≈ -50 dBFS. Real lecture speech sits around 0.05–0.2 RMS.
      // Background hum / mic preamp noise is ~0.001. 0.003 splits the two
      // cleanly without false positives on quiet speakers.
      if (rms < 0.003) {
        // eslint-disable-next-line no-console
        console.info('[SH:audio-capture] skipping silent chunk', { rms: rms.toFixed(5), durationSec })
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
  const bytes = new Uint8Array(buf)
  // Each WAV chunk is ~320 KB (16 kHz × 16-bit × 10 s). The naive
  // `btoa(String.fromCharCode(...bytes))` form rebuilds the string one
  // character at a time and dominates the chunk-emit hot path. Chunking
  // into 32 KB windows is ~10× faster while producing the byte-identical
  // base64 output.
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(binary)
}

export interface Slide {
  ts: number
  blob: Blob
  mime: 'image/jpeg'
}

const SAMPLE_INTERVAL_MS = 1000
const DIFF_THRESHOLD = 0.18    // 18% pixels change → new slide
const MIN_GAP_SEC = 3
// Pixel grid used for diff comparison. Small for CPU cost — 320×180 = 57.6 K
// pixels per tick is trivial. The captured slide that we actually upload
// uses HIGH_RES_MAX_W (see below), this is purely the change-detection grid.
const DIFF_W = 320
const DIFF_H = 180
// Captured-slide max width. The video's native resolution caps it (we never
// upscale beyond what the source provides). 1280 px gives readable slide
// text — 320 px slide thumbnails were too low-res for the rendered modal /
// markdown export to be useful.
const HIGH_RES_MAX_W = 1280
// How long after start to emit the BASELINE (very first) frame as a slide.
// Without this the opening title slide is never captured: pixelDiff needs a
// `prev` to compare against, so the first frame is silently swallowed.
// Waiting 2 s lets the video paint actual content (vs. a black-frame loading
// state) before we snapshot. Forced emit ignores the gap-time check.
const BASELINE_EMIT_DELAY_MS = 2000

export class SlideDetector {
  // Two canvases: low-res for the per-tick pixelDiff (cheap), high-res for
  // the JPEG we actually upload (preserves slide text legibility).
  private diffCanvas: HTMLCanvasElement
  private diffCtx: CanvasRenderingContext2D
  private hiCanvas: HTMLCanvasElement
  private hiCtx: CanvasRenderingContext2D
  private prev: ImageData | null = null
  private lastEmitTs = -1
  private timer: number | null = null
  private baselineEmitted = false
  private startedAtMs = 0

  constructor(private video: HTMLVideoElement, private onSlide: (s: Slide) => void) {
    this.diffCanvas = document.createElement('canvas')
    this.diffCanvas.width = DIFF_W
    this.diffCanvas.height = DIFF_H
    this.diffCtx = this.diffCanvas.getContext('2d', { willReadFrequently: true })!
    this.hiCanvas = document.createElement('canvas')
    this.hiCtx = this.hiCanvas.getContext('2d')!
  }

  start(): void {
    this.startedAtMs = Date.now()
    this.timer = window.setInterval(() => this.tick(), SAMPLE_INTERVAL_MS)
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  // Snapshot the current video frame at high resolution and emit as a slide.
  // Used for both diff-triggered emits and the baseline (first-frame) emit.
  private emitFrame(ts: number): void {
    const vw = this.video.videoWidth || HIGH_RES_MAX_W
    const vh = this.video.videoHeight || Math.round(HIGH_RES_MAX_W * 9 / 16)
    const targetW = Math.min(vw, HIGH_RES_MAX_W)
    const targetH = Math.round(vh * (targetW / vw))
    if (this.hiCanvas.width !== targetW || this.hiCanvas.height !== targetH) {
      this.hiCanvas.width = targetW
      this.hiCanvas.height = targetH
    }
    this.hiCtx.drawImage(this.video, 0, 0, targetW, targetH)
    this.hiCanvas.toBlob((blob) => {
      // canvas.toBlob is async — stop() may have fired between the
      // tick that scheduled this conversion and the conversion
      // completing. Drop the slide rather than calling onSlide
      // (which would POST to /v1/stream/slide for an already-
      // ended session).
      if (this.timer === null) return
      if (blob) {
        // eslint-disable-next-line no-console
        console.log('[SH:slide] emitting slide', { ts: ts.toFixed(1), bytes: blob.size, w: targetW, h: targetH })
        this.onSlide({ ts, blob, mime: 'image/jpeg' })
      }
    }, 'image/jpeg', 0.9)
  }

  private tick(): void {
    if (this.video.paused || this.video.readyState < 2) return
    const ts = this.video.currentTime
    this.diffCtx.drawImage(this.video, 0, 0, DIFF_W, DIFF_H)
    const cur = this.diffCtx.getImageData(0, 0, DIFF_W, DIFF_H)

    if (this.prev) {
      const diff = pixelDiff(this.prev, cur)
      // Diagnostic log: ONLY when something interesting happens
      // (diff approaches threshold, emits, or is suppressed by the
      // gap rule). Previously this fired every 1 s producing ~3600
      // log lines per hour-long lecture — pure noise on long
      // sessions. The threshold-and-above events are the ones a
      // support-debug actually needs to see.
      const willEmit = diff > DIFF_THRESHOLD && ts - this.lastEmitTs > MIN_GAP_SEC
      const noteworthy = diff > DIFF_THRESHOLD * 0.5 || willEmit
      if (noteworthy) {
        // eslint-disable-next-line no-console
        console.log('[SH:slide]', `t=${ts.toFixed(1)}s diff=${(diff * 100).toFixed(1)}% threshold=${(DIFF_THRESHOLD * 100).toFixed(0)}%`,
          willEmit ? '→ EMIT' : (diff > DIFF_THRESHOLD ? '(gap too short)' : ''))
      }
      if (willEmit) {
        this.lastEmitTs = ts
        // Mark baseline as satisfied: if pixelDiff already caught a real
        // change in the first ~2 s, we don't need to ALSO force-emit on
        // the next tick. Without this flag flip, type-1 (real diff) and
        // type-2 (forced baseline) could both fire within MIN_GAP_SEC,
        // producing back-to-back duplicate-looking slides at e.g. 00:02
        // and 00:03 — the user observed this as "the same image
        // captured twice". Either branch satisfies the "first slide
        // captured" intent, so any emit clears the flag.
        this.baselineEmitted = true
        this.emitFrame(ts)
      } else if (!this.baselineEmitted && Date.now() - this.startedAtMs >= BASELINE_EMIT_DELAY_MS) {
        // Forced first-slide capture: opening frame (title slide, lecture
        // outline, etc.) is what the user sees on activate, but pixelDiff
        // can't trigger on it because there's no `prev` to compare on the
        // very first tick. After BASELINE_EMIT_DELAY_MS we treat the
        // current frame as the baseline slide regardless of diff.
        this.baselineEmitted = true
        this.lastEmitTs = ts
        // eslint-disable-next-line no-console
        console.log('[SH:slide] forced baseline emit', { ts: ts.toFixed(1) })
        this.emitFrame(ts)
      }
    } else {
      // First tick — establish the diff baseline. The forced baseline
      // emit happens on a later tick (BASELINE_EMIT_DELAY_MS) so the
      // captured frame has real lecture content, not a black loading frame.
      // eslint-disable-next-line no-console
      console.log('[SH:slide] baseline frame captured at', ts.toFixed(1))
    }
    this.prev = cur
  }
}

export function pixelDiff(a: ImageData, b: ImageData): number {
  const A = a.data, B = b.data
  let diffPixels = 0
  const total = A.length / 4
  for (let i = 0; i < A.length; i += 4) {
    const dr = A[i] - B[i], dg = A[i + 1] - B[i + 1], db = A[i + 2] - B[i + 2]
    if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) > 60) diffPixels++
  }
  return diffPixels / total
}

export interface Slide {
  ts: number
  blob: Blob
  mime: 'image/jpeg'
}

const SAMPLE_INTERVAL_MS = 1000
const DIFF_THRESHOLD = 0.18    // 18% pixels change → new slide
const MIN_GAP_SEC = 3

export class SlideDetector {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private prev: ImageData | null = null
  private lastEmitTs = -1
  private timer: number | null = null

  constructor(private video: HTMLVideoElement, private onSlide: (s: Slide) => void) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = 320
    this.canvas.height = 180
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
  }

  start(): void {
    this.timer = window.setInterval(() => this.tick(), SAMPLE_INTERVAL_MS)
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick(): void {
    if (this.video.paused || this.video.readyState < 2) return
    const ts = this.video.currentTime
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height)
    const cur = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)

    if (this.prev) {
      const diff = pixelDiff(this.prev, cur)
      if (diff > DIFF_THRESHOLD && ts - this.lastEmitTs > MIN_GAP_SEC) {
        this.lastEmitTs = ts
        this.canvas.toBlob((blob) => {
          if (blob) this.onSlide({ ts, blob, mime: 'image/jpeg' })
        }, 'image/jpeg', 0.85)
      }
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

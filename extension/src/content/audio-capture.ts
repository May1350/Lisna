import { webmBlobToWav } from './audio-encode'

export interface AudioChunk {
  startTimeSec: number
  durationSec: number
  blob: Blob
  mime: string
}

const CHUNK_DURATION_MS = 15_000

export class AudioCapture {
  private recorder: MediaRecorder | null = null
  private parts: Blob[] = []
  private startedAtVideoTime = 0
  private chunkStartReal = 0
  private mime = 'audio/webm;codecs=opus'

  constructor(private video: HTMLVideoElement, private onChunk: (c: AudioChunk) => void) {}

  start(): void {
    const stream = this.video.captureStream()
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) throw new Error('No audio track in video')
    const audioStream = new MediaStream(audioTracks)
    this.recorder = new MediaRecorder(audioStream, { mimeType: this.mime })
    this.startedAtVideoTime = this.video.currentTime
    this.chunkStartReal = Date.now()
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.parts.push(e.data)
    }
    this.recorder.onstop = () => this.flushChunk()
    this.recorder.start()
    this.scheduleNextSlice()
  }

  private scheduleNextSlice(): void {
    setTimeout(() => {
      if (!this.recorder || this.recorder.state !== 'recording') return
      this.recorder.requestData()
      // restart to produce a self-contained chunk
      this.recorder.stop()
      this.recorder.start()
      this.scheduleNextSlice()
    }, CHUNK_DURATION_MS)
  }

  private flushChunk(): void {
    if (this.parts.length === 0) return
    const webmBlob = new Blob(this.parts, { type: this.mime })
    const durationSec = (Date.now() - this.chunkStartReal) / 1000
    const startTimeSec = this.startedAtVideoTime
    this.parts = []
    this.startedAtVideoTime = this.video.currentTime
    this.chunkStartReal = Date.now()

    // Convert WebM/Opus → WAV before emitting. Groq's Whisper rejects
    // MediaRecorder WebM fragments ("could not process file"); WAV is
    // universally accepted. Run async; on failure surface to console and
    // skip the chunk (rather than blow up the whole capture pipeline).
    void (async () => {
      try {
        const wavBlob = await webmBlobToWav(webmBlob)
        this.onChunk({
          startTimeSec,
          durationSec,
          blob: wavBlob,
          mime: 'audio/wav',
        })
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[SH:audio-capture] WAV encode failed; dropping chunk', e)
      }
    })()
  }

  stop(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop()
    }
    this.recorder = null
  }
}

export async function blobToBase64(b: Blob): Promise<string> {
  const buf = await b.arrayBuffer()
  let s = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

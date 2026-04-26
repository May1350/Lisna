import { showToast } from './toast'
import { AudioCapture, blobToBase64 } from './audio-capture'
import { SlideDetector, type Slide } from './slide-detector'

let detected = false
let activeVideo: HTMLVideoElement | null = null

function findBestVideo(): HTMLVideoElement | null {
  const all = Array.from(document.querySelectorAll<HTMLVideoElement>('video'))
  // pick the largest by area
  let best: HTMLVideoElement | null = null
  let bestArea = 0
  for (const v of all) {
    const r = v.getBoundingClientRect()
    const area = r.width * r.height
    if (area > bestArea && r.width > 200) { best = v; bestArea = area }
  }
  return best
}

function checkAndOffer(): void {
  if (detected) return
  const v = findBestVideo()
  if (!v) return
  detected = true
  activeVideo = v
  showToast({
    onActivate: () => {
      chrome.runtime.sendMessage({ type: 'SESSION_START', tabId: -1, url: location.href })
    },
  })
}

// initial check + observe DOM mutations (debounced)
checkAndOffer()
let mutationDebounce = 0
const obs = new MutationObserver(() => {
  if (detected) { obs.disconnect(); return }
  const now = Date.now()
  if (now - mutationDebounce < 500) return
  mutationDebounce = now
  checkAndOffer()
})
obs.observe(document.documentElement, { childList: true, subtree: true })

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_VIDEO_INFO') {
    if (activeVideo) {
      sendResponse({ ok: true, info: { duration: activeVideo.duration, paused: activeVideo.paused } })
    } else sendResponse({ ok: false })
    return true
  }
  return false
})

let capture: AudioCapture | null = null
let currentSessionId: string | null = null

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type === 'SESSION_START') {
    void startCapture(msg.url)
    sendResponse({ ok: true })
    return true
  }
  if (msg?.type === 'JUMP_TO') {
    if (activeVideo) { activeVideo.currentTime = msg.ts; activeVideo.playbackRate = 1.0 }
    sendResponse({ ok: true })
    return true
  }
  return false
})

async function startCapture(url: string): Promise<void> {
  if (!activeVideo || activeVideo.readyState < 2) return

  // get configured speed (or auto-detect max)
  const stored = await chrome.storage.local.get('sh.playback')
  const speed = stored['sh.playback']
  if (speed === 'auto' || speed === undefined) {
    activeVideo.playbackRate = detectMaxSpeed(activeVideo) ?? 2
  } else if (typeof speed === 'number') {
    activeVideo.playbackRate = speed
  }

  // Tentative client-generated id; the backend MAY return a different canonical id
  // on the first /v1/stream/audio response (e.g. if a session for this user+url already exists).
  // We adopt that canonical id and only THEN broadcast session_started so the side panel
  // connects WS to the correct session.
  currentSessionId = crypto.randomUUID()
  let canonicalAdopted = false

  capture = new AudioCapture(activeVideo, async (chunk) => {
    const b64 = await blobToBase64(chunk.blob)
    const r = await chrome.runtime.sendMessage({
      type: 'API_FETCH',
      method: 'POST',
      path: '/v1/stream/audio',
      body: {
        session_id: currentSessionId,
        url,
        start_time_sec: chunk.startTimeSec,
        duration_sec: chunk.durationSec,
        audio_b64: b64,
        mime: chunk.mime,
      },
    }) as { ok: true; data: { added: number; transcript_preview: string; session_id: string } } | { ok: false; error: string }

    if (r && r.ok && !canonicalAdopted) {
      const canonical = r.data?.session_id
      if (canonical) {
        currentSessionId = canonical
        canonicalAdopted = true
        // notify side panel only after we have the canonical id
        chrome.runtime.sendMessage({
          type: 'SP_BROADCAST',
          payload: { type: 'session_started', sessionId: currentSessionId, url },
        })
      }
    }
  })
  capture.start()

  const detector = new SlideDetector(activeVideo, async (slide: Slide) => {
    if (!canonicalAdopted) return // wait until canonical id is known
    const buf = await slide.blob.arrayBuffer()
    let s = ''; const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    const b64 = btoa(s)
    await chrome.runtime.sendMessage({
      type: 'API_FETCH',
      method: 'POST',
      path: '/v1/stream/slide',
      body: { session_id: currentSessionId, ts: slide.ts, image_b64: b64, mime: 'image/jpeg' },
    })
  })
  detector.start()
  activeVideo.addEventListener('ended', () => detector.stop())
}

function detectMaxSpeed(_v: HTMLVideoElement): number | null {
  // best effort: try common max values; players differ. Default to 2.
  return 2
}

activeVideo?.addEventListener('ended', () => {
  capture?.stop()
  if (currentSessionId) {
    chrome.runtime.sendMessage({
      type: 'API_FETCH',
      method: 'POST',
      path: '/v1/session/finalize',
      body: { session_id: currentSessionId, title: document.title },
    })
  }
})

export {}  // module marker

import { showToast } from './toast'
import { AudioCapture, blobToBase64 } from './audio-capture'

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

// initial check + observe DOM mutations
checkAndOffer()
const obs = new MutationObserver(() => checkAndOffer())
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
  if (!activeVideo) return

  // apply playback speed setting
  const settingResp = await chrome.runtime.sendMessage({
    type: 'API_FETCH', path: '/v1/__noop__', method: 'GET'  // placeholder; speed handled below
  }).catch(() => null)
  void settingResp

  // get configured speed (or auto-detect max)
  const stored = await chrome.storage.local.get('sh.playback')
  const speed = stored['sh.playback']
  if (speed === 'auto' || speed === undefined) {
    activeVideo.playbackRate = detectMaxSpeed(activeVideo) ?? 2
  } else if (typeof speed === 'number') {
    activeVideo.playbackRate = speed
  }

  currentSessionId = crypto.randomUUID()
  capture = new AudioCapture(activeVideo, async (chunk) => {
    const b64 = await blobToBase64(chunk.blob)
    await chrome.runtime.sendMessage({
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
    })
  })
  capture.start()

  // notify side panel
  chrome.runtime.sendMessage({ type: 'SP_BROADCAST', payload: { type: 'session_started', sessionId: currentSessionId, url } })
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

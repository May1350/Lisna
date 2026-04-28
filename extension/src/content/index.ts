import { mountInlineButton, type InlineButtonHandle, type InlineButtonState } from './inline-button'
import { mountModal } from './in-page-modal'
import { AudioCapture, blobToBase64 } from './audio-capture'
import { SlideDetector, type Slide } from './slide-detector'
import { getEnabled } from '../shared/storage'

// Top-frame guard: inline button + session orchestration only run in the top frame.
// (iframe-embedded videos are out of scope for this iteration — Phase 2.)
const isTopFrame = window.top === window.self

let detected = false
let activeVideo: HTMLVideoElement | null = null
let button: InlineButtonHandle | null = null
let capture: AudioCapture | null = null
let detector: SlideDetector | null = null
let currentSessionId: string | null = null
let onEndedHandler: (() => void) | null = null

// Centralized status setter so callers don't reach into the button handle
// directly. The inline button is hidden while the modal is mounted (to avoid
// the visual overlap with the modal in the top-right of the viewport) and
// restored when the modal closes — see handleActivate / mountModal.onClose.
function setButtonStatus(s: InlineButtonState): void {
  button?.setStatus(s)
}

function findBestVideo(): HTMLVideoElement | null {
  const all = Array.from(document.querySelectorAll<HTMLVideoElement>('video'))
  let best: HTMLVideoElement | null = null
  let bestArea = 0
  for (const v of all) {
    const r = v.getBoundingClientRect()
    const area = r.width * r.height
    if (area > bestArea && r.width > 200) { best = v; bestArea = area }
  }
  return best
}

function handleActivate(): void {
  // The modal handles its own auth state — if the user is not logged in, it
  // renders LoginScreen inline. We optimistically kick off capture in
  // parallel; the first audio chunk fires ~15s in, so the user has a window
  // to authenticate before any /v1/stream/audio request lands. If they're
  // still not logged in by then, the SW returns 401 and we lose the first
  // chunk — acceptable trade-off vs. blocking on auth here.
  //
  // While the modal is mounted we hide the inline button to avoid the visual
  // overlap with the modal in the top-right of the viewport. When the user
  // closes the modal we restore the button to whatever state it was in at
  // the moment of mount (which after activation is 'processing').
  // Capture the pre-modal status BEFORE we hide the button. After activation
  // the conceptual state is 'processing' (capture about to start), so that's
  // what we should restore to when the user closes the modal — unless the
  // session has already ended by then (e.g. user hit ⏹ from inside the
  // modal), in which case we stay idle.
  mountModal({
    onClose: () => {
      const restoreTo: InlineButtonState = capture ? 'processing' : 'idle'
      setButtonStatus(restoreTo)
    },
    onSetSpeed: (speed: number) => {
      if (activeVideo) activeVideo.playbackRate = speed
    },
  })
  setButtonStatus('hidden')
  void startCapture(location.href)
  // currentButtonStatus is now 'hidden'; the conceptual underlying state
  // (i.e. what we'd show if the modal closed right now) is 'processing'.
  // We don't need a separate variable for that — the onClose closure derives
  // it from `capture` directly.
}

function tryMountButton(): void {
  if (!isTopFrame || detected) return
  const v = findBestVideo()
  if (!v) return
  detected = true
  activeVideo = v
  button = mountInlineButton(v, () => { handleActivate() }, () => stopCaptureLocal())
}

function unmountButton(): void {
  button?.unmount()
  button = null
  detected = false
}

function init(): void {
  if (!isTopFrame) return
  void (async () => {
    const enabled = await getEnabled()
    if (!enabled) return
    tryMountButton()

    // Watch for late-loading video elements (debounced).
    let mutationDebounce = 0
    const obs = new MutationObserver(() => {
      if (detected) { obs.disconnect(); return }
      const now = Date.now()
      if (now - mutationDebounce < 500) return
      mutationDebounce = now
      tryMountButton()
    })
    obs.observe(document.documentElement, { childList: true, subtree: true })
  })()
}

init()

// React to ON/OFF changes broadcast by the SW.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!isTopFrame) return false
  if (msg?.type === 'SH_ENABLED_CHANGED') {
    if (msg.enabled) {
      tryMountButton()
    } else {
      unmountButton()
      // Do NOT stop an in-flight session here; the OFF toggle just hides the
      // affordance. Stop is an explicit user action via the side panel.
    }
    sendResponse({ ok: true })
    return true
  }
  return false
})

// Also react to direct storage changes (e.g. options page toggling state).
chrome.storage?.onChanged.addListener((changes, area) => {
  if (!isTopFrame) return
  if (area !== 'local') return
  const c = changes['sh.enabled']
  if (!c) return
  const enabled = c.newValue !== false
  if (enabled) tryMountButton()
  else unmountButton()
})

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type === 'JUMP_TO') {
    if (activeVideo) { activeVideo.currentTime = msg.ts; activeVideo.playbackRate = 1.0 }
    sendResponse({ ok: true })
    return true
  }
  if (msg?.type === 'STOP_SESSION') {
    stopCaptureLocal()
    sendResponse({ ok: true })
    return true
  }
  return false
})

function stopCaptureLocal(): void {
  try { capture?.stop() } catch { /* ignore */ }
  try { detector?.stop() } catch { /* ignore */ }
  capture = null
  detector = null
  if (activeVideo && onEndedHandler) {
    activeVideo.removeEventListener('ended', onEndedHandler)
    onEndedHandler = null
  }
  // Notes preserved server-side; revert button so the user can re-engage.
  setButtonStatus('idle')
  currentSessionId = null
}

async function startCapture(url: string): Promise<void> {
  if (!activeVideo || activeVideo.readyState < 2) return
  // Already capturing? Skip.
  if (capture) return

  // get configured speed (or auto-detect max)
  const stored = await chrome.storage.local.get('sh.playback')
  const speed = stored['sh.playback']
  if (speed === 'auto' || speed === undefined) {
    activeVideo.playbackRate = detectMaxSpeed(activeVideo) ?? 2
  } else if (typeof speed === 'number') {
    activeVideo.playbackRate = speed
  }

  // Tentative client-generated id; backend MAY return a different canonical id
  // on the first /v1/stream/audio response. Adopt that canonical id and only THEN
  // broadcast session_started so the side panel connects WS to the correct session.
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
        chrome.runtime.sendMessage({
          type: 'SP_BROADCAST',
          payload: { type: 'session_started', sessionId: currentSessionId, url },
        })
      }
    }
  })
  capture.start()

  detector = new SlideDetector(activeVideo, async (slide: Slide) => {
    if (!canonicalAdopted) return
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

  onEndedHandler = () => {
    detector?.stop()
    capture?.stop()
    if (currentSessionId) {
      chrome.runtime.sendMessage({
        type: 'API_FETCH',
        method: 'POST',
        path: '/v1/session/finalize',
        body: { session_id: currentSessionId, title: document.title },
      })
    }
    setButtonStatus('idle')
  }
  activeVideo.addEventListener('ended', onEndedHandler)
}

function detectMaxSpeed(_v: HTMLVideoElement): number | null {
  return 2
}

export {}  // module marker

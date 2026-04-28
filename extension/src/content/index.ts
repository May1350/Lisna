import { mountInlineButton, type InlineButtonHandle, type InlineButtonState } from './inline-button'
import { mountModal } from './in-page-modal'
import { AudioCapture, blobToBase64 } from './audio-capture'
import { SlideDetector, type Slide } from './slide-detector'
import { getEnabled } from '../shared/storage'

// This script runs in the top frame AND in every iframe (manifest has all_frames: true).
// Different platforms embed the <video> element in different places:
//   - YouTube, Coursera (some): top frame
//   - K-LMS, Canvas Studio, Vimeo embeds: cross-origin iframe
// We let each frame independently look for a video and mount the inline button
// in WHATEVER frame contains the video. The modal must be mounted in the TOP
// frame, however, because it's a viewport-level overlay (an iframe is too small).
// Cross-frame coordination uses window.postMessage:
//   iframe → parent (top): { source: 'sh-frame', type: 'REQUEST_MODAL' | 'STOPPED' }
//   parent (top) → iframe: { source: 'sh-parent', type: 'MODAL_CLOSED' | 'SET_SPEED' | 'STOP_CAPTURE' }
const isTopFrame = window.top === window.self

let detected = false
let activeVideo: HTMLVideoElement | null = null
let button: InlineButtonHandle | null = null
let capture: AudioCapture | null = null
let detector: SlideDetector | null = null
let currentSessionId: string | null = null
let onEndedHandler: (() => void) | null = null

function setButtonStatus(s: InlineButtonState): void {
  button?.setStatus(s)
}

// Robust video detection.
// - width threshold lowered to 100 (small embedded players still count)
// - intrinsic videoWidth/Height fallback when bounding rect is momentarily 0
//   (the metadata loaded before the layout settled)
function findBestVideo(): HTMLVideoElement | null {
  const all = Array.from(document.querySelectorAll<HTMLVideoElement>('video'))
  let best: HTMLVideoElement | null = null
  let bestScore = 0
  for (const v of all) {
    const r = v.getBoundingClientRect()
    const rectArea = r.width * r.height
    const intrinsicArea = v.videoWidth * v.videoHeight
    // Take whichever is larger; intrinsic is weighted lower since it doesn't
    // reflect visible size.
    const score = Math.max(rectArea, intrinsicArea / 4)
    const passes = r.width > 100 || v.videoWidth > 0
    if (score > bestScore && passes) {
      best = v
      bestScore = score
    }
  }
  return best
}

function applySpeed(speed: number): void {
  if (activeVideo) activeVideo.playbackRate = speed
}

function onModalClosed(): void {
  setButtonStatus(capture !== null ? 'processing' : 'idle')
}

function broadcastToFrames(message: unknown): void {
  const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe')
  iframes.forEach(ifr => {
    try { ifr.contentWindow?.postMessage(message, '*') } catch { /* ignore */ }
  })
}

function handleActivate(): void {
  if (isTopFrame) {
    // Direct flow — modal in same frame, capture in same frame
    mountModal({
      onClose: () => {
        // Tell child iframes too (defensive — capture may live there)
        broadcastToFrames({ source: 'sh-parent', type: 'MODAL_CLOSED' })
        onModalClosed()
      },
      onSetSpeed: (speed: number) => {
        applySpeed(speed)
        broadcastToFrames({ source: 'sh-parent', type: 'SET_SPEED', speed })
      },
    })
    setButtonStatus('hidden')
    void startCapture(location.href)
  } else {
    // Iframe: ask the parent (top frame) to mount the modal; capture stays here
    // (we have the <video> element in this frame).
    window.parent.postMessage(
      { source: 'sh-frame', type: 'REQUEST_MODAL', frameUrl: location.href },
      '*',
    )
    setButtonStatus('hidden')
    void startCapture(location.href)
  }
}

function tryMountButton(): void {
  if (detected) return
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

function setupMutationObserver(): void {
  let mutationDebounce = 0
  const obs = new MutationObserver((mutations) => {
    if (detected) { obs.disconnect(); return }
    const now = Date.now()
    if (now - mutationDebounce >= 500) {
      mutationDebounce = now
      tryMountButton()
    }
    // Attach loadedmetadata listener to dynamically-added video elements so we
    // re-try mounting once the video is actually playable. Some sites (esp.
    // SPA-style players) add the <video> with 0 size and only populate
    // dimensions after metadata loads.
    for (const m of mutations) {
      m.addedNodes.forEach(node => {
        if (node instanceof HTMLVideoElement) {
          node.addEventListener('loadedmetadata', () => tryMountButton(), { once: true })
        } else if (node instanceof HTMLElement) {
          node.querySelectorAll('video').forEach(v => {
            v.addEventListener('loadedmetadata', () => tryMountButton(), { once: true })
          })
        }
      })
    }
  })
  obs.observe(document.documentElement, { childList: true, subtree: true })
}

function init(): void {
  void (async () => {
    const enabled = await getEnabled()
    if (!enabled) return

    tryMountButton()
    setupMutationObserver()

    // Periodic poll for the first 30s — covers sites that don't fire mutations
    // when adding the video (shadow DOM patterns, deferred element insertion,
    // etc.). Stops as soon as we mount, or after 15 polls.
    let polls = 0
    const pollId = window.setInterval(() => {
      polls += 1
      if (detected || polls >= 15) {
        window.clearInterval(pollId)
        return
      }
      tryMountButton()
    }, 2000)
  })()
}

init()

// ===== Cross-frame message routing =====

if (isTopFrame) {
  // Receive messages from child iframes (e.g. iframe asks us to mount the modal).
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { source?: string; type?: string; frameUrl?: string } | null
    if (!data || data.source !== 'sh-frame') return

    if (data.type === 'REQUEST_MODAL') {
      mountModal({
        onClose: () => {
          broadcastToFrames({ source: 'sh-parent', type: 'MODAL_CLOSED' })
          onModalClosed()
        },
        onSetSpeed: (speed: number) => {
          // Apply locally (no-op if no video here) AND broadcast to children
          applySpeed(speed)
          broadcastToFrames({ source: 'sh-parent', type: 'SET_SPEED', speed })
        },
      })
    }
    // 'STOPPED' from a child is informational — modal stays open until user
    // closes it. Notes are already saved server-side. No-op for now.
  })
} else {
  // Iframe: receive directives from the top frame.
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { source?: string; type?: string; speed?: number } | null
    if (!data || data.source !== 'sh-parent') return

    if (data.type === 'MODAL_CLOSED') {
      onModalClosed()
    } else if (data.type === 'SET_SPEED' && typeof data.speed === 'number') {
      applySpeed(data.speed)
    } else if (data.type === 'STOP_CAPTURE') {
      stopCaptureLocal()
    }
  })
}

// ===== Storage / runtime message routing (existing) =====

// React to ON/OFF changes broadcast by the SW.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'SH_ENABLED_CHANGED') {
    if (msg.enabled) {
      tryMountButton()
    } else {
      unmountButton()
      // Do NOT stop an in-flight session here; the OFF toggle just hides the
      // affordance. Stop is an explicit user action via the side panel / pill.
    }
    sendResponse({ ok: true })
    return true
  }
  return false
})

// Also react to direct storage changes (e.g. options page toggling state).
chrome.storage?.onChanged.addListener((changes, area) => {
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
    // Stop locally (no-op if capture is in a child iframe) AND fan out to
    // child iframes so the frame that actually has the video stops too.
    stopCaptureLocal()
    if (isTopFrame) {
      broadcastToFrames({ source: 'sh-parent', type: 'STOP_CAPTURE' })
    }
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

  // Apply configured playback speed (or default).
  const stored = await chrome.storage.local.get('sh.playback')
  const speed = stored['sh.playback']
  if (speed === 'auto' || speed === undefined) {
    activeVideo.playbackRate = detectMaxSpeed(activeVideo) ?? 2
  } else if (typeof speed === 'number') {
    activeVideo.playbackRate = speed
  }

  // Tentative client-generated id; backend MAY return a different canonical id
  // on the first /v1/stream/audio response. Adopt that canonical id and only
  // THEN broadcast session_started so the modal connects WS to the correct
  // session.
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

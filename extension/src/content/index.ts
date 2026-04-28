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
// Tracks the in-flight capture session so stopCaptureLocal can flip a flag
// that the AudioCapture / SlideDetector callbacks read, suppressing any
// straggler chunks produced after stop().
type CaptureSession = { id: string; canonicalAdopted: boolean; stopped: boolean }
let activeSession: CaptureSession | null = null

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
  console.log(`[SH:${isTopFrame ? 'top' : 'iframe'}]`, location.host, 'handleActivate')
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
  console.log(`[SH:${isTopFrame ? 'top' : 'iframe'}]`, location.host, 'video found, mounting button', { rectW: v.getBoundingClientRect().width, rectH: v.getBoundingClientRect().height, videoW: v.videoWidth, videoH: v.videoHeight })
  button = mountInlineButton(v, () => { handleActivate() }, () => stopCaptureLocal())
  // Pre-warm the Lambdas the user is about to hit. Fire-and-forget; the
  // SW's WARMUP handler dispatches pings to /v1/auth/google, /v1/session,
  // and /v1/stream/audio in parallel. Best case: shaves ~2 s off the first
  // backend call. Worst case: a few extra HTTP requests no one cares about.
  void chrome.runtime.sendMessage({ type: 'WARMUP' }).catch(() => { /* ignore */ })
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
  // Flip the closure-scoped flag FIRST so any drain chunks emitted by
  // MediaRecorder's onstop are suppressed instead of POSTing with a
  // session id that's about to be cleared.
  if (activeSession) activeSession.stopped = true
  try { capture?.stop() } catch { /* ignore */ }
  try { detector?.stop() } catch { /* ignore */ }
  capture = null
  detector = null
  activeSession = null
  if (activeVideo && onEndedHandler) {
    activeVideo.removeEventListener('ended', onEndedHandler)
    onEndedHandler = null
  }
  // Notes preserved server-side; revert button so the user can re-engage.
  setButtonStatus('idle')
  currentSessionId = null
}

// Diagnostic logger — prefixed so we can grep in the console regardless of
// which frame logged. Frame URL is included so it's clear whether the iframe
// or top frame produced the line.
const TAG = `[SH:${isTopFrame ? 'top' : 'iframe'}]`
function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(TAG, location.host, ...args)
}
function warn(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.warn(TAG, location.host, ...args)
}

async function startCapture(url: string): Promise<void> {
  if (!activeVideo) { warn('startCapture: no activeVideo'); return }
  if (activeVideo.readyState < 2) { warn('startCapture: video readyState<2'); return }
  // Already capturing? Skip.
  if (capture) { log('startCapture: already capturing'); return }

  log('startCapture: starting', { url, readyState: activeVideo.readyState, paused: activeVideo.paused })

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
  //
  // RACE NOTE: We deliberately keep the session id in a closure (`session`)
  // rather than re-reading the module-level `currentSessionId` from inside
  // the AudioCapture callback. After the user presses stop, stopCaptureLocal()
  // sets the module-level id to null, but MediaRecorder may still emit one
  // last "drain" chunk via onstop AFTER that nulling. If the callback read
  // the module variable, that drain chunk would POST `session_id: null` and
  // the backend's Zod validator would 400. Holding the id in a closure scopes
  // it correctly to this capture session only.
  const session: { id: string; canonicalAdopted: boolean; stopped: boolean } = {
    id: crypto.randomUUID(),
    canonicalAdopted: false,
    stopped: false,
  }
  currentSessionId = session.id
  let chunksSent = 0

  try {
    capture = new AudioCapture(activeVideo, async (chunk) => {
      // After stopCaptureLocal() flips the flag, drop any straggler chunk
      // produced by MediaRecorder's drain rather than POSTing with a stale id.
      if (session.stopped) { log('audio chunk dropped (session stopped)'); return }
      chunksSent += 1
      log('audio chunk produced', { n: chunksSent, durationSec: chunk.durationSec, blobSize: chunk.blob.size, mime: chunk.mime })
      const b64 = await blobToBase64(chunk.blob)
      let r: { ok: true; data: { added: number; transcript_preview: string; session_id: string } } | { ok: false; error: string } | undefined
      try {
        r = await chrome.runtime.sendMessage({
          type: 'API_FETCH',
          method: 'POST',
          path: '/v1/stream/audio',
          body: {
            session_id: session.id,
            url,
            start_time_sec: chunk.startTimeSec,
            duration_sec: chunk.durationSec,
            audio_b64: b64,
            mime: chunk.mime,
          },
        }) as typeof r
      } catch (e) {
        warn('audio chunk sendMessage threw', e)
        return
      }

      if (!r) { warn('audio chunk: empty response'); return }
      if (!r.ok) { warn('audio chunk: backend error', r.error); return }
      log('audio chunk: backend ok', { added: r.data?.added, preview: r.data?.transcript_preview, canonicalSessionId: r.data?.session_id })

      if (!session.canonicalAdopted) {
        const canonical = r.data?.session_id
        if (canonical) {
          session.id = canonical
          currentSessionId = canonical
          session.canonicalAdopted = true
          log('canonical session adopted, broadcasting session_started', canonical)
          chrome.runtime.sendMessage({
            type: 'SP_BROADCAST',
            payload: { type: 'session_started', sessionId: canonical, url },
          })
        }
      }
    })
    capture.start()
    activeSession = session
    log('AudioCapture started OK')
  } catch (e) {
    warn('AudioCapture failed to start', e)
    capture = null
    return
  }

  detector = new SlideDetector(activeVideo, async (slide: Slide) => {
    if (session.stopped || !session.canonicalAdopted) return
    const buf = await slide.blob.arrayBuffer()
    let s = ''; const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    const b64 = btoa(s)
    await chrome.runtime.sendMessage({
      type: 'API_FETCH',
      method: 'POST',
      path: '/v1/stream/slide',
      body: { session_id: session.id, ts: slide.ts, image_b64: b64, mime: 'image/jpeg' },
    })
  })
  detector.start()

  onEndedHandler = () => {
    session.stopped = true
    detector?.stop()
    capture?.stop()
    if (session.canonicalAdopted) {
      chrome.runtime.sendMessage({
        type: 'API_FETCH',
        method: 'POST',
        path: '/v1/session/finalize',
        body: { session_id: session.id, title: document.title },
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

import { mountInlineButton, type InlineButtonHandle, type InlineButtonState } from './inline-button'
import { mountModal } from './in-page-modal'
// Type-only imports — the actual classes are dynamically `await import`-ed
// inside startCapture() so iframes that never start a capture don't pay
// the parse cost. CRX plugin v2 auto-registers the lazy chunk in WAR.
import type { AudioCapture } from './audio-capture'
import type { SlideDetector, Slide } from './slide-detector'
// Shared wire schemas — backend handlers parse the same zod schemas.
// Wire-shape drift fails compile here rather than 400ing at runtime.
import type { SessionCurateBody, StreamAudioBody, StreamSlideBody } from 'shared'
import { getEnabled } from '../shared/storage'
import type { QuotaSnapshot } from '../shared/types'
import { CURATE_URL } from '../shared/config'

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

// Origin of this extension's bundled pages — including the modal iframe
// at chrome-extension://<ID>/src/side-panel/index.html. We use this for:
//   1. Validating event.origin on incoming postMessages from the modal
//      (so a malicious script can't impersonate it from the host page).
//   2. Targeting outbound postMessages destined for the modal (so a
//      payload containing session IDs / quota / outline can't leak to
//      ad / tracker iframes that happen to be on the page).
// chrome.runtime.getURL('') returns 'chrome-extension://<ID>/'; strip the
// trailing slash so it matches the format browsers report as event.origin.
const EXTENSION_ORIGIN = chrome.runtime.getURL('').replace(/\/$/, '')

// Idempotence sentinel against content-script re-injection. SPA
// navigations inside the same tab can cause Chrome to re-run the
// content script without unloading the prior copy. Without a guard
// every module-level addEventListener stacks, producing multiplicative
// event handling (one chrome.runtime message → N copies fire) and
// growing memory each time.
//
// We tag the frame's window with a sentinel and gate listener
// registration on it. State vars (activeVideo, capture, etc.) are fine
// to re-declare — they live in the new module's closure — but window-
// level event listeners are global and need to dedupe.
interface ShWindow extends Window { __SH_CONTENT_BOOTED__?: true }
const __sh_first_boot__ = !(window as unknown as ShWindow).__SH_CONTENT_BOOTED__
;(window as unknown as ShWindow).__SH_CONTENT_BOOTED__ = true

let detected = false
let activeVideo: HTMLVideoElement | null = null
let button: InlineButtonHandle | null = null
let capture: AudioCapture | null = null
let detector: SlideDetector | null = null
let onEndedHandler: (() => void) | null = null
// Tracks the in-flight capture session so stopCaptureLocal can flip a flag
// that the AudioCapture / SlideDetector callbacks read, suppressing any
// straggler chunks produced after stop().
type CaptureSession = { id: string; canonicalAdopted: boolean; stopped: boolean; abort: AbortController }
let activeSession: CaptureSession | null = null
// Cleanup callback set by startCapture and invoked by stopCaptureLocal
// to detach the early play/pause listeners attached before the await
// boundary. Without this they leak across stop/restart cycles and
// rebroadcast video state when the user has actually stopped capture.
let captureCleanup: (() => void) | null = null

// Drive-viewer-only: captured `location.href` of the YouTube embed iframe,
// reported by that iframe at video-detection time via a `DRIVE_IFRAME_URL`
// postMessage. We use this as `parentUrl` when mounting the modal in the
// top frame so the backend `/v1/session` lookup hits the same `url_hash`
// the iframe will POST audio chunks under. `iframe.src` (the HTML
// attribute as read from the top frame) can drift from the iframe's
// actual `location.href` after YouTube embed runs its own internal
// navigation, so relying on `src` would risk a url_hash mismatch that
// surfaces as "modal opens empty, notes never appear".
let driveIframeFrameUrl: string | null = null

// Top-frame Drive slide-capture state. The YouTube embed's <video> element
// returns near-blank frames to canvas drawImage (frame buffer not exposed —
// confirmed empirically 2026-05-13: paused=false, readyState=4, but pixels
// uniformly white), so the standard SlideDetector running inside the iframe
// has nothing to capture. We instead drive a top-frame loop that:
//   1. caches the iframe's video tick state broadcast (paused/currentTime/readyState)
//   2. asks the SW for a captureVisibleTab screenshot
//   3. crops the YouTube iframe rect from that screenshot
//   4. runs the same pixelDiff + MIN_GAP gating as SlideDetector
//   5. emits via the same /v1/stream/slide path the iframe normally uses
//      (with a top-frame-generated session_id — backend keys on url_hash,
//      so this row coalesces with the iframe's audio uploads automatically).
interface DriveVideoTick { paused: boolean; currentTime: number; readyState: number }
let driveVideoTick: DriveVideoTick | null = null
let driveSlideTimer: number | null = null
let driveSlidePrev: ImageData | null = null
let driveSlideLastEmitTs = -1
let driveSlideBaselineEmitted = false
let driveSlideStartedAtMs = 0
let driveSlideSessionId: string | null = null

function setButtonStatus(s: InlineButtonState): void {
  button?.setStatus(s)
}

// ── Drive viewer special-case ─────────────────────────────────────────
// Google Drive's video viewer (drive.google.com/file/<id>/view) renders
// the file via a YouTube embed iframe (youtube.googleapis.com/embed/…).
// Drive's top frame lays a transparent click-handler overlay on top of
// that iframe to drive its own play/pause UI, which swallows pointer
// events before they reach the iframe — so a button mounted inside the
// iframe is visible but unclickable. Detected 2026-05-13.
//
// Workaround: mount the button in the TOP frame, anchored to the
// iframe's bounding rect (which equals the visible video area). The
// YouTube iframe still detects its <video> and runs capture there;
// the top frame click handler tells it to start via a START_CAPTURE
// postMessage (sibling to the existing SET_SPEED / STOP_CAPTURE
// control verbs).
function isDriveViewerTop(): boolean {
  return isTopFrame
    && location.host === 'drive.google.com'
    // Drive file viewer pathname shape: /file/d/<id>/view
    // (sometimes followed by ?usp=… query — already excluded since
    // location.pathname is query-stripped).
    && /^\/file\/d\/[^/]+\/view/.test(location.pathname)
}

// True when THIS frame is a descendant of a drive.google.com viewer
// page. Used by iframes (the YouTube embed) to suppress their own
// button mount — the top frame owns the button in this configuration.
// location.ancestorOrigins is a Chrome/Safari/Edge API (not Firefox);
// Lisna ships only to Chromium so the optional-chain fallback is just
// defensive.
function isHostedInDriveViewer(): boolean {
  if (isTopFrame) return false
  try {
    const a = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins
    if (!a) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] === 'https://drive.google.com') return true
    }
    return false
  } catch {
    return false
  }
}

function findVideoIframeForDriveViewer(): HTMLIFrameElement | null {
  return document.querySelector<HTMLIFrameElement>(
    'iframe[src*="youtube.googleapis.com/embed"], iframe[src*="youtube.com/embed"]',
  )
}

// ── Drive top-frame slide capture (Plan A: chrome.tabs.captureVisibleTab) ─
// Constants mirror slide-detector.ts so the user-perceived emit rate is the
// same as on other sites. Slight latency penalty per tick (~50-150ms SW
// round-trip + JPEG decode) — still well under the 1Hz tick budget.
const DRIVE_TICK_MS = 1000
const DRIVE_DIFF_W = 32
const DRIVE_DIFF_H = 18
const DRIVE_DIFF_THRESHOLD = 0.18
const DRIVE_MIN_GAP_SEC = 3
const DRIVE_BASELINE_DELAY_MS = 2000
const DRIVE_HIGH_RES_MAX_W = 1280

function drivePixelDiff(a: ImageData, b: ImageData): number {
  const A = a.data, B = b.data
  let diffPixels = 0
  const total = A.length / 4
  for (let i = 0; i < A.length; i += 4) {
    const dr = A[i] - B[i], dg = A[i + 1] - B[i + 1], db = A[i + 2] - B[i + 2]
    if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) > 60) diffPixels++
  }
  return diffPixels / total
}

function driveBufToB64(buf: ArrayBuffer): string {
  let s = ''
  const u8 = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunk)))
  }
  return btoa(s)
}

function startDriveSlideCapture(captureUrl: string): void {
  if (driveSlideTimer !== null) return
  driveSlideStartedAtMs = Date.now()
  driveSlideBaselineEmitted = false
  driveSlidePrev = null
  driveSlideLastEmitTs = -1
  driveSlideSessionId = (typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `drv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
  log('drive-slide: start', { sessionId: driveSlideSessionId, captureUrl })
  driveSlideTimer = window.setInterval(() => {
    void driveSlideTick(captureUrl)
  }, DRIVE_TICK_MS)
}

function stopDriveSlideCapture(): void {
  if (driveSlideTimer !== null) {
    window.clearInterval(driveSlideTimer)
    driveSlideTimer = null
  }
  driveSlidePrev = null
  driveSlideLastEmitTs = -1
  driveSlideBaselineEmitted = false
}

async function driveSlideTick(captureUrl: string): Promise<void> {
  // captureVisibleTab returns the active tab in the sender's window; if the
  // user has switched tabs, skip rather than capture the wrong page.
  if (document.visibilityState !== 'visible') return
  const v = driveVideoTick
  if (!v) return                              // haven't heard from iframe yet
  if (v.paused || v.readyState < 2) return    // mirror SlideDetector tick guard

  const ifr = findVideoIframeForDriveViewer()
  if (!ifr) return
  const rect = ifr.getBoundingClientRect()
  if (rect.width < 100 || rect.height < 100) return

  type CaptureResp = { ok?: boolean; data?: { dataUrl?: string }; error?: string } | null
  let resp: CaptureResp = null
  try {
    const raw = await chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' })
    resp = raw as CaptureResp
  } catch {
    return
  }
  if (!resp?.ok || !resp.data?.dataUrl) return
  const dataUrl = resp.data.dataUrl

  let img: HTMLImageElement
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image decode failed'))
      el.src = dataUrl
    })
  } catch {
    return
  }

  // captureVisibleTab returns the screenshot at device-pixel resolution.
  // Scale the rect's CSS pixels by the image-to-viewport ratio (typically
  // window.devicePixelRatio, but compute from the image to be exact in
  // edge cases like zoom).
  const ratio = img.naturalWidth / window.innerWidth
  const sx = Math.max(0, rect.left * ratio)
  const sy = Math.max(0, rect.top * ratio)
  const sw = rect.width * ratio
  const sh = rect.height * ratio

  // Hi-res canvas for the eventual JPEG upload (capped for bandwidth).
  const targetW = Math.min(rect.width, DRIVE_HIGH_RES_MAX_W)
  const targetH = Math.round(rect.height * (targetW / rect.width))
  const hi = document.createElement('canvas')
  hi.width = targetW; hi.height = targetH
  const hiCtx = hi.getContext('2d')
  if (!hiCtx) return
  hiCtx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH)

  // Low-res for diff.
  const diffCanvas = document.createElement('canvas')
  diffCanvas.width = DRIVE_DIFF_W; diffCanvas.height = DRIVE_DIFF_H
  const diffCtx = diffCanvas.getContext('2d')
  if (!diffCtx) return
  diffCtx.drawImage(hi, 0, 0, DRIVE_DIFF_W, DRIVE_DIFF_H)
  const cur = diffCtx.getImageData(0, 0, DRIVE_DIFF_W, DRIVE_DIFF_H)

  const ts = v.currentTime
  const emit = async () => {
    const blob = await new Promise<Blob | null>(resolve => hi.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob || !driveSlideSessionId) return
    const buf = await blob.arrayBuffer()
    const b64 = driveBufToB64(buf)
    log('drive-slide → POST /v1/stream/slide', { ts: ts.toFixed(1), bytes: blob.size })
    void chrome.runtime.sendMessage({
      type: 'API_FETCH',
      method: 'POST',
      path: '/v1/stream/slide',
      body: { session_id: driveSlideSessionId, url: captureUrl, ts, image_b64: b64, mime: 'image/jpeg' },
    })
  }

  if (driveSlidePrev) {
    const diff = drivePixelDiff(driveSlidePrev, cur)
    const willEmit = diff > DRIVE_DIFF_THRESHOLD && ts - driveSlideLastEmitTs > DRIVE_MIN_GAP_SEC
    if (willEmit) {
      driveSlideLastEmitTs = ts
      driveSlideBaselineEmitted = true
      log('drive-slide diff EMIT', { ts: ts.toFixed(1), diff: (diff * 100).toFixed(1) + '%' })
      await emit()
    } else if (!driveSlideBaselineEmitted && Date.now() - driveSlideStartedAtMs >= DRIVE_BASELINE_DELAY_MS) {
      // Force-emit the first slide ~2s after start so the opening frame
      // (title slide) is captured even when there's no diff trigger yet.
      driveSlideBaselineEmitted = true
      driveSlideLastEmitTs = ts
      log('drive-slide baseline EMIT', { ts: ts.toFixed(1) })
      await emit()
    }
  }
  driveSlidePrev = cur
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

// Fire-and-forget helper around chrome.runtime.sendMessage. The extension
// SW can be in three "missing" states from the content script's view:
//   1. Just restarted (SW MV3 lifecycle) — sendMessage rejects with
//      "Could not establish connection. Receiving end does not exist."
//      until the SW finishes booting. Browser usually retries internally
//      but the promise rejects in some races.
//   2. Disabled / uninstalled at runtime — "Extension context invalidated".
//   3. Update reload — same as (2) for a few seconds.
// Without an attached .catch the rejection becomes an unhandledrejection,
// which is noisy in DevTools, surfaces in error-reporting hooks the page
// itself may have, and (in some MV3 builds) terminates the whole content
// script. Logging at warn-level lets us debug without becoming a UX bug.
function fireAndForgetSend(msg: unknown): void {
  try {
    const p = chrome.runtime.sendMessage(msg)
    if (p && typeof (p as Promise<unknown>).catch === 'function') {
      void (p as Promise<unknown>).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[content] sendMessage failed:', e instanceof Error ? e.message : e)
      })
    }
  } catch (e) {
    // sendMessage can throw synchronously when the extension context
    // is already invalidated (no Promise issued at all).
    // eslint-disable-next-line no-console
    console.warn('[content] sendMessage threw:', e instanceof Error ? e.message : e)
  }
}

function broadcastToFrames(message: unknown): void {
  // Pick the postMessage target origin based on which side the message
  // is bound for:
  //   - source: 'sh-frame'  → destined for the modal iframe at the
  //                            extension origin. Sensitive payloads
  //                            (session IDs, quota, outline) flow here,
  //                            so we restrict the target to
  //                            EXTENSION_ORIGIN — ad / tracker iframes
  //                            on the host page will silently drop the
  //                            message instead of receiving the data.
  //   - source: 'sh-parent' → destined for the video child iframes
  //                            (YouTube same-origin, but also Vimeo /
  //                            K-LMS / Canvas Studio cross-origin).
  //                            We don't know each iframe's origin
  //                            ahead of time and these messages carry
  //                            only control verbs (no sensitive data),
  //                            so '*' stays. The receiver-side handler
  //                            below validates that event.source is
  //                            window.top before acting.
  //   - anything else        → fall back to extension origin (safer
  //                            default; nothing legitimate hits this).
  const m = message as { source?: string } | null
  const targetOrigin = m?.source === 'sh-parent' ? '*' : EXTENSION_ORIGIN
  const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe')
  iframes.forEach(ifr => {
    try { ifr.contentWindow?.postMessage(message, targetOrigin) } catch { /* ignore */ }
  })
}

// Fast pre-flight: read the quota snapshot the modal cached during a
// recent session and decide whether starting a fresh capture is worth
// it. Returns true when the user is at their monthly cap (we should
// SKIP startCapture; the modal will render the explicit "limit
// reached" surface). Returns false when there's no usable cache OR
// the user has headroom — let startCapture run as before; the
// existing 402-on-first-chunk path is the safety net for stale
// caches.
//
// TTL is 5 min: longer than any single page-load → first-chunk gap
// (~12 s) but short enough that a Pro upgrade taking effect doesn't
// leave the user stuck behind a stale "exhausted" cache for hours.
async function isQuotaExhaustedCached(): Promise<boolean> {
  try {
    const r = await chrome.storage.local.get('sh.cachedQuota')
    const cached = r['sh.cachedQuota'] as { quota?: { percent_used?: number }; ts?: number } | undefined
    if (!cached || typeof cached.ts !== 'number' || !cached.quota) return false
    if (Date.now() - cached.ts > 5 * 60 * 1000) return false  // stale
    return (cached.quota.percent_used ?? 0) >= 100
  } catch {
    return false
  }
}

function handleActivate(): void {
  console.log(`[SH:${isTopFrame ? 'top' : 'iframe'}]`, location.host, 'handleActivate')
  // Synchronously tell the modal "we've started, audio is being collected,
  // first transcript arrives in a few seconds". Without this the modal
  // sits in its initial empty state until the canonical session id arrives
  // (~13-18 s on a cold-start path), so users perceive the click as
  // unresponsive. Fired BEFORE the modal even mounts so the React app
  // sees it on first render via the SP_BROADCAST channel.
  fireAndForgetSend({
    type: 'SP_BROADCAST',
    payload: { type: 'session_pending' },
  })
  // Defer the capture-start branch until we know whether the user has
  // quota headroom. Modal mount happens unconditionally — we want them
  // to see their saved notes / the upgrade card regardless.
  const startCaptureIfAllowed = async (): Promise<void> => {
    const exhausted = await isQuotaExhaustedCached()
    if (exhausted) {
      log('handleActivate: skipping startCapture — cached quota at 100%')
      return
    }
    void startCapture(location.href)
  }
  if (isDriveViewerTop()) {
    // Drive viewer: modal in top frame, capture in the YouTube embed iframe.
    // parentUrl is the iframe's src so /v1/session lookup matches the URL
    // the capture frame uses when POSTing chunks (mirroring the K-LMS /
    // Vimeo path that uses data.frameUrl for the same reason).
    const ifr = findVideoIframeForDriveViewer()
    mountModal({
      onClose: () => {
        broadcastToFrames({ source: 'sh-parent', type: 'MODAL_CLOSED' })
        onModalClosed()
        // Tear down the Drive-only screenshot loop along with the modal so
        // we don't keep round-tripping the SW after the user is done.
        stopDriveSlideCapture()
      },
      onSetSpeed: (speed: number) => {
        // No local <video> here — relay the speed change to the iframe.
        broadcastToFrames({ source: 'sh-parent', type: 'SET_SPEED', speed })
      },
      // Prefer the iframe-reported location.href (matches POST-time url_hash);
      // fall back to the HTML iframe.src attribute (may drift after embed
      // internal navigation), then to our own top-frame URL as a last resort.
      parentUrl: driveIframeFrameUrl ?? ifr?.src ?? location.href,
    })
    setButtonStatus('hidden')
    // Tell the YouTube embed iframe (which holds the <video>) to begin capture.
    broadcastToFrames({ source: 'sh-parent', type: 'START_CAPTURE' })
    // Start our top-frame slide-capture loop (canvas drawImage of the
    // <video> doesn't work in Drive's embed, so we screenshot the tab
    // and crop the iframe rect instead).
    startDriveSlideCapture(driveIframeFrameUrl ?? ifr?.src ?? location.href)
    return
  }

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
      parentUrl: location.href,
    })
    setButtonStatus('hidden')
    void startCaptureIfAllowed()
  } else {
    // Iframe: ask the parent (top frame) to mount the modal; capture stays here
    // (we have the <video> element in this frame).
    window.parent.postMessage(
      { source: 'sh-frame', type: 'REQUEST_MODAL', frameUrl: location.href },
      '*',
    )
    setButtonStatus('hidden')
    void startCaptureIfAllowed()
  }
}

function tryMountButton(): void {
  if (detected) return

  // Drive viewer: top frame owns the button (anchored to the video iframe's
  // rect). The iframe still detects its <video> below for capture, but its
  // button mount is suppressed via the isHostedInDriveViewer() branch.
  if (isDriveViewerTop()) {
    const ifr = findVideoIframeForDriveViewer()
    if (!ifr) return
    detected = true
    // activeVideo stays null in this frame — the YouTube iframe holds it
    log('drive-viewer top: mounting button anchored to video iframe', { src: ifr.src })
    button = mountInlineButton(ifr, () => { handleActivate() })
    void chrome.runtime.sendMessage({ type: 'WARMUP' }).catch(() => { /* ignore */ })
    return
  }

  // YouTube embed iframe inside Drive viewer: detect the video so START_CAPTURE
  // (postMessage from top) can drive startCapture(), but DON'T mount our own
  // button — clicks here would be lost to Drive's overlay anyway, and the top
  // frame already mounted one anchored over this iframe.
  if (isHostedInDriveViewer()) {
    const v = findBestVideo()
    if (!v) return
    detected = true
    activeVideo = v
    // Hand the top frame our real location.href so its modal mounts with a
    // matching parentUrl. Top frame can't read this via `iframe.src` because
    // the attribute drifts after embed-internal navigation.
    try {
      window.parent.postMessage(
        { source: 'sh-frame', type: 'DRIVE_IFRAME_URL', frameUrl: location.href },
        '*',
      )
    } catch { /* ignore */ }
    log('drive-viewer iframe: video detected, mount skipped, frameUrl reported', { videoW: v.videoWidth })
    return
  }

  const v = findBestVideo()
  if (!v) return
  detected = true
  activeVideo = v
  console.log(`[SH:${isTopFrame ? 'top' : 'iframe'}]`, location.host, 'video found, mounting button', { rectW: v.getBoundingClientRect().width, rectH: v.getBoundingClientRect().height, videoW: v.videoWidth, videoH: v.videoHeight })
  // Inline overlay no longer hosts a "stop session" button — stopping
  // is a modal-only action now. Keep the activate callback only.
  button = mountInlineButton(v, () => { handleActivate() })
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
    maybeSeekFromUrl()

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

// Auto-seek from `__sh_seek=<seconds>` URL param. Markdown-obsidian's
// deepLink() emits this alongside the standard `t=NNs` so timestamp
// links land at the right time on platforms whose player ignores
// `t=` (K-LMS, Canvas Studio, Kaltura, etc.) — verified empirically
// that K-LMS rejects every standard timestamp param convention.
//
// We poll for the video to be ready (loadedmetadata) and seek when
// it is, with a 15 s ceiling so we stop even if the page never
// produces a video. Only acts on iframes / pages that actually
// contain a <video>; the param itself is harmless on other pages.
function maybeSeekFromUrl(): void {
  const seekParam = new URLSearchParams(location.search).get('__sh_seek')
  if (!seekParam) return
  const targetSec = parseFloat(seekParam)
  if (!isFinite(targetSec) || targetSec < 0) return

  let attempts = 0
  const MAX_ATTEMPTS = 30   // 30 × 500 ms = 15 s
  const id = window.setInterval(() => {
    attempts++
    const v = findBestVideo()
    if (v && v.readyState >= 2) {
      try {
        v.currentTime = targetSec
        // eslint-disable-next-line no-console
        console.log(`[SH:seek] jumped to ${targetSec}s via __sh_seek param`)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[SH:seek] currentTime assignment threw', e)
      }
      // Best-effort autoplay — most browsers block autoplay for
      // videos with audio when the user hasn't interacted with the
      // page yet. The catch is intentional: if blocked, the user
      // sees the video paused at the right timestamp and can hit
      // play themselves. Better than starting at 0:00.
      if (v.paused) v.play().catch(() => { /* autoplay policy */ })
      window.clearInterval(id)
    } else if (attempts >= MAX_ATTEMPTS) {
      window.clearInterval(id)
      // eslint-disable-next-line no-console
      console.warn(`[SH:seek] gave up after ${MAX_ATTEMPTS} attempts — no playable video`)
    }
  }, 500)
}

// Gate init() too — it sets up a MutationObserver and a 30 s polling
// interval. On content-script re-injection (SPA navigation in the same
// document), running init() again would stack a second observer that
// fires on every DOM mutation in addition to the original, eventually
// O(N) observers per long-lived tab.
if (__sh_first_boot__) init()

// ===== Cross-frame message routing =====
// All addEventListener / chrome.runtime.onMessage / chrome.storage.onChanged
// calls below are gated behind __sh_first_boot__ so they do not duplicate
// when Chrome re-injects this content script into the same frame (e.g.
// after an SPA navigation that doesn't reload the document).

if (__sh_first_boot__ && isTopFrame) {
  // Receive messages from child iframes (e.g. iframe asks us to mount the modal).
  // Origin policy: REQUEST_MODAL is sent by content scripts running in CHILD
  // iframes (any origin — host-same-origin, Vimeo, K-LMS, Canvas Studio, etc.).
  // We can't restrict by event.origin without breaking those legitimate
  // cross-origin video frames, so we instead validate via event.source: it
  // must be a real Window object that is neither this top frame nor null
  // (a page-top script trying to impersonate a child iframe would have
  // event.source === window). This blocks the in-page-script attack vector
  // while still admitting all genuine cross-origin video iframes.
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { source?: string; type?: string; frameUrl?: string } | null
    if (!data || data.source !== 'sh-frame') return
    if (e.source === null || e.source === window) {
      // eslint-disable-next-line no-console
      console.warn('[SH:top] rejecting sh-frame message with non-iframe source', { origin: e.origin })
      return
    }

    if (data.type === 'DRIVE_VIDEO_TICK') {
      // YouTube embed iframe is broadcasting its <video> state so our
      // top-frame slide-capture loop can decide when to tick (we have no
      // direct DOM access to the video element from this frame).
      const t = data as unknown as { paused?: boolean; currentTime?: number; readyState?: number }
      if (typeof t.paused === 'boolean' && typeof t.currentTime === 'number' && typeof t.readyState === 'number') {
        driveVideoTick = { paused: t.paused, currentTime: t.currentTime, readyState: t.readyState }
      }
      return
    }

    if (data.type === 'DRIVE_IFRAME_URL' && typeof data.frameUrl === 'string') {
      // Drive-viewer mode: the YouTube embed iframe has reported its real
      // location.href so that when the user clicks our button, handleActivate
      // can mount the modal with a parentUrl that matches what the iframe
      // POSTs under. Stored once at detection time; subsequent reports
      // (e.g. iframe re-init) overwrite — the most recent value is what
      // the iframe will be using when it next POSTs a chunk.
      driveIframeFrameUrl = data.frameUrl
      log('top: stored drive iframe frameUrl', { frameUrl: data.frameUrl })
      return
    }

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
        // Use the iframe's URL so the modal queries /v1/session with the
        // SAME url that the capture frame uploaded chunks under. Falling
        // back to location.href (the top frame's URL) breaks markdown
        // export with 404 on K-LMS / Vimeo / Canvas Studio because the
        // url_hash differs from what stream-audio inserted.
        parentUrl: data.frameUrl,
      })
    }
    // 'STOPPED' from a child is informational — modal stays open until user
    // closes it. Notes are already saved server-side. No-op for now.
  })

  // Modal-originated control messages (JUMP_TO, TRIGGER_CURATE). The
  // modal lives as an iframe inside this top frame and posts to
  // window.parent (= here). On YouTube the video is in this frame too,
  // so the listeners registered inside startCapture pick the message
  // up directly. On K-LMS / Vimeo the video is in a child iframe; we
  // need to forward the message there. Doing both unconditionally is
  // safe — only the frame that actually has activeVideo / capture
  // state will act on it.
  // Origin policy: sh-parent messages received here originate from the
  // modal iframe at the extension origin. Reject anything else — a
  // host-page script firing { source:'sh-parent', type:'SET_PLAY' }
  // would otherwise jump video time / toggle play / fire a curate.
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { source?: string; type?: string; ts?: number; full?: boolean; play?: boolean } | null
    if (!data || data.source !== 'sh-parent') return
    if (e.origin !== EXTENSION_ORIGIN) {
      // eslint-disable-next-line no-console
      console.warn('[SH:top] rejecting sh-parent from non-extension origin', { origin: e.origin, type: data.type })
      return
    }
    if (data.type === 'JUMP_TO' && typeof data.ts === 'number') {
      if (activeVideo) activeVideo.currentTime = data.ts
      broadcastToFrames(data)
    } else if (data.type === 'TRIGGER_CURATE') {
      broadcastToFrames(data)
    } else if (data.type === 'SET_PLAY' && typeof data.play === 'boolean') {
      // Modal-originated play/pause toggle. Apply locally if the video
      // lives in the top frame, AND fan out to children since the
      // <video> may be in a child iframe (K-LMS, Vimeo, etc).
      if (activeVideo) {
        if (data.play) void activeVideo.play().catch(() => { /* ignore */ })
        else activeVideo.pause()
      }
      broadcastToFrames(data)
    }
  })
} else if (__sh_first_boot__) {
  // Iframe: receive directives from the top frame.
  // Origin policy: sh-parent control messages here are sent by the top
  // frame via broadcastToFrames — so event.source must equal window.top.
  // (We can't compare event.origin to top frame's origin because that's
  // cross-origin and unreadable from here.) The Window-identity check
  // blocks any host-page-injected script in this iframe trying to fake
  // a STOP_CAPTURE / JUMP_TO / SET_PLAY directive on its own.
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { source?: string; type?: string; speed?: number; ts?: number; play?: boolean } | null
    if (!data || data.source !== 'sh-parent') return
    if (e.source !== window.top) {
      // eslint-disable-next-line no-console
      console.warn('[SH:iframe] rejecting sh-parent from non-top source', { origin: e.origin, type: data.type })
      return
    }

    if (data.type === 'MODAL_CLOSED') {
      onModalClosed()
    } else if (data.type === 'SET_SPEED' && typeof data.speed === 'number') {
      applySpeed(data.speed)
    } else if (data.type === 'STOP_CAPTURE') {
      stopCaptureLocal()
    } else if (data.type === 'START_CAPTURE') {
      // Drive viewer: top frame received the inline-button click and asked
      // us (the YouTube embed iframe that actually holds the <video>) to
      // begin capture. Mirrors the local startCapture branch in
      // handleActivate(), minus the modal mount (top already did it).
      log('START_CAPTURE received from top frame')
      void (async () => {
        const exhausted = await isQuotaExhaustedCached()
        if (exhausted) { log('skip START_CAPTURE — cached quota at 100%'); return }
        void startCapture(location.href)
      })()
      // Drive-only: the top frame's slide-capture loop can't read our
      // <video> element directly, so we broadcast its state (paused /
      // currentTime / readyState) at 1Hz. Top frame uses this to gate
      // its captureVisibleTab calls and to stamp each slide's ts.
      if (isHostedInDriveViewer()) {
        window.setInterval(() => {
          if (!activeVideo) return
          window.parent.postMessage({
            source: 'sh-frame',
            type: 'DRIVE_VIDEO_TICK',
            paused: activeVideo.paused,
            currentTime: activeVideo.currentTime,
            readyState: activeVideo.readyState,
          }, '*')
        }, 1000)
      }
    } else if (data.type === 'JUMP_TO' && typeof data.ts === 'number') {
      // Top frame relays modal jump requests here. Only the frame with
      // the actual <video> acts (others have activeVideo === null).
      if (activeVideo) activeVideo.currentTime = data.ts
    } else if (data.type === 'SET_PLAY' && typeof data.play === 'boolean') {
      // Top frame relays modal play/pause toggles here. Only the frame
      // with the actual <video> acts; siblings without it are no-ops.
      if (activeVideo) {
        if (data.play) void activeVideo.play().catch(() => { /* ignore */ })
        else activeVideo.pause()
      }
    }
  })
}

// ===== Storage / runtime message routing (existing) =====

if (__sh_first_boot__) {
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
    // Side-panel-originated jumps arrive here via the SW's tabs.sendMessage.
    // Only the top frame receives it (chrome.tabs.sendMessage delivers to
    // the top frame by default). Forward to children iframes too because
    // the video may live in one of them (K-LMS, Vimeo).
    //
    // Note: we deliberately do NOT touch playbackRate here. The previous
    // implementation reset it to 1.0 on every jump, which yanked users
    // out of their chosen 2× / 1.5× playback. The user's speed setting
    // is its own concern — a jump shouldn't override it.
    if (activeVideo) activeVideo.currentTime = msg.ts
    if (isTopFrame) {
      broadcastToFrames({ source: 'sh-parent', type: 'JUMP_TO', ts: msg.ts })
    }
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

}  // end if (__sh_first_boot__)

function stopCaptureLocal(): void {
  // Run the wrap-up handler — pauses the underlying <video>, runs the
  // final curate, broadcasts session_ended, and detaches every per-
  // session listener that the closure registered. Calling this from
  // user-stop makes the modal's 停止 button equivalent to the natural-
  // end path (the user wants the notes now, just like ended-of-video).
  // session.stopped guard inside onEndedHandler makes it idempotent.
  if (onEndedHandler) {
    try {
      // Detach the 'ended' listener BEFORE invoking, so a later
      // 'ended' fire (the user might keep playing the video to the
      // end after they've already stopped) doesn't re-run wrap-up.
      if (activeVideo) activeVideo.removeEventListener('ended', onEndedHandler)
      onEndedHandler()
    } catch (e) { warn('onEndedHandler threw', e) }
    onEndedHandler = null
  } else {
    // No wrap-up handler set (capture never started, or already torn
    // down). Defensive cleanup of capture/detector if somehow lingering.
    if (activeSession) {
      activeSession.stopped = true
      // Fire the abort so any in-flight chunk/slide post-processing in
      // this frame short-circuits at the next await boundary. The SW's
      // /v1/stream/audio fetch itself can't be aborted from here (no
      // signal channel across sendMessage), but the response will be
      // ignored by the session.stopped guard above.
      try { activeSession.abort.abort() } catch { /* ignore */ }
    }
    try { capture?.stop() } catch { /* ignore */ }
    try { detector?.stop() } catch { /* ignore */ }
  }
  capture = null
  detector = null
  activeSession = null
  if (captureCleanup) {
    try { captureCleanup() } catch { /* ignore */ }
    captureCleanup = null
  }
  // Notes preserved server-side; revert button so the user can re-engage.
  setButtonStatus('idle')
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

  // Lazy-load the audio/slide modules ONLY when a capture actually
  // starts. The content script runs in every iframe (manifest's
  // all_frames: true), and most iframes never reach this code path —
  // eagerly importing these modules into every frame was pure waste.
  // CRX plugin v2 handles the dynamic-import chunk emission + WAR
  // registration automatically.
  const [{ AudioCapture, blobToBase64 }, { SlideDetector }] = await Promise.all([
    import('./audio-capture'),
    import('./slide-detector'),
  ])

  log('startCapture: starting', { url, readyState: activeVideo.readyState, paused: activeVideo.paused })

  // ── Push initial video state IMMEDIATELY (synchronous) ─────────────
  // The modal renders the "録音中 / 停止中" pill from this signal. Doing
  // it here (before the awaited storage read, before the AudioContext
  // construction, before the listeners) closes a window where the user
  // could press play and see no UI feedback for hundreds of ms. The
  // play/pause listeners are attached at the very next sync line so
  // any subsequent state change is captured too.
  const earlyVideoStateMessage = (playing: boolean) => ({
    type: 'SP_BROADCAST',
    payload: { type: 'video_state', playing },
  })
  fireAndForgetSend(earlyVideoStateMessage(!activeVideo.paused))
  broadcastToFrames({ source: 'sh-frame', type: 'VIDEO_STATE', playing: !activeVideo.paused })

  // Attach play/pause listeners IMMEDIATELY too — before the async
  // storage read. If the user presses play during the await window we
  // would otherwise miss the event entirely. We attach a thin proxy
  // here that just rebroadcasts state; the curate-trigger listeners
  // are attached later (after capture is up) and are independent.
  const earlyOnPlay = () => {
    fireAndForgetSend(earlyVideoStateMessage(true))
    broadcastToFrames({ source: 'sh-frame', type: 'VIDEO_STATE', playing: true })
  }
  const earlyOnPause = () => {
    fireAndForgetSend(earlyVideoStateMessage(false))
    broadcastToFrames({ source: 'sh-frame', type: 'VIDEO_STATE', playing: false })
  }
  activeVideo.addEventListener('play', earlyOnPlay)
  activeVideo.addEventListener('pause', earlyOnPause)
  // Register a cleanup so stopCaptureLocal() can detach these even
  // when the natural ended/onEndedHandler path doesn't fire.
  captureCleanup = () => {
    activeVideo?.removeEventListener('play', earlyOnPlay)
    activeVideo?.removeEventListener('pause', earlyOnPause)
  }

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
  // rather than re-reading any module-level session id from inside the
  // AudioCapture callback. After the user presses stop, stopCaptureLocal()
  // would clear such a module variable, but MediaRecorder may still emit one
  // last "drain" chunk via onstop AFTER that nulling. If the callback read
  // the module variable, that drain chunk would POST `session_id: null` and
  // the backend's Zod validator would 400. Holding the id in a closure scopes
  // it correctly to this capture session only.
  // AbortController scoped to this capture session. Triggered by
  // stopCaptureLocal() / onEndedHandler. We can't abort the SW-side
  // /v1/stream/audio fetch from here (chrome.runtime.sendMessage doesn't
  // accept an AbortSignal and the SW does the actual fetch), but the
  // signal still serves three purposes inside this content frame:
  //   1. Short-circuit the 1.5 s retry sleep when the user stops mid-
  //      backoff (otherwise a chunk POST you no longer care about can
  //      still fire ~1.5 s after stop()).
  //   2. Skip the b64-encode + sendMessage path for any chunk whose
  //      onChunk callback raced past the session.stopped flag check.
  //   3. Auto-detach the TRIGGER_CURATE message listener via
  //      addEventListener({ signal }) — already in place below.
  const sessionAbort = new AbortController()
  const session: {
    id: string
    canonicalAdopted: boolean
    stopped: boolean
    abort: AbortController
    // Slides emitted before the canonical session id arrives. Holding
    // them here (instead of dropping) preserves the very first slide —
    // SlideDetector's forced-baseline emit fires at ~2 s after capture
    // start, while the canonical id arrives only after the first audio
    // chunk completes its STT round-trip (~3-4 s). Without this queue
    // the opening slide of every lecture is silently lost.
    pendingSlides: Slide[]
  } = {
    id: crypto.randomUUID(),
    canonicalAdopted: false,
    stopped: false,
    abort: sessionAbort,
    pendingSlides: [],
  }
  let chunksSent = 0
  // ── In-flight retry queue ─────────────────────────────────────────────
  // Stashes audio chunks whose POST failed with a *network exception*
  // (the SW.sendMessage promise threw, meaning the request never got
  // off the device). On the next successful POST we drain this queue
  // so transient wifi blinks don't lose 10-30 s of audio.
  //
  // We deliberately do NOT enqueue chunks that received an HTTP error
  // (5xx after retry, 4xx, etc.). Reason: the server may have already
  // processed the chunk and the response just got lost on the way back
  // — re-sending would write the same transcript twice into
  // sessions.transcripts. Network-throw is the one case we can be
  // confident the request never reached Lambda, so re-send is safe.
  //
  // Cap: 6 chunks ≈ 60 s of audio at ~320 KB each ≈ 1.9 MB. Beyond
  // that we drop the oldest (FIFO) — the user's outage is long enough
  // that perfect recovery is no longer realistic, and unbounded growth
  // would risk page-tab memory pressure.
  interface PendingChunk {
    startTimeSec: number
    durationSec: number
    audio_b64: string
    mime: string
  }
  const pendingChunks: PendingChunk[] = []
  const MAX_PENDING_CHUNKS = 6
  let draining = false  // single-flight guard so two drain cycles don't race on the queue

  type ChunkOk = {
    ok: true
    data: {
      added?: number
      transcript_preview?: string
      session_id: string
      quota?: QuotaSnapshot
      chunk_error?: string
    }
  }
  type ChunkErr = { ok: false; error: string; status?: number; data?: { error?: string; quota?: QuotaSnapshot } }

  const isTransient5xx = (resp: ChunkOk | ChunkErr | undefined): boolean =>
    !!resp && !resp.ok && typeof resp.status === 'number' && resp.status >= 500 && resp.status < 600

  // Single SW round-trip — caller decides whether to retry / enqueue.
  const sendChunkOnce = (p: PendingChunk): Promise<ChunkOk | ChunkErr | undefined> =>
    chrome.runtime.sendMessage({
      type: 'API_FETCH',
      method: 'POST',
      path: '/v1/stream/audio',
      body: {
        session_id: session.id,
        url,
        start_time_sec: p.startTimeSec,
        duration_sec: p.durationSec,
        audio_b64: p.audio_b64,
        mime: p.mime,
      } satisfies StreamAudioBody,
    }) as Promise<ChunkOk | ChunkErr | undefined>

  // Best-effort drain of the backlog. Runs after a successful live
  // chunk so we know connectivity is restored. One in-flight at a
  // time (draining flag) so a delayed second trigger doesn't pop the
  // same item twice. Stops on first failure — the next live chunk's
  // success will trigger another drain attempt.
  const drainPending = async (): Promise<void> => {
    if (draining) return
    if (pendingChunks.length === 0) return
    draining = true
    try {
      while (pendingChunks.length > 0) {
        if (session.stopped || session.abort.signal.aborted) return
        const head = pendingChunks[0]
        let res: ChunkOk | ChunkErr | undefined
        try {
          res = await sendChunkOnce(head)
        } catch {
          // Still offline. Leave queue intact for next live chunk.
          log('drainPending: network still failing; keeping queue', { remaining: pendingChunks.length })
          return
        }
        if (res?.ok) {
          pendingChunks.shift()
          log('drainPending: replayed queued chunk', { remaining: pendingChunks.length })
          continue
        }
        // Non-2xx response. 4xx (other than 402 quota — capture is
        // about to stop anyway) means the request will never succeed
        // however many times we replay it (auth gone, ZodError, etc.)
        // — drop it. 5xx leaves the chunk in the queue; the next live
        // chunk's success path will retry.
        if (res && res.status && res.status >= 400 && res.status < 500 && res.status !== 402) {
          pendingChunks.shift()
          warn('drainPending: dropping queued chunk on permanent 4xx', { status: res.status, remaining: pendingChunks.length })
          continue
        }
        // 5xx or empty response → leave in queue.
        log('drainPending: backend not ready; pausing drain', { status: res?.status, remaining: pendingChunks.length })
        return
      }
    } finally {
      draining = false
    }
  }

  const enqueueChunk = (p: PendingChunk): void => {
    if (pendingChunks.length >= MAX_PENDING_CHUNKS) {
      const dropped = pendingChunks.shift()
      warn('pending queue full; dropping oldest', {
        droppedTs: dropped?.startTimeSec,
        queueCap: MAX_PENDING_CHUNKS,
      })
    }
    pendingChunks.push(p)
    log('chunk enqueued for retry', { startTimeSec: p.startTimeSec, queueLen: pendingChunks.length })
  }

  try {
    capture = new AudioCapture(activeVideo, async (chunk) => {
      // After stopCaptureLocal() flips the flag, drop any straggler chunk
      // produced by MediaRecorder's drain rather than POSTing with a stale id.
      if (session.stopped) { log('audio chunk dropped (session stopped)'); return }
      chunksSent += 1
      log('audio chunk produced', { n: chunksSent, durationSec: chunk.durationSec, blobSize: chunk.blob.size, mime: chunk.mime })
      const b64 = await blobToBase64(chunk.blob)
      const payload: PendingChunk = {
        startTimeSec: chunk.startTimeSec,
        durationSec: chunk.durationSec,
        audio_b64: b64,
        mime: chunk.mime,
      }
      // Single retry with 1.5s backoff for transient 5xx. Observed in
      // production: API Gateway → VPC Lambda occasionally returns 503
      // even though the Lambda itself succeeds (CloudWatch shows clean
      // invocations). About 1 in 5 chunks affected on cold-network
      // moments. A single retry recovers virtually all of them and the
      // delay is hidden inside the 10 s chunk cadence.
      const sendChunk = (): Promise<ChunkOk | ChunkErr | undefined> => sendChunkOnce(payload)
      let r: ChunkOk | ChunkErr | undefined
      try {
        r = await sendChunk()
        if (session.stopped || session.abort.signal.aborted) return
        if (isTransient5xx(r)) {
          warn('audio chunk: transient 5xx, retrying once', { status: (r as ChunkErr).status, n: chunksSent })
          // Abortable sleep — when the user clicks 停止 mid-backoff we
          // resolve early and exit before issuing the retry, instead of
          // making the user wait 1.5 s for a request they no longer
          // care about.
          await new Promise<void>(res => {
            const t = setTimeout(res, 1500)
            session.abort.signal.addEventListener('abort', () => {
              clearTimeout(t)
              res()
            }, { once: true })
          })
          if (session.stopped || session.abort.signal.aborted) return
          r = await sendChunk()
          if (session.stopped || session.abort.signal.aborted) return
        }
      } catch (e) {
        // Network exception — request never reached Lambda. Stash for
        // replay on the next successful chunk's drain. We are
        // confident there's no server-side write to dedup against,
        // so re-sending later is safe (no double-INSERT risk).
        warn('audio chunk sendMessage threw — enqueueing for retry', e)
        enqueueChunk(payload)
        return
      }

      if (!r) { warn('audio chunk: empty response'); return }

      if (!r.ok) {
        warn('audio chunk: backend error', r.error)
        // 402 = quota exceeded. Pull the quota snapshot the backend embeds
        // in the body, push it to the modal as a blocking banner, and stop
        // capture cleanly — there's no point burning bandwidth on chunks the
        // backend will reject for the rest of the period.
        if (r.status === 402 && r.data?.error === 'quota_exceeded' && r.data.quota) {
          fireAndForgetSend({
            type: 'SP_BROADCAST',
            payload: { type: 'quota_exceeded', quota: r.data.quota },
          })
          broadcastToFrames({ source: 'sh-frame', type: 'QUOTA_EXCEEDED', quota: r.data.quota })
          stopCaptureLocal()
        }
        // 503 service_unavailable = backend classified an upstream LLM
        // failure (Groq STT auth/quota/rate). Operator was notified via
        // SNS already; for the user we (a) surface a "service down"
        // banner via the same curate_failed channel the modal already
        // renders, and (b) stop capture immediately — every additional
        // chunk would just hit the same upstream wall and waste audio.
        if (r.status === 503 && r.data?.error === 'service_unavailable') {
          warn('audio chunk: service_unavailable — stopping capture', { provider: (r.data as { provider?: string }).provider, kind: (r.data as { kind?: string }).kind })
          fireAndForgetSend({
            type: 'SP_BROADCAST',
            payload: { type: 'curate_failed', reason: 'service_unavailable' },
          })
          broadcastToFrames({ source: 'sh-frame', type: 'CURATE_FAILED', reason: 'service_unavailable' })
          stopCaptureLocal()
        }
        return
      }
      log('audio chunk: backend ok', { added: r.data?.added, preview: r.data?.transcript_preview, canonicalSessionId: r.data?.session_id })

      if (!session.canonicalAdopted) {
        const canonical = r.data?.session_id
        if (canonical) {
          session.id = canonical
          session.canonicalAdopted = true
          log('canonical session adopted, broadcasting session_started', canonical)
          fireAndForgetSend({
            type: 'SP_BROADCAST',
            payload: { type: 'session_started', sessionId: canonical, url },
          })
          // Flush any slides emitted before the canonical id was adopted
          // (forced-baseline emit fires at ~2 s, but the canonical id
          // arrives only after this first audio chunk completes its STT
          // round-trip). Drain in order so timestamps stay monotonic.
          if (session.pendingSlides.length > 0) {
            const drain = session.pendingSlides.splice(0)
            log('flushing pre-adoption slides', { count: drain.length })
            for (const queued of drain) {
              void postSlide(queued)
            }
          }
        }
      }

      // Forward the latest quota snapshot to the modal on every chunk so
      // the banner reflects current usage in near-real-time. The modal uses
      // this to escalate from silent → 50% subtle → 80% amber → 95% orange
      // → 100% blocking. Sent both via SW broadcast (side-panel UI) and
      // via in-page postMessage (embed iframe modal).
      if (r.data?.quota) {
        fireAndForgetSend({
          type: 'SP_BROADCAST',
          payload: { type: 'quota_update', quota: r.data.quota },
        })
        broadcastToFrames({ source: 'sh-frame', type: 'QUOTA_UPDATE', quota: r.data.quota })
      }

      // Live chunk just succeeded → connectivity is restored. Drain
      // any chunks that were queued during a previous outage. Fire
      // and forget: the live chunk cadence is 10 s, draining a few
      // ~1 s POSTs in the background is well within that window. A
      // single-flight guard inside drainPending prevents racing.
      if (r?.ok && pendingChunks.length > 0) {
        void drainPending()
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

  // Slide POST extracted so the audio-chunk path can flush queued slides
  // through the same code path after canonical-id adoption.
  const postSlide = async (slide: Slide): Promise<void> => {
    if (session.stopped || session.abort.signal.aborted) {
      log('slide dropped (session stopped)', { ts: slide.ts.toFixed(1) })
      return
    }
    const buf = await slide.blob.arrayBuffer()
    if (session.stopped || session.abort.signal.aborted) return
    const b64 = arrayBufferToBase64(buf)
    log('slide → POST /v1/stream/slide', { ts: slide.ts.toFixed(1), bytes: slide.blob.size })
    const r = await chrome.runtime.sendMessage({
      type: 'API_FETCH',
      method: 'POST',
      path: '/v1/stream/slide',
      // `url` is required by the backend's Zod validator — same shape as
      // /v1/stream/audio. Omitting it produced a 500 (ZodError surfaced
      // as Internal Server Error) on every slide upload.
      body: {
        session_id: session.id, url, ts: slide.ts, image_b64: b64, mime: 'image/jpeg',
      } satisfies StreamSlideBody,
    }) as { ok: boolean; error?: string; status?: number } | null
    if (!r) warn('slide POST: empty response')
    else if (!r.ok) warn('slide POST failed', { status: r.status, error: r.error })
    else log('slide POST ok', { ts: slide.ts.toFixed(1) })
  }

  detector = new SlideDetector(activeVideo, async (slide: Slide) => {
    if (session.stopped) {
      log('slide dropped (session stopped)', { ts: slide.ts.toFixed(1) })
      return
    }
    if (!session.canonicalAdopted) {
      // Queue rather than drop. The audio-chunk handler flushes this
      // queue right after it adopts the canonical session id.
      // Bounded: if the FIRST audio chunk fails repeatedly (STT 5xx
      // loop, network down, etc.) the queue would grow without limit
      // — every slide the detector emits keeps piling on. Cap at 50,
      // dropping oldest, so the worst case is bounded memory and we
      // still flush the most recent slides if the canonical id ever
      // does arrive. 50 ≈ 8 minutes of slide-change activity at the
      // typical detector rate, more than enough headroom for normal
      // canonical-adoption latency (10–18 s).
      const PENDING_SLIDES_CAP = 50
      session.pendingSlides.push(slide)
      if (session.pendingSlides.length > PENDING_SLIDES_CAP) {
        session.pendingSlides.shift()
      }
      log('slide queued (waiting for canonical session id)', { ts: slide.ts.toFixed(1), queued: session.pendingSlides.length })
      return
    }
    await postSlide(slide)
  })
  detector.start()
  log('SlideDetector started — first emit can only happen after baseline frame + change')

  // ── Phase 6.1: on-demand curator triggers ──────────────────────────────
  // The curator is no longer driven by stream-audio (rolling). It runs
  // on demand when the user signals "I'm pausing — give me notes":
  //   - pause event after 3 s of remaining paused (debounce — short
  //     scrub-pauses or scrub-back shouldn't fire the curator)
  //   - ended event (video finished naturally)
  //   - the modal's manual "📝 ノートを生成" button (sent via window
  //     postMessage from the iframe → see SH_TRIGGER_CURATE handler)
  //
  // Each trigger calls POST /v1/session/curate which reads the full
  // transcript log and (re)writes the outline, then broadcasts via WS.
  let curateInFlight = false

  const triggerCurate = (reason: string): void => {
    if (!session.canonicalAdopted) return       // no session yet — nothing to curate
    if (curateInFlight) return                  // dedupe overlapping requests
    curateInFlight = true
    log('triggering curate', { reason, sessionId: session.id })
    // The modal is the user-facing surface — tell it we're curating so
    // it can swap to a "ノート生成中…" state. The modal receives this
    // via window.postMessage from this content frame.
    broadcastToFrames({ source: 'sh-frame', type: 'CURATING', reason })
    // Resolve the user's "Note language" preference (Options page) and
    // include it in the curate body. The backend curator otherwise
    // defaults to its hardcoded Japanese output regardless of the
    // lecture language — this is what makes "Follow lecture language
    // (auto)" actually do something. Read directly from chrome.storage
    // (the i18n module isn't loaded in content scripts).
    void (async () => {
      let noteLang: 'auto' | 'ja' | 'en' | 'ko' | 'zh' = 'auto'
      try {
        const r = await chrome.storage.local.get('sh.noteLang')
        const stored = r['sh.noteLang']
        if (stored === 'auto' || stored === 'ja' || stored === 'en' || stored === 'ko' || stored === 'zh') {
          noteLang = stored
        }
      } catch { /* fall through to 'auto' */ }
      chrome.runtime.sendMessage({
      type: 'API_FETCH',
      method: 'POST',
      // Lambda Function URL bypasses API Gateway HTTP API's hard 30 s
      // integration timeout — the curator can take 50–90 s on long
      // transcripts. When CURATE_URL isn't set (dev / older builds) we
      // fall through to the API GW route, which still works for short
      // sessions but will 503 on long ones.
      path: '/v1/session/curate',
      absoluteUrl: CURATE_URL || undefined,
      body: {
        session_id: session.id,
        full_rewrite: reason === 'manual_full',
        note_lang: noteLang,
      } satisfies SessionCurateBody,
    }).then((r: unknown) => {
      // Backend response shapes:
      //   200 { outline: {...} }                            ← success
      //   200 { outline: null, reason: 'no_transcripts_yet' } ← soft-fail
      //   502 { error: 'curator_failed', message: '...' }   ← LLM blew up
      // The SW's API_FETCH wrapper preserves `data` (parsed body) on every
      // status. So we read `data.reason` (200-soft-fail key) THEN
      // `data.error` (4xx/5xx key) before falling through to the SW's
      // wrapper string. Without consulting `data.error`, every 5xx ended
      // up as a raw "HTTP 502: {...}" reason that didn't match any
      // T.curateError[reason] entry → user always saw the generic
      // fallback copy instead of the localised "curator_failed" hint.
      const resp = r as {
        ok: boolean
        data?: { outline?: unknown; reason?: string; error?: string }
        error?: string
      } | null
      const ok = !!resp?.ok
      log('curate done', { reason, ok, hasOutline: !!resp?.data?.outline, error: resp?.error })
      // Fallback path: WS broadcast can be lost if the connection dropped
      // during the long curator wait (cold-start LLM calls take 30-70 s,
      // long enough for an idle WS to be reaped). Push the outline directly
      // to the modal here too — the modal's onOutline handler is idempotent
      // (replaces state with the latest outline) so duplicate delivery is
      // harmless. This guarantees the user never sits in an infinite
      // "ノート生成中…" state when the curator actually succeeded.
      if (ok && resp?.data?.outline) {
        fireAndForgetSend({
          type: 'SP_BROADCAST',
          payload: { type: 'outline_updated', outline: resp.data.outline },
        })
        broadcastToFrames({ source: 'sh-frame', type: 'OUTLINE_UPDATED', outline: resp.data.outline })
      } else if (!ok || resp?.data?.reason === 'no_transcripts_yet') {
        // Tell the modal to come out of the spinner state with a useful
        // message instead of hanging forever.
        const reason = resp?.data?.reason ?? resp?.data?.error ?? resp?.error ?? 'unknown'
        fireAndForgetSend({
          type: 'SP_BROADCAST',
          payload: { type: 'curate_failed', reason },
        })
        broadcastToFrames({ source: 'sh-frame', type: 'CURATE_FAILED', reason })
      }
    }).catch(e => {
      warn('curate request failed', e)
      const reason = e instanceof Error ? e.message : 'request_failed'
      fireAndForgetSend({
        type: 'SP_BROADCAST',
        payload: { type: 'curate_failed', reason },
      })
      broadcastToFrames({ source: 'sh-frame', type: 'CURATE_FAILED', reason })
    }).finally(() => { curateInFlight = false })
    })()
  }

  // Note generation is now EXPLICIT-ONLY:
  //   - User clicks "📝 ノートを再生成" in the modal → TRIGGER_CURATE
  //   - Session ends (natural <video> ended OR ✕ 終了) → triggerCurate('ended')
  // The previous pause-debounce trigger ("video paused for 3 s → curate")
  // was removed because users found it surprising — they'd press spacebar
  // to take a sip of water and a curator run would fire silently in the
  // background, costing a /v1/session/curate roundtrip and (on free tier)
  // burning the 30 s cooldown for the next deliberate manual click.
  //
  // Listen for manual trigger from the modal (postMessage).
  //
  // The AbortController is the listener-cleanup contract: passing
  // `signal` to addEventListener auto-removes it when abort() runs,
  // regardless of which teardown path runs first (onEndedHandler on
  // natural end, stopCaptureLocal on user-stop, or a future
  // SPA-navigation handler that just kills the controller).
  // The previous `removeEventListener(onManualTrigger)` form depended
  // on having the exact same closure reference at cleanup time —
  // robust during a single capture lifetime, but fragile if a
  // future refactor or SPA-renav path forgot to thread the closure
  // through. abort() is also idempotent so duplicate teardowns are
  // safe.
  const triggerAbort = new AbortController()
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { source?: string; type?: string; full?: boolean } | null
    if (!data || data.source !== 'sh-parent') return
    // sh-parent TRIGGER_CURATE comes from the modal iframe (extension
    // origin) when this is the top frame, OR is relayed from the top
    // frame via broadcastToFrames when this is a video child iframe.
    // Validate accordingly so an in-page-injected script can't fire a
    // /v1/session/curate roundtrip on its own.
    if (isTopFrame) {
      if (e.origin !== EXTENSION_ORIGIN) return
    } else {
      if (e.source !== window.top) return
    }
    if (data.type === 'TRIGGER_CURATE') {
      triggerCurate(data.full ? 'manual_full' : 'manual')
    }
  }, { signal: triggerAbort.signal })

  // Wrap-up handler — called from BOTH the natural-end path (<video>'s
  // 'ended' event) and the user-stop path (stopCaptureLocal). Idempotent
  // via session.stopped guard so calling it twice is a no-op.
  //
  // Always pauses the video first so the user explicitly sees the
  // session as wrapped up — important for the user-stop path because
  // the user's intent in clicking 停止 is "I'm done with this lecture".
  onEndedHandler = () => {
    if (session.stopped) return                  // idempotence
    try { activeVideo?.pause() } catch { /* ignore */ }
    session.stopped = true
    // Abort the session-scoped controller. This kills the abortable
    // retry sleep in the chunk handler and short-circuits any further
    // post-processing of in-flight chunks/slides at their next await
    // boundary. (The SW's /v1/stream/audio fetch itself proceeds to
    // completion — we ignore the response on the receiving side via
    // the session.stopped check.)
    try { sessionAbort.abort() } catch { /* ignore */ }
    detector?.stop()
    capture?.stop()
    activeVideo?.removeEventListener('play', earlyOnPlay)
    activeVideo?.removeEventListener('pause', earlyOnPause)
    triggerAbort.abort()
    if (session.canonicalAdopted) {
      // Last-chance flush of any chunks we couldn't deliver mid-session
      // (network blinked) BEFORE we trigger curate. Otherwise the
      // outline is generated from a transcript that's missing the last
      // few minutes of the lecture. Best-effort: if the network is
      // still down, the chunks stay enqueued and eventually fall off
      // when the tab closes. We do NOT await — curate doesn't need to
      // wait for backlog to land (the backend re-reads transcripts at
      // curate time, so a late drain that arrives during a curate
      // would just need another curate triggered manually). Logging
      // makes the failure mode visible.
      if (pendingChunks.length > 0) {
        log('session ending with pending chunks; attempting final drain', { remaining: pendingChunks.length })
        void drainPending()
      }
      // Final curate produces the wrap-up outline from everything we
      // captured. Same trigger for both natural-end and user-stop —
      // the user's intent in either case is "give me the notes now".
      triggerCurate('ended')
      // Broadcast a session_ended event to the modal so the auto-
      // download path (if user opted in via Options) can fire its
      // zip export as soon as the final outline arrives. Both the
      // SP_BROADCAST channel (side-panel mode) and the in-page
      // postMessage channel (embed mode) are used.
      fireAndForgetSend({
        type: 'SP_BROADCAST',
        payload: { type: 'session_ended', sessionId: session.id },
      })
      broadcastToFrames({ source: 'sh-frame', type: 'SESSION_ENDED', sessionId: session.id })
    }
    setButtonStatus('idle')
  }
  activeVideo.addEventListener('ended', onEndedHandler)
}

function detectMaxSpeed(_v: HTMLVideoElement): number | null {
  return 2
}

// Fast browser-safe base64 of an ArrayBuffer. The naive
// `btoa(String.fromCharCode(...bytes))` form rebuilds the string one
// character at a time, which on 320 KB+ slide / WAV blobs spends most
// of its time in V8 string concatenation rather than the actual b64
// encode. Chunking into 32 KB windows and joining via
// String.fromCharCode.apply is ~10× faster on large buffers and matches
// the helper already used by side-panel/lib/export.ts.
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(binary)
}

export {}  // module marker

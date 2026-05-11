// Floating in-page modal for the session view.
//
// An iframe pinned to the top-right of the page (NOT a separate Chrome window
// — the previous chrome.windows.create approach rendered fullscreen on macOS,
// which was wrong). The modal floats over the page so the user can keep
// watching the video underneath.
//
// The iframe sources `src/side-panel/index.html?embed=1&parentUrl=<url>`. The
// React app inside detects `?embed=1` and renders the session view. If the
// user is not yet authed, it renders LoginScreen — auth happens INSIDE the
// modal, so the user doesn't bounce out to the side panel.
//
// The modal communicates back via window.postMessage. Closing posts
// { type: 'SH_CLOSE_MODAL' } which the content script handles by unmounting.
//
// The modal is wrapped in a positioned container that supports drag (via a
// top handle) and resize (via a SE corner handle). Position + size are
// persisted to localStorage so the user's layout sticks across reloads.

const CONTAINER_ID = '__sh_modal_container__'
const IFRAME_ID = '__sh_modal_iframe__'
const STYLE_ID = '__sh_modal_style__'

// Origin of the modal iframe (chrome-extension://<id>). We validate
// incoming postMessages against this so a malicious script on the host
// page can't spoof a SH_CLOSE_MODAL / SH_SET_SPEED to trip the modal.
const EXTENSION_ORIGIN = chrome.runtime.getURL('').replace(/\/$/, '')

const RECT_KEY = 'sh.modalRect'
const MIN_W = 280
const MIN_H = 320
const MARGIN = 20

// Default modal size — adaptive to the viewport so the modal feels
// proportional on a 1280×800 laptop AND on a 4K desktop. Previously a
// fixed 400×600 looked tiny on big monitors and crowded on small ones.
// Capped at sensible upper bounds so the modal never dominates the
// page (a too-large modal hides the video the user is trying to study).
function computeDefaultSize(): { w: number; h: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.max(MIN_W, Math.min(Math.round(vw * 0.32), 480))
  const h = Math.max(MIN_H, Math.min(Math.round(vh * 0.85), 760))
  return { w, h }
}

interface SavedRect {
  top: number
  left: number
  width: number
  height: number
}

let messageListener: ((e: MessageEvent) => void) | null = null

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo
  return Math.min(Math.max(n, lo), hi)
}

function readSavedRect(): SavedRect | null {
  try {
    const raw = localStorage.getItem(RECT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed.top === 'number' &&
      typeof parsed.left === 'number' &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number'
    ) {
      return parsed as SavedRect
    }
    return null
  } catch {
    return null
  }
}

function saveRect(rect: SavedRect): void {
  try {
    localStorage.setItem(RECT_KEY, JSON.stringify(rect))
  } catch {
    /* localStorage may be disabled on some sites */
  }
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
#${CONTAINER_ID} {
  position: fixed;
  z-index: 999998;
  border-radius: 12px;
  overflow: hidden;
  background: white;
  box-shadow: 0 20px 60px rgba(0,0,0,0.28), 0 4px 12px rgba(0,0,0,0.14);
  display: flex;
  flex-direction: column;
  color-scheme: light;
  opacity: 0;
  transform: translateX(20px);
  transition: transform 240ms cubic-bezier(0.16, 1, 0.3, 1),
              opacity 240ms cubic-bezier(0.16, 1, 0.3, 1);
}
#${CONTAINER_ID}.__sh_visible__ {
  opacity: 1;
  transform: translateX(0);
}
/* Drag-handle title bar. 24 px tall (was 10 px) so users have a
 * comfortable target to grab — the previous strip was so thin most
 * users didn't notice it was draggable. The touch-action:none rule
 * blocks the browser's default touch behaviors (scroll, pinch-zoom)
 * while the drag is active. */
#${CONTAINER_ID} .__sh_drag_handle__ {
  flex: 0 0 24px;
  height: 24px;
  background: linear-gradient(to bottom, rgba(15,23,42,0.04), transparent);
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  touch-action: none;
}
#${CONTAINER_ID} .__sh_drag_handle__.__sh_grabbing__ {
  cursor: grabbing;
}
#${CONTAINER_ID} .__sh_drag_grip__ {
  width: 32px;
  height: 4px;
  background: rgba(15,23,42,0.18);
  border-radius: 9999px;
  transition: background 140ms ease;
}
#${CONTAINER_ID} .__sh_drag_handle__:hover .__sh_drag_grip__ {
  background: rgba(15,23,42,0.32);
}
#${IFRAME_ID} {
  flex: 1;
  width: 100%;
  border: 0;
  display: block;
  background: white;
}
/* 8-direction resize handles. Edges (N/S/E/W) get an 8 px strip
 * extending 4 px outside the modal border so the user can grab the
 * very edge of the modal naturally. Corners (NE/NW/SE/SW) get a
 * 14×14 hit target. The SE corner additionally renders a subtle
 * visible grip via ::after — the only handle that has a visual,
 * because that is the conventional "this is resizable" affordance
 * users scan for. Other handles are pointer-targets only; cursor
 * change is enough feedback when hovering. touch-action:none on
 * each handle prevents native gesture interference during drag. */
#${CONTAINER_ID} .__sh_resize_handle__ {
  position: absolute;
  z-index: 1;
  touch-action: none;
}
#${CONTAINER_ID} .__sh_resize_n__  { top: -4px;   left: 14px;  right: 14px;  height: 8px;  cursor: ns-resize; }
#${CONTAINER_ID} .__sh_resize_s__  { bottom: -4px;left: 14px;  right: 14px;  height: 8px;  cursor: ns-resize; }
#${CONTAINER_ID} .__sh_resize_e__  { top: 14px;   right: -4px; bottom: 14px; width: 8px;   cursor: ew-resize; }
#${CONTAINER_ID} .__sh_resize_w__  { top: 14px;   left: -4px;  bottom: 14px; width: 8px;   cursor: ew-resize; }
#${CONTAINER_ID} .__sh_resize_ne__ { top: -4px;   right: -4px; width: 14px;  height: 14px; cursor: nesw-resize; }
#${CONTAINER_ID} .__sh_resize_nw__ { top: -4px;   left: -4px;  width: 14px;  height: 14px; cursor: nwse-resize; }
#${CONTAINER_ID} .__sh_resize_se__ { bottom: -4px;right: -4px; width: 14px;  height: 14px; cursor: nwse-resize; }
#${CONTAINER_ID} .__sh_resize_sw__ { bottom: -4px;left: -4px;  width: 14px;  height: 14px; cursor: nesw-resize; }
/* SE corner has a visible double-diagonal grip — the conventional
 * "resizable" affordance. Other corners stay invisible (cursor
 * change is the feedback). */
#${CONTAINER_ID} .__sh_resize_se__::after {
  content: '';
  position: absolute;
  inset: 2px;
  background:
    linear-gradient(135deg, transparent 0 50%, #E8E4DC 50% 58%, transparent 58% 72%, #E8E4DC 72% 80%, transparent 80%);
  border-radius: 0 0 12px 0;
  pointer-events: none;
  transition: background 140ms ease;
}
#${CONTAINER_ID} .__sh_resize_se__:hover::after {
  background:
    linear-gradient(135deg, transparent 0 45%, #C2410C 45% 54%, transparent 54% 68%, #C2410C 68% 77%, transparent 77%);
}
`
  document.documentElement.appendChild(style)
}

// One of 8 resize directions OR the drag gesture itself. The string
// form lets onPointerMove use `.includes('e')` / `.includes('n')`
// short-hands to decide which edges to mutate.
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const RESIZE_DIRS: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

interface InteractionState {
  kind: 'drag' | ResizeDir
  pointerId: number
  startX: number
  startY: number
  startTop: number
  startLeft: number
  startW: number
  startH: number
}

export interface MountModalOptions {
  onClose: () => void
  onSetSpeed?: (speed: number) => void
  // The URL the audio/slide chunks were uploaded with. The modal uses
  // it as the ?url= key on /v1/session lookups (live outline pull,
  // markdown export). MUST match the URL used by the capture frame —
  // on K-LMS / Vimeo / Canvas Studio the capture lives in a child
  // iframe so its location.href differs from the top frame's. If the
  // top frame mounts the modal with its own URL the export 404s
  // because no session exists at that url_hash. Defaults to
  // `location.href` for the same-frame (YouTube etc.) case.
  parentUrl?: string
}

interface ModalContainerExtras {
  _onClose?: () => void
  _onSetSpeed?: (speed: number) => void
  _cleanup?: () => void
}

export function mountModal(opts: MountModalOptions): void {
  const existing = document.getElementById(CONTAINER_ID) as HTMLDivElement | null
  if (existing) {
    existing.classList.add('__sh_visible__')
    // Update closures if mountModal is called again.
    const extras = existing as unknown as ModalContainerExtras
    extras._onClose = opts.onClose
    extras._onSetSpeed = opts.onSetSpeed
    return
  }

  ensureStyle()

  // Compute initial geometry.
  const saved = readSavedRect()
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight

  const defaults = computeDefaultSize()
  const width = clamp(saved?.width ?? defaults.w, MIN_W, Math.max(MIN_W, viewportW))
  const height = clamp(saved?.height ?? defaults.h, MIN_H, Math.max(MIN_H, viewportH))
  const defaultLeft = Math.max(MARGIN, viewportW - width - MARGIN)
  const defaultTop = MARGIN
  const top = clamp(saved?.top ?? defaultTop, 0, Math.max(0, viewportH - height))
  const left = clamp(saved?.left ?? defaultLeft, 0, Math.max(0, viewportW - width))

  const container = document.createElement('div')
  container.id = CONTAINER_ID
  container.style.top = `${top}px`
  container.style.left = `${left}px`
  container.style.width = `${width}px`
  container.style.height = `${height}px`

  const dragHandle = document.createElement('div')
  dragHandle.className = '__sh_drag_handle__'
  const grip = document.createElement('div')
  grip.className = '__sh_drag_grip__'
  dragHandle.appendChild(grip)

  const iframe = document.createElement('iframe')
  iframe.id = IFRAME_ID
  const captureUrl = opts.parentUrl ?? location.href
  const url = chrome.runtime.getURL('src/side-panel/index.html')
    + `?embed=1&parentUrl=${encodeURIComponent(captureUrl)}`
  iframe.src = url

  container.appendChild(dragHandle)
  container.appendChild(iframe)
  // 8 resize handles — N/S/E/W edges + 4 corners. Each one has its
  // own pointer-down listener that records its direction so the
  // shared onPointerMove can mutate the right edges.
  const resizeHandles: HTMLDivElement[] = RESIZE_DIRS.map((dir) => {
    const h = document.createElement('div')
    h.className = `__sh_resize_handle__ __sh_resize_${dir}__`
    h.dataset.dir = dir
    container.appendChild(h)
    return h
  })
  document.body.appendChild(container)

  requestAnimationFrame(() => {
    container.classList.add('__sh_visible__')
  })

  // Store callbacks so other handlers can invoke them.
  ;(container as unknown as ModalContainerExtras)._onClose = opts.onClose
  ;(container as unknown as ModalContainerExtras)._onSetSpeed = opts.onSetSpeed

  // --- Drag + resize wiring (Pointer Events) ----------------------------
  // PointerEvents over MouseEvents:
  //  - Touch + pen support for free (single API).
  //  - setPointerCapture keeps the gesture alive when the pointer
  //    leaves the modal / window — dragging out the browser is no
  //    longer a "stuck state" bug.
  //  - Listeners attach on pointerdown and detach on pointerup, so
  //    the host page pays zero pointermove cost while idle.
  let active: InteractionState | null = null

  const beginInteraction = (): void => {
    // Re-route pointer events to the host modal handles so the
    // iframe's React tree doesn't compete during the gesture.
    iframe.style.pointerEvents = 'none'
  }
  const endInteraction = (): void => {
    iframe.style.pointerEvents = ''
    dragHandle.classList.remove('__sh_grabbing__')
  }

  const captureGestureStart = (kind: InteractionState['kind'], e: PointerEvent): void => {
    active = {
      kind,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTop: container.offsetTop,
      startLeft: container.offsetLeft,
      startW: container.offsetWidth,
      startH: container.offsetHeight,
    }
    const target = e.currentTarget as Element
    try { target.setPointerCapture(e.pointerId) } catch { /* old browser */ }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    beginInteraction()
  }

  const onDragPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return // primary mouse / single-finger only
    dragHandle.classList.add('__sh_grabbing__')
    captureGestureStart('drag', e)
    e.preventDefault()
  }

  const onResizePointerDown = (dir: ResizeDir) => (e: PointerEvent): void => {
    if (e.button !== 0) return
    captureGestureStart(dir, e)
    e.preventDefault()
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (!active) return
    const dx = e.clientX - active.startX
    const dy = e.clientY - active.startY

    if (active.kind === 'drag') {
      const maxLeft = Math.max(0, window.innerWidth - active.startW)
      const maxTop = Math.max(0, window.innerHeight - active.startH)
      container.style.left = `${clamp(active.startLeft + dx, 0, maxLeft)}px`
      container.style.top = `${clamp(active.startTop + dy, 0, maxTop)}px`
      return
    }

    // Resize: each direction string tells us which edges to move.
    // `n`/`w` pull the top/left edge AND shrink that dimension;
    // `s`/`e` simply grow the bottom/right edge.
    const dir = active.kind
    let newTop = active.startTop
    let newLeft = active.startLeft
    let newW = active.startW
    let newH = active.startH

    if (dir.includes('e')) newW = active.startW + dx
    if (dir.includes('w')) { newW = active.startW - dx; newLeft = active.startLeft + dx }
    if (dir.includes('s')) newH = active.startH + dy
    if (dir.includes('n')) { newH = active.startH - dy; newTop = active.startTop + dy }

    // Clamp to min size — for w/n-anchored resize, hold the right /
    // bottom edge fixed so the modal doesn't shift sideways at minW/H.
    if (newW < MIN_W) {
      if (dir.includes('w')) newLeft = active.startLeft + active.startW - MIN_W
      newW = MIN_W
    }
    if (newH < MIN_H) {
      if (dir.includes('n')) newTop = active.startTop + active.startH - MIN_H
      newH = MIN_H
    }

    // Clamp to viewport — keep the modal entirely visible.
    if (newLeft < 0) { newW += newLeft; newLeft = 0 }
    if (newTop < 0) { newH += newTop; newTop = 0 }
    if (newLeft + newW > window.innerWidth) newW = window.innerWidth - newLeft
    if (newTop + newH > window.innerHeight) newH = window.innerHeight - newTop
    // Re-enforce min after viewport clamp (rare edge: very small viewport).
    newW = Math.max(MIN_W, newW)
    newH = Math.max(MIN_H, newH)

    container.style.top = `${newTop}px`
    container.style.left = `${newLeft}px`
    container.style.width = `${newW}px`
    container.style.height = `${newH}px`
  }

  const onPointerUp = (): void => {
    if (!active) return
    saveRect({
      top: container.offsetTop,
      left: container.offsetLeft,
      width: container.offsetWidth,
      height: container.offsetHeight,
    })
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    active = null
    endInteraction()
  }

  // Re-clamp on viewport resize so the modal never ends up off-screen.
  const onWindowResize = (): void => {
    const cw = container.offsetWidth
    const ch = container.offsetHeight
    const maxLeft = Math.max(0, window.innerWidth - cw)
    const maxTop = Math.max(0, window.innerHeight - ch)
    const curLeft = container.offsetLeft
    const curTop = container.offsetTop
    const newLeft = clamp(curLeft, 0, maxLeft)
    const newTop = clamp(curTop, 0, maxTop)
    if (newLeft !== curLeft) container.style.left = `${newLeft}px`
    if (newTop !== curTop) container.style.top = `${newTop}px`
    // Shrink dimensions if viewport became smaller than the modal.
    const maxW = Math.max(MIN_W, window.innerWidth)
    const maxH = Math.max(MIN_H, window.innerHeight)
    if (cw > maxW) container.style.width = `${maxW}px`
    if (ch > maxH) container.style.height = `${maxH}px`
  }

  dragHandle.addEventListener('pointerdown', onDragPointerDown)
  // Resize handlers — store closures so cleanup can detach them.
  const resizeHandlers: Array<{ el: HTMLElement; handler: (e: PointerEvent) => void }> = resizeHandles.map((el, i) => {
    const handler = onResizePointerDown(RESIZE_DIRS[i])
    el.addEventListener('pointerdown', handler)
    return { el, handler }
  })
  window.addEventListener('resize', onWindowResize)

  ;(container as unknown as ModalContainerExtras)._cleanup = () => {
    dragHandle.removeEventListener('pointerdown', onDragPointerDown)
    resizeHandlers.forEach(({ el, handler }) => el.removeEventListener('pointerdown', handler))
    // pointermove/up/cancel are removed in onPointerUp under normal flow.
    // Remove idempotently here in case cleanup runs mid-gesture.
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    window.removeEventListener('resize', onWindowResize)
  }

  if (!messageListener) {
    messageListener = handleMessage
    window.addEventListener('message', messageListener)
  }
}

export function unmountModal(): void {
  const container = document.getElementById(CONTAINER_ID) as HTMLDivElement | null
  if (!container) return
  const extras = container as unknown as ModalContainerExtras
  const cleanup = extras._cleanup
  const onClose = extras._onClose
  cleanup?.()
  container.classList.remove('__sh_visible__')
  window.setTimeout(() => {
    container.remove()
    onClose?.()
  }, 260)
}

function handleMessage(e: MessageEvent): void {
  const data = e.data
  if (!data || typeof data !== 'object') return
  // SH_CLOSE_MODAL / SH_SET_SPEED are sent by the modal iframe (App.tsx
  // running at the extension origin). Reject anything else so a script
  // on the host page can't dismiss the modal or change playback speed.
  if (e.origin !== EXTENSION_ORIGIN) {
    if (data.type === 'SH_CLOSE_MODAL' || data.type === 'SH_SET_SPEED') {
      // eslint-disable-next-line no-console
      console.warn('[SH:modal-host] rejecting SH_* from non-extension origin', { origin: e.origin, type: data.type })
    }
    return
  }
  if (data.type === 'SH_CLOSE_MODAL') {
    unmountModal()
    return
  }
  if (data.type === 'SH_SET_SPEED' && typeof data.speed === 'number') {
    const container = document.getElementById(CONTAINER_ID) as HTMLDivElement | null
    if (!container) return
    const extras = container as unknown as ModalContainerExtras
    extras._onSetSpeed?.(data.speed)
  }
}

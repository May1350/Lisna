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

const RECT_KEY = 'sh.modalRect'
const MIN_W = 280
const MIN_H = 320
const DEFAULT_W = 400
const DEFAULT_H = 600
const MARGIN = 20

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
#${CONTAINER_ID} .__sh_drag_handle__ {
  flex: 0 0 10px;
  height: 10px;
  background: linear-gradient(to bottom, rgba(15,23,42,0.04), transparent);
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}
#${CONTAINER_ID} .__sh_drag_handle__.__sh_grabbing__ {
  cursor: grabbing;
}
#${CONTAINER_ID} .__sh_drag_grip__ {
  width: 24px;
  height: 3px;
  background: rgba(15,23,42,0.15);
  border-radius: 9999px;
}
#${IFRAME_ID} {
  flex: 1;
  width: 100%;
  border: 0;
  display: block;
  background: white;
}
#${CONTAINER_ID} .__sh_resize_handle__ {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  background: transparent;
  z-index: 1;
}
`
  document.documentElement.appendChild(style)
}

interface DragState {
  startX: number
  startY: number
  startTop: number
  startLeft: number
}

interface ResizeState {
  startX: number
  startY: number
  startW: number
  startH: number
}

export interface MountModalOptions {
  onClose: () => void
}

export function mountModal(opts: MountModalOptions): void {
  const existing = document.getElementById(CONTAINER_ID) as HTMLDivElement | null
  if (existing) {
    existing.classList.add('__sh_visible__')
    // Update the onClose closure if mountModal is called again.
    ;(existing as unknown as { _onClose?: () => void })._onClose = opts.onClose
    return
  }

  ensureStyle()

  // Compute initial geometry.
  const saved = readSavedRect()
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight

  const width = clamp(saved?.width ?? DEFAULT_W, MIN_W, Math.max(MIN_W, viewportW))
  const height = clamp(saved?.height ?? DEFAULT_H, MIN_H, Math.max(MIN_H, viewportH))
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
  const url = chrome.runtime.getURL('src/side-panel/index.html')
    + `?embed=1&parentUrl=${encodeURIComponent(location.href)}`
  iframe.src = url

  const resizeHandle = document.createElement('div')
  resizeHandle.className = '__sh_resize_handle__'

  container.appendChild(dragHandle)
  container.appendChild(iframe)
  container.appendChild(resizeHandle)
  document.body.appendChild(container)

  requestAnimationFrame(() => {
    container.classList.add('__sh_visible__')
  })

  // Store onClose so unmountModal can invoke it.
  ;(container as unknown as { _onClose?: () => void })._onClose = opts.onClose

  // --- Drag + resize wiring ----------------------------------------------
  let dragState: DragState | null = null
  let resizeState: ResizeState | null = null

  const beginInteraction = (): void => {
    iframe.style.pointerEvents = 'none'
  }
  const endInteraction = (): void => {
    iframe.style.pointerEvents = ''
    dragHandle.classList.remove('__sh_grabbing__')
  }

  const onDragMouseDown = (e: MouseEvent): void => {
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      startTop: container.offsetTop,
      startLeft: container.offsetLeft,
    }
    dragHandle.classList.add('__sh_grabbing__')
    beginInteraction()
    e.preventDefault()
  }

  const onResizeMouseDown = (e: MouseEvent): void => {
    resizeState = {
      startX: e.clientX,
      startY: e.clientY,
      startW: container.offsetWidth,
      startH: container.offsetHeight,
    }
    beginInteraction()
    e.preventDefault()
    e.stopPropagation()
  }

  const onMouseMove = (e: MouseEvent): void => {
    if (dragState) {
      const dx = e.clientX - dragState.startX
      const dy = e.clientY - dragState.startY
      const maxLeft = Math.max(0, window.innerWidth - container.offsetWidth)
      const maxTop = Math.max(0, window.innerHeight - container.offsetHeight)
      const newLeft = clamp(dragState.startLeft + dx, 0, maxLeft)
      const newTop = clamp(dragState.startTop + dy, 0, maxTop)
      container.style.left = `${newLeft}px`
      container.style.top = `${newTop}px`
    } else if (resizeState) {
      const dx = e.clientX - resizeState.startX
      const dy = e.clientY - resizeState.startY
      const maxW = Math.max(MIN_W, window.innerWidth - container.offsetLeft)
      const maxH = Math.max(MIN_H, window.innerHeight - container.offsetTop)
      const newW = clamp(resizeState.startW + dx, MIN_W, maxW)
      const newH = clamp(resizeState.startH + dy, MIN_H, maxH)
      container.style.width = `${newW}px`
      container.style.height = `${newH}px`
    }
  }

  const onMouseUp = (): void => {
    if (dragState || resizeState) {
      saveRect({
        top: container.offsetTop,
        left: container.offsetLeft,
        width: container.offsetWidth,
        height: container.offsetHeight,
      })
    }
    dragState = null
    resizeState = null
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
    // Also shrink dimensions if viewport became smaller than the modal.
    const maxW = Math.max(MIN_W, window.innerWidth)
    const maxH = Math.max(MIN_H, window.innerHeight)
    if (cw > maxW) container.style.width = `${maxW}px`
    if (ch > maxH) container.style.height = `${maxH}px`
  }

  dragHandle.addEventListener('mousedown', onDragMouseDown)
  resizeHandle.addEventListener('mousedown', onResizeMouseDown)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('resize', onWindowResize)

  ;(container as unknown as { _cleanup?: () => void })._cleanup = () => {
    dragHandle.removeEventListener('mousedown', onDragMouseDown)
    resizeHandle.removeEventListener('mousedown', onResizeMouseDown)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
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
  const cleanup = (container as unknown as { _cleanup?: () => void })._cleanup
  const onClose = (container as unknown as { _onClose?: () => void })._onClose
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
  if (data.type === 'SH_CLOSE_MODAL') {
    unmountModal()
  }
}

// Inline button anchored to the top-right of the video element.
// - 'idle': round 36x36 button with sparkle SVG icon. No hover-expand.
// - 'processing': two icon-only round buttons:
//     - main button: red pulsing dot (click = re-open modal)
//     - sibling stop button: ⏹ icon (click = stop session)
// - 'hidden': hidden via display:none.

const STYLE_ID = '__sh_inline_button_style__'
const ROOT_ID = '__sh_inline_button_root__'
const STOP_ID = '__sh_inline_button_stop__'

const SPARKLE_SVG = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3z"/>
  <path d="M19 14l0.7 2.1L22 17l-2.3 0.7L19 20l-0.7-2.3L16 17l2.3-0.7L19 14z"/>
</svg>
`.trim()

const STOP_SVG = `
<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
  <rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor"/>
</svg>
`.trim()

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.__sh_btn__ {
  position: absolute;
  z-index: 999999;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 9999px;
  background: rgba(15, 23, 42, 0.92);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  color: #ffffff;
  box-shadow: 0 8px 32px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.12);
  cursor: pointer;
  user-select: none;
  box-sizing: border-box;
  transition: transform 200ms cubic-bezier(0.16,1,0.3,1), background-color 200ms cubic-bezier(0.16,1,0.3,1);
}
.__sh_btn__:hover {
  background: rgba(15, 23, 42, 1);
  transform: translateY(-1px);
}
.__sh_btn__ svg { display: block; }
.__sh_status_pulse__ {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 9999px;
  background: #ef4444;
  animation: __sh_pulse__ 1.4s ease-in-out infinite;
  box-shadow: 0 0 0 0 rgba(239,68,68,0.6);
}
@keyframes __sh_pulse__ {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239,68,68,0.6); }
  50% { transform: scale(1.15); box-shadow: 0 0 0 6px rgba(239,68,68,0); }
}
`
  document.documentElement.appendChild(style)
}

export type InlineButtonState = 'idle' | 'processing' | 'hidden'

export interface InlineButtonHandle {
  setStatus(state: InlineButtonState): void
  unmount(): void
}

const POSITION_THROTTLE_MS = 250
const GAP = 8

export function mountInlineButton(
  video: HTMLVideoElement,
  onActivate: () => void,
  onStop: () => void,
): InlineButtonHandle | null {
  // Note: no top-frame guard. The inline button mounts in WHATEVER frame
  // contains the <video> element. For platforms like K-LMS / Canvas Studio /
  // Vimeo embeds, the video lives in a cross-origin iframe; the button must
  // appear there. The viewport-local position math below works inside an
  // iframe (positions are relative to the iframe's own viewport, which is
  // exactly what we want — the button visually overlays the video element
  // wherever that iframe is rendered in the parent page).
  ensureStyle()

  // Remove any prior instance.
  document.getElementById(ROOT_ID)?.remove()
  document.getElementById(STOP_ID)?.remove()

  const btn = document.createElement('button')
  btn.id = ROOT_ID
  btn.className = '__sh_btn__'
  btn.type = 'button'
  btn.title = 'この動画を要約'
  btn.setAttribute('aria-label', 'この動画を要約')
  btn.innerHTML = SPARKLE_SVG
  document.body.appendChild(btn)

  let state: InlineButtonState = 'idle'
  let stopBtn: HTMLButtonElement | null = null

  const handleClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Both 'idle' (start session) and 'processing' (re-open modal for in-flight session)
    // map to the same activation flow.
    if (state === 'idle' || state === 'processing') onActivate()
  }
  btn.addEventListener('click', handleClick)

  let scheduled = false
  const updatePosition = (): void => {
    if (state === 'hidden') return
    const rect = video.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      btn.style.display = 'none'
      if (stopBtn) stopBtn.style.display = 'none'
      return
    }
    btn.style.display = ''
    const inset = 8
    const w = btn.offsetWidth || 36
    const h = btn.offsetHeight || 36
    // Clamp the visible right edge to BOTH the video bounding box AND the
    // viewport.
    const rightEdge = Math.min(rect.right, window.innerWidth)
    const mainLeft = window.scrollX + Math.max(0, rightEdge - inset - w)
    const mainTop = window.scrollY + Math.max(0, rect.top) + inset
    btn.style.top = `${mainTop}px`
    btn.style.left = `${mainLeft}px`

    if (stopBtn) {
      stopBtn.style.display = ''
      const stopW = stopBtn.offsetWidth || 36
      // Place 8px to the LEFT of the main button.
      const desiredStopLeft = mainLeft - GAP - stopW
      if (desiredStopLeft >= 0) {
        stopBtn.style.top = `${mainTop}px`
        stopBtn.style.left = `${desiredStopLeft}px`
      } else {
        // No room on the left — stack BELOW the main button instead.
        stopBtn.style.top = `${mainTop + h + GAP}px`
        stopBtn.style.left = `${mainLeft}px`
      }
    }
  }

  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    window.setTimeout(() => {
      scheduled = false
      updatePosition()
    }, POSITION_THROTTLE_MS)
  }

  // Initial position (synchronous + a follow-up after layout settles).
  updatePosition()
  window.setTimeout(updatePosition, 50)

  const onScroll = () => schedule()
  const onResize = () => schedule()
  window.addEventListener('scroll', onScroll, { passive: true, capture: true })
  window.addEventListener('resize', onResize, { passive: true })

  let resizeObs: ResizeObserver | null = null
  if (typeof ResizeObserver !== 'undefined') {
    resizeObs = new ResizeObserver(() => schedule())
    resizeObs.observe(video)
  }

  const removeStopBtn = () => {
    if (stopBtn) {
      stopBtn.remove()
      stopBtn = null
    }
  }

  const ensureStopBtn = () => {
    if (stopBtn) return
    const s = document.createElement('button')
    s.id = STOP_ID
    s.className = '__sh_btn__'
    s.type = 'button'
    s.title = '停止'
    s.setAttribute('aria-label', '停止')
    s.innerHTML = STOP_SVG
    s.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      onStop()
    })
    document.body.appendChild(s)
    stopBtn = s
  }

  const setStatus: InlineButtonHandle['setStatus'] = (s) => {
    state = s
    if (s === 'hidden') {
      btn.style.display = 'none'
      if (stopBtn) stopBtn.style.display = 'none'
      return
    }
    btn.style.display = ''
    if (s === 'processing') {
      // Replace inner content with a red pulsing dot.
      btn.innerHTML = ''
      const pulse = document.createElement('span')
      pulse.className = '__sh_status_pulse__'
      btn.appendChild(pulse)
      btn.title = '処理中 — クリックでモーダルを再表示'
      btn.setAttribute('aria-label', '処理中 — クリックでモーダルを再表示')
      ensureStopBtn()
    } else {
      // idle: restore sparkle SVG and remove the stop sibling.
      btn.innerHTML = SPARKLE_SVG
      btn.title = 'この動画を要約'
      btn.setAttribute('aria-label', 'この動画を要約')
      removeStopBtn()
    }
    window.setTimeout(updatePosition, 0)
  }

  const unmount = () => {
    state = 'hidden'
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onResize)
    resizeObs?.disconnect()
    btn.removeEventListener('click', handleClick)
    btn.remove()
    removeStopBtn()
  }

  return { setStatus, unmount }
}

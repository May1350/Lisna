// Inline button anchored to the top-right of the video element.
// - 'idle': round 36x36 with sparkle SVG icon; expands to a pill on hover.
// - 'processing': non-interactive pill with red pulsing dot.
// - 'hidden': removed from DOM.

const STYLE_ID = '__sh_inline_button_style__'
const ROOT_ID = '__sh_inline_button_root__'

const SPARKLE_SVG = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3z"/>
  <path d="M19 14l0.7 2.1L22 17l-2.3 0.7L19 20l-0.7-2.3L16 17l2.3-0.7L19 14z"/>
</svg>
`.trim()

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
@keyframes __sh_pulse__ {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.__sh_btn__ {
  position: absolute;
  z-index: 999999;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  width: 36px;
  padding: 0;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 9999px;
  background: rgba(15, 23, 42, 0.92);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  color: #ffffff;
  font: 600 13px/1 system-ui, -apple-system, "Hiragino Sans", "Apple SD Gothic Neo", sans-serif;
  box-shadow: 0 8px 32px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.12);
  cursor: pointer;
  transition: width 200ms cubic-bezier(0.16, 1, 0.3, 1),
              padding 200ms cubic-bezier(0.16, 1, 0.3, 1),
              background-color 200ms cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
  white-space: nowrap;
  user-select: none;
  box-sizing: border-box;
}
.__sh_btn__:hover, .__sh_btn__.__sh_open__ {
  width: auto;
  padding: 0 14px 0 10px;
  background: rgba(15, 23, 42, 1);
}
.__sh_btn_icon__ {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  color: #ffffff;
}
.__sh_btn_icon__ svg {
  display: block;
}
.__sh_btn_label__ {
  opacity: 0;
  max-width: 0;
  transition: opacity 200ms cubic-bezier(0.16, 1, 0.3, 1),
              max-width 200ms cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}
.__sh_btn__:hover .__sh_btn_label__,
.__sh_btn__.__sh_open__ .__sh_btn_label__ {
  opacity: 1;
  max-width: 240px;
  pointer-events: auto;
}
.__sh_btn__.__sh_processing__ {
  width: auto;
  padding: 0 14px 0 10px;
  background: rgba(15, 23, 42, 1);
  cursor: default;
}
.__sh_btn__.__sh_processing__ .__sh_btn_label__ {
  opacity: 1;
  max-width: 240px;
}
.__sh_btn__.__sh_processing__ .__sh_btn_icon__ {
  display: none;
}
.__sh_dot__ {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: #ef4444;
  margin-left: 6px;
  animation: __sh_pulse__ 1.2s ease-in-out infinite;
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

export function mountInlineButton(
  video: HTMLVideoElement,
  onActivate: () => void,
): InlineButtonHandle | null {
  if (window.top !== window.self) return null
  ensureStyle()

  // Remove any prior instance.
  document.getElementById(ROOT_ID)?.remove()

  const btn = document.createElement('button')
  btn.id = ROOT_ID
  btn.className = '__sh_btn__'
  btn.type = 'button'
  btn.setAttribute('aria-label', 'この動画を要約')

  const icon = document.createElement('span')
  icon.className = '__sh_btn_icon__'
  icon.innerHTML = SPARKLE_SVG

  const label = document.createElement('span')
  label.className = '__sh_btn_label__'
  label.textContent = 'この動画を要約'

  btn.appendChild(icon)
  btn.appendChild(label)
  document.body.appendChild(btn)

  let state: InlineButtonState = 'idle'

  const handleClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (state !== 'idle') return
    onActivate()
  }
  btn.addEventListener('click', handleClick)

  let scheduled = false
  const updatePosition = (): void => {
    if (state === 'hidden') return
    const rect = video.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      btn.style.display = 'none'
      return
    }
    btn.style.display = ''
    const inset = 8
    const w = btn.offsetWidth || 36
    // Clamp the visible right edge to BOTH the video bounding box AND the
    // viewport. Some sites (e.g. YouTube on certain widths) render the player
    // wider than window.innerWidth — without clamping the button ends up
    // partially cut off at the right edge of the viewport.
    const rightEdge = Math.min(rect.right, window.innerWidth)
    const left = window.scrollX + Math.max(0, rightEdge - inset - w)
    const top = window.scrollY + Math.max(0, rect.top) + inset
    btn.style.top = `${top}px`
    btn.style.left = `${left}px`
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

  // Re-position on hover transitions (width changes).
  btn.addEventListener('mouseenter', () => window.setTimeout(updatePosition, 220))
  btn.addEventListener('mouseleave', () => window.setTimeout(updatePosition, 220))

  const setStatus: InlineButtonHandle['setStatus'] = (s) => {
    state = s
    if (s === 'hidden') {
      btn.style.display = 'none'
      return
    }
    btn.style.display = ''
    btn.classList.remove('__sh_processing__', '__sh_open__')
    if (s === 'processing') {
      btn.classList.add('__sh_processing__')
      label.textContent = '処理中…'
      // Add a pulsing dot if not already there.
      let dot = btn.querySelector('.__sh_dot__') as HTMLElement | null
      if (!dot) {
        dot = document.createElement('span')
        dot.className = '__sh_dot__'
        btn.appendChild(dot)
      }
      btn.disabled = true
      btn.style.cursor = 'default'
      btn.setAttribute('aria-label', '処理中')
    } else {
      // idle
      label.textContent = 'この動画を要約'
      const dot = btn.querySelector('.__sh_dot__')
      if (dot) dot.remove()
      btn.disabled = false
      btn.style.cursor = 'pointer'
      btn.setAttribute('aria-label', 'この動画を要約')
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
  }

  return { setStatus, unmount }
}

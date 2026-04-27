// Inline button anchored to the top-right of the video element.
// - 'idle': round 36x36 with sparkle SVG icon; expands to a pill on hover.
// - 'processing': non-interactive pill with red pulsing dot + ⏹ stop button.
// - 'hidden': removed from DOM.

const STYLE_ID = '__sh_inline_button_style__'
const ROOT_ID = '__sh_inline_button_root__'
const TOOLTIP_ID = '__sh_inline_button_tooltip__'

const SPARKLE_SVG = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3z"/>
  <path d="M19 14l0.7 2.1L22 17l-2.3 0.7L19 20l-0.7-2.3L16 17l2.3-0.7L19 14z"/>
</svg>
`.trim()

const STOP_SVG = `
<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
  <rect x="1" y="1" width="8" height="8" rx="1.5" fill="currentColor"/>
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
@keyframes __sh_tip_in__ {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes __sh_tip_out__ {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-4px); }
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
  padding: 0 8px 0 10px;
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
.__sh_stop__ {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-left: 8px;
  padding: 0;
  border: 0;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  cursor: pointer;
  transition: background-color 150ms ease;
}
.__sh_stop__:hover {
  background: rgba(239, 68, 68, 0.85);
}
.__sh_stop__:focus-visible {
  outline: 2px solid #fca5a5;
  outline-offset: 2px;
}
.__sh_tip__ {
  position: absolute;
  z-index: 999999;
  background: rgba(15, 23, 42, 0.96);
  color: #ffffff;
  font: 500 12px/1.3 system-ui, -apple-system, "Hiragino Sans", "Apple SD Gothic Neo", sans-serif;
  padding: 6px 10px;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.25);
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
  animation: __sh_tip_in__ 160ms ease forwards;
}
.__sh_tip__::before {
  content: '';
  position: absolute;
  top: -5px;
  left: 50%;
  transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 6px solid rgba(15, 23, 42, 0.96);
}
.__sh_tip__.__sh_tip_out__ {
  animation: __sh_tip_out__ 160ms ease forwards;
}
`
  document.documentElement.appendChild(style)
}

export type InlineButtonState = 'idle' | 'processing' | 'hidden'

export interface InlineButtonHandle {
  setStatus(state: InlineButtonState): void
  showTooltip(text: string, durationMs: number): void
  unmount(): void
}

const POSITION_THROTTLE_MS = 250

export function mountInlineButton(
  video: HTMLVideoElement,
  onActivate: () => void,
  onStop: () => void,
): InlineButtonHandle | null {
  if (window.top !== window.self) return null
  ensureStyle()

  // Remove any prior instance.
  document.getElementById(ROOT_ID)?.remove()
  document.getElementById(TOOLTIP_ID)?.remove()

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
  let tooltipTimer: number | null = null

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
    repositionTooltip()
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

  function repositionTooltip(): void {
    const tip = document.getElementById(TOOLTIP_ID) as HTMLElement | null
    if (!tip) return
    const btnRect = btn.getBoundingClientRect()
    const tipWidth = tip.offsetWidth || 0
    const left =
      window.scrollX + btnRect.left + btnRect.width / 2 - tipWidth / 2
    const top = window.scrollY + btnRect.bottom + 10
    tip.style.left = `${Math.max(8, left)}px`
    tip.style.top = `${top}px`
  }

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
      // Add a stop button to the right of the dot.
      let stop = btn.querySelector('.__sh_stop__') as HTMLButtonElement | null
      if (!stop) {
        stop = document.createElement('button')
        stop.type = 'button'
        stop.className = '__sh_stop__'
        stop.setAttribute('aria-label', '停止')
        stop.title = '停止'
        stop.innerHTML = STOP_SVG
        stop.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          onStop()
        })
        btn.appendChild(stop)
      }
      btn.disabled = false
      btn.style.cursor = 'default'
      btn.setAttribute('aria-label', '処理中')
    } else {
      // idle
      label.textContent = 'この動画を要約'
      btn.querySelector('.__sh_dot__')?.remove()
      btn.querySelector('.__sh_stop__')?.remove()
      btn.disabled = false
      btn.style.cursor = 'pointer'
      btn.setAttribute('aria-label', 'この動画を要約')
    }
    window.setTimeout(updatePosition, 0)
  }

  const showTooltip: InlineButtonHandle['showTooltip'] = (text, durationMs) => {
    // Replace any prior tooltip immediately.
    document.getElementById(TOOLTIP_ID)?.remove()
    if (tooltipTimer !== null) {
      window.clearTimeout(tooltipTimer)
      tooltipTimer = null
    }
    const tip = document.createElement('div')
    tip.id = TOOLTIP_ID
    tip.className = '__sh_tip__'
    tip.textContent = text
    document.body.appendChild(tip)
    repositionTooltip()
    tooltipTimer = window.setTimeout(() => {
      tip.classList.add('__sh_tip_out__')
      window.setTimeout(() => tip.remove(), 180)
      tooltipTimer = null
    }, durationMs)
  }

  const unmount = () => {
    state = 'hidden'
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onResize)
    resizeObs?.disconnect()
    btn.removeEventListener('click', handleClick)
    btn.remove()
    if (tooltipTimer !== null) {
      window.clearTimeout(tooltipTimer)
      tooltipTimer = null
    }
    document.getElementById(TOOLTIP_ID)?.remove()
  }

  return { setStatus, showTooltip, unmount }
}

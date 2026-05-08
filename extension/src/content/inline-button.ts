// Inline button anchored to the top-right of the video element.
// - 'idle': round 36x36 button with sparkle SVG icon. No hover-expand.
// - 'processing': two icon-only round buttons:
//     - main button: red pulsing dot (click = re-open modal)
//     - sibling stop button: ⏹ icon (click = stop session)
// - 'hidden': hidden via display:none.

import { hasSeenInlineButton, markInlineButtonSeen } from '../shared/storage'
import { t } from '../shared/i18n'

const STYLE_ID = '__sh_inline_button_style__'
const ROOT_ID = '__sh_inline_button_root__'
const STOP_ID = '__sh_inline_button_stop__'
const TOOLTIP_ID = '__sh_inline_button_tooltip__'

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

// Defensive HTML-escape for strings interpolated into innerHTML. The
// onboarding tooltip pulls its message from the locale table; even
// though the strings are statically known, escaping protects against
// future i18n entries that might contain &, <, > characters.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

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

/* First-time onboarding: until the user has clicked the button at
 * least once, the idle button glows in a pulsing blue halo and a
 * small label appears next to it pointing at the click target.
 * Both auto-clear after the user clicks OR after 30 s. The pulse is
 * tinted blue (vs the red processing pulse) so the two states are
 * never confused at a glance.
 */
.__sh_first_glow__ {
  animation: __sh_first_glow__ 1.6s ease-in-out infinite;
}
@keyframes __sh_first_glow__ {
  0%, 100% { box-shadow: 0 8px 32px rgba(0,0,0,0.28), 0 0 0 0 rgba(59,130,246,0.55); }
  50%      { box-shadow: 0 8px 32px rgba(0,0,0,0.28), 0 0 0 12px rgba(59,130,246,0); }
}
.__sh_onboarding_tooltip__ {
  position: absolute;
  z-index: 999999;
  background: #1e40af;
  color: white;
  font: 500 12px/1.4 -apple-system, "Hiragino Sans", "Apple SD Gothic Neo", sans-serif;
  padding: 6px 11px;
  border-radius: 8px;
  white-space: nowrap;
  box-shadow: 0 6px 24px rgba(30,64,175,0.4);
  pointer-events: none;
  animation: __sh_tooltip_in__ 280ms cubic-bezier(0.16,1,0.3,1) both;
}
.__sh_onboarding_tooltip__ .__sh_arrow__ {
  display: inline-block;
  margin-left: 4px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-weight: 400;
  color: rgba(255,255,255,0.92);
  animation: __sh_arrow_nudge__ 1.2s ease-in-out infinite;
}
@keyframes __sh_arrow_nudge__ {
  0%, 100% { transform: translateX(0); }
  50%      { transform: translateX(3px); }
}
.__sh_onboarding_tooltip__::after {
  content: '';
  position: absolute;
  top: 50%;
  right: -5px;
  transform: translateY(-50%);
  border: 5px solid transparent;
  border-left-color: #1e40af;
}
@keyframes __sh_tooltip_in__ {
  from { opacity: 0; transform: translateX(8px); }
  to   { opacity: 1; transform: translateX(0); }
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

// Module-level handle to the most recent mount, so `mountInlineButton`
// can fully tear down the previous instance — listeners + observers
// included — before installing a new one. The previous implementation
// only removed the DOM node via getElementById().remove(), which left
// `onScroll` / `onResize` / `ResizeObserver` callbacks bound to window
// holding closures referencing the now-detached <button>. Each page
// navigation that re-mounted the button leaked another set of zombie
// listeners that fired on every scroll forever.
let currentHandle: InlineButtonHandle | null = null

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

  // Tear down the prior instance if any, so we don't leak listeners.
  if (currentHandle) {
    try { currentHandle.unmount() } catch { /* best effort */ }
    currentHandle = null
  }
  // Defensive: also nuke any orphan DOM nodes left behind by an
  // unrelated extension instance / hot-reload that didn't go through
  // currentHandle.unmount().
  document.getElementById(ROOT_ID)?.remove()
  document.getElementById(STOP_ID)?.remove()

  // Look up locale strings ONCE at mount. The inline button is a
  // non-React content-script DOM tree; it doesn't subscribe to
  // language changes (a fresh page load picks up the new locale).
  // This is acceptable because inline-button text changes are not
  // part of any in-session UX flow — the user sees these labels
  // exactly once per video page mount.
  const T_init = t()
  const btn = document.createElement('button')
  btn.id = ROOT_ID
  btn.className = '__sh_btn__'
  btn.type = 'button'
  btn.title = T_init.inlineButton.activate
  btn.setAttribute('aria-label', T_init.inlineButton.activate)
  btn.innerHTML = SPARKLE_SVG
  document.body.appendChild(btn)

  let state: InlineButtonState = 'idle'
  let stopBtn: HTMLButtonElement | null = null
  let onboardingTooltip: HTMLDivElement | null = null
  let onboardingTimer: number | null = null

  const dismissOnboarding = (): void => {
    btn.classList.remove('__sh_first_glow__')
    if (onboardingTooltip) {
      onboardingTooltip.remove()
      onboardingTooltip = null
    }
    if (onboardingTimer !== null) {
      window.clearTimeout(onboardingTimer)
      onboardingTimer = null
    }
  }

  const handleClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Mark onboarding completed on first click + clear visuals.
    void markInlineButtonSeen()
    dismissOnboarding()
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
    // Position vertically. Preferred: just ABOVE the video frame (outside)
    // so the button never covers lecture content. Falls back to inside-top
    // when the video sits at the page top with no clearance above.
    //
    // The clamp `Math.max(0, rect.top)` that previously pinned the button
    // to viewport top during scroll is intentionally gone: the button now
    // scrolls naturally with the video and disappears when the video is
    // fully out of view, matching user expectation. A "follower" pinned
    // to the viewport felt like nag-UI on pages that weren't even
    // lectures.
    const aboveTop = rect.top - h - GAP
    const useAbove = aboveTop >= GAP    // need at least one GAP of clearance above
    const mainTop = useAbove
      ? window.scrollY + aboveTop
      : window.scrollY + rect.top + inset
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

    // Onboarding tooltip — anchored to the LEFT of the main button so
    // the speech-bubble arrow points at the button. Shows the
    // discoverability hint until the user has clicked once.
    if (onboardingTooltip) {
      const tooltipW = onboardingTooltip.offsetWidth || 180
      const tooltipH = onboardingTooltip.offsetHeight || 30
      const desiredLeft = mainLeft - GAP - tooltipW
      if (desiredLeft >= 0) {
        onboardingTooltip.style.left = `${desiredLeft}px`
        onboardingTooltip.style.top = `${mainTop + (h - tooltipH) / 2}px`
      } else {
        // No room left — place below the button.
        onboardingTooltip.style.left = `${Math.max(0, mainLeft)}px`
        onboardingTooltip.style.top = `${mainTop + h + GAP}px`
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

  // First-time onboarding affordance. Shown only once per install (the
  // `sh.inlineButtonSeen` flag in chrome.storage.local). The tooltip
  // and pulsing halo auto-dismiss after 30 s if the user ignores them
  // — silent for everyone after that, no permanent UI noise.
  void hasSeenInlineButton().then((seen) => {
    if (seen) return
    btn.classList.add('__sh_first_glow__')
    const tip = document.createElement('div')
    tip.id = TOOLTIP_ID
    tip.className = '__sh_onboarding_tooltip__'
    // Tooltip sits LEFT of the button with a speech-bubble arrow on its
    // right edge pointing AT the button. The text-end arrow ("→") also
    // points at the button so the visual cue is consistent end-to-end —
    // the previous "👈" pointed the opposite direction (left), which
    // contradicted the speech-bubble arrow and confused users about
    // which direction the actual button was.
    // Strip the trailing "→" the locale string already includes in some
    // languages (we render that as the styled span below).
    const onboardingMsg = T_init.inlineButton.onboarding.replace(/\s*→\s*$/, '').trim()
    tip.innerHTML = `${escapeHtml(onboardingMsg)} <span class="__sh_arrow__">→</span>`
    document.body.appendChild(tip)
    onboardingTooltip = tip
    updatePosition()
    onboardingTimer = window.setTimeout(() => {
      // 30 s passed without a click — drop the visuals but DO NOT
      // mark seen yet, so the next page load gives them another shot.
      btn.classList.remove('__sh_first_glow__')
      onboardingTooltip?.remove()
      onboardingTooltip = null
      onboardingTimer = null
    }, 30000)
  })

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
    s.title = T_init.inlineButton.stop
    s.setAttribute('aria-label', T_init.inlineButton.stop)
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
    // Any state transition out of idle dismisses the onboarding
    // affordance — once they've activated the modal at least once,
    // they don't need the hint anymore (and the pulse + tooltip
    // would clash visually with the processing red pulse).
    if (s !== 'idle') dismissOnboarding()
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
      btn.title = T_init.inlineButton.processing
      btn.setAttribute('aria-label', T_init.inlineButton.processing)
      ensureStopBtn()
    } else {
      // idle: restore sparkle SVG and remove the stop sibling.
      btn.innerHTML = SPARKLE_SVG
      btn.title = T_init.inlineButton.activate
      btn.setAttribute('aria-label', T_init.inlineButton.activate)
      removeStopBtn()
    }
    window.setTimeout(updatePosition, 0)
  }

  const unmount = () => {
    state = 'hidden'
    dismissOnboarding()
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onResize)
    resizeObs?.disconnect()
    btn.removeEventListener('click', handleClick)
    btn.remove()
    removeStopBtn()
    // Clear the module-level handle if WE are the current one. If a newer
    // mount has already replaced us, leave the new handle alone.
    if (currentHandle && currentHandle.unmount === unmount) currentHandle = null
  }

  const handle: InlineButtonHandle = { setStatus, unmount }
  currentHandle = handle
  return handle
}

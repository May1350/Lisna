// Inline button anchored to the top-right of the video element.
// - 'idle': round 36x36 button with a folded-page + ink-line icon
//   ("AI writes a one-page note from this video"). Apple Liquid-Glass
//   surface — ink-900 tint at 55% with heavy backdrop blur, inner top
//   highlight + bottom recess for real-glass refraction feel.
// - 'processing': SAME icon + a small warn-red pulsing badge in the
//   top-right corner of the button, signalling "currently recording in
//   the background". Click affordance stays the same (open the modal),
//   so the click target's meaning doesn't change between states. The
//   previous "whole-button red pulse" wrongly read as a recording-stop
//   indicator (Zoom / OBS pattern) and made users hesitant to click.
// - 'hidden': hidden via display:none.
//
// Note: there is no longer an explicit inline "stop" button. Stopping
// a session is done from inside the modal (or by the natural <video>
// `ended` event). The inline overlay is intentionally minimal — one
// click affordance, one status badge.
//
// Palette: warm Lisna tokens hardcoded (content scripts can't reach
// Tailwind / CSS vars). ink-900 #1A1614, paper-100 #FFFEFB,
// terra #C2410C, terra-soft #FED7AA, warn-red #B91C1C — kept in sync
// with docs/DESIGN.md by hand because this surface is injected into
// arbitrary host pages.

import { hasSeenInlineButton, markInlineButtonSeen } from '../shared/storage'
import { t } from '../shared/i18n'

const STYLE_ID = '__sh_inline_button_style__'
const ROOT_ID = '__sh_inline_button_root__'
const TOOLTIP_ID = '__sh_inline_button_tooltip__'
const DISABLE_ID = '__sh_inline_button_disable__'

// Folded-page document with two ink lines underneath. Reads as
// "AI writes a one-page note from this lecture" — owns the academic
// note-taking concept without leaning on the over-used ✨ AI sparkle.
const BUTTON_SVG = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M6 4 L15 4 L19 8 L19 20 L6 20 Z"/>
  <path d="M15 4 L15 8 L19 8"/>
  <line x1="9" y1="13" x2="16" y2="13"/>
  <line x1="9" y1="16" x2="14" y2="16"/>
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
/* Apple Liquid-Glass surface (Variant 3 — Heavy Frosted, Control
 * Center pillar style). Three ingredients that the previous
 * implementation lacked:
 *   1. blur(60) saturate(180%) brightness(1.05) — bright + vivid feel
 *      of light passing through real glass
 *   2. inset 0 1px 0 rgba(white,0.18) — top-edge highlight that
 *      simulates light hitting the glass surface (this single shadow
 *      is what makes a translucent surface read as GLASS rather than
 *      "translucent paint")
 *   3. inset 0 -1px 0 rgba(black,0.22) — bottom-edge recess that
 *      gives the pill a sense of physical thickness
 * Surface tint is ink-900 (warm dark, R26 G22 B20 — adjacent to the
 * sidepanel's ink-900) at 55% alpha so the underlying video shows
 * through in muted form. */
.__sh_btn__ {
  position: absolute;
  z-index: 999999;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0.5px solid rgba(255, 255, 255, 0.10);
  border-radius: 9999px;
  background: rgba(26, 22, 20, 0.55);
  backdrop-filter: blur(60px) saturate(180%) brightness(1.05);
  -webkit-backdrop-filter: blur(60px) saturate(180%) brightness(1.05);
  color: #FFFEFB;
  box-shadow:
    inset 0  1px 0 rgba(255, 255, 255, 0.18),
    inset 0 -1px 0 rgba(0, 0, 0, 0.22),
    0 16px 44px rgba(0, 0, 0, 0.36),
    0 2px 6px rgba(0, 0, 0, 0.14);
  cursor: pointer;
  user-select: none;
  box-sizing: border-box;
  transition: transform 200ms cubic-bezier(0.16,1,0.3,1), background-color 200ms cubic-bezier(0.16,1,0.3,1);
}
.__sh_btn__:hover {
  background: rgba(26, 22, 20, 0.72);
  transform: translateY(-1px);
}
.__sh_btn__ svg { display: block; }

/* Corner status badge — small warn-red dot that pulses to indicate
 * "background recording in progress". Positioned ABSOLUTELY relative
 * to the main button (the button has position:absolute so the badge's
 * absolute coords inside the button are local). Visual semantic is
 * "iOS-style notification dot" — purely a status marker, NOT a click
 * target. Click target is still the whole button (= open modal).
 *
 * Color: --warn-red #B91C1C (DESIGN.md §3.3 — recording / 100% / live
 * status). NOT Tailwind's red-500 (#ef4444) which is too pink-shifted
 * against the warm ink palette. */
.__sh_status_badge__ {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: #B91C1C;
  /* Ink-900 ring to lift the dot off the (translucent) button surface
   * even when the underlying video is also reddish. */
  box-shadow:
    0 0 0 1.5px rgba(26, 22, 20, 0.92),
    0 0 0 0 rgba(185, 28, 28, 0.55);
  animation: __sh_badge_pulse__ 1.6s ease-in-out infinite;
  pointer-events: none;
}
@keyframes __sh_badge_pulse__ {
  0%, 100% {
    box-shadow:
      0 0 0 1.5px rgba(26, 22, 20, 0.92),
      0 0 0 0 rgba(185, 28, 28, 0.50);
  }
  50% {
    box-shadow:
      0 0 0 1.5px rgba(26, 22, 20, 0.92),
      0 0 0 5px rgba(185, 28, 28, 0);
  }
}

/* First-time onboarding: until the user has clicked the button at
 * least once, the idle button glows in a pulsing peach halo and a
 * small label appears next to it pointing at the click target.
 * Both auto-clear after the user clicks OR after 30 s.
 *
 * Color: --terra-soft #FED7AA (NOT --terra solid). DESIGN.md §1.4
 * reserves --terra solid for value-bearing payment / Pro CTA chunks
 * exclusively; using it on a generic onboarding signal would compete
 * with the Pro upgrade slot once the user encounters one. terra-soft
 * is the same warm peach already used on the tooltip arrow, so the
 * onboarding signal reads as one consistent palette.
 */
.__sh_first_glow__ {
  animation: __sh_first_glow__ 1.6s ease-in-out infinite;
}
@keyframes __sh_first_glow__ {
  0%, 100% {
    box-shadow:
      inset 0  1px 0 rgba(255, 255, 255, 0.18),
      inset 0 -1px 0 rgba(0, 0, 0, 0.22),
      0 16px 44px rgba(0, 0, 0, 0.36),
      0 2px 6px rgba(0, 0, 0, 0.14),
      0 0 0 0 rgba(254, 215, 170, 0.65);
  }
  50% {
    box-shadow:
      inset 0  1px 0 rgba(255, 255, 255, 0.18),
      inset 0 -1px 0 rgba(0, 0, 0, 0.22),
      0 16px 44px rgba(0, 0, 0, 0.36),
      0 2px 6px rgba(0, 0, 0, 0.14),
      0 0 0 12px rgba(254, 215, 170, 0);
  }
}
.__sh_onboarding_tooltip__ {
  position: absolute;
  z-index: 999999;
  background: rgba(26, 22, 20, 0.96);
  color: #FFFEFB;
  font: 500 12px/1.4 -apple-system, "Hiragino Sans", "Apple SD Gothic Neo", sans-serif;
  padding: 6px 11px;
  border-radius: 8px;
  white-space: nowrap;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.10),
    0 6px 24px rgba(26, 22, 20, 0.45);
  pointer-events: none;
  animation: __sh_tooltip_in__ 280ms cubic-bezier(0.16,1,0.3,1) both;
}
.__sh_onboarding_tooltip__ .__sh_arrow__ {
  display: inline-block;
  margin-left: 4px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-weight: 400;
  color: #FED7AA;
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
  border-left-color: rgba(26, 22, 20, 0.96);
}
@keyframes __sh_tooltip_in__ {
  from { opacity: 0; transform: translateX(8px); }
  to   { opacity: 1; transform: translateX(0); }
}

/* Quick-disable × badge. Sits in the top-left of the main button
 * group, slightly overlapping. Hidden by default; revealed when the
 * pointer hovers anywhere over the button group. Click → message SW
 * to set sh.enabled=false + schedule re-enable alarm. The user gets
 * a top-of-viewport toast confirming the duration so the action
 * isn't silent. */
.__sh_disable_btn__ {
  position: absolute;
  z-index: 1000000;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0.5px solid rgba(255, 255, 255, 0.16);
  border-radius: 9999px;
  background: rgba(26, 22, 20, 0.96);
  color: rgba(255, 254, 251, 0.9);
  font: 700 11px/18px -apple-system, "Hiragino Sans", "Apple SD Gothic Neo", sans-serif;
  text-align: center;
  cursor: pointer;
  user-select: none;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.10),
    0 2px 6px rgba(26, 22, 20, 0.40);
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 160ms ease, transform 160ms ease, background-color 160ms ease;
  pointer-events: none;
}
/* Reveal when hovering the main button OR the disable badge itself.
 * Both selectors needed because the badge sits OUTSIDE the main
 * button's bounding box, so :hover on the main button alone won't
 * keep it visible while the cursor moves toward it. */
.__sh_btn__:hover ~ .__sh_disable_btn__,
.__sh_disable_btn__:hover {
  opacity: 1;
  transform: scale(1);
  pointer-events: auto;
}
.__sh_disable_btn__:hover {
  background: rgba(185, 28, 28, 0.95);
}

/* Top-of-viewport toast for confirmation of quick-disable.
 * Same Liquid-Glass recipe as the main button but on a wider, taller
 * pill so it reads as a notification panel rather than a button. */
.__sh_toast__ {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 92vw;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  border: 0.5px solid rgba(255, 255, 255, 0.10);
  background: rgba(26, 22, 20, 0.65);
  backdrop-filter: blur(40px) saturate(180%) brightness(1.05);
  -webkit-backdrop-filter: blur(40px) saturate(180%) brightness(1.05);
  color: #FFFEFB;
  font: 500 13px/1.4 -apple-system, "Hiragino Sans", "Apple SD Gothic Neo", "Segoe UI", sans-serif;
  box-shadow:
    inset 0  1px 0 rgba(255, 255, 255, 0.16),
    inset 0 -1px 0 rgba(0, 0, 0, 0.22),
    0 12px 32px rgba(26, 22, 20, 0.40);
  animation: __sh_toast_in__ 220ms cubic-bezier(0.16,1,0.3,1) both;
}
.__sh_toast__ button {
  background: transparent;
  color: #FED7AA;
  border: 0;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  font: 600 12px/1 inherit;
}
.__sh_toast__ button:hover { background: rgba(254, 215, 170, 0.18); }
@keyframes __sh_toast_in__ {
  from { opacity: 0; transform: translate(-50%, -8px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
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
  // currentHandle.unmount(). The legacy STOP_ID node from earlier
  // builds (when the inline group included a separate stop button)
  // is also cleaned up here so users running a fresh dist after the
  // stop-button removal don't see a ghost button.
  document.getElementById(ROOT_ID)?.remove()
  document.getElementById('__sh_inline_button_stop__')?.remove()  // legacy id, still cleaned up
  document.getElementById(DISABLE_ID)?.remove()

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
  btn.innerHTML = BUTTON_SVG
  document.body.appendChild(btn)

  // Quick-disable × badge — sits in the top-left corner of the main
  // button, hidden until the user hovers over the button group.
  // Mounted as a sibling of `btn` (not a child) so its hover state is
  // independent and the click can be handled separately from the
  // main activation click. CSS reveals it via `.__sh_btn__:hover ~ ...`.
  const disableBtn = document.createElement('button')
  disableBtn.id = DISABLE_ID
  disableBtn.className = '__sh_disable_btn__'
  disableBtn.type = 'button'
  disableBtn.textContent = '×'
  disableBtn.title = T_init.inlineButton.disable_tooltip
  disableBtn.setAttribute('aria-label', T_init.inlineButton.disable_aria)
  document.body.appendChild(disableBtn)

  let state: InlineButtonState = 'idle'
  // Recording-active badge (corner dot). Owned by setStatus, attached
  // as a child of the main button so it inherits the button's
  // absolute-position context for `top: 4px; right: 4px`.
  let statusBadge: HTMLSpanElement | null = null
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

  // Quick-disable click — message SW to set sh.enabled=false +
  // schedule re-enable alarm. The SW broadcasts the change; our
  // sibling storage.onChanged listener in content/index.ts unmounts
  // this very button, so we don't need to manually clean up here.
  // Show a confirmation toast first so the action isn't silent.
  const handleDisableClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    chrome.runtime.sendMessage({ type: 'DISABLE_TEMPORARILY' }, (resp) => {
      if (chrome.runtime.lastError) return
      const hours = resp?.data?.hours ?? 24
      showDisableToast(hours)
    })
  }
  disableBtn.addEventListener('click', handleDisableClick)

  let scheduled = false
  const updatePosition = (): void => {
    if (state === 'hidden') return
    const rect = video.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      btn.style.display = 'none'
      disableBtn.style.display = 'none'
      return
    }
    btn.style.display = ''
    disableBtn.style.display = ''
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

    // Quick-disable × badge — top-left corner of the main button,
    // overlapping by ~6px so it reads as a sub-action of the main
    // button rather than a free-floating control. Hidden by default
    // (CSS opacity 0); revealed on hover of the main button.
    disableBtn.style.top = `${mainTop - 6}px`
    disableBtn.style.left = `${mainLeft - 6}px`
    disableBtn.style.display = ''

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

  const removeStatusBadge = () => {
    if (statusBadge) {
      statusBadge.remove()
      statusBadge = null
    }
  }

  const ensureStatusBadge = () => {
    if (statusBadge) return
    const dot = document.createElement('span')
    dot.className = '__sh_status_badge__'
    // aria-hidden on the badge — it's a status decoration, not an
    // interactive control. Screen readers announce the button's
    // aria-label ("recording in background, click to reopen") which
    // already conveys the recording state in words.
    dot.setAttribute('aria-hidden', 'true')
    btn.appendChild(dot)
    statusBadge = dot
  }

  const setStatus: InlineButtonHandle['setStatus'] = (s) => {
    state = s
    // Any state transition out of idle dismisses the onboarding
    // affordance — once they've activated the modal at least once,
    // they don't need the hint anymore (and the pulse + tooltip
    // would clash visually with the recording badge).
    if (s !== 'idle') dismissOnboarding()
    if (s === 'hidden') {
      btn.style.display = 'none'
      disableBtn.style.display = 'none'
      return
    }
    btn.style.display = ''
    // Sparkle SVG stays mounted across idle / processing — both states
    // share the same click affordance ("open the assistant"). The only
    // visual difference is the corner status badge that lights up
    // while a capture session is running in the background. This
    // avoids the prior "whole-button red pulse" that wrongly read as
    // a recording-stop indicator.
    if (btn.innerHTML.indexOf('<svg') === -1) {
      btn.innerHTML = BUTTON_SVG
    }
    if (s === 'processing') {
      ensureStatusBadge()
      btn.title = T_init.inlineButton.processing
      btn.setAttribute('aria-label', T_init.inlineButton.processing)
    } else {
      removeStatusBadge()
      btn.title = T_init.inlineButton.activate
      btn.setAttribute('aria-label', T_init.inlineButton.activate)
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
    disableBtn.removeEventListener('click', handleDisableClick)
    disableBtn.remove()
    removeStatusBadge()
    // Clear the module-level handle if WE are the current one. If a newer
    // mount has already replaced us, leave the new handle alone.
    if (currentHandle && currentHandle.unmount === unmount) currentHandle = null
  }

  const handle: InlineButtonHandle = { setStatus, unmount }
  currentHandle = handle
  return handle
}

// Top-of-viewport confirmation toast for the quick-disable action.
// Auto-dismisses after 5 s. The "되돌리기" / "Undo" link cancels the
// disable by re-toggling sh.enabled=true via TOGGLE_ENABLED — which
// also clears disabledUntil + the alarm in the SW handler. Keeps the
// action reversible without the user having to find the side panel.
const TOAST_ID = '__sh_inline_button_toast__'
function showDisableToast(hours: number): void {
  ensureStyle()
  document.getElementById(TOAST_ID)?.remove()
  const T = t()
  const wrap = document.createElement('div')
  wrap.id = TOAST_ID
  wrap.className = '__sh_toast__'
  const span = document.createElement('span')
  span.textContent = T.inlineButton.disabled_toast.replace('{hours}', String(hours))
  const undoBtn = document.createElement('button')
  undoBtn.type = 'button'
  undoBtn.textContent = T.inlineButton.disabled_undo
  undoBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'TOGGLE_ENABLED', enabled: true })
    wrap.remove()
  })
  wrap.appendChild(span)
  wrap.appendChild(undoBtn)
  document.body.appendChild(wrap)
  window.setTimeout(() => { wrap.remove() }, 5000)
}

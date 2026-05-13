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
// CSS lives in a sibling file imported via Vite's `?raw` suffix —
// inlined at build time as a UTF-8 string, zero runtime change.
// Externalised so the glass-surface recipe gets syntax highlighting,
// formatter, and Stylelint coverage. The lazy-inject path in
// ensureStyle() is intentional (style tag only attached on pages
// where a button is about to mount), so the CSS is deliberately NOT
// listed in manifest.content_scripts[].css — we don't want every
// host page paying the cost of these rules in their CSSOM.
import inlineButtonCss from './inline-button.css?raw'

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
  style.textContent = inlineButtonCss
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

// Anchor element the button is positioned over. Normally a <video>, but
// for sites that swallow clicks inside the player iframe (Drive viewer
// → YouTube embed) we mount in the TOP frame anchored to the <iframe>
// element itself — the iframe's rect equals the visible video area.
// Both HTMLVideoElement and HTMLIFrameElement satisfy getBoundingClientRect
// and ResizeObserver.observe, which is all this module touches.
export type InlineButtonAnchor = HTMLVideoElement | HTMLIFrameElement

export function mountInlineButton(
  video: InlineButtonAnchor,
  onActivate: () => void,
): InlineButtonHandle | null {
  // Note: no top-frame guard. The inline button mounts in WHATEVER frame
  // contains the <video> element. For platforms like K-LMS / Canvas Studio /
  // Vimeo embeds, the video lives in a cross-origin iframe; the button must
  // appear there. The viewport-local position math below works inside an
  // iframe (positions are relative to the iframe's own viewport, which is
  // exactly what we want — the button visually overlays the video element
  // wherever that iframe is rendered in the parent page).
  // Exception: Drive viewer embeds the player in a cross-origin iframe
  // whose pointer events are pre-empted by Drive's own overlay; for that
  // case the caller passes the <iframe> element and mounts in the top
  // frame instead.
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

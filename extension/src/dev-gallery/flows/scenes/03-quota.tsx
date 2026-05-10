import { useT } from '../../../shared/i18n'
import { QuotaBanner } from '../../../side-panel/components/QuotaBanner'
import { QuotaExhaustedIdle } from '../../../side-panel/components/QuotaExhaustedIdle'
import { OutlineView } from '../../../side-panel/components/OutlineView'
import { SessionControls } from '../../../side-panel/components/SessionControls'
import { AppShell } from './_shared'
import {
  FREE_USER,
  PRO_USER,
  QUOTA_FREE_95,
  QUOTA_FREE_100,
  QUOTA_PRO_100,
  OUTLINE_SHORT_2,
} from '../../fixtures/_mock-data'
import type { FlowGraph } from '../types'

// =============================================================================
// Quota / Plan flow — how the modal escalates as the user approaches and
// crosses the monthly audio cap. Mirrors the QuotaBanner / QuotaExhaustedIdle
// composition wired up inside src/side-panel/App.tsx, both for the active
// recording overlay and the cold-start exhausted card.
// Surface: embed (in-page modal). The same components also render in the
// side-panel surface, but the embed is where users hit the limit.
// =============================================================================

const noop = () => undefined

// Layout intent (embed surface = 380×640):
//   y=0   happy chain: banner-95 → banner-100 → mid-session-hit → exhausted-free → exhausted-pro
//   y=800 branch:                                                  stripe-redirect (under exhausted-free)
const COL = 480
const HAPPY_Y = 0
const BRANCH_Y = 800

// Recreates the QuotaExhaustedIdle layout but swaps the upgrade button for
// a disabled spinner state — the brief moment after the user clicks
// Upgrade and before chrome.tabs.create lands them on Stripe Checkout.
// Keep the rest of the card identical to QuotaExhaustedIdle so the
// transition between the two scenes reads as a state change inside one
// surface, not a different screen entirely.
function StripeRedirectMirror() {
  const T = useT()
  const limitSecs = QUOTA_FREE_100.limit_secs
  const usedDisplay = Math.min(QUOTA_FREE_100.used_secs, limitSecs)
  const formatMinutes = (secs: number) => {
    const mins = Math.floor(secs / 60)
    const rem = secs % 60
    if (mins === 0) return `${rem}${T.common.seconds}`
    if (rem === 0) return `${mins}${T.common.minutes}`
    return `${mins}${T.common.minutes}${rem}${T.common.seconds}`
  }
  return (
    <div className="flex-1 flex items-start justify-center px-4 pt-6">
      <div className="w-full max-w-sm rounded-[14px] border border-paper-edge bg-paper-100 px-5 py-5 shadow-card">
        <p className="text-base font-semibold text-ink-900 mb-2 tracking-headline-tight">
          {T.quotaExhausted.free_title}
        </p>
        <p className="text-sm text-ink-700 leading-relaxed whitespace-pre-line mb-4">
          {T.quotaExhausted.free_body}
        </p>
        <div className="relative h-1.5 w-full rounded-full bg-paper-300 overflow-hidden">
          <div className="absolute inset-y-0 left-0 right-0 bg-warn-red rounded-full" />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[11px] text-ink-500 font-mono tabular-nums">
          <span>
            {formatMinutes(usedDisplay)} / {formatMinutes(limitSecs)}
          </span>
          <span className="font-medium text-ink-900">100%</span>
        </div>
        <div className="mt-1 text-[11px] text-ink-300 font-mono">{T.quota.reset_note}</div>
        <div className="mt-5 rounded-[10px] border border-terra-soft bg-terra-tint px-4 py-3">
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <span className="text-lg font-semibold text-terra leading-none tracking-headline-tight font-mono tabular-nums">
              {T.options.plan_pro_price}
            </span>
            <span className="text-[11px] text-terra-700 opacity-70 shrink-0 font-mono uppercase tracking-wider">
              {T.options.plan_pro_priceNote}
            </span>
          </div>
          <ul className="text-xs text-ink-700 space-y-1">
            <li>{T.options.plan_pro_feature1}</li>
            <li>{T.options.plan_pro_feature2}</li>
          </ul>
        </div>
        <button
          type="button"
          disabled
          className="mt-3 w-full rounded-[10px] bg-ink-200 cursor-not-allowed text-paper-100 text-sm font-medium px-4 py-3 inline-flex items-center justify-center gap-2"
        >
          <span className="inline-block w-3.5 h-3.5 border-2 border-paper-100/40 border-t-paper-100 rounded-full animate-spin" />
          <span>Stripeに移動中…</span>
        </button>
      </div>
    </div>
  )
}

export const quotaFlow: FlowGraph = {
  id: 'quota',
  label: 'Quota / Plan',
  caption: 'Quota approaches limit → banner → session ends → exhausted-idle → upgrade flow',
  surface: 'embed',
  positions: {
    'banner-95':        { x: 0 * COL, y: HAPPY_Y },
    'banner-100':       { x: 1 * COL, y: HAPPY_Y },
    'mid-session-hit':  { x: 2 * COL, y: HAPPY_Y },
    'exhausted-free':   { x: 3 * COL, y: HAPPY_Y },
    'exhausted-pro':    { x: 4 * COL, y: HAPPY_Y },
    'stripe-redirect':  { x: 3 * COL, y: BRANCH_Y },
  },
  scenes: [
    {
      id: 'banner-95',
      label: 'QuotaBanner — 95% (amber warn)',
      caption: 'Free plan at 95 % — amber warning banner shown above the outline.',
      tags: ['transient'],
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={18 * 60}>
          <QuotaBanner user={FREE_USER} quota={QUOTA_FREE_95} onUpgrade={noop} />
          <OutlineView outline={OUTLINE_SHORT_2} slides={[]} onJump={noop} />
        </AppShell>
      ),
    },
    {
      id: 'banner-100',
      label: 'QuotaBanner — blocked (red)',
      caption: 'Free plan hit limit — red banner; recording forcibly stops next chunk.',
      tags: ['error'],
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={0}>
          <QuotaBanner user={FREE_USER} quota={QUOTA_FREE_100} blocked onUpgrade={noop} />
          <OutlineView outline={OUTLINE_SHORT_2} slides={[]} onJump={noop} />
        </AppShell>
      ),
    },
    {
      id: 'mid-session-hit',
      label: 'Mid-session hit — capture stopped',
      caption: 'Quota tripped mid-session: capture stopped, banner pinned.',
      tags: ['error'],
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={0}>
          <QuotaBanner user={FREE_USER} quota={QUOTA_FREE_100} blocked onUpgrade={noop} />
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-hidden">
              <OutlineView outline={OUTLINE_SHORT_2} slides={[]} onJump={noop} />
            </div>
            <div className="px-3 pb-3 pt-2">
              <SessionControls
                isCapturing={false}
                videoPlaying={false}
                onSetPlay={noop}
                onEnd={noop}
                quotaExhausted
                userPlan="free"
                onUpgrade={noop}
              />
            </div>
          </div>
        </AppShell>
      ),
    },
    {
      id: 'exhausted-free',
      label: 'QuotaExhaustedIdle — Free',
      caption: 'User opens the modal already at 100 % — full takeover card with Pro upsell.',
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={0}>
          <QuotaExhaustedIdle
            user={FREE_USER}
            quota={QUOTA_FREE_100}
            onUpgrade={noop}
            upgrading={false}
          />
        </AppShell>
      ),
    },
    {
      id: 'stripe-redirect',
      label: 'Upgrade — redirecting to Stripe',
      caption: 'After clicking Upgrade — busy spinner while /v1/billing/checkout returns and the new tab opens.',
      tags: ['transient', 'placeholder'],
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={0}>
          <StripeRedirectMirror />
        </AppShell>
      ),
    },
    {
      id: 'exhausted-pro',
      label: 'QuotaExhaustedIdle — Pro',
      caption: 'Rare path — Pro at limit; info-only card, no upgrade.',
      render: () => (
        <AppShell user={PRO_USER} isEmbed liveRemainingSecs={0}>
          <QuotaExhaustedIdle
            user={PRO_USER}
            quota={QUOTA_PRO_100}
            onUpgrade={noop}
            upgrading={false}
          />
        </AppShell>
      ),
    },
  ],
  edges: [
    { from: 'banner-95', to: 'banner-100', label: '+5%' },
    { from: 'banner-100', to: 'mid-session-hit', label: 'block' },
    { from: 'mid-session-hit', to: 'exhausted-free', label: 'reload' },
    // Bidirectional pair between exhausted-free and stripe-redirect:
    // upgrade drops down into the redirect placeholder; cancelling the
    // Stripe tab brings the user back up. Bottom/Top handles route
    // both edges as a clean vertical lens beside the happy axis.
    { from: 'exhausted-free', to: 'stripe-redirect', label: 'upgrade', sourceHandle: 'bottom', targetHandle: 'top' },
    { from: 'stripe-redirect', to: 'exhausted-free', label: 'cancel', dashed: true, sourceHandle: 'top', targetHandle: 'bottom' },
    // Alt path at session start when the user is already on Pro and Pro
    // also happens to be at the cap. Dashed because it's a rare branch
    // off the main free-user happy chain.
    { from: 'exhausted-free', to: 'exhausted-pro', label: 'pro path', dashed: true },
  ],
  boundaryLinks: [
    { fromScene: 'banner-95', toFlowId: 'recording', toSceneId: 'paused', label: 'quota near limit', direction: 'in' },
    { fromScene: 'exhausted-free', toFlowId: 'onboarding', toSceneId: 'authed-empty', label: 'after upgrade', direction: 'out' },
  ],
}

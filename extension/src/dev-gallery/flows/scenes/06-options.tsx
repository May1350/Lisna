import { useEffect, useState } from 'react'
import { Options, PlanSection } from '../../../options/Options'
import { useT } from '../../../shared/i18n'
import { QUOTA_FREE_OK, QUOTA_FREE_95, QUOTA_PRO_OK } from '../../fixtures/_mock-data'
import type { QuotaSnapshot } from '../../../shared/types'
import type { FlowGraph } from '../types'

// =============================================================================
// Options page flow — full-tab Options surface (chrome.runtime.openOptionsPage).
//
// CAVEAT — backend dependency: The real <Options /> component fetches
// /v1/auth/me on mount to populate the Plan section. The dev gallery has no
// backend, so that call rejects (or hangs) and the Plan section stays in its
// loading-spinner state for every scene below. Same caveat for
// /v1/billing/checkout (Upgrade button pre-fetch) and /v1/feedback (submit).
//
// What the gallery CAN seed: chrome.storage values via the
// `__galleryStorage` shim installed by src/dev-gallery/main.tsx. So the
// Obsidian section (apiUrl / apiKey / folder / autoSync) and the language
// pickers reflect the seeded state on mount; the Plan and Account-identity
// surfaces remain in their loading-only state.
//
// Note on connection-test result: clicking "Test connection" issues a real
// HTTP request to the configured Obsidian URL. In the gallery there's no
// running Obsidian instance at 127.0.0.1:27123, so it will resolve to an
// error inline regardless of which scene we're in. Tagged as 'placeholder'
// where relevant.
// =============================================================================

function OptionsScene({ seed }: { seed: Record<string, unknown> }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    ;(globalThis as Record<string, unknown> & { __galleryStorage?: (s: Record<string, unknown>) => void })
      .__galleryStorage?.(seed)
    setReady(true)
  }, [seed])
  return ready ? <Options /> : null
}

// Focused PlanSection preview — renders just the Plan card (the part
// of the Options page that swaps between Free and Pro states) with
// mock quota injected directly. Used for the free-plan / pro-plan
// scenes so designers can actually see the Free vs Pro differences;
// the full <Options /> component would otherwise stay in its loading-
// spinner state because the gallery has no /v1/auth/me backend.
function PlanSectionPreview({ plan, quota }: { plan: 'free' | 'pro'; quota: QuotaSnapshot }) {
  const T = useT()
  return (
    <div className="bg-paper-100 px-6 py-8 h-full overflow-y-auto">
      <div className="max-w-md mx-auto">
        <h2 className="text-lg font-semibold text-ink-900 mb-1 tracking-headline-tight">
          {T.options.section_plan}
        </h2>
        <p className="text-xs text-ink-500 mb-4">
          {plan === 'pro'
            ? 'Pro user — quota usage card; no upgrade CTA, no Stripe pre-fetch.'
            : 'Free user — quota usage card + Pro upsell + Upgrade CTA.'}
        </p>
        <PlanSection
          plan={plan}
          quota={quota}
          onUpgrade={() => undefined}
          upgrading={false}
          T={T}
        />
      </div>
    </div>
  )
}

const RESET_SEED: Record<string, unknown> = {
  'sh.obsidianApiUrl': '',
  'sh.obsidianApiKey': '',
  'sh.obsidianFolder': '',
  'sh.obsidianAutoSync': false,
}

const OBSIDIAN_OK_SEED: Record<string, unknown> = {
  'sh.obsidianApiUrl': 'http://127.0.0.1:27123',
  'sh.obsidianApiKey': 'demo-key-xxxxx',
  'sh.obsidianFolder': 'lectures',
  'sh.obsidianAutoSync': false,
}

// Layout — Options surface is 720×720 (per Surface.tsx). Wider scenes need
// a wider COL than embed/side-panel flows.
const COL = 820 // surface width (720) + horizontal margin (100)
const ROW = 800

export const optionsFlow: FlowGraph = {
  id: 'options',
  label: 'Options page',
  caption: 'Settings — language, speed, plan, Obsidian, feedback',
  surface: 'options-page',
  positions: {
    'default':            { x: 0 * COL, y: 0 * ROW },
    'free-plan':          { x: 1 * COL, y: 0 * ROW },
    'pro-plan':           { x: 1 * COL, y: 1 * ROW },
    'obsidian-empty':     { x: 2 * COL, y: 0 * ROW },
    'obsidian-ok':        { x: 3 * COL, y: 0 * ROW },
    'obsidian-fail':      { x: 3 * COL, y: 1 * ROW },
    'feedback-submitted': { x: 2 * COL, y: 2 * ROW },
  },
  scenes: [
    {
      id: 'default',
      label: 'Options — fresh load',
      caption: 'Default options view — Plan section spinner, Obsidian unconfigured.',
      render: () => <OptionsScene seed={RESET_SEED} />,
    },
    {
      id: 'free-plan',
      label: 'Plan section — Free (16% used)',
      caption: 'Free plan card: usage bar (green tier) + Pro upsell + Upgrade CTA.',
      variants: [
        {
          label: 'Free · 16% (calm)',
          render: () => <PlanSectionPreview plan="free" quota={QUOTA_FREE_OK} />,
        },
        {
          label: 'Free · 95% (red bar)',
          render: () => <PlanSectionPreview plan="free" quota={QUOTA_FREE_95} />,
        },
      ],
    },
    {
      id: 'pro-plan',
      label: 'Plan section — Pro',
      caption: 'Pro plan card: hours-based usage; no upgrade CTA, no Stripe pre-fetch.',
      render: () => <PlanSectionPreview plan="pro" quota={QUOTA_PRO_OK} />,
    },
    {
      id: 'obsidian-empty',
      label: 'Obsidian — unconfigured',
      caption: 'Obsidian unconfigured — form empty + connection-test button disabled.',
      render: () => <OptionsScene seed={RESET_SEED} />,
    },
    {
      id: 'obsidian-ok',
      label: 'Obsidian — configured',
      caption: 'Obsidian configured — form populated; click "Test connection" to ping locally.',
      render: () => <OptionsScene seed={OBSIDIAN_OK_SEED} />,
    },
    {
      id: 'obsidian-fail',
      label: 'Obsidian — test fails',
      caption: 'Obsidian fail — same form; "Test connection" shows error inline (no Obsidian running in gallery).',
      tags: ['error'],
      render: () => <OptionsScene seed={OBSIDIAN_OK_SEED} />,
    },
    {
      id: 'feedback-submitted',
      label: 'Feedback — submit state',
      caption: 'Feedback section — submit success state requires real /v1/feedback response.',
      tags: ['placeholder'],
      render: () => <OptionsScene seed={RESET_SEED} />,
    },
  ],
  edges: [
    { from: 'default', to: 'free-plan', label: 'free user' },
    { from: 'default', to: 'pro-plan', label: 'pro user' },
    // Skips over free-plan on the same y=0 row. Route via the bottom
    // edges so the smoothstep elbow goes UNDER the chain instead of
    // cutting straight through the intermediate node.
    { from: 'default', to: 'obsidian-empty', label: 'scroll', sourceHandle: 'bottom', targetHandle: 'bottom' },
    { from: 'obsidian-empty', to: 'obsidian-ok', label: 'configure' },
    {
      from: 'obsidian-empty',
      to: 'obsidian-fail',
      label: 'config fail',
      dashed: true,
      sourceHandle: 'bottom',
      targetHandle: 'top',
    },
    { from: 'default', to: 'feedback-submitted', label: 'submit' },
  ],
}

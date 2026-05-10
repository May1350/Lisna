import { useEffect, useState } from 'react'
import { Options } from '../../../options/Options'
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
      label: 'Options — free plan',
      caption: 'Free plan view — Plan section pending API response (gallery has no backend).',
      tags: ['placeholder'],
      render: () => <OptionsScene seed={RESET_SEED} />,
    },
    {
      id: 'pro-plan',
      label: 'Options — pro plan',
      caption: 'Pro plan view — same caveat as free; Plan API not available in gallery.',
      tags: ['placeholder'],
      render: () => <OptionsScene seed={RESET_SEED} />,
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

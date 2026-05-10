import type { GalleryFixture } from './types'
import { createElement as h } from 'react'
import { QuotaBanner } from '../../side-panel/components/QuotaBanner'
import { QuotaExhaustedIdle } from '../../side-panel/components/QuotaExhaustedIdle'
import { PanelHeader } from '../../side-panel/components/PanelHeader'
import {
  FREE_USER,
  PRO_USER,
  QUOTA_FREE_OK,
  QUOTA_FREE_80,
  QUOTA_FREE_95,
  QUOTA_FREE_100,
  QUOTA_PRO_100,
} from './_mock-data'

const CATEGORY = 'Quota / Plan'
const noop = () => undefined

export const quotaFixtures: GalleryFixture[] = [
  // ── QuotaBanner ────────────────────────────────────────────────────
  {
    id: 'quota-banner-free-80',
    category: CATEGORY,
    label: 'QuotaBanner — free, 82%',
    note: 'Amber warning band. Below 90% the banner does not render.',
    render: () =>
      h(QuotaBanner, { user: FREE_USER, quota: QUOTA_FREE_80, onUpgrade: noop }),
  },
  {
    id: 'quota-banner-free-95',
    category: CATEGORY,
    label: 'QuotaBanner — free, 95%',
    note: 'Amber warning, upgrade CTA visible.',
    render: () =>
      h(QuotaBanner, { user: FREE_USER, quota: QUOTA_FREE_95, onUpgrade: noop }),
  },
  {
    id: 'quota-banner-free-100',
    category: CATEGORY,
    label: 'QuotaBanner — free, 100%',
    note: 'Red blocked band, upgrade CTA visible.',
    render: () =>
      h(QuotaBanner, { user: FREE_USER, quota: QUOTA_FREE_100, onUpgrade: noop }),
  },
  {
    id: 'quota-banner-pro-100',
    category: CATEGORY,
    label: 'QuotaBanner — pro, 100%',
    note: 'Red blocked band, no upgrade button (already pro).',
    render: () =>
      h(QuotaBanner, { user: PRO_USER, quota: QUOTA_PRO_100, onUpgrade: noop }),
  },
  {
    id: 'quota-banner-free-blocked',
    category: CATEGORY,
    label: 'QuotaBanner — free, blocked=true',
    note: '402 forced — overrides percent_used to 100%.',
    render: () =>
      h(QuotaBanner, {
        user: FREE_USER,
        quota: QUOTA_FREE_95,
        onUpgrade: noop,
        blocked: true,
      }),
  },

  // ── QuotaExhaustedIdle ────────────────────────────────────────────
  {
    id: 'quota-exhausted-free-idle',
    category: CATEGORY,
    label: 'QuotaExhaustedIdle — free, idle',
    note: 'Pro upgrade card with active CTA.',
    height: 480,
    render: () =>
      h(QuotaExhaustedIdle, {
        user: FREE_USER,
        quota: QUOTA_FREE_100,
        onUpgrade: noop,
        upgrading: false,
      }),
  },
  {
    id: 'quota-exhausted-free-upgrading',
    category: CATEGORY,
    label: 'QuotaExhaustedIdle — free, upgrading',
    note: 'CTA disabled while Stripe Checkout redirect is in flight.',
    height: 480,
    render: () =>
      h(QuotaExhaustedIdle, {
        user: FREE_USER,
        quota: QUOTA_FREE_100,
        onUpgrade: noop,
        upgrading: true,
      }),
  },
  {
    id: 'quota-exhausted-pro',
    category: CATEGORY,
    label: 'QuotaExhaustedIdle — pro, info only',
    note: 'No upgrade card; just the reset notice.',
    height: 360,
    render: () =>
      h(QuotaExhaustedIdle, {
        user: PRO_USER,
        quota: QUOTA_PRO_100,
        onUpgrade: noop,
        upgrading: false,
      }),
  },

  // ── PanelHeader ───────────────────────────────────────────────────
  {
    id: 'panel-header-not-logged-in',
    category: CATEGORY,
    label: 'PanelHeader — not logged in',
    render: () =>
      h(PanelHeader, {
        user: null,
        isEmbed: true,
        onClose: noop,
        onLogout: noop,
      }),
  },
  {
    id: 'panel-header-free-embed-ok',
    category: CATEGORY,
    label: 'PanelHeader — free, embed, quota OK',
    note: 'Plain remaining pill (no warning colour yet).',
    render: () =>
      h(PanelHeader, {
        user: FREE_USER,
        isEmbed: true,
        playbackSpeed: 1,
        onSpeedChange: noop,
        liveRemainingSecs: QUOTA_FREE_OK.remaining_secs,
        onClose: noop,
        onLogout: noop,
      }),
  },
  {
    id: 'panel-header-free-embed-amber',
    category: CATEGORY,
    label: 'PanelHeader — free, embed, ≤5min remaining',
    note: 'Amber chip (warn-amber/10).',
    render: () =>
      h(PanelHeader, {
        user: FREE_USER,
        isEmbed: true,
        playbackSpeed: 1,
        onSpeedChange: noop,
        liveRemainingSecs: 60,
        onClose: noop,
        onLogout: noop,
      }),
  },
  {
    id: 'panel-header-free-embed-red',
    category: CATEGORY,
    label: 'PanelHeader — free, embed, ≤1min remaining',
    note: 'Red chip (warn-red/10).',
    render: () =>
      h(PanelHeader, {
        user: FREE_USER,
        isEmbed: true,
        playbackSpeed: 1,
        onSpeedChange: noop,
        liveRemainingSecs: 30,
        onClose: noop,
        onLogout: noop,
      }),
  },
  {
    id: 'panel-header-pro-embed',
    category: CATEGORY,
    label: 'PanelHeader — pro, embed',
    note: 'Pro avatar (terra ring) + plan dot, no remaining chip.',
    render: () =>
      h(PanelHeader, {
        user: PRO_USER,
        isEmbed: true,
        playbackSpeed: 1.25,
        onSpeedChange: noop,
        onClose: noop,
        onLogout: noop,
      }),
  },
  {
    id: 'panel-header-free-side-panel',
    category: CATEGORY,
    label: 'PanelHeader — free, side panel',
    note: 'Account view: ON/OFF toggle visible, plan-logout combo line.',
    render: () =>
      h(PanelHeader, {
        user: FREE_USER,
        isEmbed: false,
        enabled: true,
        onToggleEnabled: noop,
        onClose: noop,
        onLogout: noop,
      }),
  },
  {
    id: 'panel-header-pro-side-panel',
    category: CATEGORY,
    label: 'PanelHeader — pro, side panel',
    note: 'Account view, pro avatar + toggle off.',
    render: () =>
      h(PanelHeader, {
        user: PRO_USER,
        isEmbed: false,
        enabled: false,
        onToggleEnabled: noop,
        onClose: noop,
        onLogout: noop,
      }),
  },
]

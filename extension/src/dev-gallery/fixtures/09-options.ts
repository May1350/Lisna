import type { GalleryFixture } from './types'
import { createElement as h } from 'react'
import { Options } from '../../options/Options'

const CATEGORY = 'Options page'

// Storage seeder — calls the gallery's `__galleryStorage` shim if it
// exists. The shim is installed by src/dev-gallery/main.tsx before any
// fixture renders. We patch synchronously inside render() so the call
// is idempotent across re-renders and the seed lands BEFORE Options'
// mount-time useEffect reads chrome.storage.
type SeedFn = (items: Record<string, unknown>) => void

function seedStorage(items: Record<string, unknown>): void {
  const fn = (globalThis as Record<string, unknown>).__galleryStorage as
    | SeedFn
    | undefined
  if (typeof fn === 'function') fn(items)
}

const FRAME_W = 720
const FRAME_H = 900

export const optionsFixtures: GalleryFixture[] = [
  {
    id: 'options-default',
    category: CATEGORY,
    label: 'Options page — default load',
    note:
      'Full Options component. /v1/auth/me resolves to null in the gallery, ' +
      'so the Plan section stays in its loading-spinner state.',
    width: FRAME_W,
    height: FRAME_H,
    render: () => {
      // Reset Obsidian-related keys to defaults so a previous fixture's
      // seed doesn't bleed across.
      seedStorage({
        'sh.obsidianApiUrl': '',
        'sh.obsidianApiKey': '',
        'sh.obsidianFolder': '',
        'sh.obsidianAutoSync': false,
      })
      return h(Options)
    },
  },
  {
    id: 'options-obsidian-configured',
    category: CATEGORY,
    label: 'Options page — Obsidian pre-configured',
    note:
      'API URL / key / folder seeded into chrome.storage before mount; URL ' +
      'edit-affordance auto-unlocks because the URL is non-default.',
    width: FRAME_W,
    height: FRAME_H,
    render: () => {
      seedStorage({
        'sh.obsidianApiUrl': 'http://127.0.0.1:27124',
        'sh.obsidianApiKey': 'demo-redacted-key',
        'sh.obsidianFolder': 'lectures',
        'sh.obsidianAutoSync': true,
      })
      return h(Options)
    },
  },
  {
    id: 'options-defaults-clean',
    category: CATEGORY,
    label: 'Options page — clean defaults (URL locked)',
    note:
      'Empty Obsidian config; Default URL hint visible, edit affordance is ' +
      'gated behind a confirm() click.',
    width: FRAME_W,
    height: FRAME_H,
    render: () => {
      seedStorage({
        'sh.obsidianApiUrl': '',
        'sh.obsidianApiKey': '',
        'sh.obsidianFolder': '',
        'sh.obsidianAutoSync': false,
      })
      return h(Options)
    },
  },
]

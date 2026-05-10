import type { GalleryFixture } from './types'
import { createElement as h } from 'react'
import { SpeedSelector } from '../../side-panel/components/SpeedSelector'
import { useT } from '../../shared/i18n'

const CATEGORY = 'Modals / Overlays'

const SPEEDS = [1, 1.5, 2, 2.5, 3, 4] as const

// Static recreation of SpeedSelector's open-dropdown state. The real
// component manages `open` purely in internal useState with no
// defaultOpen prop, so design review of the popover requires either
// clicking the trigger live OR a stable JSX mirror like this one.
// Keep in sync with src/side-panel/components/SpeedSelector.tsx.
function SpeedSelectorOpen({ current = 1.5 }: { current?: number }) {
  const T = useT()
  return h(
    'div',
    { className: 'relative' },
    h(
      'button',
      {
        type: 'button',
        className:
          'px-2 py-1 text-xs font-semibold rounded-md bg-paper-300 hover:bg-ink-200 text-ink-900 min-w-[40px]',
        title: T.speed.selectorTitle,
      },
      `${current}×`,
    ),
    h(
      'div',
      {
        className:
          'absolute right-0 top-full mt-1 bg-paper-100 border border-paper-edge rounded-md shadow-lg py-1 z-50',
      },
      ...SPEEDS.map(s =>
        h(
          'button',
          {
            key: s,
            type: 'button',
            className: `block w-full text-left px-3 py-1 text-xs hover:bg-paper-300 ${
              current === s ? 'font-semibold text-ink-700' : 'text-ink-900'
            }`,
          },
          `${s}×`,
        ),
      ),
    ),
  )
}

const noop = () => undefined

export const modalFixtures: GalleryFixture[] = [
  {
    id: 'speed-selector-closed-1x',
    category: CATEGORY,
    label: 'SpeedSelector — closed (1×)',
    note: 'Real component; click the trigger to open the dropdown.',
    height: 80,
    render: () => h(SpeedSelector, { current: 1, onChange: noop }),
  },
  {
    id: 'speed-selector-closed-1.5x',
    category: CATEGORY,
    label: 'SpeedSelector — closed (1.5×)',
    note: 'Real component; click the trigger to open the dropdown.',
    height: 80,
    render: () => h(SpeedSelector, { current: 1.5, onChange: noop }),
  },
  {
    id: 'speed-selector-closed-2x',
    category: CATEGORY,
    label: 'SpeedSelector — closed (2×)',
    note: 'Real component; click the trigger to open the dropdown.',
    height: 80,
    render: () => h(SpeedSelector, { current: 2, onChange: noop }),
  },
  {
    id: 'speed-selector-open-static',
    category: CATEGORY,
    label: 'SpeedSelector — open dropdown (static recreation)',
    note: 'Static recreation; mirrors src/side-panel/components/SpeedSelector.tsx open state.',
    height: 220,
    render: () => h(SpeedSelectorOpen, { current: 1.5 }),
  },
]

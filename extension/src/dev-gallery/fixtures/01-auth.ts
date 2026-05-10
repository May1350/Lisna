import type { GalleryFixture } from './types'
import { createElement as h } from 'react'
import { ConsentModal } from '../../side-panel/components/ConsentModal'
import { LoginScreen } from '../../side-panel/components/LoginScreen'
import { useT } from '../../shared/i18n'

// Static recreation of LoginScreen's loading/error states. The component's
// `loading` and `err` are internal useState — to drive them without
// modifying the component, we mirror the JSX. Keep in sync with
// src/side-panel/components/LoginScreen.tsx.
function LoginScreenStatic({ variant }: { variant: 'loading' | 'error' }) {
  const T = useT()
  const taglineLines = T.login.tagline.split('\n')
  const privacyLines = T.login.privacyNote.split('\n')
  return h(
    'div',
    { className: 'min-h-screen flex flex-col items-center justify-center px-8 py-10 text-center bg-gradient-to-b from-white to-paper-200' },
    h('div', { className: 'w-14 h-14 mb-5 rounded-2xl bg-ink-900 shadow-lg flex items-center justify-center text-paper-100 text-2xl font-bold' }, 'L'),
    h('h1', { className: 'text-xl font-bold text-ink-900 mb-1.5' }, T.login.title),
    h('p', { className: 'text-sm text-ink-700 mb-7 leading-relaxed max-w-[260px]' },
      ...taglineLines.flatMap((line, i) =>
        i < taglineLines.length - 1
          ? [h('span', { key: i }, line), h('br', { key: `br-${i}` })]
          : [h('span', { key: i }, line)],
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        disabled: variant === 'loading',
        'aria-label': T.login.button,
        className:
          'group inline-flex items-center justify-center gap-3 px-5 py-2.5 bg-paper-100 border border-paper-edge rounded-full text-sm font-medium text-ink-900 shadow-sm hover:shadow-md hover:border-ink-300 disabled:opacity-50 transition-all',
      },
      variant === 'loading'
        ? [
            h('span', {
              key: 'spin',
              className:
                'inline-block w-4 h-4 border-2 border-paper-edge border-t-ink-700 rounded-full animate-spin',
            }),
            h('span', { key: 'lbl' }, T.login.busy),
          ]
        : [
            h('span', { key: 'g', className: 'inline-block w-4 h-4 rounded-full bg-ink-900' }),
            h('span', { key: 'lbl' }, T.login.button),
          ],
    ),
    variant === 'error'
      ? h(
          'p',
          { className: 'text-warn-red text-xs mt-4 max-w-[280px] leading-relaxed' },
          T.login.failPrefix,
          'network error — please retry',
        )
      : null,
    h(
      'p',
      { className: 'text-[10px] text-ink-300 mt-8 leading-relaxed max-w-[260px]' },
      ...privacyLines.flatMap((line, i) =>
        i < privacyLines.length - 1
          ? [h('span', { key: i }, line), h('br', { key: `br-${i}` })]
          : [h('span', { key: i }, line)],
      ),
    ),
  )
}

// Reference fixtures for category 1 — Auth / Session entry.
// Pattern: import the real component; pass real (or mock) props; never wrap.

export const authFixtures: GalleryFixture[] = [
  {
    id: 'consent-modal',
    category: 'Auth / Session entry',
    label: 'ConsentModal — initial',
    note: 'Both checkboxes unchecked; CTA disabled.',
    height: 520,
    render: () =>
      h(ConsentModal, {
        onAccept: () => {
          // no-op in gallery; we want to keep the modal visible
        },
      }),
  },
  {
    id: 'login-screen-idle',
    category: 'Auth / Session entry',
    label: 'LoginScreen — idle',
    height: 520,
    render: () =>
      h(LoginScreen, {
        currentUrl: 'https://www.youtube.com/watch?v=dev',
        onSuccess: () => undefined,
      }),
  },
  {
    id: 'login-screen-loading',
    category: 'Auth / Session entry',
    label: 'LoginScreen — signing in (static recreation)',
    note: 'Mirrors loading=true branch (button shows spinner + busy label, disabled).',
    height: 520,
    render: () => h(LoginScreenStatic, { variant: 'loading' }),
  },
  {
    id: 'login-screen-error',
    category: 'Auth / Session entry',
    label: 'LoginScreen — error (static recreation)',
    note: 'Mirrors err set branch (warn-red message below button).',
    height: 520,
    render: () => h(LoginScreenStatic, { variant: 'error' }),
  },
]

import type { GalleryFixture } from './types'
import { createElement as h } from 'react'
import { ConsentModal } from '../../side-panel/components/ConsentModal'
import { LoginScreen } from '../../side-panel/components/LoginScreen'
import { useT } from '../../shared/i18n'

// Static recreation of LoginScreen's loading/error states. The component's
// `loading` and `err` are internal useState — to drive them without
// modifying the component, we mirror the JSX. Keep in sync with
// src/side-panel/components/LoginScreen.tsx.

// Inline copy of the official Google "G" mark — same SVG as
// LoginScreen's GoogleGlyph helper.
function GoogleGlyphInline() {
  return h(
    'svg',
    { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': true },
    h('path', { fill: '#4285F4', d: 'M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.79 2.71v2.26h2.9c1.7-1.57 2.69-3.88 2.69-6.62z' }),
    h('path', { fill: '#34A853', d: 'M9 18c2.43 0 4.47-.81 5.96-2.18l-2.9-2.26c-.81.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z' }),
    h('path', { fill: '#FBBC05', d: 'M3.95 10.7c-.18-.54-.28-1.12-.28-1.7s.1-1.16.28-1.7V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l2.99-2.34z' }),
    h('path', { fill: '#EA4335', d: 'M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.96L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z' }),
  )
}

function LoginScreenStatic({ variant }: { variant: 'loading' | 'error' }) {
  const T = useT()
  const taglineLines = T.login.tagline.split('\n')
  const privacyLines = T.login.privacyNote.split('\n')
  // chrome.runtime.getURL works in the dev gallery via the chrome-mock,
  // resolving to a relative URL under origin. The real PNG icon lives
  // at /icons/icon128.png (publicDir flatten — source is
  // extension/public/icons/icon128.png).
  const logoUrl = chrome.runtime.getURL('icons/icon128.png')
  return h(
    'div',
    { className: 'min-h-screen flex flex-col items-center justify-center px-8 py-10 text-center bg-gradient-to-b from-paper-100 to-paper-200' },
    h('img', {
      src: logoUrl,
      alt: T.login.title,
      width: 56,
      height: 56,
      className: 'w-14 h-14 mb-5 rounded-2xl shadow-lg',
    }),
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
            h(GoogleGlyphInline, { key: 'g' }),
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

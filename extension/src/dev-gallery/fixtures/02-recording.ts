import type { GalleryFixture } from './types'
import { createElement as h, Fragment } from 'react'
import { SessionControls } from '../../side-panel/components/SessionControls'
import { useT } from '../../shared/i18n'

const CATEGORY = 'Recording lifecycle'

// ── Mirrors of inline App.tsx state components ───────────────────────
// IdleSessionState, CuratingState, PostSessionHint are not exported from
// App.tsx — these copies re-create their JSX 1:1 so the gallery has a
// stable visual reference for design review. Keep in sync with App.tsx
// if the inline source ever changes.

function CuratingState() {
  const T = useT()
  return h(
    'div',
    { className: 'flex-1 flex flex-col items-center justify-center px-6 py-10 text-center' },
    h(
      'div',
      { className: 'relative w-12 h-12 mb-4' },
      h('span', { className: 'absolute inset-0 rounded-full border-4 border-paper-edge' }),
      h('span', {
        className: 'absolute inset-0 rounded-full border-4 border-ink-900 border-t-transparent animate-spin',
      }),
    ),
    h('p', { className: 'text-sm font-medium text-ink-900' }, T.curate.spinnerTitle),
    h(
      'p',
      { className: 'text-xs text-ink-500 mt-1 max-w-xs leading-relaxed' },
      T.curate.spinnerHint,
      h('br'),
      T.curate.timeHint,
    ),
  )
}

function IdleSessionState({ videoPlaying }: { videoPlaying: boolean | null }) {
  const T = useT()
  let dotColor = 'bg-ink-300'
  let label: string = T.capture.waiting
  let body: ReturnType<typeof h> | null = null
  let pulsing = false
  if (videoPlaying === false) {
    dotColor = 'bg-ink-500'
    label = T.capture.pausedTitle
    body = T.capture.pausedHint as unknown as ReturnType<typeof h>
  } else if (videoPlaying === true) {
    dotColor = 'bg-ok-green'
    pulsing = true
    label = T.capture.recordingTitle
    const lines = T.capture.recordingHint.split('\n')
    body = h(
      Fragment,
      null,
      ...lines.map((line, i) =>
        h(
          'span',
          { key: i },
          line,
          i < lines.length - 1 ? h('br') : null,
        ),
      ),
    )
  }
  return h(
    'div',
    { className: 'flex-1 flex flex-col items-center justify-center px-6 py-10 text-center' },
    h(
      'div',
      { className: 'flex items-center gap-2 mb-3' },
      h('span', {
        className: `inline-block w-1.5 h-1.5 rounded-full ${dotColor} ${pulsing ? 'animate-pulse' : ''}`,
        'aria-hidden': true,
      }),
      h(
        'span',
        { className: 'text-[10px] font-mono uppercase tracking-eyebrow text-ink-500' },
        label,
      ),
    ),
    body
      ? h('p', { className: 'text-xs text-ink-500 max-w-xs leading-relaxed' }, body)
      : null,
  )
}

function PostSessionHint() {
  const T = useT()
  return h(
    'div',
    {
      className:
        'mx-3 mb-1 bg-terra-tint border border-terra-soft text-ink-900 text-xs px-3 py-2 rounded-[10px] leading-relaxed',
    },
    h('span', { className: 'font-semibold text-terra-700' }, T.postSession.title),
    ' ',
    T.postSession.hint,
  )
}

const noop = () => undefined

export const recordingFixtures: GalleryFixture[] = [
  {
    id: 'session-controls-playing',
    category: CATEGORY,
    label: 'SessionControls — capturing, playing',
    note: 'Single pause-as-curate-trigger button.',
    render: () =>
      h(SessionControls, {
        isCapturing: true,
        videoPlaying: true,
        onSetPlay: noop,
        onEnd: noop,
      }),
  },
  {
    id: 'session-controls-paused',
    category: CATEGORY,
    label: 'SessionControls — capturing, paused',
    note: 'Resume + destructive end split into two buttons.',
    render: () =>
      h(SessionControls, {
        isCapturing: true,
        videoPlaying: false,
        onSetPlay: noop,
        onEnd: noop,
      }),
  },
  {
    id: 'session-controls-quota-exhausted-free',
    category: CATEGORY,
    label: 'SessionControls — quota exhausted (free)',
    note: 'Gray inactive card with upgrade affordance.',
    render: () =>
      h(SessionControls, {
        isCapturing: true,
        videoPlaying: true,
        onSetPlay: noop,
        onEnd: noop,
        quotaExhausted: true,
        userPlan: 'free',
        onUpgrade: noop,
      }),
  },
  {
    id: 'session-controls-quota-exhausted-pro',
    category: CATEGORY,
    label: 'SessionControls — quota exhausted (pro)',
    note: 'Info-only variant, no clickable CTA.',
    render: () =>
      h(SessionControls, {
        isCapturing: true,
        videoPlaying: true,
        onSetPlay: noop,
        onEnd: noop,
        quotaExhausted: true,
        userPlan: 'pro',
      }),
  },
  {
    id: 'session-controls-not-capturing',
    category: CATEGORY,
    label: 'SessionControls — not capturing',
    note: 'Renders nothing (null). Validates the no-render branch.',
    render: () =>
      h(SessionControls, {
        isCapturing: false,
        videoPlaying: null,
        onSetPlay: noop,
        onEnd: noop,
      }),
  },
  {
    id: 'idle-session-state-waiting',
    category: CATEGORY,
    label: 'IdleSessionState — waiting (videoPlaying=null)',
    note: 'Re-creates inline JSX from src/side-panel/App.tsx.',
    height: 240,
    render: () => h(IdleSessionState, { videoPlaying: null }),
  },
  {
    id: 'idle-session-state-paused',
    category: CATEGORY,
    label: 'IdleSessionState — paused (videoPlaying=false)',
    note: 'Re-creates inline JSX from src/side-panel/App.tsx.',
    height: 240,
    render: () => h(IdleSessionState, { videoPlaying: false }),
  },
  {
    id: 'idle-session-state-recording',
    category: CATEGORY,
    label: 'IdleSessionState — recording (videoPlaying=true)',
    note: 'Re-creates inline JSX from src/side-panel/App.tsx.',
    height: 240,
    render: () => h(IdleSessionState, { videoPlaying: true }),
  },
  {
    id: 'curating-state',
    category: CATEGORY,
    label: 'CuratingState — first-curate spinner',
    note: 'Re-creates inline JSX from src/side-panel/App.tsx.',
    height: 240,
    render: () => h(CuratingState),
  },
  {
    id: 'post-session-hint',
    category: CATEGORY,
    label: 'PostSessionHint — terra-tinted footer',
    note: 'Re-creates inline JSX from src/side-panel/App.tsx.',
    render: () => h(PostSessionHint),
  },
]

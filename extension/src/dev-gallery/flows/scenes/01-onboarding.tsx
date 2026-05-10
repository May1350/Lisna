import { useT } from '../../../shared/i18n'
import { ConsentModal } from '../../../side-panel/components/ConsentModal'
import { LoginScreen } from '../../../side-panel/components/LoginScreen'
import { AppShell } from './_shared'
import { FREE_USER } from '../../fixtures/_mock-data'
import type { FlowGraph } from '../types'

// =============================================================================
// Onboarding flow — first-time user from install to authenticated empty state.
// Surface: embed (in-page modal). The same components are used in side-panel
// surface, but most users hit the embed first by visiting a YouTube lecture.
// =============================================================================

const noop = () => undefined

// Static recreations for LoginScreen variants (loading / error). The real
// component's `loading` / `err` are internal useState — to drive them
// without modifying production code we mirror the JSX. Keep in sync with
// src/side-panel/components/LoginScreen.tsx.
function GoogleGlyphInline() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.79 2.71v2.26h2.9c1.7-1.57 2.69-3.88 2.69-6.62z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.9-2.26c-.81.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.95 10.7c-.18-.54-.28-1.12-.28-1.7s.1-1.16.28-1.7V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l2.99-2.34z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.96L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"/>
    </svg>
  )
}

function LoginScreenStatic({ variant }: { variant: 'loading' | 'error' }) {
  const T = useT()
  const taglineLines = T.login.tagline.split('\n')
  const privacyLines = T.login.privacyNote.split('\n')
  const logoUrl = chrome.runtime.getURL('public/icons/icon128.png')
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 py-10 text-center bg-gradient-to-b from-paper-100 to-paper-200">
      <img src={logoUrl} alt={T.login.title} width={56} height={56} className="w-14 h-14 mb-5 rounded-2xl shadow-lg" />
      <h1 className="text-xl font-bold text-ink-900 mb-1.5">{T.login.title}</h1>
      <p className="text-sm text-ink-700 mb-7 leading-relaxed max-w-[260px]">
        {taglineLines.map((line, i) => (
          <span key={i}>
            {line}
            {i < taglineLines.length - 1 && <br />}
          </span>
        ))}
      </p>
      <button
        type="button"
        disabled={variant === 'loading'}
        aria-label={T.login.button}
        className="group inline-flex items-center justify-center gap-3 px-5 py-2.5 bg-paper-100 border border-paper-edge rounded-full text-sm font-medium text-ink-900 shadow-sm hover:shadow-md hover:border-ink-300 disabled:opacity-50 transition-all"
      >
        {variant === 'loading' ? (
          <>
            <span className="inline-block w-4 h-4 border-2 border-paper-edge border-t-ink-700 rounded-full animate-spin" />
            <span>{T.login.busy}</span>
          </>
        ) : (
          <>
            <GoogleGlyphInline />
            <span>{T.login.button}</span>
          </>
        )}
      </button>
      {variant === 'error' && (
        <p className="text-warn-red text-xs mt-4 max-w-[280px] leading-relaxed">
          {T.login.failPrefix}network error — please retry
        </p>
      )}
      <p className="text-[10px] text-ink-300 mt-8 leading-relaxed max-w-[260px]">
        {privacyLines.map((line, i) => (
          <span key={i}>
            {line}
            {i < privacyLines.length - 1 && <br />}
          </span>
        ))}
      </p>
    </div>
  )
}

// IdleSessionState — recreated from src/side-panel/App.tsx (not exported).
// Keep in sync. Reused by Recording flow too — see scenes/02-recording.tsx.
function IdleStateMirror({ videoPlaying }: { videoPlaying: boolean | null }) {
  const T = useT()
  let dotColor = 'bg-ink-300'
  let label = T.capture.waiting
  let body: React.ReactNode = null
  let pulsing = false
  if (videoPlaying === false) {
    dotColor = 'bg-ink-500'
    label = T.capture.pausedTitle
    body = T.capture.pausedHint
  } else if (videoPlaying === true) {
    dotColor = 'bg-ok-green'
    pulsing = true
    label = T.capture.recordingTitle
    body = T.capture.recordingHint.split('\n').map((line, i) => (
      <span key={i}>
        {line}
        {i < T.capture.recordingHint.split('\n').length - 1 && <br />}
      </span>
    ))
  }
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex items-center gap-2 mb-3">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor} ${pulsing ? 'animate-pulse' : ''}`} aria-hidden />
        <span className="text-[10px] font-mono uppercase tracking-eyebrow text-ink-500">{label}</span>
      </div>
      {body && (
        <p className="text-xs text-ink-500 max-w-xs leading-relaxed">{body}</p>
      )}
    </div>
  )
}

// =============================================================================

// Layout intent (embed surface = 380×640):
//   y=0   happy path: consent → login-idle → login-loading → authed-empty
//   y=720 branch:                              login-error
// This keeps the OAuth-ok edge (login-loading → authed-empty) as a
// straight horizontal line instead of routing it across login-error.
const HAPPY_Y = 0
const BRANCH_Y = 720
const COL = 480 // surface width (380) + horizontal margin (100)

export const onboardingFlow: FlowGraph = {
  id: 'onboarding',
  label: 'Onboarding',
  caption: 'First install → authenticated empty session',
  surface: 'embed',
  positions: {
    'consent':       { x: 0 * COL, y: HAPPY_Y },
    'login-idle':    { x: 1 * COL, y: HAPPY_Y },
    'login-loading': { x: 2 * COL, y: HAPPY_Y },
    'authed-empty':  { x: 3 * COL, y: HAPPY_Y },
    'login-error':   { x: 2 * COL, y: BRANCH_Y },
  },
  scenes: [
    {
      id: 'consent',
      label: 'ConsentModal — first paint',
      caption: 'User opens a YouTube lecture for the first time. The in-page modal mounts, hits the consent gate before anything else.',
      tags: ['modal', 'overlay'],
      render: () => (
        // The ConsentModal is fixed inset-0; with our Frame containing
        // block, it darkens the modal-frame area and shows the card.
        <div className="flex-1 relative bg-paper-200">
          <ConsentModal onAccept={noop} />
        </div>
      ),
    },
    {
      id: 'login-idle',
      label: 'LoginScreen — idle',
      caption: 'After consent, the user must sign in with Google before the modal will record anything.',
      render: () => (
        <LoginScreen
          currentUrl="https://www.youtube.com/watch?v=dev"
          onSuccess={noop}
        />
      ),
    },
    {
      id: 'login-loading',
      label: 'LoginScreen — signing in',
      caption: 'After clicking the Google button. The button shows a spinner + "処理中…" until OAuth completes.',
      tags: ['transient'],
      render: () => <LoginScreenStatic variant="loading" />,
    },
    {
      id: 'login-error',
      label: 'LoginScreen — error',
      caption: 'OAuth failed (network drop, user cancelled, popup blocked). Inline message under the button; user retries.',
      tags: ['error'],
      render: () => <LoginScreenStatic variant="error" />,
    },
    {
      id: 'authed-empty',
      label: 'Authenticated · waiting for video',
      caption: 'Sign-in succeeded. PanelHeader shows the user; main body is the IdleSessionState waiting for a video play.',
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={4 * 3600 + 12 * 60}>
          <IdleStateMirror videoPlaying={null} />
        </AppShell>
      ),
    },
  ],
  edges: [
    { from: 'consent', to: 'login-idle', label: 'agree' },
    { from: 'login-idle', to: 'login-loading', label: 'click sign in' },
    { from: 'login-loading', to: 'authed-empty', label: 'OAuth ok' },
    // Vertical branch: login-loading drops down to login-error on
    // failure; user retries from error back up to loading. Bottom/Top
    // handles route this pair as a clean lens shape next to the
    // happy-path horizontal axis.
    { from: 'login-loading', to: 'login-error', label: 'OAuth fail', sourceHandle: 'bottom', targetHandle: 'top' },
    { from: 'login-error', to: 'login-loading', label: 'retry', sourceHandle: 'top', targetHandle: 'bottom' },
  ],
  boundaryLinks: [
    { fromScene: 'authed-empty', toFlowId: 'recording', toSceneId: 'empty-waiting', label: 'play video', direction: 'out' },
  ],
}

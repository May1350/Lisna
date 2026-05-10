import { useEffect } from 'react'
import { LiveTranscript } from '../../../side-panel/components/LiveTranscript'
import { OutlineView } from '../../../side-panel/components/OutlineView'
import { ErrorBoundary } from '../../../side-panel/components/ErrorBoundary'
import { ErrorToast } from '../../../side-panel/components/ErrorToast'
import { reportError } from '../../../shared/errors'
import { useT } from '../../../shared/i18n'
import type { Translations } from '../../../shared/i18n'
import { AppShell } from './_shared'
import { FREE_USER, OUTLINE_SHORT_2, TRANSCRIPT_SHORT } from '../../fixtures/_mock-data'
import type { FlowGraph } from '../types'

// =============================================================================
// Errors flow — curate failure → banner → retry; alt branches for upstream
// LLM down, transient network drop (toast), and render-time crash
// (ErrorBoundary takeover). All recoveries converge on a normal recording
// state at the centre, which acts as the recovery hub.
// Surface: embed (in-page modal).
// =============================================================================

const noop = () => undefined

// Static recreation of the inline curateError banner from
// src/side-panel/App.tsx (~line 1080). Keep in sync with that JSX —
// this mirrors the className stack and the optional Report CTA. Only
// reasons in ERROR_REPORTABLE get the report button (matches App.tsx).
const ERROR_REPORTABLE = new Set<string>(['curator_failed', 'timeout_no_signal', 'request_failed'])

function CurateErrorBanner({ reason }: { reason: keyof Translations['curateError'] }) {
  const T = useT()
  const known = T.curateError as Record<string, string>
  const text = known[reason as string] ?? T.curateError.fallback
  const reportable = ERROR_REPORTABLE.has(reason as string)
  return (
    <div className="mx-3 mb-1 bg-warn-red/5 border border-warn-red/30 text-warn-red text-xs px-3 py-2 rounded flex items-start gap-2">
      <span className="flex-1">{text}</span>
      {reportable && (
        <button
          type="button"
          onClick={noop}
          className="shrink-0 text-[11px] font-medium text-warn-red hover:text-warn-red underline whitespace-nowrap"
        >
          {T.curateError.reportButton}
        </button>
      )}
    </div>
  )
}

// Severity-styled banner for the upstream-LLM scene. The real App.tsx
// banner uses a single style for every reason, but the spec wants a
// visually distinct "deeper red" variant to make the alt branch read
// at a glance — solid red border instead of warn-red/30.
function UpstreamDownBanner() {
  const T = useT()
  const text = (T.curateError as Record<string, string>).service_unavailable
    ?? T.curateError.fallback
  return (
    <div className="mx-3 mb-1 bg-warn-red/10 border border-warn-red text-warn-red text-xs px-3 py-2 rounded flex items-start gap-2">
      <span className="flex-1 font-medium">{text}</span>
    </div>
  )
}

// Wrapper for the network-drop scene: publishes a warning toast on
// mount, then renders the real ErrorToast component. Mirrors the
// ToastDemo pattern from fixtures/07-errors.ts.
function NetworkToastDemo() {
  useEffect(() => {
    void reportError(new Error('ネットワーク接続が一時的に切断されました'), {
      severity: 'warning',
      context: 'gallery:flow-network-drop',
    })
  }, [])
  return <ErrorToast />
}

// Boom: throws on every render to trigger the ErrorBoundary fallback.
// Inline (not exported) so the scene is self-contained.
function Boom(): never {
  throw new Error('Demo: simulated render failure (Boom component)')
}

// =============================================================================

// Layout intent (embed surface = 380×640):
//   resumed sits in the centre as the recovery hub. The four error
//   scenes orbit it — curate-error (left), error-boundary (right),
//   network-toast (top-centre), upstream-llm (top-left). Recovery
//   edges fan in toward the centre; the curate-error → upstream-llm
//   "worsens" edge is a short vertical hop on the left column.
const COL = 480
const ROW = 800

export const errorsFlow: FlowGraph = {
  id: 'errors',
  label: 'Errors',
  caption:
    'Recording → curate fails → banner → user retries → resumed; alt: upstream LLM down / network drop / render crash',
  surface: 'embed',
  positions: {
    'resumed':        { x: COL * 1, y: ROW * 1 },
    'curate-error':   { x: 0,       y: ROW * 1 },
    'upstream-llm':   { x: 0,       y: 0       },
    'network-toast':  { x: COL * 1, y: 0       },
    'error-boundary': { x: COL * 2, y: ROW * 1 },
  },
  scenes: [
    {
      id: 'curate-error',
      label: 'Curate failed — banner',
      caption:
        'Curator returned an error. Recording continues; the banner sits above the outline and offers a Report CTA for whitelisted reasons.',
      tags: ['error'],
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={4 * 3600 + 12 * 60}>
          <CurateErrorBanner reason="curator_failed" />
          <LiveTranscript items={TRANSCRIPT_SHORT} videoPlaying={true} />
          <OutlineView outline={OUTLINE_SHORT_2} onJump={noop} />
        </AppShell>
      ),
    },
    {
      id: 'upstream-llm',
      label: 'Upstream LLM down',
      caption:
        'Backend classified the failure as an upstream provider issue (Anthropic / OpenAI / Groq). Operator already alerted; user-side copy reassures rather than asks for action.',
      tags: ['error'],
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={4 * 3600 + 12 * 60}>
          <UpstreamDownBanner />
          <LiveTranscript items={TRANSCRIPT_SHORT} videoPlaying={true} />
          <OutlineView outline={OUTLINE_SHORT_2} onJump={noop} />
        </AppShell>
      ),
    },
    {
      id: 'network-toast',
      label: 'Network drop — toast',
      caption:
        'Transient network drop. Recording state is unchanged; a warning toast appears at the bottom and auto-dismisses after 4 s.',
      tags: ['transient'],
      render: () => (
        <div className="relative h-full">
          <AppShell user={FREE_USER} isEmbed liveRemainingSecs={4 * 3600 + 12 * 60}>
            <LiveTranscript items={TRANSCRIPT_SHORT} videoPlaying={true} />
            <OutlineView outline={OUTLINE_SHORT_2} onJump={noop} />
          </AppShell>
          <NetworkToastDemo />
        </div>
      ),
    },
    {
      id: 'error-boundary',
      label: 'ErrorBoundary — render crash',
      caption:
        'A descendant threw during render. The boundary catches it and replaces the whole modal with a recovery card offering reload.',
      tags: ['error', 'modal'],
      render: () => (
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      ),
    },
    {
      id: 'resumed',
      label: 'Recovered — normal recording',
      caption:
        'Recovered: error cleared, normal recording resumes.',
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={4 * 3600 + 12 * 60}>
          <LiveTranscript items={TRANSCRIPT_SHORT} videoPlaying={true} />
          <OutlineView outline={OUTLINE_SHORT_2} onJump={noop} />
        </AppShell>
      ),
    },
  ],
  edges: [
    // Hub-spoke recoveries: every error has a path back to `resumed`.
    // curate-error sits left of resumed → straight horizontal arrow.
    { from: 'curate-error', to: 'resumed', label: 'retry ok' },
    // Vertical alt branch: when retry doesn't help and the failure is
    // upstream rather than transient, the banner copy "worsens" into
    // the service_unavailable variant.
    {
      from: 'curate-error',
      to: 'upstream-llm',
      label: 'worsens',
      dashed: true,
      sourceHandle: 'top',
      targetHandle: 'bottom',
    },
    // upstream-llm sits top-left; recovery fans diagonally down-right
    // toward the central hub. Default right→left handles route the
    // edge cleanly across the diagonal.
    { from: 'upstream-llm', to: 'resumed', label: 'recovered' },
    // network-toast sits directly above resumed → vertical drop.
    {
      from: 'network-toast',
      to: 'resumed',
      label: 'reconnect',
      sourceHandle: 'bottom',
      targetHandle: 'top',
    },
    // error-boundary sits right of resumed → reverse horizontal.
    {
      from: 'error-boundary',
      to: 'resumed',
      label: 'reload',
      sourceHandle: 'left',
      targetHandle: 'right',
    },
  ],
  boundaryLinks: [
    // Recording's transcript-streaming state is where curate kicks off,
    // so a curate failure originates there; once resumed, control
    // hands back to the same streaming state.
    {
      fromScene: 'curate-error',
      toFlowId: 'recording',
      toSceneId: 'transcript-streaming',
      label: 'curate fails',
      direction: 'in',
    },
    {
      fromScene: 'resumed',
      toFlowId: 'recording',
      toSceneId: 'transcript-streaming',
      label: 'recovery',
      direction: 'out',
    },
  ],
}

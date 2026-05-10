import { useEffect } from 'react'
import { useT } from '../../../shared/i18n'
import { LiveTranscript } from '../../../side-panel/components/LiveTranscript'
import { OutlineView } from '../../../side-panel/components/OutlineView'
import { SessionControls } from '../../../side-panel/components/SessionControls'
import { AppShell } from './_shared'
import {
  FREE_USER,
  OUTLINE_SHORT_2,
  OUTLINE_LONG_8,
  TRANSCRIPT_SHORT,
  TRANSCRIPT_LONG,
} from '../../fixtures/_mock-data'
import type { FlowGraph } from '../types'

// =============================================================================
// Recording flow — authenticated user starts a video, transcript streams,
// the first outline lands, then user pauses or ends the session. Surface:
// embed (in-page modal). Mirrors the wiring in src/side-panel/App.tsx
// around the IdleSessionState / CuratingState / PostSessionHint /
// SessionControls / LiveTranscript / OutlineView block — keep in sync.
// =============================================================================

const noop = () => undefined

// IdleSessionState — recreated from src/side-panel/App.tsx (not exported).
// Same body as the onboarding flow's IdleStateMirror; duplicated here on
// purpose so each scene file is self-contained. Keep in sync with
// src/side-panel/App.tsx::IdleSessionState.
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
    const lines = T.capture.recordingHint.split('\n')
    body = lines.map((line, i) => (
      <span key={i}>
        {line}
        {i < lines.length - 1 && <br />}
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

// CuratingState — recreated from src/side-panel/App.tsx (not exported).
// Big-square spinner shown when curate has been triggered but no outline
// exists yet. Keep in sync with src/side-panel/App.tsx::CuratingState.
function CuratingStateMirror() {
  const T = useT()
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="relative w-12 h-12 mb-4">
        <span className="absolute inset-0 rounded-full border-4 border-paper-edge" />
        <span className="absolute inset-0 rounded-full border-4 border-ink-900 border-t-transparent animate-spin" />
      </div>
      <p className="text-sm font-medium text-ink-900">{T.curate.spinnerTitle}</p>
      <p className="text-xs text-ink-500 mt-1 max-w-xs leading-relaxed">
        {T.curate.spinnerHint}<br />
        {T.curate.timeHint}
      </p>
    </div>
  )
}

// PostSessionHint — recreated from src/side-panel/App.tsx (not exported).
// Footer hint that nudges the user toward regenerate / export after the
// capture has wrapped. Keep in sync with src/side-panel/App.tsx::PostSessionHint.
function PostSessionHintMirror() {
  const T = useT()
  return (
    <div className="mx-3 mb-1 bg-terra-tint border border-terra-soft text-ink-900 text-xs px-3 py-2 rounded-[10px] leading-relaxed">
      <span className="font-semibold text-terra-700">{T.postSession.title}</span>{' '}
      {T.postSession.hint}
    </div>
  )
}

// End-of-session confirmation overlay — recreated from
// src/side-panel/components/SessionControls.tsx (the `confirmingEnd` branch
// is internal useState, so we can't drive it via props). Mirrors the JSX
// 1:1 so the visual matches what the user actually sees mid-flow. Keep in
// sync with src/side-panel/components/SessionControls.tsx.
function EndConfirmMirror() {
  const T = useT()
  const bodyLines = T.controls.confirm.body.split('\n')
  return (
    <div className="rounded-[10px] border border-paper-edge bg-paper-100 p-3 text-sm shadow-card">
      <p className="font-medium text-ink-900 mb-1">{T.controls.confirm.title}</p>
      <p className="text-xs text-ink-700 leading-relaxed mb-3">
        {bodyLines.map((line, i) => (
          <span key={i}>
            {line}
            {i < bodyLines.length - 1 && <br />}
          </span>
        ))}
      </p>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          className="px-3 py-1.5 text-xs rounded-md border border-paper-edge bg-paper-100 text-ink-700 hover:bg-paper-200 transition-colors"
        >
          {T.controls.confirm.cancel}
        </button>
        <button
          type="button"
          className="px-3 py-1.5 text-xs rounded-md bg-warn-red text-paper-100 hover:opacity-90 transition-opacity"
        >
          {T.controls.confirm.confirm}
        </button>
      </div>
    </div>
  )
}

// Tiny wrapper that flips the captions-collapsed storage flag on mount —
// the LiveTranscript reads it from chrome.storage in a useEffect, so we
// seed it before mount via the gallery shim so the panel renders into
// its collapsed visual right away. Mirrors the pattern in
// src/dev-gallery/fixtures/03-transcript.ts.
function CollapseCaptionsSeed() {
  useEffect(() => {
    const setStorage = (globalThis as Record<string, unknown>).__galleryStorage as
      | ((seed: Record<string, unknown>) => void)
      | undefined
    setStorage?.({ 'sh.captionsCollapsed': true })
  }, [])
  return null
}

// Live remaining seconds — realistic values for the PanelHeader pill.
const LIVE_OK = 4 * 3600 + 12 * 60 // ~4h12m — cool/neutral
const LIVE_AMBER = 60 * 5          // 5 min — amber
// (red threshold not currently exercised by these scenes)

export const recordingFlow: FlowGraph = {
  id: 'recording',
  label: 'Recording lifecycle',
  caption: 'Authenticated user starts a video → transcript streams → first outline arrives → user pauses or ends',
  surface: 'embed',
  scenes: [
    {
      id: 'empty-waiting',
      label: 'Authenticated · waiting for video',
      caption: 'Modal mounted, waiting for user to play the video.',
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={LIVE_OK}>
          <IdleStateMirror videoPlaying={null} />
        </AppShell>
      ),
    },
    {
      id: 'first-chunk',
      label: 'First seconds of recording',
      caption: 'First few seconds of recording — captions placeholder shown until first chunk arrives.',
      tags: ['transient'],
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={LIVE_OK}>
          <IdleStateMirror videoPlaying={true} />
          <LiveTranscript items={[]} videoPlaying={true} />
          <div className="px-3 pb-3 pt-2">
            <SessionControls
              isCapturing
              videoPlaying={true}
              onSetPlay={noop}
              onEnd={noop}
            />
          </div>
        </AppShell>
      ),
    },
    {
      id: 'transcript-streaming',
      label: 'Audio streaming · first curate pending',
      caption: 'Audio chunks streaming; first curate is generating the initial outline.',
      tags: ['transient'],
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={LIVE_OK}>
          {/* curating && !hasContent branch in App.tsx → CuratingState
              replaces the idle/outline body. LiveTranscript stays
              mounted underneath so the user sees text streaming
              while the first outline generation runs. */}
          <CuratingStateMirror />
          <LiveTranscript items={TRANSCRIPT_LONG.slice(0, 5)} videoPlaying={true} />
          <div className="px-3 pb-3 pt-2">
            <SessionControls
              isCapturing
              videoPlaying={true}
              onSetPlay={noop}
              onEnd={noop}
            />
          </div>
        </AppShell>
      ),
    },
    {
      id: 'outline-arrives',
      label: 'First outline rendered',
      caption: 'First outline rendered — user can now jump-to-time + see structure.',
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={LIVE_OK}>
          <CollapseCaptionsSeed />
          <OutlineView outline={OUTLINE_SHORT_2} onJump={noop} outlineUpdatedAt={Date.now()} />
          <LiveTranscript items={TRANSCRIPT_SHORT} videoPlaying={true} />
          <div className="px-3 pb-3 pt-2">
            <SessionControls
              isCapturing
              videoPlaying={true}
              onSetPlay={noop}
              onEnd={noop}
            />
          </div>
        </AppShell>
      ),
    },
    {
      id: 'paused',
      label: 'Video paused',
      caption: 'Video paused mid-session. Outline preserved; user can resume or end.',
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={LIVE_AMBER}>
          <IdleStateMirror videoPlaying={false} />
          <OutlineView outline={OUTLINE_LONG_8} onJump={noop} outlineUpdatedAt={Date.now()} />
          <div className="px-3 pb-3 pt-2">
            <SessionControls
              isCapturing
              videoPlaying={false}
              onSetPlay={noop}
              onEnd={noop}
            />
          </div>
        </AppShell>
      ),
    },
    {
      id: 'end-confirm',
      label: 'End-of-session confirm',
      caption: 'End-of-session confirm dialog. Cancel returns to paused; Confirm wraps up.',
      tags: ['modal'],
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={LIVE_AMBER}>
          <OutlineView outline={OUTLINE_LONG_8} onJump={noop} outlineUpdatedAt={Date.now()} />
          <div className="px-3 pb-3 pt-2">
            <EndConfirmMirror />
          </div>
        </AppShell>
      ),
    },
    {
      id: 'post-session',
      label: 'Session ended · hint shown',
      caption: 'After session ends — hint reminds the user how to regenerate or export.',
      render: () => (
        <AppShell user={FREE_USER} isEmbed liveRemainingSecs={null}>
          {/* App.tsx: sessionId && !isCapturing && hasContent → render
              PostSessionHint above the (now-hidden) SessionControls.
              SessionControls returns null when isCapturing=false, so
              we omit it entirely here. */}
          <OutlineView outline={OUTLINE_LONG_8} onJump={noop} outlineUpdatedAt={Date.now()} />
          <PostSessionHintMirror />
        </AppShell>
      ),
    },
  ],
  edges: [
    { from: 'empty-waiting', to: 'first-chunk', label: 'play' },
    { from: 'first-chunk', to: 'transcript-streaming', label: 'audio in' },
    { from: 'transcript-streaming', to: 'outline-arrives', label: 'curate ok' },
    { from: 'outline-arrives', to: 'paused', label: 'pause' },
    // Bidirectional pair (outline-arrives ↔ paused) on a HORIZONTAL
    // chain. Back-edge attaches LEFT→RIGHT so the arrow flows from
    // paused's left edge back to outline-arrives's right edge. The
    // CurvedEdge's right-perpendicular logic then offsets this leg
    // BELOW the chord while the forward edge sits ABOVE — clean
    // parallel pair, no diagonal-through-the-node bug.
    { from: 'paused', to: 'outline-arrives', label: 'resume', sourceHandle: 'left', targetHandle: 'right' },
    { from: 'paused', to: 'end-confirm', label: 'end' },
    // Bidirectional pair (paused ↔ end-confirm). Same horizontal-chain
    // back-edge pattern.
    { from: 'end-confirm', to: 'paused', label: 'cancel', sourceHandle: 'left', targetHandle: 'right' },
    { from: 'end-confirm', to: 'post-session', label: 'confirm' },
  ],
  boundaryLinks: [
    // Outbound to (Phase 2) quota flow. Target flow not registered yet —
    // FlowView only lists registered flows, so an unregistered toFlowId
    // renders the sticker but won't break navigation.
    { fromScene: 'paused', toFlowId: 'quota', toSceneId: 'banner-95', label: 'quota near limit', direction: 'out' },
    // Outbound to (Phase 2) errors flow on curate failure.
    { fromScene: 'transcript-streaming', toFlowId: 'errors', toSceneId: 'curate-error', label: 'curate fails', direction: 'out' },
  ],
}

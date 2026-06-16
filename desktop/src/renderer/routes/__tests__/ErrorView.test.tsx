/**
 * Tests for ErrorView.
 *
 * Static structural assertions via react-dom/server — vitest config has no DOM
 * env. Click→callback wiring (onRetry / onDiscard / restartApp) is verified via
 * the live app per CLAUDE.md UI guidance.
 *
 * F1 (retry-from-transcript, 2026-06-11): a transient error must offer TWO
 * actions — "ノートを作り直す" (re-finalize the PRESERVED transcript; main keeps
 * `current` on finalize failure per ipc.ts:354) and "新しい録音" (discard +
 * re-record). The old single "もう一度試す" button wiped the transcript by routing
 * back to an empty recording — the exact "字幕が全部消える" pain.
 *
 * STT Phase 2a (Group D): the transcript is preserved SERVER-SIDE (the
 * orchestrator caches it at finalize), so ErrorView no longer renders it
 * inline and no longer takes a `segments` prop — retry re-finalizes against
 * the server-side transcript. The reassurance line is unconditional on the
 * transient branch.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorView } from '../ErrorView';

describe('ErrorView', () => {
  it('transient error: offers BOTH re-generate and new-recording actions', () => {
    const html = renderToStaticMarkup(
      <ErrorView message="CHUNK_FAILED:0" onRetry={() => {}} onDiscard={() => {}} />,
    );
    expect(html).toContain('data-testid="error-retry-note"');
    expect(html).toContain('ノートを作り直す');
    expect(html).toContain('data-testid="error-new-recording"');
    expect(html).toContain('新しい録音');
  });

  it('transient error: does NOT show the restart button', () => {
    const html = renderToStaticMarkup(
      <ErrorView message="GENERATE_TIMEOUT" onRetry={() => {}} onDiscard={() => {}} />,
    );
    expect(html).not.toContain('data-testid="error-restart"');
  });

  it('transient error: shows the transcript-preserved reassurance', () => {
    const html = renderToStaticMarkup(
      <ErrorView message="CHUNK_FAILED:0" onRetry={() => {}} onDiscard={() => {}} />,
    );
    expect(html).toContain('文字起こしは保持されています');
  });

  it('permanent error: shows ONLY the restart button (sidecar dead → re-finalize impossible)', () => {
    const html = renderToStaticMarkup(
      <ErrorView
        message="SIDECAR_GAVE_UP"
        onRetry={() => {}}
        onDiscard={() => {}}
        permanent
      />,
    );
    expect(html).toContain('data-testid="error-restart"');
    expect(html).toContain('再起動');
    expect(html).not.toContain('data-testid="error-retry-note"');
    expect(html).not.toContain('data-testid="error-new-recording"');
    expect(html).not.toContain('文字起こしは保持されています');
  });
});

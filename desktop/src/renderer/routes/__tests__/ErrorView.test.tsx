/**
 * Tests for ErrorView.
 *
 * Static structural assertions via react-dom/server — vitest config has
 * no DOM env. Interactivity (button clicks) is verified via the live app
 * per CLAUDE.md system-prompt guidance for UI changes.
 *
 * Retry-route fix (2026-06-10): P0-3 preserves the SessionOrchestrator on
 * finalize failure, but the old onRetry routed to a fresh recording view
 * whose Start hit SESSION_ACTIVE — the preserved transcript was
 * unreachable. ErrorView now exposes TWO routes after a finalize failure:
 *   - もう一度試す (onRetry)   → re-pick family + re-finalize (App routes
 *     to familyPicking when the orchestrator is preserved)
 *   - 破棄して新規録音 (onDiscard) → session/discard + fresh recording
 * onDiscard is optional: App provides it only when the error came from a
 * finalize failure (i.e. main still holds the session).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorView } from '../ErrorView';

const SEGMENTS = [
  { startSec: 0, endSec: 2, text: 'こんにちは' },
  { startSec: 2, endSec: 4, text: 'テストです' },
];

describe('ErrorView', () => {
  it('renders the retry button もう一度試す when not permanent', () => {
    const html = renderToStaticMarkup(
      <ErrorView message="CHUNK_FAILED:0" segments={SEGMENTS} onRetry={() => {}} />,
    );
    expect(html).toContain('もう一度試す');
    expect(html).toContain('data-testid="error-retry"');
  });

  it('renders the discard button when onDiscard is provided (finalize-failure route)', () => {
    const html = renderToStaticMarkup(
      <ErrorView
        message="CHUNK_FAILED:0"
        segments={SEGMENTS}
        onRetry={() => {}}
        onDiscard={() => {}}
      />,
    );
    expect(html).toContain('破棄して新規録音');
    expect(html).toContain('data-testid="error-discard"');
    // Both routes visible together — retry must not be replaced.
    expect(html).toContain('data-testid="error-retry"');
  });

  it('omits the discard button when onDiscard is absent (crash / start-failure route)', () => {
    const html = renderToStaticMarkup(
      <ErrorView message="SIDECAR_DOWN" segments={SEGMENTS} onRetry={() => {}} />,
    );
    expect(html).not.toContain('data-testid="error-discard"');
  });

  it('permanent renders restart only — no retry, no discard even if onDiscard provided', () => {
    const html = renderToStaticMarkup(
      <ErrorView
        message="SIDECAR_GAVE_UP"
        segments={SEGMENTS}
        onRetry={() => {}}
        onDiscard={() => {}}
        permanent
      />,
    );
    expect(html).toContain('Lisna を再起動');
    expect(html).not.toContain('data-testid="error-retry"');
    expect(html).not.toContain('data-testid="error-discard"');
  });

  it('renders preserved transcript segments', () => {
    const html = renderToStaticMarkup(
      <ErrorView message="CHUNK_FAILED:0" segments={SEGMENTS} onRetry={() => {}} />,
    );
    expect(html).toContain('こんにちは');
    expect(html).toContain('2 個のセグメント');
  });
});

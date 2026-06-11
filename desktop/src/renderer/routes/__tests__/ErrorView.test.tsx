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
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorView } from '../ErrorView';
import type { TranscriptSegment } from '@shared/types';

const SEGMENTS: TranscriptSegment[] = [
  { startSec: 0, endSec: 2, text: 'これはテストの文字起こしです', noSpeechProb: 0.01 } as TranscriptSegment,
  { startSec: 2, endSec: 5, text: '二つ目のセグメント', noSpeechProb: 0.01 } as TranscriptSegment,
];

describe('ErrorView', () => {
  it('transient error: offers BOTH re-generate and new-recording actions', () => {
    const html = renderToStaticMarkup(
      <ErrorView message="CHUNK_FAILED:0" segments={SEGMENTS} onRetry={() => {}} onDiscard={() => {}} />,
    );
    expect(html).toContain('data-testid="error-retry-note"');
    expect(html).toContain('ノートを作り直す');
    expect(html).toContain('data-testid="error-new-recording"');
    expect(html).toContain('新しい録音');
  });

  it('transient error: does NOT show the restart button', () => {
    const html = renderToStaticMarkup(
      <ErrorView message="GENERATE_TIMEOUT" segments={SEGMENTS} onRetry={() => {}} onDiscard={() => {}} />,
    );
    expect(html).not.toContain('data-testid="error-restart"');
  });

  it('still displays the preserved transcript so the user sees it is not lost', () => {
    const html = renderToStaticMarkup(
      <ErrorView message="CHUNK_FAILED:0" segments={SEGMENTS} onRetry={() => {}} onDiscard={() => {}} />,
    );
    expect(html).toContain('これはテストの文字起こしです');
    expect(html).toContain('2 個のセグメント');
  });

  it('permanent error: shows ONLY the restart button (sidecar dead → re-finalize impossible)', () => {
    const html = renderToStaticMarkup(
      <ErrorView
        message="SIDECAR_GAVE_UP"
        segments={SEGMENTS}
        onRetry={() => {}}
        onDiscard={() => {}}
        permanent
      />,
    );
    expect(html).toContain('data-testid="error-restart"');
    expect(html).toContain('再起動');
    expect(html).not.toContain('data-testid="error-retry-note"');
    expect(html).not.toContain('data-testid="error-new-recording"');
  });
});

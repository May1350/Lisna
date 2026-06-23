/**
 * Tests for TranscriptView.
 *
 * Static structural assertions via react-dom/server — vitest config has no DOM
 * env (mirrors ErrorView.test.tsx). Click→callback wiring (onNewSession) is
 * verified via the live app per CLAUDE.md UI guidance.
 *
 * STT Phase 2 ("文字起こし" picker choice): the raw whole-WAV transcript is
 * rendered subtitle-style as `[m:ss] text` lines — no LLM note. Pure render
 * from props.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TranscriptSegment } from '@shared/types';
import { TranscriptView } from '../TranscriptView';

const SEGMENTS = [
  { startSec: 5, endSec: 8, text: 'おはようございます' },
  { startSec: 63, endSec: 67, text: '本日の議題について' },
] as TranscriptSegment[];

describe('TranscriptView', () => {
  it('renders one [m:ss] text line per segment', () => {
    const html = renderToStaticMarkup(
      <TranscriptView segments={SEGMENTS} language="ja" onNewSession={() => {}} />,
    );
    // startSec 5 → 0:05, startSec 63 → 1:03
    expect(html).toContain('[0:05]');
    expect(html).toContain('[1:03]');
  });

  it('shows every segment text', () => {
    const html = renderToStaticMarkup(
      <TranscriptView segments={SEGMENTS} language="ja" onNewSession={() => {}} />,
    );
    expect(html).toContain('おはようございます');
    expect(html).toContain('本日の議題について');
  });

  it('renders the 新しい録音 button', () => {
    const html = renderToStaticMarkup(
      <TranscriptView segments={SEGMENTS} language="ja" onNewSession={() => {}} />,
    );
    expect(html).toContain('data-testid="transcript-new-session"');
    expect(html).toContain('新しい録音');
  });

  it('header shows the segment count', () => {
    const html = renderToStaticMarkup(
      <TranscriptView segments={SEGMENTS} language="ja" onNewSession={() => {}} />,
    );
    expect(html).toContain('2 個のセグメント');
  });

  it('header shows the formatted duration when durationSec is passed', () => {
    const html = renderToStaticMarkup(
      <TranscriptView
        segments={SEGMENTS}
        language="ja"
        durationSec={125}
        onNewSession={() => {}}
      />,
    );
    // 125s → 2:05
    expect(html).toContain('2:05');
  });

  it('omits the duration when durationSec is absent', () => {
    const html = renderToStaticMarkup(
      <TranscriptView segments={SEGMENTS} language="ja" onNewSession={() => {}} />,
    );
    expect(html).not.toContain(' · 2:05');
  });
});

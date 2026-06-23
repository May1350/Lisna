/**
 * Tests for NoteRenderProgress. Static SSR assertions per the
 * renderer-side no-DOM-env convention.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoteRenderProgress, formatElapsed } from '../NoteRenderProgress';

describe('NoteRenderProgress', () => {
  it('renders nothing when progress is null', () => {
    const html = renderToStaticMarkup(<NoteRenderProgress progress={null} />);
    expect(html).toBe('');
  });

  it('renders the loading phase with a cold-cache hint', () => {
    const html = renderToStaticMarkup(<NoteRenderProgress progress={{ phase: 'loading' }} />);
    expect(html).toContain('data-testid="progress-loading"');
    expect(html).toContain('モデルを読み込み中');
    expect(html).toContain('30 秒');
  });

  it('renders chunk phase with progress bar and N/total counter', () => {
    const html = renderToStaticMarkup(
      <NoteRenderProgress progress={{ phase: 'chunk', chunkIndex: 2, totalChunks: 5 }} />,
    );
    expect(html).toContain('data-testid="progress-chunk"');
    expect(html).toContain('チャンク 3/5 を生成中');
    // 3/5 = 60%
    expect(html).toMatch(/width:\s*60%/);
  });

  it('falls back gracefully when chunk fields are missing', () => {
    const html = renderToStaticMarkup(
      <NoteRenderProgress progress={{ phase: 'chunk' }} />,
    );
    expect(html).toContain('チャンクを生成中');
    // No bogus N/total counter
    expect(html).not.toMatch(/\d+\/\d+/);
  });

  it('renders the retry counter when attempt ≥ 2', () => {
    const html = renderToStaticMarkup(
      <NoteRenderProgress
        progress={{ phase: 'chunk', chunkIndex: 0, totalChunks: 2, attempt: 2, attemptMax: 6 }}
      />,
    );
    expect(html).toContain('チャンク 1/2 を生成中');
    expect(html).toContain('再試行 2/6');
  });

  it('hides the retry counter on the first attempt', () => {
    const html = renderToStaticMarkup(
      <NoteRenderProgress
        progress={{ phase: 'chunk', chunkIndex: 0, totalChunks: 2, attempt: 1, attemptMax: 6 }}
      />,
    );
    expect(html).not.toContain('再試行');
  });

  it('renders elapsed time from startedAt on the chunk phase', () => {
    // Mid-second offset so test-execution jitter (< 500 ms) cannot flip the
    // floored second; renderToStaticMarkup runs the useState(Date.now)
    // initializer synchronously.
    const html = renderToStaticMarkup(
      <NoteRenderProgress
        progress={{ phase: 'chunk', chunkIndex: 0, totalChunks: 2, startedAt: Date.now() - 272_500 }}
      />,
    );
    expect(html).toContain('経過 4:32');
  });

  it('renders elapsed time on the loading phase too', () => {
    const html = renderToStaticMarkup(
      <NoteRenderProgress progress={{ phase: 'loading', startedAt: Date.now() - 5_500 }} />,
    );
    expect(html).toContain('経過 0:05');
  });

  it('omits the elapsed line when startedAt is absent', () => {
    const html = renderToStaticMarkup(
      <NoteRenderProgress progress={{ phase: 'chunk', chunkIndex: 0, totalChunks: 2 }} />,
    );
    expect(html).not.toContain('経過');
  });

  it('renders merge phase copy', () => {
    const html = renderToStaticMarkup(<NoteRenderProgress progress={{ phase: 'merge' }} />);
    expect(html).toContain('data-testid="progress-merge"');
    expect(html).toContain('マージ中');
  });

  it('renders persist phase copy', () => {
    const html = renderToStaticMarkup(<NoteRenderProgress progress={{ phase: 'persist' }} />);
    expect(html).toContain('data-testid="progress-persist"');
    expect(html).toContain('保存中');
  });

  it('caps the progress bar at 100% on overflow', () => {
    const html = renderToStaticMarkup(
      <NoteRenderProgress progress={{ phase: 'chunk', chunkIndex: 100, totalChunks: 5 }} />,
    );
    expect(html).toMatch(/width:\s*100%/);
  });

  it('renders the transcribing phase with a real percent bar driven by pct', () => {
    const html = renderToStaticMarkup(
      <NoteRenderProgress progress={{ phase: 'transcribing', pct: 42 }} />,
    );
    expect(html).toContain('data-testid="progress-transcribing"');
    expect(html).toContain('文字起こし中');
    expect(html).toContain('42%');
    expect(html).toMatch(/width:\s*42%/);
  });

  it('renders the transcribing phase with NO fake percent before the first pct event', () => {
    const html = renderToStaticMarkup(
      <NoteRenderProgress progress={{ phase: 'transcribing' }} />,
    );
    expect(html).toContain('data-testid="progress-transcribing"');
    expect(html).toContain('文字起こし中');
    // No-fake-progress founder rule: the visible copy must show no percent
    // until a real pct arrives. (The 0% bar `width:0%` is a style, not copy —
    // assert against the <p> label text, not the raw style attributes.)
    const label = html.match(/<p>([^<]*)<\/p>/)?.[1] ?? '';
    expect(label).not.toMatch(/\d+\s*%/);
  });
});

describe('formatElapsed', () => {
  it('formats m:ss under an hour', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(5)).toBe('0:05');
    expect(formatElapsed(62)).toBe('1:02');
    expect(formatElapsed(272)).toBe('4:32');
    expect(formatElapsed(3599)).toBe('59:59');
  });

  it('formats h:mm:ss from one hour', () => {
    expect(formatElapsed(3600)).toBe('1:00:00');
    expect(formatElapsed(3725)).toBe('1:02:05');
  });

  it('clamps negative input to 0:00 (clock skew defense)', () => {
    expect(formatElapsed(-3)).toBe('0:00');
  });
});

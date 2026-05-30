/**
 * Tests for NoteRenderProgress. Static SSR assertions per the
 * renderer-side no-DOM-env convention.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoteRenderProgress } from '../NoteRenderProgress';

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
    expect(html).toContain('チャンク 3 / 5');
    // 3/5 = 60%
    expect(html).toMatch(/width:\s*60%/);
  });

  it('falls back gracefully when chunk fields are missing', () => {
    const html = renderToStaticMarkup(
      <NoteRenderProgress progress={{ phase: 'chunk' }} />,
    );
    expect(html).toContain('チャンクを処理中');
    // No bogus N/total counter
    expect(html).not.toMatch(/\d+ \/ \d+/);
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
});

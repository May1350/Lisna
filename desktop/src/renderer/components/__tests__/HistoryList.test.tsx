/**
 * Static structural tests (renderToStaticMarkup — vitest config has no DOM
 * env; click wiring is verified via the live app per CLAUDE.md UI guidance).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistoryList } from '../HistoryList';
import type { DumpSummary } from '@shared/ipc-protocol';

const ROWS: DumpSummary[] = [
  {
    id: '2026-06-11T01-00-00-000Z',
    recordedAt: '2026-06-11T01:00:00.000Z',
    language: 'ja',
    llmModel: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    segmentCount: 12,
    durationSec: 95,
    family: 'interview',
    ok: false,
  },
  { id: '2026-06-10T01-00-00-000Z', recordedAt: '2026-06-10T01:00:00.000Z', unreadable: true },
];

describe('HistoryList', () => {
  it('renders the quiet empty-state line for an empty list', () => {
    const html = renderToStaticMarkup(<HistoryList dumps={[]} onOpen={() => {}} />);
    expect(html).toContain('まだ履歴がありません');
    expect(html).toContain('history-section');
    expect(html).not.toContain('history-row-');
  });

  it('renders a button row per readable dump with duration + status badge', () => {
    const html = renderToStaticMarkup(<HistoryList dumps={ROWS} onOpen={() => {}} />);
    expect(html).toContain('history-row-2026-06-11T01-00-00-000Z');
    expect(html).toContain('1:35');        // 95s formatted m:ss
    expect(html).toContain('interview');
    expect(html).toContain('失敗');         // ok:false badge
  });

  it('renders unreadable dumps as unselectable text, not buttons', () => {
    const html = renderToStaticMarkup(<HistoryList dumps={ROWS} onOpen={() => {}} />);
    expect(html).toContain('読み込み不可');
    expect(html).not.toContain('history-row-2026-06-10T01-00-00-000Z');
  });
});

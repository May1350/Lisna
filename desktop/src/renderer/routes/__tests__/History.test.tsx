/** Static structural tests for the pure HistoryDetail (container fetch is
 *  live-app-verified, consistent with ErrorView.test.tsx's approach).
 *
 * Task 9 — HistoryDetail's embedded FamilyPickerStep now requires
 * connectorConnected/onOpenConnector and reads localStorage (upsell-
 * dismissal flag) via a lazy useState initializer, so a stub is required
 * before render — mirrors Recording.test.tsx / FamilyPickerStep.test.tsx.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistoryDetail } from '../History';
import type { DumpTranscript } from '@shared/ipc-protocol';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    clear: () => { store = {}; },
  };
})();

beforeEach(() => {
  localStorageMock.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
});

const TRANSCRIPT: DumpTranscript = {
  sessionId: 'live',
  language: 'ja',
  llmModel: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
  segments: [
    { startSec: 0, endSec: 2, text: 'こんにちは', noSpeechProb: 0.01 },
    { startSec: 2, endSec: 5, text: 'テストです', noSpeechProb: 0.01 },
  ] as DumpTranscript['segments'],
};

describe('HistoryDetail', () => {
  it('renders transcript segments, meta line, back button, and the family picker', () => {
    const html = renderToStaticMarkup(
      <HistoryDetail
        id="2026-06-11T01-00-00-000Z"
        transcript={TRANSCRIPT}
        onBack={() => {}}
        onRegenerate={() => {}}
        connectorConnected={false}
        onOpenConnector={() => {}}
      />,
    );
    expect(html).toContain('history-detail');
    expect(html).toContain('history-back');
    expect(html).toContain('こんにちは');
    expect(html).toContain('テストです');
    expect(html).toContain('2件');
    // FamilyPickerStep is embedded for re-pickable family (F1 parity).
    expect(html).toContain('family-picker');
    expect(html).toContain('family-continue');
    // Transcript is editable from History (the correction loop, reachable here too).
    expect(html).toContain('transcript-edit');
  });

  it('threads connectorConnected through to the embedded target picker (Task 9)', () => {
    const html = renderToStaticMarkup(
      <HistoryDetail
        id="2026-06-11T01-00-00-000Z"
        transcript={TRANSCRIPT}
        onBack={() => {}}
        onRegenerate={() => {}}
        connectorConnected
        onOpenConnector={() => {}}
      />,
    );
    expect(html).toContain('data-testid="target-seg"');
  });

  it('shows the Claude upsell banner when not connected (Task 9)', () => {
    const html = renderToStaticMarkup(
      <HistoryDetail
        id="2026-06-11T01-00-00-000Z"
        transcript={TRANSCRIPT}
        onBack={() => {}}
        onRegenerate={() => {}}
        connectorConnected={false}
        onOpenConnector={() => {}}
      />,
    );
    expect(html).toContain('data-testid="claude-upsell"');
  });

  it('shows the origin badge in the detail meta line when the transcript carries one (Task 10)', () => {
    const html = renderToStaticMarkup(
      <HistoryDetail
        id="2026-06-11T01-00-00-000Z"
        transcript={{ ...TRANSCRIPT, origin: 'claude' }}
        onBack={() => {}}
        onRegenerate={() => {}}
        connectorConnected={false}
        onOpenConnector={() => {}}
      />,
    );
    // Anchored to the segment-count meta line (not a bare 'Claude' substring
    // match — the embedded FamilyPickerStep's upsell banner also says
    // "Claude連携..." when disconnected, so a loose match would false-positive).
    expect(html).toContain('2件 · Claude');
  });

  it('omits the origin badge when the transcript has no origin (defensive, predates the field)', () => {
    const html = renderToStaticMarkup(
      <HistoryDetail
        id="2026-06-11T01-00-00-000Z"
        transcript={TRANSCRIPT}
        onBack={() => {}}
        onRegenerate={() => {}}
        connectorConnected={false}
        onOpenConnector={() => {}}
      />,
    );
    expect(html).toContain('2件');
    expect(html).not.toContain('2件 · ');
  });
});

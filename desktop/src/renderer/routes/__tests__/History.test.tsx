/** Static structural tests for the pure HistoryDetail (container fetch is
 *  live-app-verified, consistent with ErrorView.test.tsx's approach). */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistoryDetail } from '../History';
import type { DumpTranscript } from '@shared/ipc-protocol';

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
      />,
    );
    expect(html).toContain('history-detail');
    expect(html).toContain('history-back');
    expect(html).toContain('こんにちは');
    expect(html).toContain('テストです');
    expect(html).toContain('2 segments');
    // FamilyPickerStep is embedded for re-pickable family (F1 parity).
    expect(html).toContain('family-picker');
    expect(html).toContain('family-continue');
  });
});

import { describe, it, expect } from 'vitest';
import { chunkTranscript, SessionTranscript } from './chunking';

const mkTranscript = (segs: Array<{ ts: number; text: string }>): SessionTranscript => ({
  sessionId: 'test',
  speakers: [{ id: 0 }],
  transcriptSegments: segs.map(s => ({ ...s, speakerId: 0 })),
});

describe('chunkTranscript', () => {
  it('empty transcript returns []', () => {
    expect(chunkTranscript(mkTranscript([]), 8000, 30)).toEqual([]);
  });

  it('single segment under budget returns [transcript]', () => {
    const t = mkTranscript([{ ts: 0, text: 'short' }]);
    const chunks = chunkTranscript(t, 8000, 30);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].transcriptSegments).toHaveLength(1);
  });

  it('multiple segments fitting budget returns one chunk', () => {
    const t = mkTranscript([
      { ts: 0, text: 'hi' },
      { ts: 1, text: 'there' },
      { ts: 2, text: 'all' },
    ]);
    expect(chunkTranscript(t, 8000, 30)).toHaveLength(1);
  });

  it('splits at silence > 1.5s within slack window', () => {
    const t = mkTranscript([
      { ts: 0, text: 'あ'.repeat(5000) },
      { ts: 10, text: 'B' },
      { ts: 20, text: 'C' },
      { ts: 22, text: 'D' },
    ]);
    const chunks = chunkTranscript(t, 2500, 30);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('hard-cuts at token budget when no silence in slack window', () => {
    const segs: Array<{ ts: number; text: string }> = [];
    for (let i = 0; i < 200; i++) segs.push({ ts: i * 0.5, text: 'あ'.repeat(100) });
    const t = mkTranscript(segs);
    const chunks = chunkTranscript(t, 1000, 5);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      const totalChars = c.transcriptSegments.reduce((s, x) => s + x.text.length, 0);
      expect(totalChars).toBeLessThan(2500);
    }
  });
});

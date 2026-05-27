// desktop/src/shared/note-schema/__tests__/chunking.test.ts
//
// Carry-forward I-1: the spike test asserted only chunks.length > 1.
// This version asserts boundary-ts — confirms the split landed AT the
// silence gap, not just that A split happened.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chunkTranscript } from '../chunking';
import type { SessionTranscript } from '../transcript';

const mkTranscript = (
  segs: Array<{ ts: number; endTs?: number; text: string; speakerId?: number }>,
): SessionTranscript => ({
  sessionId: 'test',
  speakers: [{ id: 0 }],
  transcriptSegments: segs.map(s => ({
    ts: s.ts,
    endTs: s.endTs ?? s.ts + 0.5,
    text: s.text,
    speakerId: s.speakerId ?? 0,
  })),
});

describe('chunkTranscript (v2 shape)', () => {
  it('empty transcript returns []', () => {
    expect(chunkTranscript(mkTranscript([]), 8000, 30)).toEqual([]);
  });

  it('single segment under budget returns [transcript]', () => {
    const t = mkTranscript([{ ts: 0, text: 'short' }]);
    expect(chunkTranscript(t, 8000, 30)).toHaveLength(1);
  });

  it('multiple segments fitting budget returns one chunk', () => {
    const t = mkTranscript([
      { ts: 0, text: 'hi' },
      { ts: 1, text: 'there' },
      { ts: 2, text: 'all' },
    ]);
    expect(chunkTranscript(t, 8000, 30)).toHaveLength(1);
  });

  it('splits at silence > 1.5s within slack window (I-1 tightening)', () => {
    // Layout:
    //   seg0: ts=0, endTs=9.9, text=あ×5000 (3000 tokens — exceeds 2500 budget alone)
    //   seg1: ts=20, endTs=20.5, text='B' (1 token)  ← 10.1s silence before this
    //   seg2: ts=30, endTs=30.5, text='C' (1 token)
    //   seg3: ts=32, endTs=32.5, text='D' (1 token)
    //
    // Soft boundary after seg0 (budget exceeded at seg1). softEndTs=0.
    // Silence search window: [-30, +30]. With I-3 fix (Task 8) using endTs:
    //   gap seg0→seg1: 20 - min(9.9, 20) = 10.1s ≥ 1.5s, gapStart=9.9 — VALID
    //   gap seg1→seg2: 30 - min(20.5, 30) =  9.5s ≥ 1.5s, gapStart=20.5 — VALID
    // Algorithm picks the candidate closest to softEndTs (=0):
    //   |9.9 - 0| = 9.9 < |20.5 - 0| = 20.5 → seg0→seg1 wins.
    // best.endTs = 20 → hardEndIdx = 0 → chunk[0]=[seg0], chunk[1]=[seg1,seg2,seg3].
    const t = mkTranscript([
      { ts: 0, endTs: 9.9, text: 'あ'.repeat(5000) },   // exceeds 2500 budget on its own
      { ts: 20, endTs: 20.5, text: 'B' },
      { ts: 30, endTs: 30.5, text: 'C' },
      { ts: 32, endTs: 32.5, text: 'D' },
    ]);
    const chunks = chunkTranscript(t, 2500, 30);

    // I-1 tightening: not just "more than one chunk" — the chunk boundary
    // must land AT the silence gap (chunk[0] last seg ts=0, chunk[1] first
    // seg ts=20, confirming the 10.1s seg0→seg1 gap was used as the split point).
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].transcriptSegments.at(-1)?.ts).toBe(0);
    expect(chunks[1].transcriptSegments[0].ts).toBe(20);
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

  it('silence branch is exercised when endTs is well-defined (I-3 fix)', () => {
    // 200 segments at 5s each (each 4.9s of audio), with a 3-second silence
    // between seg[99] (ts=495, endTs=499.9) and seg[100] (ts=503).
    //
    // Each segment = 'あ'×150 = 90 tokens. Budget = 9000 tokens → soft
    // boundary at seg[99] (100 segs × 90 = 9000).
    //
    // Without I-3 fix (text-length heuristic for seg[99]):
    //   segLastWord = 495 + 150 × 0.07 = 505.5, which OVERFLOWS past
    //   seg[100].ts=503. gapEnd(503) - gapStart(505.5) = -2.5 → negative
    //   duration → silence branch skipped → hard-cut only.
    //
    // With I-3 fix (use endTs):
    //   segLastWord = min(499.9, 503) = 499.9. gapDuration = 503-499.9 = 3.1s
    //   ≥ 1.5s, gapStart=499.9 within [465, 525] → silence snap fires.
    const segs: Array<{ ts: number; endTs: number; text: string }> = [];
    for (let i = 0; i < 200; i++) {
      const ts = i < 100 ? i * 5 : i * 5 + 3;       // 3s offset after seg[99]
      segs.push({
        ts,
        endTs: ts + 4.9,                              // each seg = 4.9s of audio
        text: 'あ'.repeat(150),                      // 90 tokens each
      });
    }
    const t = mkTranscript(segs);
    // Budget = 9000 tokens (= 100 segs × 90 tok). Soft boundary hits seg[99].
    const chunks = chunkTranscript(t, 9000, 30);
    expect(chunks.length).toBeGreaterThan(1);

    // The silence-snap must land at the 3-s gap: chunk ending at seg[99]
    // (ts=495) and next chunk starting at seg[100] (ts=503).
    const splitFound = chunks.some(
      (c, i) =>
        i + 1 < chunks.length &&
        c.transcriptSegments.at(-1)?.ts === 99 * 5 &&
        chunks[i + 1].transcriptSegments[0].ts === 100 * 5 + 3,
    );
    expect(splitFound).toBe(true);
  });
});

describe('chunkTranscript on the 90-min synth fixture', () => {
  const FIXTURE_PATH = resolve(import.meta.dirname, '../fixtures/synth-90min.json');
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
  // Adapt the spike fixture (which has only `ts`/`text`/`speakerId`) to the v2
  // shape by deriving endTs = ts + max(text.length * 0.07, 0.5). This is a
  // TEST-ONLY adaptation; Task 8's I-3 fix uses STT's real endTs.
  const transcript: SessionTranscript = {
    sessionId: raw.sessionId ?? 'synth-90min',
    speakers: raw.speakers,
    transcriptSegments: raw.transcriptSegments.map((s: { ts: number; text: string; speakerId: number }) => ({
      ts: s.ts,
      endTs: s.ts + Math.max(s.text.length * 0.07, 0.5),
      text: s.text,
      speakerId: s.speakerId,
    })),
  };

  it('produces 4-12 chunks at 8K-token budget', () => {
    const chunks = chunkTranscript(transcript, 8000, 30);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks.length).toBeLessThanOrEqual(12);
  });

  it('preserves all segments (no loss)', () => {
    const chunks = chunkTranscript(transcript, 8000, 30);
    const totalChunked = chunks.reduce((s, c) => s + c.transcriptSegments.length, 0);
    expect(totalChunked).toBe(transcript.transcriptSegments.length);
  });
});

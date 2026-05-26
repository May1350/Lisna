// desktop/spikes/phase-0/04-chunking/synth.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chunkTranscript, SessionTranscript } from './chunking';

const SYNTH_PATH = resolve(import.meta.dirname, 'fixtures/synth-90min.json');

describe('chunkTranscript on synthesized transcript', () => {
  const transcript: SessionTranscript = JSON.parse(readFileSync(SYNTH_PATH, 'utf-8'));

  it('produces 4-12 chunks at 8K-token budget', () => {
    const chunks = chunkTranscript(transcript, 8000, 30);
    // eslint-disable-next-line no-console
    console.log(`Chunks: ${chunks.length}, total segments: ${transcript.transcriptSegments.length}`);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks.length).toBeLessThanOrEqual(12);
  });

  it('every chunk respects token budget (with 20% slack)', () => {
    const chunks = chunkTranscript(transcript, 8000, 30);
    for (const c of chunks) {
      const tokens = c.transcriptSegments.reduce(
        (s, seg) => s + Math.ceil(seg.text.length * 0.6),
        0,
      );
      expect(tokens).toBeLessThan(8000 * 1.2);
    }
  });

  it('preserves all segments (no loss)', () => {
    const chunks = chunkTranscript(transcript, 8000, 30);
    const totalChunked = chunks.reduce((s, c) => s + c.transcriptSegments.length, 0);
    expect(totalChunked).toBe(transcript.transcriptSegments.length);
  });
});

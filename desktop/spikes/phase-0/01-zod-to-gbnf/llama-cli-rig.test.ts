import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { decodeStreamChunks } from './llama-cli-rig';

// Regression for H6 (2026-05-29): the rig decoded each stdout `data` chunk with
// `d.toString()`, which splits multi-byte UTF-8 at chunk boundaries and emits
// U+FFFD. Confirmed live — seed-3000 chunk-0 mangled 決断 → ��断 (8× U+FFFD),
// which corrupted the spike's JA measurements and masqueraded as a model/grammar
// failure. Pure unit test, no LLM.
describe('decodeStreamChunks — UTF-8 chunk-boundary safety', () => {
  const json = '{"answer":"決断が重い"}'; // 決 = E6 B1 BA (3 bytes)
  const full = Buffer.from(json, 'utf8');
  // Split 1 byte into 決 so its 3 bytes straddle two chunks.
  const splitAt = Buffer.byteLength('{"answer":"', 'utf8') + 1;
  const a = full.subarray(0, splitAt);
  const b = full.subarray(splitAt);

  it('reassembles a split multi-byte char with no corruption', () => {
    const decoded = decodeStreamChunks([a, b]);
    expect(decoded).toBe(json);
    expect(decoded).not.toContain('�');
  });

  it('fail-first: naive per-chunk toString() DOES corrupt (the old rig bug)', () => {
    const naive = [a, b].map((c) => c.toString('utf8')).join('');
    expect(naive).toContain('�');
    expect(naive).not.toBe(json);
  });
});

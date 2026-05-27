import { describe, it, expect } from 'vitest';
import {
  computeProvenance,
  DEFAULT_PROVENANCE_CONFIG,
  type ProvenanceConfig,
} from '../provenance';
import type { SessionTranscript } from '../transcript';

const mkTranscript = (tsValues: number[]): SessionTranscript => ({
  sessionId: 't',
  speakers: [{ id: 0 }],
  transcriptSegments: tsValues.map(ts => ({
    ts,
    endTs: ts + 0.5,
    text: 'x',
    speakerId: 0,
  })),
});

describe('computeProvenance — table-driven', () => {
  const transcript = mkTranscript([0, 5, 10, 15, 20]);

  it.each<[string, { ts?: number }, ProvenanceConfig | undefined, 'transcript' | 'inferred']>([
    ['exact hit', { ts: 5 }, undefined, 'transcript'],
    ['within window upper', { ts: 7 }, undefined, 'transcript'],          // 7 ∈ 5±3
    ['within window lower', { ts: 8 }, undefined, 'transcript'],          // 8 ∈ 10±3
    ['outside window', { ts: 100 }, undefined, 'inferred'],
    ['undefined ts → inferred', {}, undefined, 'inferred'],
    ['ts = 0 boundary', { ts: 0 }, undefined, 'transcript'],
    ['narrow window misses', { ts: 6 }, { matchWindowSec: 0.5, emptyTranscriptDefault: 'inferred' }, 'inferred'],
    ['narrow window hits', { ts: 5.3 }, { matchWindowSec: 0.5, emptyTranscriptDefault: 'inferred' }, 'transcript'],
  ])('%s', (_label, item, config, expected) => {
    expect(computeProvenance(item, transcript, config)).toBe(expected);
  });

  it('empty transcript honours config emptyTranscriptDefault', () => {
    const empty = mkTranscript([]);
    expect(computeProvenance({ ts: 5 }, empty)).toBe('inferred');
    expect(
      computeProvenance({ ts: 5 }, empty, {
        matchWindowSec: 3,
        emptyTranscriptDefault: 'transcript',
      }),
    ).toBe('transcript');
  });

  it('DEFAULT_PROVENANCE_CONFIG = { matchWindowSec: 3, emptyTranscriptDefault: "inferred" }', () => {
    expect(DEFAULT_PROVENANCE_CONFIG.matchWindowSec).toBe(3);
    expect(DEFAULT_PROVENANCE_CONFIG.emptyTranscriptDefault).toBe('inferred');
  });
});

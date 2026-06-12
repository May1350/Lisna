/**
 * Review P0-3: a from-dump finalize failure must NOT retry through the live
 * `session/finalize` (current === null → guaranteed NO_ACTIVE_SESSION).
 * retryViewFor routes dump-origin errors back to the History detail (family
 * re-pickable there); live-origin errors keep the F1 familyPicking edge.
 */
import { describe, it, expect } from 'vitest';
import { retryViewFor } from '../App';
import type { TranscriptSegment } from '@shared/types';

const SEGMENTS = [{ startSec: 0, endSec: 2, text: 'x', noSpeechProb: 0 }] as TranscriptSegment[];

describe('retryViewFor', () => {
  it('routes live-origin (and origin-less legacy) errors to familyPicking with preserved segments', () => {
    expect(retryViewFor({ segments: SEGMENTS })).toEqual({ kind: 'familyPicking', segments: SEGMENTS });
    expect(retryViewFor({ origin: { kind: 'live' }, segments: SEGMENTS })).toEqual({
      kind: 'familyPicking',
      segments: SEGMENTS,
    });
  });

  it('routes dump-origin errors back to the History detail', () => {
    expect(
      retryViewFor({ origin: { kind: 'dump', id: '2026-06-11T01-00-00-000Z' }, segments: SEGMENTS }),
    ).toEqual({ kind: 'history', id: '2026-06-11T01-00-00-000Z' });
  });
});

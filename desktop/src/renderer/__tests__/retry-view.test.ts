/**
 * Review P0-3: a from-dump finalize failure must NOT retry through the live
 * `session/finalize` (current === null → guaranteed NO_ACTIVE_SESSION).
 * retryViewFor routes dump-origin errors back to the History detail (family
 * re-pickable there); live-origin errors keep the F1 familyPicking edge.
 *
 * STT Phase 2a (Group D): the transcript is preserved server-side, so the
 * error view no longer carries `segments`; retryViewFor takes origin only.
 */
import { describe, it, expect } from 'vitest';
import { retryViewFor } from '../App';

describe('retryViewFor', () => {
  it('routes live-origin (and origin-less legacy) errors to familyPicking', () => {
    expect(retryViewFor({})).toEqual({ kind: 'familyPicking' });
    expect(retryViewFor({ origin: { kind: 'live' } })).toEqual({ kind: 'familyPicking' });
  });

  it('routes dump-origin errors back to the History detail', () => {
    expect(
      retryViewFor({ origin: { kind: 'dump', id: '2026-06-11T01-00-00-000Z' } }),
    ).toEqual({ kind: 'history', id: '2026-06-11T01-00-00-000Z' });
  });
});

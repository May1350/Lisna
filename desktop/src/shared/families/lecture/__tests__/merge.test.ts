import { describe, it, expect } from 'vitest';
import { lectureMergeStrategy } from '../merge';
import { deterministicMerge } from '../../../post-decode/deterministic-merge';

describe('lectureMergeStrategy with deterministicMerge', () => {
  it('picks longest scalar for title across chunks', () => {
    const out = deterministicMerge<{ title: string }>(
      [{ title: '電磁気' }, { title: '電磁気の基礎' }],
      lectureMergeStrategy,
    );
    expect(out.title).toBe('電磁気の基礎');
  });

  it('concat-only sections with sortByTs (no dedup on sections)', () => {
    const out = deterministicMerge<{ sections: Array<{ heading: string; ts: number }> }>(
      [{ sections: [{ heading: 'B', ts: 50 }] }, { sections: [{ heading: 'A', ts: 0 }] }],
      lectureMergeStrategy,
    );
    expect(out.sections.map(s => s.heading)).toEqual(['A', 'B']);
  });

  it('extras concat-dedup across chunks (typed slot collisions resolved)', () => {
    const out = deterministicMerge<{ extras: Array<{ text: string }> }>(
      [
        { extras: [{ text: 'electric field E = ρ/ε₀' }] },
        { extras: [{ text: 'electric field E = ρ/ε₀.' }] }, // near-identical, trailing dot
      ],
      lectureMergeStrategy,
    );
    // Trigram Jaccard > 0.7 → dedup to 1.
    expect(out.extras).toHaveLength(1);
  });

  it('top-level arrays (not in fieldOverrides) use default concat-dedup', () => {
    // Defensive against future schema additions
    const out = deterministicMerge<{ topics: Array<{ text: string }> }>(
      [{ topics: [{ text: 'topic-a' }] }, { topics: [{ text: 'topic-a' }] }],
      lectureMergeStrategy,
    );
    expect(out.topics).toHaveLength(1);
  });
});

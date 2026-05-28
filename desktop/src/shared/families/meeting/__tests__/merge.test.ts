import { describe, it, expect } from 'vitest';
import { meetingMergeStrategy } from '../merge';
import { deterministicMerge } from '../../../post-decode/deterministic-merge';

describe('meetingMergeStrategy with deterministicMerge', () => {
  it('decisions concat-dedup: near-identical decision texts collapse to one', () => {
    const out = deterministicMerge<{ decisions: Array<{ text: string }> }>(
      [
        { decisions: [{ text: 'We will ship by end of June' }] },
        { decisions: [{ text: 'We will ship by end of June.' }] }, // trailing dot — trigram Jaccard > 0.7
      ],
      meetingMergeStrategy,
    );
    // concat-dedup: near-duplicate collapsed to 1.
    expect(out.decisions).toHaveLength(1);
  });

  it('topic_arc concat-only: all items retained even when texts are similar', () => {
    const out = deterministicMerge<{ topic_arc: Array<{ label: string; ts: number }> }>(
      [
        { topic_arc: [{ label: 'Opening remarks', ts: 60 }] },
        { topic_arc: [{ label: 'Opening remarks.', ts: 5 }] }, // similar text — concat-only NEVER dedup
      ],
      meetingMergeStrategy,
    );
    // concat-only: both items retained regardless of text similarity.
    expect(out.topic_arc).toHaveLength(2);
    // sortByTs: items sorted ascending by ts.
    expect(out.topic_arc[0]!.ts).toBe(5);
    expect(out.topic_arc[1]!.ts).toBe(60);
  });

  it("scalar 'longest': executive_summary picks the longest non-empty value", () => {
    const out = deterministicMerge<{ executive_summary: string }>(
      [
        { executive_summary: 'Short.' },
        { executive_summary: 'A much longer executive summary that won.' },
      ],
      meetingMergeStrategy,
    );
    expect(out.executive_summary).toBe('A much longer executive summary that won.');
  });

  it('proposals concat-dedup: near-identical proposal texts collapse to one', () => {
    const out = deterministicMerge<{ proposals: Array<{ text: string }> }>(
      [
        { proposals: [{ text: 'Adopt a weekly release cadence' }] },
        { proposals: [{ text: 'Adopt a weekly release cadence.' }] }, // trailing dot — trigram Jaccard > 0.7
      ],
      meetingMergeStrategy,
    );
    // concat-dedup: near-duplicate collapsed to 1 (mirrors decisions).
    expect(out.proposals).toHaveLength(1);
  });

  it('next_steps concat-dedup: duplicate action texts collapsed', () => {
    const out = deterministicMerge<{ next_steps: Array<{ text: string }> }>(
      [
        { next_steps: [{ text: 'Alice will write the spec' }] },
        { next_steps: [{ text: 'Alice will write the spec.' }] }, // near-duplicate
        { next_steps: [{ text: 'Bob will review it' }] },
      ],
      meetingMergeStrategy,
    );
    // Alice's two entries dedup to 1; Bob's unique entry is kept → 2 total.
    expect(out.next_steps).toHaveLength(2);
  });

  it('discussions concat-only: byte-identical discussions are both retained', () => {
    // discussions carry no `text` field, so dedupArrayByTextField (used by
    // concat-dedup) falls back to JSON.stringify equality. Two byte-identical
    // discussion objects WOULD collapse to 1 under concat-dedup. concat-only
    // never dedups — asserting both are retained is the discriminating test
    // that FAILS if the policy were wrongly concat-dedup.
    const identical = { summary: 'Budget discussion', ts_start: 120 };
    const out = deterministicMerge<{ discussions: Array<{ summary: string; ts_start: number }> }>(
      [
        { discussions: [{ ...identical }] },
        { discussions: [{ ...identical }] },
      ],
      meetingMergeStrategy,
    );
    // concat-only retains both even though they are byte-identical.
    expect(out.discussions).toHaveLength(2);
  });
});

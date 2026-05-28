import { describe, it, expect } from 'vitest';
import { deterministicMerge } from '../deterministic-merge';
import type { MergeStrategy } from '@shared/families';

describe('deterministicMerge', () => {
  it('picks longest scalar with scalarPolicy=longest', () => {
    const strategy: MergeStrategy = { scalarPolicy: 'longest', arrayPolicy: 'concat-dedup' };
    const out = deterministicMerge([{ title: 'A' }, { title: 'A longer title' }], strategy);
    expect(out.title).toBe('A longer title');
  });

  it('picks first non-undefined scalar with scalarPolicy=first', () => {
    const strategy: MergeStrategy = { scalarPolicy: 'first', arrayPolicy: 'concat-only' };
    const partials: Array<Partial<{ title: string }>> = [{ title: undefined }, { title: 'B' }, { title: 'C' }];
    const out = deterministicMerge(partials, strategy);
    expect(out.title).toBe('B');
  });

  it('concat-only arrays without dedup (preserves duplicates)', () => {
    const strategy: MergeStrategy = { scalarPolicy: 'longest', arrayPolicy: 'concat-only' };
    const out = deterministicMerge(
      [{ items: [{ text: 'a' }, { text: 'b' }] }, { items: [{ text: 'a' }] }],
      strategy,
    );
    expect((out.items as unknown[])).toHaveLength(3);
  });

  it('concat-dedup removes near-identical strings (trigram Jaccard > 0.7)', () => {
    const strategy: MergeStrategy = { scalarPolicy: 'longest', arrayPolicy: 'concat-dedup' };
    const out = deterministicMerge(
      [{ items: [{ text: 'electric field strength' }] }, { items: [{ text: 'electric field strength.' }] }],
      strategy,
    );
    // "electric field strength" vs "electric field strength." share most trigrams → dedup.
    expect((out.items as unknown[])).toHaveLength(1);
  });

  it('sortByTs sorts arrays by item.ts ascending after concat', () => {
    const strategy: MergeStrategy = { scalarPolicy: 'longest', arrayPolicy: 'concat-only', sortByTs: true };
    const out = deterministicMerge(
      [{ items: [{ text: 'B', ts: 50 }] }, { items: [{ text: 'A', ts: 0 }] }],
      strategy,
    );
    expect((out.items as Array<{ text: string; ts: number }>).map(i => i.text)).toEqual(['A', 'B']);
  });

  it('sortByTs orders ts_start-keyed items (meeting discussions shape) ascending across chunks', () => {
    // Meeting `discussions[]` key their timestamp on `ts_start`, not `ts`
    // (families/meeting/schema.ts). meetingMergeStrategy declares
    // `discussions: { policy: 'concat-only' }` + global `sortByTs: true`, so
    // the engine must order discussions temporally across chunks. Encounter
    // order below is reversed from ts_start order; a comparator that reads
    // only `.ts` returns 0 and leaves chunk-encounter order intact (the bug).
    const strategy: MergeStrategy = {
      scalarPolicy: 'longest',
      arrayPolicy: 'concat-dedup',
      sortByTs: true,
      fieldOverrides: { discussions: { policy: 'concat-only' } },
    };
    const out = deterministicMerge<{ discussions: Array<{ topic: string; ts_start: number }> }>(
      [
        { discussions: [{ topic: 'budget', ts_start: 120 }] },
        { discussions: [{ topic: 'intro', ts_start: 10 }] },
      ],
      strategy,
    );
    expect(out.discussions.map(d => d.ts_start)).toEqual([10, 120]);
  });

  it('fieldOverrides take precedence over arrayPolicy', () => {
    const strategy: MergeStrategy = {
      scalarPolicy: 'longest',
      arrayPolicy: 'concat-dedup',
      fieldOverrides: { keep_dupes: { policy: 'concat-only' } },
    };
    const out = deterministicMerge(
      [{ keep_dupes: [{ text: 'a' }] }, { keep_dupes: [{ text: 'a' }] }],
      strategy,
    );
    expect((out.keep_dupes as unknown[])).toHaveLength(2);
  });

  it('custom field policy runs the handler', () => {
    const strategy: MergeStrategy = {
      scalarPolicy: 'longest',
      arrayPolicy: 'concat-dedup',
      fieldOverrides: { tally: { policy: 'custom', handler: (vs) => (vs as number[]).reduce((a, b) => (a ?? 0) + (b ?? 0), 0) } },
    };
    const out = deterministicMerge([{ tally: 3 }, { tally: 5 }], strategy);
    expect(out.tally).toBe(8);
  });

  it('merge-llm arrayPolicy is a no-op in deterministic merge (falls back to first)', () => {
    const strategy: MergeStrategy = { scalarPolicy: 'longest', arrayPolicy: 'merge-llm' };
    const out = deterministicMerge(
      [{ items: [{ text: 'a' }] }, { items: [{ text: 'b' }] }],
      strategy,
    );
    // merge-llm in deterministic context falls back to first-non-undefined behavior.
    expect((out.items as unknown[]).length).toBe(1);
  });
});

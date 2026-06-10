import { describe, it, expect } from 'vitest';
import { assignBrainstormIdeaIds } from '@shared/note-schema';
import { BrainstormNoteSchema, type BrainstormNote } from '../schema';
import fixtureJson from '../migrations/v1-fixture.json';

function validBrainstormFixture(): BrainstormNote {
  return {
    schemaVersion: 1,
    family: 'brainstorm',
    title: 'fixture',
    generatedAt: '2026-05-27T00:00:00.000Z',
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 0 },
    language: 'ja',
    durationSec: 1800,
    purpose: 'fixture',
    idea_clusters: [
      {
        theme: 'T',
        ideas: [{ id: '550e8400-e29b-41d4-a716-446655440000', text: 'i', ts: 1, from: 'transcript' as const }],
      },
    ],
  };
}

describe('BrainstormNoteSchema', () => {
  it('parses a minimal valid BrainstormNote', () => {
    const parsed = BrainstormNoteSchema.parse(validBrainstormFixture());
    expect(parsed.family).toBe('brainstorm');
    expect(parsed.idea_clusters).toHaveLength(1);
  });

  it('rejects when family !== "brainstorm"', () => {
    expect(() => BrainstormNoteSchema.parse({ ...validBrainstormFixture(), family: 'lecture' })).toThrow();
  });

  // Same empty-slot class as the interview founder P1 (2026-06-10): without
  // .min(1) the grammar lets a mode-collapsed model fill "" legally.
  it('rejects empty idea_clusters[].theme', () => {
    const base = validBrainstormFixture();
    expect(() => BrainstormNoteSchema.parse({ ...base, idea_clusters: [{ ...base.idea_clusters[0]!, theme: '' }] })).toThrow();
  });
  it('rejects empty idea_clusters[].ideas[].text', () => {
    const base = validBrainstormFixture();
    expect(() => BrainstormNoteSchema.parse({
      ...base,
      idea_clusters: [{ theme: 'T', ideas: [{ id: '550e8400-e29b-41d4-a716-446655440000', text: '', ts: 1, from: 'transcript' as const }] }],
    })).toThrow();
  });
  it('rejects empty parking_lot[].text', () => {
    expect(() => BrainstormNoteSchema.parse({
      ...validBrainstormFixture(),
      parking_lot: [{ text: '', ts: 1, from: 'transcript' as const }],
    })).toThrow();
  });

  it('rejects when idea_clusters has 16 clusters (max 15)', () => {
    const base = validBrainstormFixture();
    const clusters = Array.from({ length: 16 }, (_, i) => ({
      theme: `T${i}`,
      ideas: [{ id: '550e8400-e29b-41d4-a716-446655440000', text: 'i', ts: i, from: 'transcript' as const }],
    }));
    expect(() => BrainstormNoteSchema.parse({ ...base, idea_clusters: clusters })).toThrow();
  });

  it('accepts 15 idea_clusters (max boundary)', () => {
    const base = validBrainstormFixture();
    const clusters = Array.from({ length: 15 }, (_, i) => ({
      theme: `T${i}`,
      ideas: [{ id: '550e8400-e29b-41d4-a716-446655440000', text: 'i', ts: i, from: 'transcript' as const }],
    }));
    expect(() => BrainstormNoteSchema.parse({ ...base, idea_clusters: clusters })).not.toThrow();
  });

  it('rejects when a cluster has 31 ideas (max 30 per cluster)', () => {
    const base = validBrainstormFixture();
    const ideas = Array.from({ length: 31 }, (_, i) => ({
      id: `550e8400-e29b-41d4-a716-44665544${String(i).padStart(4, '0')}`,
      text: `idea ${i}`,
      ts: i,
      from: 'transcript' as const,
    }));
    expect(() =>
      BrainstormNoteSchema.parse({ ...base, idea_clusters: [{ theme: 'T', ideas }] }),
    ).toThrow();
  });

  it('rejects an empty ideas array in a cluster (min 1)', () => {
    const base = validBrainstormFixture();
    expect(() =>
      BrainstormNoteSchema.parse({ ...base, idea_clusters: [{ theme: 'T', ideas: [] }] }),
    ).toThrow();
  });

  it('rejects when parking_lot has 21 entries (max 20)', () => {
    const base = validBrainstormFixture();
    const parking_lot = Array.from({ length: 21 }, (_, i) => ({
      text: `item ${i}`,
      ts: i,
      from: 'inferred' as const,
    }));
    expect(() => BrainstormNoteSchema.parse({ ...base, parking_lot })).toThrow();
  });

  it('accepts valid atmosphere values', () => {
    const base = validBrainstormFixture();
    expect(() => BrainstormNoteSchema.parse({ ...base, atmosphere: 'collaborative' })).not.toThrow();
    expect(() => BrainstormNoteSchema.parse({ ...base, atmosphere: 'energetic' })).not.toThrow();
    expect(() => BrainstormNoteSchema.parse({ ...base, atmosphere: 'subdued' })).not.toThrow();
  });

  it('rejects an invalid atmosphere value', () => {
    const base = validBrainstormFixture();
    expect(() => BrainstormNoteSchema.parse({ ...base, atmosphere: 'tense' })).toThrow();
  });

  it('rejects a non-UUID idea id', () => {
    const base = validBrainstormFixture();
    const clusters = [
      {
        theme: 'T',
        ideas: [{ id: 'not-a-uuid', text: 'i', ts: 1, from: 'transcript' as const }],
      },
    ];
    expect(() => BrainstormNoteSchema.parse({ ...base, idea_clusters: clusters })).toThrow();
  });

  it('accepts inherited purpose-driven fields (conclusions + next_steps)', () => {
    const base = validBrainstormFixture();
    expect(() =>
      BrainstormNoteSchema.parse({
        ...base,
        conclusions: [{ text: 'アイデアAが最も実行可能', from: 'inferred' as const }],
        next_steps: [{ text: 'プロトタイプ作成', ts: 900, from: 'inferred' as const }],
      }),
    ).not.toThrow();
  });
});

describe('BrainstormNoteSchema — v1-fixture roundtrip', () => {
  it('parses the v1 migration fixture without throwing', () => {
    expect(() => BrainstormNoteSchema.parse(fixtureJson)).not.toThrow();
  });
});

describe('BrainstormNoteSchema — Path G budget locks (fail loud if a future PR widens a bound)', () => {
  it('idea_clusters max is 15 (15 passes, 16 throws)', () => {
    const mk = (n: number) => ({
      ...validBrainstormFixture(),
      idea_clusters: Array.from({ length: n }, (_, i) => ({
        theme: `T${i}`,
        ideas: [{ id: `550e8400-e29b-41d4-a716-44665544${String(i).padStart(4, '0')}`, text: 'i', ts: i, from: 'transcript' as const }],
      })),
    });
    expect(() => BrainstormNoteSchema.parse(mk(15))).not.toThrow();
    expect(() => BrainstormNoteSchema.parse(mk(16))).toThrow();
  });

  it('ideas per cluster max is 30 (30 passes, 31 throws)', () => {
    const mkIdeas = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `550e8400-e29b-41d4-a716-44665544${String(i).padStart(4, '0')}`,
        text: `idea ${i}`,
        ts: i,
        from: 'transcript' as const,
      }));
    const mk = (n: number) => ({ ...validBrainstormFixture(), idea_clusters: [{ theme: 'T', ideas: mkIdeas(n) }] });
    expect(() => BrainstormNoteSchema.parse(mk(30))).not.toThrow();
    expect(() => BrainstormNoteSchema.parse(mk(31))).toThrow();
  });

  it('parking_lot max is 20 (20 passes)', () => {
    const parking_lot = Array.from({ length: 20 }, (_, i) => ({
      text: `item ${i}`,
      ts: i,
      from: 'inferred' as const,
    }));
    expect(() => BrainstormNoteSchema.parse({ ...validBrainstormFixture(), parking_lot })).not.toThrow();
  });
});

describe('BrainstormNoteSchema — UUID hydration round-trip', () => {
  it('assignBrainstormIdeaIds fills ids so BrainstormNoteSchema.parse succeeds with valid UUIDs', () => {
    // LLM shape: ideas WITHOUT id, reconciled base fields matching actual NoteBaseSchema
    const llmShape: Record<string, unknown> = {
      schemaVersion: 1,
      family: 'brainstorm',
      title: 'Round-trip test',
      generatedAt: '2026-05-27T00:00:00.000Z',
      generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 0 },
      language: 'ja',
      durationSec: 600,
      purpose: 'test',
      idea_clusters: [
        {
          theme: 'T1',
          ideas: [
            { text: 'idea A', ts: 10 },
            { text: 'idea B', ts: 20 },
          ],
        },
      ],
    };

    // Step 1: assign UUIDs
    const hydrated = assignBrainstormIdeaIds(llmShape);

    // Step 2: hand-fill `from` on ideas (computeProvenance is a separate stage)
    const clusters = (hydrated.idea_clusters as Array<{ theme: string; ideas: Array<Record<string, unknown>> }>);
    clusters[0]!.ideas[0]!.from = 'transcript';
    clusters[0]!.ideas[1]!.from = 'transcript';

    // Step 3: parse — must succeed
    const parsed = BrainstormNoteSchema.parse(hydrated);
    expect(parsed.family).toBe('brainstorm');
    const idA = parsed.idea_clusters[0]!.ideas[0]!.id;
    const idB = parsed.idea_clusters[0]!.ideas[1]!.id;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(idA).toMatch(UUID_RE);
    expect(idB).toMatch(UUID_RE);
    expect(idA).not.toBe(idB);
  });
});

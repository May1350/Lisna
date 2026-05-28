import { describe, it, expect } from 'vitest';
import { hydratePostDecode, assignBrainstormIdeaIds } from '../post-decode-hydration';
import type { SessionTranscript } from '../transcript';

const transcript: SessionTranscript = {
  sessionId: 't',
  speakers: [{ id: 0 }],
  transcriptSegments: [
    { ts: 0, endTs: 0.5, text: 'a', speakerId: 0 },
    { ts: 10, endTs: 10.5, text: 'b', speakerId: 0 },
  ],
};

describe('hydratePostDecode', () => {
  it('fills `from` on a top-level leaf with ts (transcript match)', () => {
    const obj = { key: 'k', text: 'x', ts: 0 };
    hydratePostDecode(obj, transcript);
    expect((obj as { from?: string }).from).toBe('transcript');
  });

  it('fills `from = inferred` when ts outside window', () => {
    const obj = { key: 'k', text: 'x', ts: 999 };
    hydratePostDecode(obj, transcript);
    expect((obj as { from?: string }).from).toBe('inferred');
  });

  it('recurses into arrays of objects', () => {
    const obj = {
      sections: [
        {
          heading: 'Intro',
          key_terms: [
            { term: 'photo', definition: 'd', ts: 0 },
            { term: 'unknown', definition: 'd', ts: 9999 },
          ],
        },
      ],
    };
    hydratePostDecode(obj, transcript);
    expect((obj.sections[0]!.key_terms[0] as { from?: string }).from).toBe('transcript');
    expect((obj.sections[0]!.key_terms[1] as { from?: string }).from).toBe('inferred');
  });

  it('does NOT overwrite an explicit `from` already present', () => {
    const obj = { ts: 0, from: 'inferred' };
    hydratePostDecode(obj, transcript);
    expect(obj.from).toBe('inferred'); // unchanged
  });

  it('does NOT add `from` to leaves without ts', () => {
    const obj = { text: 'no-anchor' };
    hydratePostDecode(obj, transcript);
    expect((obj as { from?: string }).from).toBeUndefined();
  });

  it('handles null / non-object values gracefully', () => {
    expect(() => hydratePostDecode(null as unknown as object, transcript)).not.toThrow();
    expect(() => hydratePostDecode(42 as unknown as object, transcript)).not.toThrow();
  });

  it('handles empty transcript per config', () => {
    const empty: SessionTranscript = { sessionId: 'e', speakers: [], transcriptSegments: [] };
    const obj = { ts: 5 };
    hydratePostDecode(obj, empty);
    expect((obj as { from?: string }).from).toBe('inferred');
  });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('assignBrainstormIdeaIds', () => {
  it('assigns distinct UUID v4 to ideas without id', () => {
    const raw: Record<string, unknown> = {
      family: 'brainstorm',
      idea_clusters: [
        {
          theme: 'T',
          ideas: [
            { text: 'idea A', ts: 1 },
            { text: 'idea B', ts: 2 },
          ],
        },
      ],
    };
    const result = assignBrainstormIdeaIds(raw);
    const clusters = result.idea_clusters as Array<{ ideas: Array<{ id: string }> }>;
    const idA = clusters[0]!.ideas[0]!.id;
    const idB = clusters[0]!.ideas[1]!.id;
    expect(idA).toMatch(UUID_RE);
    expect(idB).toMatch(UUID_RE);
    expect(idA).not.toBe(idB);
  });

  it('preserves existing ids', () => {
    const existingId = '550e8400-e29b-41d4-a716-446655440000';
    const raw: Record<string, unknown> = {
      family: 'brainstorm',
      idea_clusters: [
        {
          theme: 'T',
          ideas: [{ id: existingId, text: 'idea A', ts: 1 }],
        },
      ],
    };
    const result = assignBrainstormIdeaIds(raw);
    const clusters = result.idea_clusters as Array<{ ideas: Array<{ id: string }> }>;
    expect(clusters[0]!.ideas[0]!.id).toBe(existingId);
  });

  it('is a no-op for non-brainstorm family', () => {
    const raw: Record<string, unknown> = {
      family: 'lecture',
      idea_clusters: [{ theme: 'T', ideas: [{ text: 'i', ts: 1 }] }],
    };
    const result = assignBrainstormIdeaIds(raw);
    expect(result).toBe(raw); // same reference — untouched
  });

  it('is defensive on missing idea_clusters', () => {
    const raw: Record<string, unknown> = { family: 'brainstorm' };
    expect(() => assignBrainstormIdeaIds(raw)).not.toThrow();
    const result = assignBrainstormIdeaIds(raw);
    expect(result).toBe(raw);
  });
});

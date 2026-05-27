import { describe, it, expect } from 'vitest';
import { hydratePostDecode } from '../post-decode-hydration';
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
    expect((obj as any).from).toBe('transcript');
  });

  it('fills `from = inferred` when ts outside window', () => {
    const obj = { key: 'k', text: 'x', ts: 999 };
    hydratePostDecode(obj, transcript);
    expect((obj as any).from).toBe('inferred');
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
    expect((obj.sections[0].key_terms[0] as any).from).toBe('transcript');
    expect((obj.sections[0].key_terms[1] as any).from).toBe('inferred');
  });

  it('does NOT overwrite an explicit `from` already present', () => {
    const obj = { ts: 0, from: 'inferred' };
    hydratePostDecode(obj, transcript);
    expect(obj.from).toBe('inferred'); // unchanged
  });

  it('does NOT add `from` to leaves without ts', () => {
    const obj = { text: 'no-anchor' };
    hydratePostDecode(obj, transcript);
    expect((obj as any).from).toBeUndefined();
  });

  it('handles null / non-object values gracefully', () => {
    expect(() => hydratePostDecode(null as unknown as object, transcript)).not.toThrow();
    expect(() => hydratePostDecode(42 as unknown as object, transcript)).not.toThrow();
  });

  it('handles empty transcript per config', () => {
    const empty: SessionTranscript = { sessionId: 'e', speakers: [], transcriptSegments: [] };
    const obj = { ts: 5 };
    hydratePostDecode(obj, empty);
    expect((obj as any).from).toBe('inferred');
  });
});

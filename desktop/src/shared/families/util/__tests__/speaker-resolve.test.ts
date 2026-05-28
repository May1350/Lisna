import { describe, it, expect } from 'vitest';
import { resolveSpeakerLabel } from '../speaker-resolve';
import type { SessionTranscript } from '@shared/note-schema/transcript';

describe('resolveSpeakerLabel', () => {
  const transcript: SessionTranscript = {
    sessionId: 's',
    speakers: [{ id: 0, name: 'Tanaka' }, { id: 1 }],
    transcriptSegments: [],
  };

  it('returns the name when set', () => {
    expect(resolveSpeakerLabel(0, transcript)).toBe('Tanaka');
  });

  it('returns "Speaker {id}" when name not set', () => {
    expect(resolveSpeakerLabel(1, transcript)).toBe('Speaker 1');
  });

  it('returns "Speaker ?{ref}" for an out-of-range ref', () => {
    expect(resolveSpeakerLabel(99, transcript)).toBe('Speaker ?99');
  });
});

import { describe, it, expect } from 'vitest';
import { GenerationTelemetrySchema } from '../telemetry';

describe('GenerationTelemetry Zod', () => {
  it('parses a complete telemetry record', () => {
    const t = {
      noteId: 'abc',
      modelId: 'llama-3.2-3b-q4-km',
      promptVariantId: 'v1-baseline',
      schemaVersion: 1,
      generationStartedAt: '2026-05-27T00:00:00Z',
      generationDurationMs: 95000,
      chunkCount: 3,
      totalTokensIn: 24000,
      totalTokensOut: 1200,
      validationWarnings: ['Dropped 1 invalid speakerRef'],
      dedupHits: [{ field: 'decisions', count: 2 }],
      postDecodeMutations: [
        { field: 'sections[0].key_terms[2].from', reason: 'no-ts-match' },
      ],
    };
    expect(() => GenerationTelemetrySchema.parse(t)).not.toThrow();
  });

  it('rejects negative durations', () => {
    expect(() =>
      GenerationTelemetrySchema.parse({
        noteId: 'a', modelId: 'm', promptVariantId: 'v',
        schemaVersion: 1, generationStartedAt: '2026-05-27T00:00:00Z',
        generationDurationMs: -1, chunkCount: 1,
        totalTokensIn: 0, totalTokensOut: 0,
        validationWarnings: [], dedupHits: [], postDecodeMutations: [],
      }),
    ).toThrow();
  });
});

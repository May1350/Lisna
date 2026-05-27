import { describe, it, expect } from 'vitest';
import {
  NoteBaseSchema,
  Provenance,
  ProvenanceSchema,
  SpeakerRefSchema,
  POST_DECODE_MARKER_DESCRIPTION,
} from '../base';

describe('NoteBase / Provenance / SpeakerRef Zod', () => {
  it('NoteBaseSchema parses minimum required fields', () => {
    const minimal = {
      schemaVersion: 1,
      family: 'lecture' as const,
      title: 'Hello',
      generatedAt: '2026-05-27T00:00:00Z',
      generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
      language: 'ja' as const,
      durationSec: 600,
    };
    expect(() => NoteBaseSchema.parse(minimal)).not.toThrow();
  });

  it('NoteBaseSchema rejects invalid family discriminator', () => {
    expect(() =>
      NoteBaseSchema.parse({
        schemaVersion: 1,
        family: 'podcast',
        title: 't',
        generatedAt: '2026-05-27T00:00:00Z',
        generatedBy: { model: 'm', promptVersion: 1 },
        language: 'ja',
        durationSec: 1,
      }),
    ).toThrow();
  });

  it('NoteBaseSchema accepts optional experimentArmId + validation_warnings', () => {
    const withOpt = {
      schemaVersion: 1,
      family: 'meeting' as const,
      title: 't',
      generatedAt: '2026-05-27T00:00:00Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'en' as const,
      durationSec: 1,
      experimentArmId: 'llama-3.2-3b-q4-km/v1-baseline',
      validation_warnings: ['Dropped 1 invalid speaker reference'],
    };
    expect(() => NoteBaseSchema.parse(withOpt)).not.toThrow();
  });

  it('Provenance type narrows to literal union', () => {
    const a: Provenance = 'transcript';
    const b: Provenance = 'inferred';
    expect(ProvenanceSchema.parse(a)).toBe('transcript');
    expect(ProvenanceSchema.parse(b)).toBe('inferred');
    expect(() => ProvenanceSchema.parse('guessed')).toThrow();
  });

  it('ProvenanceSchema carries the postDecodeOnly marker description', () => {
    // The marker is the JSON-stringified object `{"postDecodeOnly":true}` set
    // via .describe(). zod-to-gbnf reads _def.description and strips fields
    // whose JSON-parsed description has postDecodeOnly: true (see
    // desktop/spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.ts:32-47).
    const desc = (ProvenanceSchema as unknown as { _def: { description: string } })._def.description;
    expect(desc).toBe(POST_DECODE_MARKER_DESCRIPTION);
    const parsed = JSON.parse(desc) as { postDecodeOnly?: boolean };
    expect(parsed.postDecodeOnly).toBe(true);
  });

  it('SpeakerRefSchema parses non-negative integers', () => {
    expect(SpeakerRefSchema.parse(0)).toBe(0);
    expect(SpeakerRefSchema.parse(7)).toBe(7);
    expect(() => SpeakerRefSchema.parse(-1)).toThrow();
    expect(() => SpeakerRefSchema.parse(1.5)).toThrow();
  });
});

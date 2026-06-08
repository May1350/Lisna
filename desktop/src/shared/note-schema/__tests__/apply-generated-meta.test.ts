import { describe, it, expect } from 'vitest';
import { applyGeneratedMeta } from '../apply-generated-meta';
import { CURRENT_SCHEMA_VERSION } from '../forward-incompat';
import type { NoteBase } from '../base';

/**
 * Regression: the v2 finalize path returned a note whose schemaVersion /
 * generatedAt / generatedBy / language came straight from the LLM grammar
 * output (orchestrator never overwrote them). A 1B model hallucinated an
 * invalid `generatedAt` string → the renderer's `new Date(...)` rendered
 * "Invalid Date" (founder smoke 2026-06-08). System metadata must be owned
 * by the app, not the model.
 */
describe('applyGeneratedMeta', () => {
  const llmHallucinatedNote = (): NoteBase =>
    ({
      schemaVersion: 7, // LLM hallucination (real bug: emitted 2 → forward-incompat)
      family: 'lecture',
      title: 'Real title from the model', // content field — must be preserved
      generatedAt: 'sometime yesterday', // LLM hallucination → "Invalid Date"
      generatedBy: { model: 'who-knows', promptVersion: 42 },
      language: 'en', // LLM hallucination — session was 'ja'
      durationSec: 0,
    }) as NoteBase;

  const meta = {
    generatedAt: '2026-06-08T12:00:00.000Z',
    model: 'llama-3.2-1b-q4-km',
    promptVersion: 1,
    language: 'ja' as const,
    durationSec: 8,
  };

  it('overwrites LLM-supplied schemaVersion with CURRENT_SCHEMA_VERSION', () => {
    const out = applyGeneratedMeta(llmHallucinatedNote(), meta);
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('overwrites generatedAt with a valid ISO date (fixes "Invalid Date")', () => {
    const out = applyGeneratedMeta(llmHallucinatedNote(), meta);
    expect(out.generatedAt).toBe('2026-06-08T12:00:00.000Z');
    expect(new Date(out.generatedAt).toString()).not.toBe('Invalid Date');
  });

  it('overwrites generatedBy with the real model + prompt version', () => {
    const out = applyGeneratedMeta(llmHallucinatedNote(), meta);
    expect(out.generatedBy).toEqual({ model: 'llama-3.2-1b-q4-km', promptVersion: 1 });
  });

  it('overwrites language with the actual session language', () => {
    const out = applyGeneratedMeta(llmHallucinatedNote(), meta);
    expect(out.language).toBe('ja');
  });

  it('overwrites durationSec with the measured value', () => {
    const out = applyGeneratedMeta(llmHallucinatedNote(), meta);
    expect(out.durationSec).toBe(8);
  });

  it('preserves model-authored content fields (title)', () => {
    const out = applyGeneratedMeta(llmHallucinatedNote(), meta);
    expect(out.title).toBe('Real title from the model');
  });

  it('mutates and returns the same note object (in-place)', () => {
    const note = llmHallucinatedNote();
    const out = applyGeneratedMeta(note, meta);
    expect(out).toBe(note);
  });
});

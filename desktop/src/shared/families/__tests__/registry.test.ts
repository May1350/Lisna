import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { familyRegistry, type FamilyDefinition, type MergeStrategy } from '../index';
import type { NoteFamily, NoteBase } from '@shared/note-schema/base';

describe('familyRegistry skeleton', () => {
  it('familyRegistry is an empty mutable record at the type-level (filled by Plans 3-6)', () => {
    // The registry is exported as a Record<NoteFamily, FamilyDefinition<any>>.
    // At Plan 2's landing, it's empty (or contains stub entries) — the
    // contract is what we're shipping, not the data.
    expect(typeof familyRegistry).toBe('object');
  });

  it('FamilyDefinition has the expected shape (type-level contract)', () => {
    // Compile-time assertion: a definition can be constructed.
    // (We don't run it — just verify the shape compiles.)
    type _CompileCheck<T extends NoteBase> = FamilyDefinition<T> extends {
      id: NoteFamily;
      schema: z.ZodType<T>;
      prompts: ReadonlyArray<{ variantId: string }>;
      defaultPromptVariant: string;
      evalBaselines: ReadonlyArray<string>;
      mergeStrategy: MergeStrategy;
    } ? true : false;
    const ok: _CompileCheck<NoteBase> = true;
    expect(ok).toBe(true);
  });

  it('MergeStrategy admits the alpha scalarPolicy/arrayPolicy unions', () => {
    const s: MergeStrategy = {
      scalarPolicy: 'longest',
      arrayPolicy: 'concat-dedup',
      sortByTs: true,
    };
    expect(s.scalarPolicy).toBe('longest');
  });
});

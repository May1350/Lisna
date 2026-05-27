import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  familyCoreRegistry,
  type FamilyCoreDefinition,
  type MergeStrategy,
} from '../index';
import {
  familyRendererRegistry,
  type FamilyRendererDefinition,
} from '../renderer';
import type { NoteFamily, NoteBase } from '@shared/note-schema/base';

describe('family registries skeleton', () => {
  it('familyCoreRegistry is an empty mutable record at the type-level (filled by Plans 3-6)', () => {
    expect(typeof familyCoreRegistry).toBe('object');
  });

  it('familyRendererRegistry is an empty mutable record at the type-level (filled by Plans 3-6 renderer-lane work)', () => {
    expect(typeof familyRendererRegistry).toBe('object');
  });

  it('FamilyCoreDefinition has the expected React-free shape (type-level contract)', () => {
    // Compile-time assertion: a core definition can be constructed.
    type _CoreCheck<T extends NoteBase> = FamilyCoreDefinition<T> extends {
      id: NoteFamily;
      schema: z.ZodType<T>;
      prompts: ReadonlyArray<{ variantId: string }>;
      defaultPromptVariant: string;
      evalBaselines: ReadonlyArray<string>;
      mergeStrategy: MergeStrategy;
    } ? true : false;
    const ok: _CoreCheck<NoteBase> = true;
    expect(ok).toBe(true);
  });

  it('FamilyRendererDefinition has the expected shape (type-level contract)', () => {
    type _RendererCheck<T extends NoteBase> = FamilyRendererDefinition<T> extends {
      id: NoteFamily;
    } ? true : false;
    const ok: _RendererCheck<NoteBase> = true;
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

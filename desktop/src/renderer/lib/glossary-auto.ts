import { suggestGlossaryTerms } from '@shared/stt/glossary';

export interface GlossaryEditDeps {
  getGlossary: () => Promise<string[]>;
  setGlossary: (terms: string[]) => Promise<string[]>;
}

/**
 * Extract new proper nouns from transcript edit before→after pairs and
 * auto-append them to the glossary (no confirm). Returns the terms actually
 * persisted — best-effort: the edit is already saved, so a glossary write
 * failure resolves to [] rather than throwing.
 */
export async function autoRegisterGlossaryFromEdit(
  pairs: readonly { before: string; after: string }[],
  deps: GlossaryEditDeps,
): Promise<string[]> {
  try {
    const existing = await deps.getGlossary();
    const terms = suggestGlossaryTerms(pairs, existing);
    if (terms.length === 0) return [];
    const saved = await deps.setGlossary([...existing, ...terms]);
    return terms.filter((t) => saved.includes(t));
  } catch {
    return [];
  }
}

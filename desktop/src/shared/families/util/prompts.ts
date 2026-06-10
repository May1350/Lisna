import type { ChatMessage } from '@shared/ipc-protocol';
import type { Language } from '@shared/types';

/** Inputs to chunkUserTemplate — per spec §5.2 chunk-render. */
export interface ChunkContext {
  chunkIndex: number;
  totalChunks: number;
  transcript: string;
}

/** Inputs to mergeUserTemplate — per spec §5.2c merge-LLM. Lecture has no merge call; this type exists for Meeting/Interview/Brainstorm variants. */
export interface MergeContext {
  partials: ReadonlyArray<unknown>;
}

/** Per spec §4.0. A versioned prompt artifact. */
export interface PromptVariant {
  version: number;
  variantId: string;
  systemTemplate: string;
  chunkUserTemplate: (ctx: ChunkContext) => string;
  mergeUserTemplate?: (ctx: MergeContext) => string;
  exemplars?: ChatMessage[];
  recommendedTemp: number;
  notes: string;
}

// ── Output-language adaptation (minimal EN support, 2026-06-10) ─────────────

const OUTPUT_LANGUAGE: Record<Exclude<Language, 'ja'>, string> = {
  en: 'English',
  ko: 'Korean',
  zh: 'Chinese',
};

// Matches the per-family "output must be Japanese" rule line in the
// EN-authored prompts (lecture/meeting). The trailing wording differs per
// family ("unless the lecture itself…" vs "unless the meeting itself…"),
// so match the stable prefix and consume the rest of the line.
const JA_RULE_LINE = /^- All user-visible text in the JSON MUST be Japanese[^\n]*$/m;

/**
 * Adapt a family system template to the session language.
 *
 * `ja` returns the template BYTE-IDENTICAL — v2.0 prompts were authored and
 * eval'd as JA-only, and the baseline must not drift. For other languages:
 *   - EN-authored prompts (lecture/meeting) get their JA output-rule line
 *     swapped for the target-language rule.
 *   - JA-native prompts (interview/brainstorm) get an explicit override
 *     appended — a full native rewrite of those prompts is the proper v2.1
 *     follow-up, gated on per-language eval.
 */
export function renderSystemTemplate(template: string, language: Language): string {
  if (language === 'ja') return template;
  const lang = OUTPUT_LANGUAGE[language];
  const rule = `- All user-visible text in the JSON MUST be ${lang}, unless the source itself uses terms from another language (then preserve as-is).`;
  if (JA_RULE_LINE.test(template)) {
    return template.replace(JA_RULE_LINE, rule);
  }
  return (
    template +
    `\n\nLANGUAGE OVERRIDE: The source audio is in ${lang}. All user-visible text in the JSON MUST be ${lang}.`
  );
}

export interface PromptSelectionOpts {
  /** User-set preference from settings (e.g. picker UI). */
  userPreference?: string;
  /** Env-var override name. Default 'LISNA_PROMPT_VARIANT'. */
  envVar?: string;
}

/**
 * Select a prompt variant by precedence:
 *   1. process.env[envVar] (if set AND that variantId exists)
 *   2. opts.userPreference (if set AND that variantId exists)
 *   3. familyDefaultVariantId
 *
 * Throws if the family default doesn't exist in `variants` (programmer
 * error — caught at first call).
 */
export function selectPromptVariant(
  variants: ReadonlyArray<PromptVariant>,
  familyDefaultVariantId: string,
  opts: PromptSelectionOpts = {},
): PromptVariant {
  const envVar = opts.envVar ?? 'LISNA_PROMPT_VARIANT';
  const envValue = process.env[envVar];
  if (envValue) {
    const fromEnv = variants.find(v => v.variantId === envValue);
    if (fromEnv) return fromEnv;
    // Unknown env value — fall through (don't error; env may be left from
    // an older config). Logged separately by the orchestrator if needed.
  }
  if (opts.userPreference) {
    const fromPref = variants.find(v => v.variantId === opts.userPreference);
    if (fromPref) return fromPref;
  }
  const def = variants.find(v => v.variantId === familyDefaultVariantId);
  if (!def) {
    throw new Error(
      `selectPromptVariant: family default '${familyDefaultVariantId}' not in variants`,
    );
  }
  return def;
}

import type { ChatMessage } from '@shared/ipc-protocol';

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

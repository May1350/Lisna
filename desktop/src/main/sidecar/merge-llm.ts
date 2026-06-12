import { z } from 'zod';
import { callWithGrammar, type LlmGenerator } from './grammar-call';
import type { SamplingParams } from '@shared/ipc-protocol';
import { familyCoreRegistry, selectPromptVariant, type MergeStrategy } from '@shared/families';
import { deterministicMerge } from '@shared/post-decode/deterministic-merge';
import { runPostDecodePipeline } from '@shared/post-decode/pipeline';
import { zodToGbnf } from '@shared/note-schema/zod-to-gbnf';
import type { SessionTranscript } from '@shared/note-schema/transcript';
import type { InterviewNote } from '@shared/families/interview/schema';
import type { BrainstormNote } from '@shared/families/brainstorm/schema';

export type MergeFamily = 'interview' | 'brainstorm';
export type MergedNote = InterviewNote | BrainstormNote;

export interface RunMergeOpts {
  family: MergeFamily;
  /** Per-chunk notes, already validated + provenance-hydrated by the per-chunk pipeline. */
  partials: Array<Record<string, unknown>>;
  /** Used to hydrate `from` on the LLM-synthesized derived fields before final validation. */
  transcript: SessionTranscript;
  baseSeed: number;
  generator: LlmGenerator;
  temperature?: number;
  maxAttempts?: number;
  maxTokens?: number;
  /** Sampler knobs forwarded verbatim to callWithGrammar (spec sampler-alignment §5). */
  sampling?: SamplingParams;
}

export interface MergeResultOk {
  ok: true;
  merged: MergedNote;
  attemptsUsed: number;
  latencyMs: number;
  validationWarnings: string[];
}

export interface MergeResultFail {
  ok: false;
  finalReason: string;
  attemptsUsed: number;
  latencyMs: number;
}

export type MergeResult = MergeResultOk | MergeResultFail;

const SCHEMA_NAME: Record<MergeFamily, string> = {
  interview: 'InterviewNote',
  brainstorm: 'BrainstormNote',
};

/**
 * Productionized cross-chunk merge for Interview + Brainstorm (Plan 6 Task 7).
 *
 * Spike 1.1 verdict = MIXED: a 3B model unions structured turns unreliably
 * (dropped 4 of 8 qa_pairs worst case). So this is a HYBRID merge, NOT the pure
 * LLM merge of the original plan pseudo-code:
 *
 *   1. `deterministicMerge` builds the structural base — qa_pairs unioned in
 *      code, participants/quotable_lines carried, scalars longest. The fields
 *      marked `merge-llm` in the family strategy are placeholders here.
 *   2. ONE grammar-constrained LLM call produces the derived prose; only the
 *      `merge-llm`-policy fields (interview: themes/key_takeaways/subject_summary;
 *      brainstorm: idea_clusters) are overlaid onto the base.
 *   3. `runPostDecodePipeline` re-hydrates provenance + ids on the overlaid
 *      fields and re-validates the whole note.
 *
 * On LLM failure (retries exhausted) or post-merge validation failure, returns
 * `ok:false`; the orchestrator (Task 13) falls back to a fully-deterministic
 * merge, which still preserves every qa_pair.
 */
export async function runMergeLLMCall(opts: RunMergeOpts): Promise<MergeResult> {
  const fam = familyCoreRegistry[opts.family];
  if (!fam) throw new Error(`${opts.family.toUpperCase()}_FAMILY_NOT_REGISTERED`);

  const strategy = fam.mergeStrategy;
  const llmFields = mergeLlmFields(strategy);

  // 1. Deterministic structural base (qa_pairs unioned, participants carried, …).
  const base = deterministicMerge<Record<string, unknown>>(opts.partials, strategy);

  // 2. Build the merge prompt the same way the per-chunk path builds chunk prompts
  //    (systemTemplate + user prompt; the sidecar applies the chat template).
  const prompt = selectPromptVariant(fam.prompts, fam.defaultPromptVariant);
  if (!prompt.mergeUserTemplate) {
    throw new Error(`${opts.family}: prompt variant '${prompt.variantId}' has no mergeUserTemplate`);
  }
  const userPrompt = prompt.mergeUserTemplate({ partials: opts.partials });
  const combinedPrompt = `${prompt.systemTemplate}\n\n${userPrompt}`;
  const grammar = zodToGbnf(fam.schema, SCHEMA_NAME[opts.family]);

  // 3. ONE grammar-constrained merge call (z.unknown() pass-through; validation
  //    happens once on the final overlaid note via runPostDecodePipeline).
  const t0 = Date.now();
  const result = await callWithGrammar<unknown>({
    prompt: combinedPrompt,
    schema: z.unknown(),
    grammar,
    baseSeed: opts.baseSeed,
    temperature: opts.temperature ?? prompt.recommendedTemp,
    maxAttempts: opts.maxAttempts ?? 3,
    maxTokens: opts.maxTokens ?? 4096,
    generator: opts.generator,
    sampling: opts.sampling,
  });

  if (!result.ok) {
    return {
      ok: false,
      finalReason: result.finalReason,
      attemptsUsed: result.attempts.length,
      latencyMs: Date.now() - t0,
    };
  }

  // 4. Overlay ONLY the derived (merge-llm) fields from the LLM onto the base.
  const llmNote =
    result.value && typeof result.value === 'object' && !Array.isArray(result.value)
      ? (result.value as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = { ...base };
  const warnings: string[] = [];
  for (const field of llmFields) {
    if (llmNote[field] !== undefined) {
      merged[field] = llmNote[field];
    } else {
      warnings.push(`merge: LLM omitted '${field}'; kept deterministic fallback`);
    }
  }

  // 5. Safety net for structured content nested inside an LLM field. Brainstorm
  //    ideas live inside idea_clusters (an LLM field), so the qa_pairs-style drop
  //    risk applies. A correct merge keeps at least the richest single chunk's
  //    ideas; fewer means the LLM lost some. Warn (don't re-inject) — unspiked.
  if (opts.family === 'brainstorm') {
    const maxSingle = Math.max(0, ...opts.partials.map(p => countIdeas(p['idea_clusters'])));
    const mergedCount = countIdeas(merged['idea_clusters']);
    if (mergedCount < maxSingle) {
      warnings.push(
        `merge: idea_clusters merge yielded ${mergedCount} idea(s), fewer than the richest chunk (${maxSingle}); review brainstorm clusters`,
      );
    }
  }

  // 6. Re-hydrate provenance/ids on the overlaid fields + validate the whole note.
  let validated: MergedNote;
  try {
    validated = runPostDecodePipeline(JSON.stringify(merged), fam, opts.transcript) as MergedNote;
  } catch (e) {
    return {
      ok: false,
      finalReason: `post-merge validation: ${e instanceof Error ? e.message : String(e)}`,
      attemptsUsed: result.attemptsUsed,
      latencyMs: Date.now() - t0,
    };
  }

  return {
    ok: true,
    merged: validated,
    attemptsUsed: result.attemptsUsed,
    latencyMs: Date.now() - t0,
    validationWarnings: warnings,
  };
}

/** Fields whose merge policy delegates synthesis to the LLM. */
function mergeLlmFields(strategy: MergeStrategy): string[] {
  const fields: string[] = [];
  for (const [field, override] of Object.entries(strategy.fieldOverrides ?? {})) {
    if (override.policy === 'merge-llm') fields.push(field);
  }
  return fields;
}

/** Total ideas across all clusters in a BrainstormNote's idea_clusters value. */
function countIdeas(clusters: unknown): number {
  if (!Array.isArray(clusters)) return 0;
  let n = 0;
  for (const cluster of clusters) {
    const ideas = (cluster as Record<string, unknown> | null)?.['ideas'];
    if (Array.isArray(ideas)) n += ideas.length;
  }
  return n;
}

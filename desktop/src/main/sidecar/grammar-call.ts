import type { z } from 'zod';

/**
 * Caller-supplied function that runs ONE grammar-constrained LLM call.
 * Production binds this to SidecarClient.generate() with grammar attached
 * (Task 13). Tests bind it to a mock that returns canned JSON.
 *
 * Returning `{ text }` keeps the surface narrow — the wrapper's job is
 * parse + validate + retry, not LLM-protocol details.
 */
export type LlmGenerator = (opts: {
  prompt: string;
  grammar: string;
  seed: number;
  temperature: number;
  maxTokens: number;
}) => Promise<{ text: string; seed: number }>;

/** Per-attempt observability record. Surfaces in both success + failure shapes. */
export interface GrammarAttempt {
  attempt: number;          // 1-indexed
  seed: number;
  latencyMs: number;
  ok: boolean;
  reason?: string;          // populated when ok = false
}

export interface GrammarCallSuccess<T> {
  ok: true;
  value: T;
  attemptsUsed: number;
  attempts: GrammarAttempt[];
}

export interface GrammarCallFailure {
  ok: false;
  attempts: GrammarAttempt[];
  finalReason: string;      // = last attempt's reason
}

export type GrammarCallResult<T> = GrammarCallSuccess<T> | GrammarCallFailure;

export interface GrammarCallOpts<T> {
  prompt: string;
  schema: z.ZodType<T>;
  grammar: string;
  baseSeed: number;
  temperature: number;
  maxAttempts: number;
  maxTokens: number;
  generator: LlmGenerator;
}

/**
 * Run a grammar-constrained LLM call with `maxAttempts` retries.
 * Implementation completed in Task 12 — Task 11 stub returns ok on first
 * call (no retry loop yet).
 */
export async function callWithGrammar<T>(
  opts: GrammarCallOpts<T>,
): Promise<GrammarCallResult<T>> {
  const attempts: GrammarAttempt[] = [];
  const seed = opts.baseSeed;
  const t0 = Date.now();
  const r = await opts.generator({
    prompt: opts.prompt,
    grammar: opts.grammar,
    seed,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
  });
  const latencyMs = Date.now() - t0;
  const value = opts.schema.parse(JSON.parse(r.text));
  attempts.push({ attempt: 1, seed, latencyMs, ok: true });
  return { ok: true, value, attemptsUsed: 1, attempts };
}

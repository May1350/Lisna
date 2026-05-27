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
 * Run a grammar-constrained LLM call with retry. Per Spike 0.1 take-4
 * contract (see `desktop/spikes/phase-0/01-zod-to-gbnf/decision-0.1-fail.md`
 * + take-4 in `decision-0.1-success.md`):
 *
 *   - Up to `maxAttempts` attempts (1-indexed).
 *   - Fresh seed per attempt: `baseSeed + (attempt - 1) * 100`.
 *   - Temperature stays constant across attempts.
 *   - Catches JSON.parse failure, Zod validation failure, AND generator
 *     rejection — each becomes a failed attempt with a populated `reason`
 *     and triggers a retry until `maxAttempts` exhausted.
 *   - Surfaces per-attempt `seed`, `latencyMs`, `ok`, `reason` so Plan 7's
 *     eval harness can score retry-rate as a quality axis (carry-forward #8).
 */
export async function callWithGrammar<T>(
  opts: GrammarCallOpts<T>,
): Promise<GrammarCallResult<T>> {
  const attempts: GrammarAttempt[] = [];
  let lastReason = 'no attempts run (maxAttempts < 1)';

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const seed = opts.baseSeed + (attempt - 1) * 100;
    const t0 = Date.now();
    let ok = false;
    let reason: string | undefined;
    let value: T | undefined;

    try {
      const r = await opts.generator({
        prompt: opts.prompt,
        grammar: opts.grammar,
        seed,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
      });
      const parsed = JSON.parse(r.text);
      value = opts.schema.parse(parsed);
      ok = true;
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
      lastReason = reason;
    }

    const latencyMs = Date.now() - t0;
    attempts.push({ attempt, seed, latencyMs, ok, reason });
    if (ok && value !== undefined) {
      return { ok: true, value, attemptsUsed: attempt, attempts };
    }
  }

  return { ok: false, attempts, finalReason: lastReason };
}

/**
 * Minimal sidecar surface the wrapper needs. The real `SidecarClient`
 * grows a `generateWithGrammar` method in Plan 3 (touches C++ to add a
 * `grammar` field to the generate IPC envelope). Until then, this
 * factory exists as a typed seam so Plan 2 can publish a stable API.
 */
export interface GrammarCapableSidecar {
  generateWithGrammar(req: {
    prompt: string;
    grammar: string;
    seed: number;
    temperature: number;
    maxTokens: number;
  }): Promise<{ text: string; seed: number }>;
}

/**
 * Bind `callWithGrammar`'s LlmGenerator to a SidecarClient that supports
 * grammar-constrained generation. Plan 3 will add `generateWithGrammar`
 * to the real client.
 */
export function makeSidecarGenerator(client: GrammarCapableSidecar): LlmGenerator {
  return async ({ prompt, grammar, seed, temperature, maxTokens }) =>
    client.generateWithGrammar({ prompt, grammar, seed, temperature, maxTokens });
}

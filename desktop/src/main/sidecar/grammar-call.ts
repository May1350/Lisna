import type { z } from 'zod';
import type { SidecarClient } from './client';
import { TIMEOUTS } from './timeouts';

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
  /**
   * JSON paths of string slots where the sanitize stage made repairs (mode-
   * collapse recovery). Empty/undefined on healthy output. Lets the eval
   * harness (Plan 7) score the silent-recovery rate so production model
   * degradation can't hide behind sanitize.
   */
  sanitizedSlots?: string[];
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
 * Sanitize one JS string: shape-AGNOSTIC mode-collapse recovery.
 *
 * Three passes (in order):
 *   1. Decode any `\uXXXX` literal sequences via String.fromCharCode (covers
 *      the founder-reported shape where `今` ASCII renders as 6 chars).
 *   2. Nuke any remaining backslashes (covers this run's `\\'<NL>...` and
 *      future variants — the reviewer's "enumerate the legitimate-content
 *      boundary, not the observed shapes" guidance).
 *   3. Trim a leading/trailing run of ASCII quote / whitespace / control
 *      noise that typically wraps a recovered term in mode-collapse output.
 *      Full-width JA punctuation (e.g. `。「」`) is preserved.
 *
 * Returns the cleaned string; caller compares to the original to decide
 * whether anything was sanitized.
 */
function sanitizeStringValue(s: string): string {
  let out = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  out = out.replace(/\\/g, '');
  out = out.replace(/^['"\s\n\r\t]+/, '').replace(/['"\s\n\r\t]+$/, '');
  return out;
}

/**
 * Walk a JSON-parsed value; recursively apply `sanitizeStringValue` to every
 * string leaf. Returns the (possibly-mutated) value AND the JSON paths of
 * slots that were actually repaired — useful as telemetry for the eval
 * harness so silent recovery doesn't mask model degradation.
 *
 * Caller runs this BEFORE the `findEscapeLiteralInStrings` final-invariant
 * check, so the detector only fires when sanitize couldn't recover.
 *
 * Heuristic assumes no production family legitimately needs backslashes in
 * string content. If a future (Code-)family does, route generation through
 * a separate path that skips this stage.
 */
export function sanitizeEscapeLiteralsInStrings<T>(
  value: T,
  path = '$',
): { value: T; sanitizedSlots: string[] } {
  const slots: string[] = [];
  const walked = walk(value, path, slots);
  return { value: walked as T, sanitizedSlots: slots };
}

function walk(value: unknown, path: string, slots: string[]): unknown {
  if (typeof value === 'string') {
    const cleaned = sanitizeStringValue(value);
    if (cleaned !== value) slots.push(path);
    return cleaned;
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => walk(v, `${path}[${i}]`, slots));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = walk(v, `${path}.${k}`, slots);
    }
    return out;
  }
  return value;
}

/**
 * Walk a JSON-parsed value; return the first string-typed leaf containing a
 * backslash, along with its JSON path. Healthy JA notes do not contain
 * backslashes in any string slot — a backslash in the DECODED value is the
 * fingerprint of grammar-mode-collapsed output where the model emitted
 * source-code-style escape sequences (`\\u…`, `\\'`, `\\n`) as literal text.
 *
 * Used as the FINAL INVARIANT after `sanitizeEscapeLiteralsInStrings` — a
 * positive hit means sanitize couldn't recover the slot, so we burn the
 * attempt and trigger the existing fresh-seed retry contract.
 *
 * Background: founder smoke 2026-06-09; see memory
 * `v2_track2_escape_literal_phase1_2026-06-09`.
 *
 * Caveat (future-proofing): the heuristic assumes no production family
 * legitimately needs backslashes in string content. If a future
 * (Code-)family does, gate this at the family-aware `runPostDecodePipeline`
 * layer instead.
 */
export function findEscapeLiteralInStrings(
  value: unknown,
  path = '$',
): { path: string; sample: string } | null {
  if (typeof value === 'string') {
    if (value.includes('\\')) {
      return { path, sample: value.slice(0, 40) };
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = findEscapeLiteralInStrings(value[i], `${path}[${i}]`);
      if (r) return r;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const r = findEscapeLiteralInStrings(v, `${path}.${k}`);
      if (r) return r;
    }
    return null;
  }
  return null;
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
    let sanitizedSlots: string[] | undefined;

    try {
      const r = await opts.generator({
        prompt: opts.prompt,
        grammar: opts.grammar,
        seed,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
      });
      const parsed = JSON.parse(r.text);
      // Mode-collapse recovery (added 2026-06-09): sanitize first
      // (shape-agnostic), THEN detect as the final invariant. If sanitize
      // recovered cleanly, we proceed; if a backslash survives, we throw and
      // the existing fresh-seed retry contract picks up.
      const { value: sanitized, sanitizedSlots: slots } =
        sanitizeEscapeLiteralsInStrings(parsed);
      if (slots.length > 0) sanitizedSlots = slots;
      const literal = findEscapeLiteralInStrings(sanitized);
      if (literal) {
        throw new Error(
          `ESCAPE_LITERAL_AT_${literal.path}:${JSON.stringify(literal.sample)}`,
        );
      }
      value = opts.schema.parse(sanitized);
      ok = true;
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
      lastReason = reason;
    }

    const latencyMs = Date.now() - t0;
    const att: GrammarAttempt = { attempt, seed, latencyMs, ok, reason };
    if (sanitizedSlots) att.sanitizedSlots = sanitizedSlots;
    attempts.push(att);
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

/**
 * Concrete GrammarCapableSidecar backed by a SidecarClient. Wraps the combined
 * prompt as a single `user` message (so the GGUF chat template applies; avoids
 * the legacy `prompt`-field path), streams the grammar-constrained generation,
 * and accumulates tokens. Echoes the input seed (the C++ side does not return it;
 * callWithGrammar uses its own seed regardless).
 */
export function makeGrammarSidecar(client: SidecarClient): GrammarCapableSidecar {
  return {
    async generateWithGrammar({ prompt, grammar, seed, temperature, maxTokens }) {
      let text = '';
      for await (const tok of client.sendStream(
        {
          type: 'generate',
          messages: [{ role: 'user', content: prompt }],
          grammar,
          seed,
          temperature,
          maxTokens,
        },
        { timeoutMs: TIMEOUTS.GENERATE_NO_PROGRESS_MS },
      )) {
        text += tok;
      }
      return { text, seed };
    },
  };
}

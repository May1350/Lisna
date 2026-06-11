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
}) => Promise<{ text: string; seed: number; stats?: { tokensOut: number; genMs: number } }>;

/** Per-attempt observability record. Surfaces in both success + failure shapes. */
export interface GrammarAttempt {
  attempt: number;          // 1-indexed
  seed: number;
  latencyMs: number;
  /** Sidecar-reported decode stats (absent on older binaries / failed attempts).
   *  tokensOut/genMs discriminate "output too long" from "decode too slow" —
   *  the 1-min-target decomposition (2026-06-10). */
  tokensOut?: number;
  genMs?: number;
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
  /**
   * Session language for the grounding guard (`findLanguageMismatch`). When
   * 'ja', an attempt whose user-visible strings carry ~zero Japanese script
   * is rejected as fabrication (NOTE_LANGUAGE_MISMATCH) and retried. Omit to
   * disable (en sessions — English can't be script-checked — and the
   * merge-LLM path, which synthesizes from already-guarded partials).
   */
  expectedLanguage?: 'ja' | 'en' | 'ko';
}

/**
 * LaTeX commands that legitimately carry a backslash in note string slots.
 * The Lecture formula slot's promptHint explicitly invites LaTeX
 * ("LaTeX-style fine" — `shared/families/lecture/slots/formula.ts`), so the
 * legitimate-content boundary is NOT "no backslashes" — it's "no backslashes
 * except LaTeX commands". First production firing of the sanitizer
 * (2026-06-11, founder 13-min JA finance lecture) was a false positive:
 * `\frac{\text{利益}}{\text{資本}}` was stripped to `frac{text{利益}}…`.
 *
 * Allowlist (not a generic `\[a-z]+` pattern) so mode-collapse junk that
 * happens to look like a word escape (`\n…`, `\u…`, `\hit`) is still nuked.
 */
const LATEX_COMMANDS = [
  // structure / text
  'frac', 'dfrac', 'tfrac', 'text', 'textbf', 'textit', 'mathrm', 'mathbf',
  'mathit', 'mathcal', 'mathbb', 'operatorname', 'left', 'right', 'begin',
  'end', 'overline', 'underline', 'hat', 'bar', 'vec', 'tilde', 'dot', 'ddot',
  // operators / functions
  'times', 'cdot', 'div', 'pm', 'mp', 'sqrt', 'sum', 'prod', 'int', 'lim',
  'log', 'ln', 'exp', 'sin', 'cos', 'tan', 'max', 'min', 'infty', 'partial',
  'nabla',
  // relations
  'le', 'leq', 'ge', 'geq', 'neq', 'approx', 'equiv', 'sim', 'propto', 'in',
  'notin', 'subset', 'supset', 'cup', 'cap', 'forall', 'exists',
  // arrows / dots
  'to', 'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow',
  'leftrightarrow', 'mapsto', 'dots', 'cdots', 'ldots', 'vdots',
  // greek
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta',
  'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma',
  'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta',
  'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega',
];

// `(?![a-zA-Z])` so `\textbf` can't half-match as `\text` + junk `bf` —
// regex alternation backtracks into the longer alternative, so list order
// is not load-bearing.
const LATEX_COMMAND_PATTERN = `\\\\(?:${LATEX_COMMANDS.join('|')})(?![a-zA-Z])`;
const LATEX_MASK_RE = new RegExp(LATEX_COMMAND_PATTERN, 'g');
// Single pass: keep an allowlisted `\cmd` whole, drop junk backslashes.
// Junk matches as a RUN — but each backslash in the run carries a negative
// lookahead so the run can never swallow a backslash that starts a kept
// command (a greedy `\\\\+` would eat `\\frac`'s second backslash). Run
// matching matters: with per-backslash drops, `\pi\\iri`'s two junk
// backslashes each see `\` as a neighbor, skip the space, and fuse into
// `\piiri` — which fails the final invariant (review round 2).
const JUNK_BACKSLASH = `\\\\(?!(?:${LATEX_COMMANDS.join('|')})(?![a-zA-Z]))`;
const KEEP_LATEX_OR_STRIP_RE = new RegExp(
  `(${LATEX_COMMAND_PATTERN})|(?:${JUNK_BACKSLASH})+`,
  'g',
);

/**
 * Sanitize one JS string: shape-AGNOSTIC mode-collapse recovery.
 *
 * Three passes (in order):
 *   1. Decode any `\uXXXX` literal sequences via String.fromCharCode (covers
 *      the founder-reported shape where `今` ASCII renders as 6 chars).
 *   2. Nuke any remaining backslashes EXCEPT allowlisted LaTeX commands
 *      (covers this run's `\\'<NL>...` and future variants — the reviewer's
 *      "enumerate the legitimate-content boundary, not the observed shapes"
 *      guidance; since 2026-06-11 the boundary includes LATEX_COMMANDS).
 *      A dropped RUN of junk backslashes sitting between two ASCII letters
 *      leaves a space, not nothing: plain deletion in `\frac\n{x}` or
 *      `\pi\\iri` would merge into `\fracn` / `\piiri`, strings that fail
 *      `findEscapeLiteralInStrings` and burn every fresh-seed retry on a
 *      slot this function claimed to have repaired.
 *   3. Trim a leading/trailing run of ASCII quote / whitespace / control
 *      noise that typically wraps a recovered term in mode-collapse output.
 *      Full-width JA punctuation (e.g. `。「」`) is preserved.
 *
 * CONTRACT: output must always satisfy `findEscapeLiteralInStrings` (the
 * two share LATEX_COMMANDS) — see the lockstep test in grammar-call.test.ts.
 *
 * Returns the cleaned string; caller compares to the original to decide
 * whether anything was sanitized.
 */
function sanitizeStringValue(s: string): string {
  let out = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  out = out.replace(
    KEEP_LATEX_OR_STRIP_RE,
    (m, latex: string | undefined, offset: number, whole: string) => {
      if (latex !== undefined) return latex;
      const prev = whole[offset - 1] ?? '';
      const next = whole[offset + m.length] ?? '';
      return /[a-zA-Z]/.test(prev) && /[a-zA-Z]/.test(next) ? ' ' : '';
    },
  );
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
 * Heuristic assumes the only legitimate backslashes in production string
 * content are LaTeX commands (LATEX_COMMANDS). If a future (Code-)family
 * needs arbitrary backslashes, route generation through a separate path
 * that skips this stage.
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
 * backslash OUTSIDE an allowlisted LaTeX command, along with its JSON path.
 * Healthy JA notes contain backslashes only as LaTeX (see LATEX_COMMANDS) —
 * any other backslash in the DECODED value is the fingerprint of
 * grammar-mode-collapsed output where the model emitted source-code-style
 * escape sequences (`\\u…`, `\\'`, `\\n`) as literal text.
 *
 * Used as the FINAL INVARIANT after `sanitizeEscapeLiteralsInStrings` — a
 * positive hit means sanitize couldn't recover the slot, so we burn the
 * attempt and trigger the existing fresh-seed retry contract. MUST share
 * LATEX_COMMANDS with sanitize: anything sanitize preserves but this flags
 * would burn every retry on legitimate output.
 *
 * Background: founder smoke 2026-06-09; see memory
 * `v2_track2_escape_literal_phase1_2026-06-09`. LaTeX exemption added after
 * the 2026-06-11 production false positive.
 *
 * Caveat (future-proofing): the heuristic assumes no production family
 * legitimately needs non-LaTeX backslashes in string content. If a future
 * (Code-)family does, gate this at the family-aware `runPostDecodePipeline`
 * layer instead.
 */
export function findEscapeLiteralInStrings(
  value: unknown,
  path = '$',
): { path: string; sample: string } | null {
  if (typeof value === 'string') {
    if (value.replace(LATEX_MASK_RE, '').includes('\\')) {
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

// ─── Language-mismatch guard (fabrication circuit-breaker, 2026-06-12) ────────
//
// Production incident (dump 2026-06-11T16-14-00-372Z): the 3B ignored a 9k-char
// Japanese interview transcript and emitted a memorized ENGLISH boilerplate
// template — grammar-valid, schema-valid, Zod-passing, so every structural
// check stayed green and a 100%-fabricated note shipped to the founder. The
// cheap, near-zero-false-positive symptom: a JA-session note whose user-visible
// strings contain ~zero Japanese script CANNOT be grounded in a Japanese
// transcript. This guard rejects the attempt so the existing fresh-seed retry
// ladder gets a chance, and exhaustion fails LOUD instead of shipping fiction.
//
// What it deliberately does NOT catch: fabrication written IN Japanese (needs
// term-overlap grounding — tier 2) and en-session fabrication (English can't
// be script-checked). Those are the model/prompt track's job; this is a floor.

/** Japanese-script codepoints: hiragana, katakana, kanji (+ExtA), halfwidth
 * kana, JP punctuation. Mirrors `tokens.ts` CJK ranges MINUS fullwidth ASCII
 * (Ａ-Ｚ should not count as "Japanese" here). */
const JA_SCRIPT_RE = /[぀-ゟ゠-ヿ一-鿿㐀-䶿｡-ﾟ\u3000-〿]/g;

/** System slots whose values are legitimately ASCII (enums, ids, ISO dates) —
 * excluded so they can't dilute the ratio on short notes. */
const LANGUAGE_CHECK_EXCLUDED_KEYS = new Set([
  'family', 'language', 'from', 'model', 'generatedAt', 'experimentArmId',
]);

/** Below this many checked chars the note is too small to judge — stay inert
 * (the schema's .min(1) floors make near-empty notes a separate failure). */
const LANGUAGE_CHECK_MIN_CHARS = 100;

/** A JA note dominated by English terms/LaTeX still sits well above this
 * (measured ≥0.15 on real notes); the fabricated-English incident note was
 * ~0.00. The wide margin is deliberate — #114 taught us a guard's own false
 * positive burns every retry on legitimate output. */
const JA_RATIO_MIN = 0.05;

function collectCheckedText(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectCheckedText(v, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (LANGUAGE_CHECK_EXCLUDED_KEYS.has(k)) continue;
      collectCheckedText(v, out);
    }
  }
}

/**
 * Grounding guard: returns mismatch evidence when `expectedLanguage` is 'ja'
 * but the note's user-visible text is not meaningfully Japanese. Null = pass
 * (including: non-ja expectations, and notes under the size floor).
 */
export function findLanguageMismatch(
  value: unknown,
  expectedLanguage: 'ja' | 'en' | 'ko' | undefined,
): { ratio: number; checkedChars: number } | null {
  if (expectedLanguage !== 'ja') return null;
  const parts: string[] = [];
  collectCheckedText(value, parts);
  const text = parts.join('');
  if (text.length < LANGUAGE_CHECK_MIN_CHARS) return null;
  const jaChars = (text.match(JA_SCRIPT_RE) ?? []).length;
  const ratio = jaChars / text.length;
  if (ratio >= JA_RATIO_MIN) return null;
  return { ratio, checkedChars: text.length };
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
    let stats: { tokensOut: number; genMs: number } | undefined;

    try {
      const r = await opts.generator({
        prompt: opts.prompt,
        grammar: opts.grammar,
        seed,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
      });
      stats = r.stats;
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
      const mismatch = findLanguageMismatch(sanitized, opts.expectedLanguage);
      if (mismatch) {
        throw new Error(
          `NOTE_LANGUAGE_MISMATCH:ratio=${mismatch.ratio.toFixed(3)},checked=${mismatch.checkedChars}`,
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
    if (stats) {
      att.tokensOut = stats.tokensOut;
      att.genMs = stats.genMs;
    }
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
  }): Promise<{ text: string; seed: number; stats?: { tokensOut: number; genMs: number } }>;
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
      let stats: { tokensOut: number; genMs: number } | undefined;
      for await (const tok of client.sendStream(
        {
          type: 'generate',
          messages: [{ role: 'user', content: prompt }],
          grammar,
          seed,
          temperature,
          maxTokens,
        },
        { timeoutMs: TIMEOUTS.GENERATE_NO_PROGRESS_MS, onDone: (s) => { stats = s; } },
      )) {
        text += tok;
      }
      return { text, seed, stats };
    },
  };
}

/**
 * SDK-boundary result handling for the cloud note path — split out of
 * claude-notes.ts to keep that file under the repo's 200-line new-file
 * review threshold. Two cohesive units live here:
 *   - `classifyCloudError`: typed SDK error → CONNECTOR_* code (flow
 *     contract step 5)
 *   - `parseAndValidate`: SDK response text → schema-valid note (flow
 *     contract steps 3-4), with its private helpers (fence strip,
 *     meta-stub injection, text-block extraction)
 * Same never-log invariant as claude-notes.ts: no key/transcript/prompt/
 * note content in logs or error messages — counts/ratios only.
 */
import Anthropic from '@anthropic-ai/sdk';
import { ZodError } from 'zod';
import { runPostDecodePipeline } from '@shared/post-decode/pipeline';
import type { FamilyCoreDefinition } from '@shared/families';
import type { NoteBase, NoteLanguage } from '@shared/note-schema/base';
import type { SessionTranscript } from '@shared/note-schema/transcript';
import { findLanguageMismatch } from '../sidecar/grammar-call';

/** Minimal shape of an Anthropic Messages response this module needs —
 * decoupled from the full SDK `Message` type so tests can mock without
 * constructing every field (id, model, role, usage, ...). `stop_reason`
 * (H1/H2) drives claude-notes.ts's truncation-aware retry — 'max_tokens'
 * means the JSON was cut mid-stream, not merely malformed. */
export interface CloudMessageResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason: string | null;
}

/**
 * Classifies a thrown error from `client.messages.create` per the flow
 * contract's typed-class table (never string-match, except the one
 * credit/billing discrimination inside `BadRequestError`). Always throws —
 * SDK errors are NOT retried by the attempt loop (the SDK's own
 * `maxRetries: 1` already handles transient 5xx).
 */
export function classifyCloudError(err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError) throw new Error('CONNECTOR_AUTH_INVALID');
  if (err instanceof Anthropic.RateLimitError) throw new Error('CONNECTOR_RATE_LIMITED');
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit|billing/i.test(err.message)) throw new Error('CONNECTOR_NO_CREDIT');
    throw new Error('CONNECTOR_BAD_RESPONSE');
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) throw new Error('CONNECTOR_TIMEOUT');
  if (err instanceof Anthropic.APIConnectionError) throw new Error('CONNECTOR_OFFLINE');
  // M13 — 500 and 529 (Overloaded) share ONE SDK class in the installed
  // @anthropic-ai/sdk 0.91: `core/error.js`'s `APIError.generate()` maps any
  // `status >= 500` to `InternalServerError` — there is no separate
  // "Overloaded" class to check. MUST come before the generic APIError
  // fallback below (InternalServerError extends APIError).
  if (err instanceof Anthropic.InternalServerError) throw new Error('CONNECTOR_SERVER_BUSY');
  if (err instanceof Anthropic.APIError) throw new Error('CONNECTOR_BAD_RESPONSE');
  throw err;
}

/**
 * H1 — classify a `parseAndValidate` failure into a SANITIZED taxonomy
 * string for the `CONNECTOR_BAD_RESPONSE:<reason>` suffix (mirrors the
 * `CHUNK_FAILED:<i>:<reason>` diagnostic convention already used on-device).
 * NEVER returns the raw error message — a JSON.parse SyntaxError can echo
 * payload characters. Zod issue paths are schema FIELD NAMES (e.g.
 * "decisions"), not user content, so they're safe to surface. Truncation is
 * NOT a member of this taxonomy: claude-notes.ts's attempt loop checks
 * `response.stop_reason === 'max_tokens'` BEFORE calling this classifier and
 * throws the dedicated `CONNECTOR_OUTPUT_TRUNCATED` code instead, so this
 * function only ever runs for a non-truncated failure.
 */
export function classifyValidationFailure(err: unknown): string {
  if (err instanceof ZodError) {
    const path = err.issues[0]?.path.join('.');
    return `schema:${path || 'unknown'}`;
  }
  if (err instanceof Error && /ja grounding guard/i.test(err.message)) return 'lang-mismatch';
  return 'parse';
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1]! : trimmed;
}

/**
 * Meta-stub injection (flow contract step 3): parsed content spreads OVER
 * the stubs, except the system-owned fields, which are stub-forced (spread
 * last so they always win — the model is told not to emit them, but the
 * grammar-free cloud path can't stop it from trying). Same placeholder
 * pattern as `meeting/assemble.ts`'s NoteBase stub. `runPostDecodePipeline`
 * needs valid-shaped values here to pass Stage 4's `.strict()` parse;
 * `applyGeneratedMeta` overwrites all of them with real values afterward.
 */
function injectMetaStubs(
  parsed: Record<string, unknown>,
  language: NoteLanguage,
  durationSec: number,
): Record<string, unknown> {
  return {
    ...parsed,
    schemaVersion: 1,
    generatedAt: '',
    generatedBy: { model: '', promptVersion: 0 },
    language,
    durationSec,
  };
}

function extractResponseText(response: CloudMessageResponse): string {
  const block = response.content.find((b) => b.type === 'text' && typeof b.text === 'string');
  if (!block || typeof block.text !== 'string') {
    throw new Error('cloud response had no text content block');
  }
  return block.text;
}

/**
 * Turn a raw SDK response into a schema-valid note: extract the first text
 * block, strip optional ```json fences, JSON.parse, inject system-meta
 * stubs, run the ja grounding guard, then the full post-decode pipeline
 * (fills `from`/ids, drops empties, `.strict()` schema parse). Throws on
 * any failure — the caller's attempt loop maps that to retry-or-
 * CONNECTOR_BAD_RESPONSE.
 */
export function parseAndValidate(
  response: CloudMessageResponse,
  family: FamilyCoreDefinition<NoteBase>,
  args: { transcript: SessionTranscript; language: NoteLanguage; durationSec: number },
): NoteBase {
  const rawText = extractResponseText(response);
  const jsonText = stripJsonFences(rawText);
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  const injected = injectMetaStubs(parsed, args.language, args.durationSec);

  const mismatch = findLanguageMismatch(injected, args.language);
  if (mismatch) {
    throw new Error(
      `cloud note failed the ja grounding guard (ratio=${mismatch.ratio}, checkedChars=${mismatch.checkedChars})`,
    );
  }

  return runPostDecodePipeline(JSON.stringify(injected), family, args.transcript) as NoteBase;
}

/**
 * Cloud note generation core (spec 2026-07-07 section 5, section 8a) — the LLM connector's
 * single-shot path: one Claude API call on the user's own subscription turns
 * a whole transcript into a schema-valid family note. Counterpart to the
 * on-device grammar-constrained chunked path (`sidecar/orchestrator.ts`);
 * this path has no chunking and no GBNF grammar — the model free-writes JSON
 * and `runPostDecodePipeline` validates it the same way a chunk result is
 * validated on-device.
 *
 * NEVER log the API key, transcript, prompt, or note content — telemetry is
 * counts/durations only (see `CloudNoteDeps.onEvent` and the returned
 * `telemetry` shape).
 */
import { loadApiKey as loadApiKeyDefault } from './claude-auth';
import {
  classifyCloudError,
  classifyValidationFailure,
  parseAndValidate,
  type CloudMessageResponse,
} from './claude-errors';
import { defaultCreateClient, type CloudMessages } from './claude-client';
import { buildCloudNotePrompt, CLOUD_PROMPT_VERSION } from '@shared/families/util/cloud-prompt';
import { familyCoreRegistry } from '@shared/families';
import { applyGeneratedMeta } from '@shared/note-schema/apply-generated-meta';
import type { NoteBase, NoteFamily, NoteLanguage } from '@shared/note-schema/base';
import type { SessionTranscript } from '@shared/note-schema/transcript';

// Re-export so consumers (tests, Task 6) keep a single import surface.
export type { CloudMessageResponse } from './claude-errors';
export type { CloudMessages, CloudMessageStream } from './claude-client';

// Side-effect imports: register family cores so familyCoreRegistry is
// populated. Same convention as session-finalize.ts — registration happens
// once per process via module load, not per call.
import '@shared/families/lecture/core';
import '@shared/families/meeting/core';
import '@shared/families/interview/core';
import '@shared/families/brainstorm/core';

/** Overridable, not scattered — spec section 8a. */
export const CLOUD_MODEL = process.env.LISNA_CLOUD_MODEL ?? 'claude-sonnet-5';

/** 1M-token context safety margin; cheap, practically never fires. */
const TRANSCRIPT_CHAR_LIMIT = 700_000;
const MAX_TOKENS_INITIAL = 16_000;
/** H2 — bumped cap for the ONE truncation-triggered retry. Never reused at
 * the same cap twice (that would just burn money on the same truncation). */
const MAX_TOKENS_RETRY = 32_000;
/** M14 — overall per-call abort. Matches the SDK's own DEFAULT_TIMEOUT (10
 * min, see client.js) rather than undercutting it — the prior 300_000 (5 min)
 * sat BELOW the SDK's documented worst-case budget for max_tokens=16000,
 * so the client aborted requests that were slowly succeeding (and being
 * billed). Verified: RequestOptions.timeout applies uniformly to `.stream()`
 * and `.create()` (both funnel through client.js's `fetchWithTimeout`, which
 * wraps the single underlying fetch — including the whole SSE stream
 * duration — in one AbortController timeout from request start).
 */
const TIMEOUT_MS = 600_000;
const MAX_ATTEMPTS = 2;

export interface CloudGenerateArgs {
  family: NoteFamily;
  transcript: SessionTranscript;
  language: NoteLanguage;
  durationSec: number;
}

export type CloudNoteEvent = { kind: 'cloud-start' } | { kind: 'cloud-retry'; attempt: number };

export interface CloudNoteDeps {
  /** Injectable for tests — defaults to claude-auth's `loadApiKey`. */
  loadApiKey?: () => Promise<string | null>;
  /** Injectable for tests — defaults to a real Anthropic client (`maxRetries: 1`). */
  createClient?: (apiKey: string) => CloudMessages;
  onEvent?: (e: CloudNoteEvent) => void;
}

function totalTranscriptChars(transcript: SessionTranscript): number {
  let total = 0;
  for (const seg of transcript.transcriptSegments) total += seg.text.length;
  return total;
}

export interface CloudNoteTelemetry {
  model: string;
  durationMs: number;
  inputChars: number;
  attempts: number;
}

export async function generateCloudNote(
  args: CloudGenerateArgs,
  deps: CloudNoteDeps = {},
): Promise<{ note: NoteBase; telemetry: CloudNoteTelemetry }> {
  const loadApiKey = deps.loadApiKey ?? loadApiKeyDefault;
  const apiKey = await loadApiKey();
  if (apiKey === null) throw new Error('CONNECTOR_NO_KEY');

  const inputChars = totalTranscriptChars(args.transcript);
  if (inputChars > TRANSCRIPT_CHAR_LIMIT) throw new Error('CONNECTOR_TRANSCRIPT_TOO_LONG');

  const family = familyCoreRegistry[args.family];
  if (!family) throw new Error(`Unknown note family: ${args.family}`);

  const { system, user } = buildCloudNotePrompt(args.family, args.transcript, args.language);

  const createClient = deps.createClient ?? defaultCreateClient;
  const client = createClient(apiKey);

  deps.onEvent?.({ kind: 'cloud-start' });

  const start = Date.now();
  let maxTokens = MAX_TOKENS_INITIAL;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: CloudMessageResponse;
    try {
      const stream = client.messages.stream(
        {
          model: CLOUD_MODEL,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
        },
        { timeout: TIMEOUT_MS },
      );
      response = await stream.finalMessage();
    } catch (err) {
      classifyCloudError(err);
    }

    try {
      const note = parseAndValidate(response, family, args);
      applyGeneratedMeta(note, {
        generatedAt: new Date().toISOString(),
        model: CLOUD_MODEL,
        promptVersion: CLOUD_PROMPT_VERSION,
        language: args.language,
        durationSec: args.durationSec,
        origin: 'claude',
      });
      return {
        note,
        telemetry: { model: CLOUD_MODEL, durationMs: Date.now() - start, inputChars, attempts: attempt },
      };
    } catch (validateErr) {
      // H2 — a truncated response (stop_reason='max_tokens') will fail
      // parse/validate the same way every time at the same cap; retrying
      // blind just doubles the bill for the same failure. Bump the cap ONCE;
      // if attempt 2 is ALSO truncated, surface the dedicated code instead of
      // falling through to a same-cap third attempt (MAX_ATTEMPTS caps this
      // at one bumped retry regardless).
      if (response.stop_reason === 'max_tokens') {
        if (attempt < MAX_ATTEMPTS) {
          maxTokens = MAX_TOKENS_RETRY;
          deps.onEvent?.({ kind: 'cloud-retry', attempt: attempt + 1 });
          continue;
        }
        throw new Error('CONNECTOR_OUTPUT_TRUNCATED');
      }
      if (attempt < MAX_ATTEMPTS) {
        deps.onEvent?.({ kind: 'cloud-retry', attempt: attempt + 1 });
        continue;
      }
      // H1 — thread a SANITIZED reason (never the raw error message) so the
      // failure is diagnosable, matching the on-device CHUNK_FAILED:<i>:<reason>
      // convention. The C-1 `:dump=<id>` suffix (session-finalize.ts) may
      // stack AFTER this one; toFriendlyJa's substring match and the
      // $-anchored :dump= extractor both stay correct either way.
      throw new Error(`CONNECTOR_BAD_RESPONSE:${classifyValidationFailure(validateErr)}`);
    }
  }

  // Unreachable — the loop above always either returns or throws on the
  // final attempt. Satisfies TS control-flow analysis.
  throw new Error('CONNECTOR_BAD_RESPONSE:parse');
}

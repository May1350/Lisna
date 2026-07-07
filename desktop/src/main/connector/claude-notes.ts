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
import Anthropic from '@anthropic-ai/sdk';
import { loadApiKey as loadApiKeyDefault } from './claude-auth';
import { classifyCloudError, parseAndValidate, type CloudMessageResponse } from './claude-errors';
import { buildCloudNotePrompt, CLOUD_PROMPT_VERSION } from '@shared/families/util/cloud-prompt';
import { familyCoreRegistry } from '@shared/families';
import { applyGeneratedMeta } from '@shared/note-schema/apply-generated-meta';
import type { NoteBase, NoteFamily, NoteLanguage } from '@shared/note-schema/base';
import type { SessionTranscript } from '@shared/note-schema/transcript';

// Re-export so consumers (tests, Task 6) keep a single import surface.
export type { CloudMessageResponse } from './claude-errors';

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
const MAX_TOKENS = 16_000;
const TIMEOUT_MS = 300_000;
const MAX_ATTEMPTS = 2;

export interface CloudGenerateArgs {
  family: NoteFamily;
  transcript: SessionTranscript;
  language: NoteLanguage;
  durationSec: number;
}

/** Injectable client surface — decoupled from the full `Anthropic` class so
 * tests don't need a real client. The real `Anthropic` instance satisfies
 * this via the adapter in `defaultCreateClient` below. */
export interface CloudMessages {
  messages: {
    create(
      body: {
        model: string;
        max_tokens: number;
        system: string;
        messages: Array<{ role: 'user'; content: string }>;
      },
      options?: { timeout?: number },
    ): Promise<CloudMessageResponse>;
  };
}

export type CloudNoteEvent = { kind: 'cloud-start' } | { kind: 'cloud-retry'; attempt: number };

export interface CloudNoteDeps {
  /** Injectable for tests — defaults to claude-auth's `loadApiKey`. */
  loadApiKey?: () => Promise<string | null>;
  /** Injectable for tests — defaults to a real Anthropic client (`maxRetries: 1`). */
  createClient?: (apiKey: string) => CloudMessages;
  onEvent?: (e: CloudNoteEvent) => void;
}

function defaultCreateClient(apiKey: string): CloudMessages {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  return {
    messages: {
      // Adapter cast: the real SDK's `Message.content` (a large ContentBlock
      // union) is a superset of `CloudMessageResponse` — narrowing here at
      // the one true integration boundary keeps CloudMessages simple.
      create: (body, options) =>
        client.messages.create(body, options) as unknown as Promise<CloudMessageResponse>,
    },
  };
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
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: CloudMessageResponse;
    try {
      response = await client.messages.create(
        {
          model: CLOUD_MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: 'user', content: user }],
        },
        { timeout: TIMEOUT_MS },
      );
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
    } catch {
      if (attempt < MAX_ATTEMPTS) {
        deps.onEvent?.({ kind: 'cloud-retry', attempt: attempt + 1 });
        continue;
      }
      throw new Error('CONNECTOR_BAD_RESPONSE');
    }
  }

  // Unreachable — the loop above always either returns or throws on the
  // final attempt. Satisfies TS control-flow analysis.
  throw new Error('CONNECTOR_BAD_RESPONSE');
}

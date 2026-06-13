import type { STTEngine, LLMEngine, Language, TranscriptSegment, ChatMessage } from '@shared/engine-interfaces';
import type { Note } from '@shared/types';
import type { SessionPhase } from '@shared/ipc-protocol';
import { withTimeout } from '@shared/with-timeout';
import { buildJaNoteV1Prompt } from './prompts/ja-note-v1';
import { TIMEOUTS, TIMEOUT_CODES } from './timeouts';
import { generateChunkedNote } from './chunked-note';

// ─── finalizeLecture / finalizeMeeting imports ───────────────────────────────
import type { SessionTranscript } from '@shared/note-schema/transcript';
import type { NoteLanguage } from '@shared/note-schema';
import type { ModelProfile } from '@shared/models/profiles';
import { renderSystemTemplate } from '@shared/families/util/prompts';
import type { GenerationTelemetry } from '@shared/note-schema/telemetry';
import type { LectureNote } from '@shared/families/lecture/schema';
import type { MeetingNote } from '@shared/families/meeting/schema';
import type { InterviewNote } from '@shared/families/interview/schema';
import type { BrainstormNote } from '@shared/families/brainstorm/schema';
import { z } from 'zod';
import { familyCoreRegistry, selectPromptVariant, type FamilyCoreDefinition } from '@shared/families';
import type { NoteBase } from '@shared/note-schema';
import { zodToGbnf } from '@shared/note-schema/zod-to-gbnf';
import { chunkTranscript } from '@shared/note-schema/chunking';
import { estimateTokens } from '@shared/note-schema/tokens';
import { runPostDecodePipeline, dropEmptyUserVisibleItems } from '@shared/post-decode/pipeline';
import { collapseSpeakerRefsToZero } from '@shared/post-decode/collapse-speaker-refs';
import { applyGeneratedMeta } from '@shared/note-schema/apply-generated-meta';
import { deterministicMerge } from '@shared/post-decode/deterministic-merge';
import { consolidateLectureSections } from '../../shared/post-decode/consolidate-lecture-sections';
import { runMergeLLMCall } from './merge-llm';
import { callWithGrammar, makeSidecarGenerator, type GrammarAttempt, type GrammarCapableSidecar, type LlmGenerator } from './grammar-call';
import { degradeToSingleSpeaker } from '@shared/families/meeting/degrade-to-single-speaker';
import type { FinalizeFamily } from '../log';

// ─── Route (b) latency decomposition (founder smoke 2026-06-09) ──────────────
//
// onTelemetry feeds the founder-visible main.log so a finalize wall time can
// be split into cold-cache (first attempt latency >> rest), retry (totalAttempts
// > chunks), or RAM swap (per-chunk latency grows monotonically). The IPC route
// wires this to sessionLog.finalize{Attempt,ChunkDone,Done}; the per-event
// shape is shape-only (counts/durations/seeds/JSON-paths-count) — see log.ts
// PII contract.
//
// Re-exporting FinalizeFamily lets callers type their dispatcher without an
// extra import path (orchestrator owns the finalize* surface).

export type { FinalizeFamily };

export type FinalizeTelemetryEvent =
  | {
      // Fired at the TOP of each generation attempt (the other events fire
      // only after work settles — useless for "what is running right now").
      // Feeds the renderer's curatingV2 progress via ipc.ts →
      // toFinalizeProgressPayload (founder ask 2026-06-13: real progress, no
      // simulation). Cost: one synchronous callback per attempt — attempts
      // are minutes apart, nothing touches the LLM path.
      kind: 'attempt-start';
      family: FinalizeFamily;
      chunkIndex: number;
      totalChunks: number;
      /** 1-indexed attempt about to run, counted ACROSS outer fresh-seed
       * blocks: outerAttempt × INNER_GRAMMAR_ATTEMPTS + inner attempt.
       * ≥2 means the previous attempt failed (UI shows 再試行 N/M). */
      attempt: number;
      /** Worst-case attempts for this chunk (outer × inner). */
      maxAttempts: number;
      seed: number;
    }
  | {
      kind: 'attempt';
      family: FinalizeFamily;
      chunkIndex: number;
      totalChunks: number;
      outerAttempt: number;   // 0-indexed (matches the for-loop var)
      attempt: number;        // 1-indexed (matches GrammarAttempt.attempt)
      seed: number;
      latencyMs: number;
      ok: boolean;
      reason?: string;
      sanitizedSlotCount?: number;
      /** Sidecar decode stats (decode-speed instrumentation, 2026-06-10). */
      tokensOut?: number;
      genMs?: number;
    }
  | {
      kind: 'chunk-done';
      family: FinalizeFamily;
      chunkIndex: number;
      totalChunks: number;
      totalLatencyMs: number;
      outerAttempts: number;    // 1-indexed: how many outer cycles ran
      totalAttempts: number;    // sum of inner attempts across outer
      freshSeedRetries: number; // outerAttempts - 1
      sanitizedTotal: number;
    }
  | {
      kind: 'finalize-done';
      family: FinalizeFamily;
      totalLatencyMs: number;
      chunkCount: number;
      totalAttempts: number;
      sanitizedTotal: number;
      /** Present for the 'lecture' family only — consolidation stats from
       *  consolidateLectureSections (rung-1, duration-aware targetCap). */
      consolidation?: {
        targetCap: number;
        folded: number;
        truncated: number;
        deduped: number;
      };
    };

/**
 * Walk a callWithGrammar result's `attempts[]`, emit one 'attempt' telemetry
 * event per inner attempt, and return per-call totals.
 */
function emitGrammarAttempts(
  onTelemetry: ((e: FinalizeTelemetryEvent) => void) | undefined,
  ctx: {
    family: FinalizeFamily;
    chunkIndex: number;
    totalChunks: number;
    outerAttempt: number;
  },
  attempts: GrammarAttempt[],
): { innerAttempts: number; sanitizedCount: number } {
  let sanitizedCount = 0;
  for (const att of attempts) {
    const slotCount = att.sanitizedSlots?.length ?? 0;
    sanitizedCount += slotCount;
    onTelemetry?.({
      kind: 'attempt',
      family: ctx.family,
      chunkIndex: ctx.chunkIndex,
      totalChunks: ctx.totalChunks,
      outerAttempt: ctx.outerAttempt,
      attempt: att.attempt,
      seed: att.seed,
      latencyMs: att.latencyMs,
      ok: att.ok,
      reason: att.reason,
      sanitizedSlotCount: slotCount || undefined,
      tokensOut: att.tokensOut,
      genMs: att.genMs,
    });
  }
  return { innerAttempts: attempts.length, sanitizedCount };
}

interface RunChunkOpts {
  family: FinalizeFamily;
  fam: FamilyCoreDefinition<NoteBase>;
  chunkIndex: number;
  totalChunks: number;
  /** System turn — sent as a true `system` role message (role split, 2026-06-12). */
  systemPrompt: string;
  /** User turn — chunk header + rendered transcript + instruction tail. */
  userPrompt: string;
  grammar: string;
  /**
   * Family-specific base seed (lecture 5000+i, meeting 6000+i, interview
   * 7000+i, brainstorm 8000+i). The helper applies the outer-retry block
   * offset (POST_DECODE_SEED_OFFSET) on top.
   */
  baseSeed: number;
  tuning: { temperature: number; maxGenTokens: number };
  generator: LlmGenerator;
  /**
   * SessionTranscript fed into runPostDecodePipeline for `from`-provenance
   * lookup. May differ from the orchestrator's args.transcript when
   * diarization fallback degraded it to single-speaker (meeting/interview).
   */
  transcriptForPostDecode: SessionTranscript;
  /**
   * Session language for the fabrication circuit-breaker
   * (`findLanguageMismatch` in callWithGrammar). finalize* passes
   * `args.language ?? 'ja'`; 'ja' rejects near-zero-Japanese output.
   */
  expectedLanguage?: 'ja' | 'en' | 'ko';
  onTelemetry?: (e: FinalizeTelemetryEvent) => void;
}

interface RunChunkResult {
  /** Post-decoded chunk partial; caller casts to the family-specific shape. */
  validated: unknown;
  /** Sum of inner attempts across outer retries — folded into finalize-done. */
  innerAttemptsTotal: number;
  /** Sum of sanitized JSON paths across inner attempts — folded into finalize-done. */
  sanitizedTotal: number;
}

/**
 * Per-chunk outer-retry + post-decode + telemetry, extracted from the four
 * finalize* functions where this exact loop body was duplicated 4×. The
 * shape preserves the prior semantics exactly:
 *
 *   - up to POST_DECODE_OUTER_ATTEMPTS outer cycles, each with its own seed
 *     block (`baseSeed + outer*POST_DECODE_SEED_OFFSET`);
 *   - inside each outer cycle: callWithGrammar (maxAttempts=3 inner) →
 *     post-decode pipeline; ESCAPE_LITERAL_AT_<path> continues to the next
 *     outer seed block (per memory v2_track2_escape_literal_phase1); Zod
 *     errors from runPostDecodePipeline continue (P0b);
 *   - non-Zod, non-ESCAPE_LITERAL throws (ForwardIncompatNoteError,
 *     SyntaxError, etc.) propagate immediately — not retriable.
 *   - on exhaust: throws `CHUNK_FAILED:<i>:<reason>` or
 *     `CHUNK_FAILED:<i>:POST_DECODE_ZOD_EXHAUSTED:<zod message>`.
 *
 * Telemetry semantics also preserved:
 *
 *   - emits one `attempt-start` event at the TOP of every inner attempt (via
 *     callWithGrammar's onAttemptStart), with the chunk-spanning overall
 *     counter — the renderer's live progress feed;
 *   - emits one `attempt` event per inner attempt via emitGrammarAttempts;
 *   - emits exactly one `chunk-done` event in a try/finally so a throw still
 *     surfaces the partial timing (founder log attribution invariant).
 *
 * The caller still emits `finalize-done` AFTER iterating all chunks — that
 * stays at the call site because it needs cross-chunk totals (and is only
 * fired on the success path; a throw escapes the function before that emit).
 */
async function runChunkWithGrammar(opts: RunChunkOpts): Promise<RunChunkResult> {
  const chunkT0 = Date.now();
  let outerAttemptsUsed = 0;
  let innerAttemptsThisChunk = 0;
  let sanitizedThisChunk = 0;

  try {
    let validated: unknown;
    let lastZodError: z.ZodError | undefined;
    for (let outerAttempt = 0; outerAttempt < POST_DECODE_OUTER_ATTEMPTS; outerAttempt++) {
      outerAttemptsUsed = outerAttempt + 1;
      const result = await callWithGrammar<unknown>({
        prompt: opts.userPrompt,
        system: opts.systemPrompt,
        schema: z.unknown(),
        grammar: opts.grammar,
        baseSeed: opts.baseSeed + outerAttempt * POST_DECODE_SEED_OFFSET,
        temperature: opts.tuning.temperature,
        maxAttempts: INNER_GRAMMAR_ATTEMPTS,
        maxTokens: opts.tuning.maxGenTokens,
        generator: opts.generator,
        expectedLanguage: opts.expectedLanguage,
        onAttemptStart: (attempt, seed) => {
          opts.onTelemetry?.({
            kind: 'attempt-start',
            family: opts.family,
            chunkIndex: opts.chunkIndex,
            totalChunks: opts.totalChunks,
            attempt: outerAttempt * INNER_GRAMMAR_ATTEMPTS + attempt,
            maxAttempts: POST_DECODE_OUTER_ATTEMPTS * INNER_GRAMMAR_ATTEMPTS,
            seed,
          });
        },
      });

      const stats = emitGrammarAttempts(
        opts.onTelemetry,
        {
          family: opts.family,
          chunkIndex: opts.chunkIndex,
          totalChunks: opts.totalChunks,
          outerAttempt,
        },
        result.attempts,
      );
      innerAttemptsThisChunk += stats.innerAttempts;
      sanitizedThisChunk += stats.sanitizedCount;

      if (!result.ok) {
        // ESCAPE_LITERAL_AT_ (added 2026-06-09): inner +100-stride seeds often
        // can't escape the mode-collapse basin on short string slots. Give it
        // a fresh outer seed block (+10000) before failing the chunk. See
        // findEscapeLiteralInStrings + memory
        // v2_track2_escape_literal_phase1_2026-06-09.
        // NOTE_LANGUAGE_MISMATCH (2026-06-12) gets the same treatment —
        // template-fabrication is a mode-collapse cousin, and a fresh seed
        // block is its only recovery short of a prompt/model change.
        if (
          (result.finalReason.startsWith('ESCAPE_LITERAL_AT_') ||
            result.finalReason.startsWith('NOTE_LANGUAGE_MISMATCH')) &&
          outerAttempt < POST_DECODE_OUTER_ATTEMPTS - 1
        ) {
          continue;
        }
        throw new Error(`CHUNK_FAILED:${opts.chunkIndex}:${result.finalReason}`);
      }

      // callWithGrammar parses JSON internally (with z.unknown() it passes
      // through). runPostDecodePipeline expects raw JSON — the double round-
      // trip is acceptable for chunk-sized JSON and keeps the pipeline
      // contract unchanged.
      const rawJson = JSON.stringify(result.value);
      try {
        validated = runPostDecodePipeline(rawJson, opts.fam, opts.transcriptForPostDecode);
        break;
      } catch (e) {
        if (e instanceof z.ZodError) {
          lastZodError = e;
          continue;
        }
        throw e;  // ForwardIncompatNoteError / SyntaxError / etc. — not retriable
      }
    }
    if (validated === undefined) {
      throw new Error(
        `CHUNK_FAILED:${opts.chunkIndex}:POST_DECODE_ZOD_EXHAUSTED:${lastZodError?.issues[0]?.message ?? 'unknown'}`,
      );
    }
    return {
      validated,
      innerAttemptsTotal: innerAttemptsThisChunk,
      sanitizedTotal: sanitizedThisChunk,
    };
  } finally {
    opts.onTelemetry?.({
      kind: 'chunk-done',
      family: opts.family,
      chunkIndex: opts.chunkIndex,
      totalChunks: opts.totalChunks,
      totalLatencyMs: Date.now() - chunkT0,
      outerAttempts: outerAttemptsUsed,
      totalAttempts: innerAttemptsThisChunk,
      freshSeedRetries: Math.max(0, outerAttemptsUsed - 1),
      sanitizedTotal: sanitizedThisChunk,
    });
  }
}

// ─── P0b: per-chunk outer retry around callWithGrammar + post-decode ─────────
// `callWithGrammar` receives `schema: z.unknown()` so its per-attempt
// retry-on-Zod contract no-ops for the real family shape. The real
// `family.schema.parse()` runs inside `runPostDecodePipeline` Stage 4, AFTER
// `callWithGrammar` returned ok=true. Without an outer wrap, a single bad
// emission burns the whole chunk and propagates `ZodError` out of
// `finalize*` with no recovery. The constants below bound a small outer
// retry loop in both `finalizeLecture` and `finalizeMeeting`.

/** Inner retry budget per callWithGrammar invocation (+100-stride seed per
 *  attempt). Shared between the call itself and the attempt-start overall
 *  counter so the UI's "再試行 N/M" math cannot drift from the real budget. */
const INNER_GRAMMAR_ATTEMPTS = 3;
/** Max outer attempts (inclusive of the first try). With INNER_GRAMMAR_ATTEMPTS
 *  inner, worst-case 2×3=6 generations per chunk (~2 min on the 8GB box). */
const POST_DECODE_OUTER_ATTEMPTS = 2;
/** Seed-block size per outer attempt. Strictly larger than `callWithGrammar`'s
 *  inner retry stride (`baseSeed + 0/+100/+200`), so outer attempts cannot
 *  collide with each other's inner retries — independent random pulls. */
const POST_DECODE_SEED_OFFSET = 10000;

interface Opts {
  stt: STTEngine;
  llm: LLMEngine;
  sttModelPath: string;
  llmModelPath: string;
  language: Language;
  /**
   * Optional override for the chat-message builder. Returns `ChatMessage[]`
   * so the sidecar can apply the GGUF chat template. Tests typically inject
   * a fixed array so they don't need to parse the prompt content.
   */
  buildPrompt?(language: Language, segments: TranscriptSegment[]): ChatMessage[];
}

/**
 * Default prompt builder. v2.0 alpha is JA-only (concept-lock), so we route
 * everything through the JA-note-v1 plain-text builder. See
 * `prompts/ja-note-v1.ts` for the format contract.
 *
 * The `buildPrompt?` opt remains as an injection seam: tests override it
 * with a fixed string (no need to validate prompt content) and a future
 * multilingual v2.1 can dispatch on `language`.
 */
const defaultPrompt = buildJaNoteV1Prompt;

/**
 * Coordinates STT → LLM in time-sliced order for a single recording session.
 *
 * **Lifecycle (single-use, strict FSM):**
 *   idle → recording → finalizing → done
 *
 * - `start()` transitions idle → recording (loads STT, clears segments).
 * - `onChunk(audio)` is valid only in `recording` state; appends transcribed segments.
 * - `stop()` transitions recording → finalizing → done. Unloads STT, loads LLM,
 *   generates note, unloads LLM. LLM unload runs in `finally`, so a thrown
 *   `generate()` does not leave the model resident. Optional `onPhase`
 *   callback observes the three internal awaits (stt-unloading → llm-loading
 *   → generating) before each begins; the final `llm.unloadModel()` in
 *   `finally` is intentionally silent (renderer is already past 'Generating').
 *
 * **Out-of-order callers (`onChunk` before `start()`, double `start()`, double
 * `stop()`) are NOT guarded by this class.** Callers (typically the `session/*`
 * IPC handlers registered by the main process) are responsible for ordering.
 * Treat each instance as a single-use disposable per session.
 *
 * Memory floor (8GB RAM) requires STT and LLM never coexist in resident memory;
 * `stt.unloadModel()` blocks until OS-confirmed RSS drop (mach API, Task 3.4)
 * before `llm.loadModel()` is invoked.
 */
export class SessionOrchestrator {
  private segments: TranscriptSegment[] = [];
  constructor(private opts: Opts) {}

  /**
   * Read-only view of accumulated transcript segments. Used by the
   * `session/finalize` IPC handler (Task 10) to build a SessionTranscript
   * without exposing the mutable internal array.
   */
  get exposedSegments(): readonly TranscriptSegment[] { return this.segments; }
  /** Session language as passed at start — read by the finalize IPC route. */
  get language(): Language { return this.opts.language; }

  async start(): Promise<void> {
    this.segments = [];
    // Cap STT cold load. 60s budget covers TCC mic-permission prompt + GGUF
    // mmap + Metal init on M1 (see TIMEOUTS comment for the calibration).
    // Throws STT_TIMEOUT if the sidecar wedges.
    await withTimeout(
      this.opts.stt.loadModel(this.opts.sttModelPath, this.opts.language),
      TIMEOUTS.STT_LOAD_MS,
      TIMEOUT_CODES.STT_TIMEOUT,
    );
  }

  /**
   * Transcribe one audio chunk and accumulate its segments.
   *
   * `sessionOffsetSec` re-anchors Whisper's CHUNK-RELATIVE timestamps
   * (each 10s chunk is transcribed independently, so every segment's
   * startSec is in [0, chunkLen]) to session time. Without it, a long
   * recording's transcript claims everything happened in the first few
   * seconds — live captions show resetting timestamps, and the finalize
   * prompt hands the LLM time anchors that are all ~0, so the model
   * fabricates section ts (2026-06-10: 12-min EN lecture → uniform fake
   * 12s ladder). Callers pass ChunkPayload.startMs / 1000.
   */
  async onChunk(audio: Float32Array, sessionOffsetSec = 0): Promise<TranscriptSegment[]> {
    const raw = await this.opts.stt.transcribe(audio);
    const segs = sessionOffsetSec === 0 ? raw : raw.map((s) => ({
      ...s,
      startSec: s.startSec + sessionOffsetSec,
      endSec: s.endSec + sessionOffsetSec,
    }));
    this.segments.push(...segs);
    return segs;
  }

  /**
   * @param onPhase Optional observer fired synchronously BEFORE each of the
   *   three internal awaits: 'stt-unloading' → 'llm-loading' → 'generating'.
   *   Return value is ignored (fire-and-forget — do not await side effects
   *   from inside). Callback errors are not caught; caller must ensure
   *   non-throwing behavior. Caller emits 'stt-loading' around `start()`
   *   separately (in this codebase: from the `session/start` IPC handler).
   */
  async stop(onPhase?: (phase: SessionPhase) => void): Promise<Note> {
    // Empty-transcript guard: if no segments were captured (silence-only
    // recording, or user clicked Start/Stop without speaking), skip the
    // LLM round-trip entirely. Loading a 2GB GGUF to generate hallucinated
    // text from an empty prompt is a 10-30s waste that produces garbage.
    // Throw EMPTY_TRANSCRIPT so the renderer can show a friendly error
    // ("It looks like nothing was recorded — please try again") instead of
    // routing the user to a NoteView containing LLM-confabulated content.
    if (this.segments.length === 0) {
      onPhase?.('stt-unloading');
      // 5s timeout cap on unload. If unload throws a non-timeout error
      // (sidecar said `error`, etc.), propagate it — that's a diagnostic
      // the user/devs need to see. The EMPTY_TRANSCRIPT throw below only
      // fires if unload resolved cleanly.
      await withTimeout(
        this.opts.stt.unloadModel(),
        TIMEOUTS.STT_UNLOAD_MS,
        TIMEOUT_CODES.STT_TIMEOUT,
      );
      throw new Error('EMPTY_TRANSCRIPT');
    }
    try {
      onPhase?.('stt-unloading');
      // 5s STT unload — see TIMEOUTS comment. Throws STT_TIMEOUT.
      await withTimeout(
        this.opts.stt.unloadModel(),
        TIMEOUTS.STT_UNLOAD_MS,
        TIMEOUT_CODES.STT_TIMEOUT,
      );
      onPhase?.('llm-loading');
      // 30s LLM load (Q4_K_M mmap + Metal init). Throws LLM_LOAD_TIMEOUT.
      await withTimeout(
        this.opts.llm.loadModel(this.opts.llmModelPath),
        TIMEOUTS.LLM_LOAD_MS,
        TIMEOUT_CODES.LLM_LOAD_TIMEOUT,
      );
      onPhase?.('generating');
      // generateChunkedNote chunks long transcripts to stay within n_ctx
      // (see chunked-note.ts) — short transcripts still take the single-pass
      // path (byte-identical output). GENERATE_TIMEOUT (no-progress 60s) is
      // enforced per generate() call inside LlamaCppLLM → SidecarClient.sendStream.
      const md = await generateChunkedNote({
        segments: this.segments,
        language: this.opts.language,
        buildPrompt: this.opts.buildPrompt ?? defaultPrompt,
        generate: (messages) =>
          this.opts.llm.generate(messages, { maxTokens: 4096, temperature: 0.4 }),
      });
      return {
        language: this.opts.language,
        generatedAt: new Date().toISOString(),
        markdown: md,
        transcriptSegments: this.segments,
      };
    } finally {
      // Best-effort unload — swallow secondary errors so we don't mask the primary throw.
      // Also cap with timeout so a wedged sidecar can't strand the renderer in Finalizing
      // forever. 5s budget; on timeout we just move on (the renderer has already left
      // 'generating' phase by the time finally runs).
      await withTimeout(
        this.opts.llm.unloadModel(),
        TIMEOUTS.LLM_UNLOAD_MS,
        TIMEOUT_CODES.LLM_UNLOAD_TIMEOUT,
      ).catch(() => {});
    }
  }
}

// ─── finalizeLecture ─────────────────────────────────────────────────────────
//
// Pure async function: SessionTranscript + GrammarCapableSidecar + ModelProfile
// → LectureNote + GenerationTelemetry.
//
// Task 10 will wire this behind the `session/finalize` IPC channel. No
// Electron IPC in this file.

export interface FinalizeLectureArgs {
  sessionId: string;
  transcript: SessionTranscript;
  sidecar: GrammarCapableSidecar;
  modelProfile: ModelProfile;
  promptVariantId?: string;
  /**
   * Session language (minimal EN support, 2026-06-10). Drives the system-
   * template output-language rule (renderSystemTemplate) and the Note meta.
   * Defaults to 'ja' — the eval'd v2.0 baseline.
   */
  language?: NoteLanguage;
  onProgress?: (e:
    | { phase: 'chunk'; chunkIndex: number; totalChunks: number }
    | { phase: 'merge' }
    | { phase: 'persist' }
  ) => void;
  /**
   * Latency-decomposition telemetry (route (b), 2026-06-09). Emits one event
   * per LLM attempt, per chunk completion, and a single finalize-done at the
   * tail. The IPC route wires this to sessionLog so the founder-visible
   * main.log carries the breakdown. Optional — omitting it is a silent no-op.
   * Failure path: chunk-done still fires (try/finally), finalize-done does
   * NOT (the throw escapes).
   */
  onTelemetry?: (e: FinalizeTelemetryEvent) => void;
}

export interface FinalizeLectureResult {
  note: LectureNote;
  telemetry: GenerationTelemetry;
}

/**
 * Finalize a lecture session: chunk the transcript, call the LLM once per chunk
 * with a grammar-constrained decode, run each chunk through the post-decode
 * pipeline, then deterministically merge all partials into a single LectureNote.
 *
 * No Electron IPC — this is a pure async function. Task 10 wires the IPC layer.
 */
export async function finalizeLecture(
  args: FinalizeLectureArgs,
): Promise<FinalizeLectureResult> {
  const generationStartedAt = new Date().toISOString();
  const t0 = Date.now();

  // ── Correction D: family lookup via registry ──────────────────────────────
  // Side-effect import in callers (or beforeEach in tests) ensures the lecture
  // family is registered before we reach here.
  const fam = familyCoreRegistry['lecture'];
  if (!fam) throw new Error('LECTURE_FAMILY_NOT_REGISTERED');

  // ── Correction B/E: grammar as string, prompt selection ───────────────────
  const grammar = zodToGbnf(fam.schema, 'LectureNote');

  const prompt = selectPromptVariant(
    fam.prompts,
    fam.defaultPromptVariant,
    args.promptVariantId ? { userPreference: args.promptVariantId } : undefined,
  );

  // ── Correction J: chunk the transcript ────────────────────────────────────
  const tuning = args.modelProfile.perFamily['lecture'];
  const chunks = chunkTranscript(args.transcript, tuning.recommendedChunkTokens);

  if (chunks.length === 0) {
    throw new Error('EMPTY_TRANSCRIPT');
  }

  const generator = makeSidecarGenerator(args.sidecar);
  const partials: Array<Partial<LectureNote>> = [];

  // Telemetry accumulators for the finalize-done roll-up; sum the per-chunk
  // result.innerAttemptsTotal / sanitizedTotal returned by runChunkWithGrammar
  // so the final breadcrumb matches sum(chunk-done.totalAttempts).
  let totalAttemptsAcrossChunks = 0;
  let sanitizedAcrossChunks = 0;

  // ── Per-chunk: call LLM + post-decode pipeline ────────────────────────────
  for (let i = 0; i < chunks.length; i++) {
    args.onProgress?.({ phase: 'chunk', chunkIndex: i, totalChunks: chunks.length });

    // ── Correction F: systemTemplate (not system) ──────────────────────────
    const userPrompt = prompt.chunkUserTemplate({
      chunkIndex: i,
      totalChunks: chunks.length,
      transcript: renderTranscriptChunk(chunks[i]!),
    });
    const systemPrompt = renderSystemTemplate(prompt.systemTemplate, args.language ?? 'ja');

    const chunkResult = await runChunkWithGrammar({
      family: 'lecture',
      fam,
      chunkIndex: i,
      totalChunks: chunks.length,
      systemPrompt,
      userPrompt,
      grammar,
      baseSeed: 5000 + i,
      tuning,
      generator,
      transcriptForPostDecode: args.transcript,
      expectedLanguage: args.language ?? 'ja',
      onTelemetry: args.onTelemetry,
    });
    partials.push(chunkResult.validated as Partial<LectureNote>);
    totalAttemptsAcrossChunks += chunkResult.innerAttemptsTotal;
    sanitizedAcrossChunks += chunkResult.sanitizedTotal;
  }

  // ── Merge partials ────────────────────────────────────────────────────────
  args.onProgress?.({ phase: 'merge' });
  const merged = deterministicMerge<Record<string, unknown>>(
    partials as Array<Partial<Record<string, unknown>>>,
    fam.mergeStrategy,
  );

  // ── Consolidate sections (rung-1: duration-aware soft target) ────────────
  // Duration-aware targetCap: clamp(ceil(durationMin / 8), 10, 24).
  // Runs AFTER deterministicMerge and BEFORE schema.parse so the final Zod
  // validation sees the already-folded + dedup-fitted section list.
  const durationMin = (args.transcript.transcriptSegments.at(-1)?.endTs ?? 0) / 60;
  const targetCap = Math.max(10, Math.min(24, Math.ceil(durationMin / 8)));
  const { note: consolidated, stats: consolidationStats } = consolidateLectureSections(
    merged as unknown as LectureNote,
    targetCap,
  );

  // Re-parse the consolidated object through the family schema for final validation
  const note = fam.schema.parse(consolidated) as LectureNote;
  // System owns provenance/schema metadata — the grammar exposes these
  // NoteBase fields so the LLM emits them too, but its values are untrustworthy
  // (a 1B model hallucinated an invalid generatedAt → "Invalid Date").
  applyGeneratedMeta(note, {
    generatedAt: generationStartedAt,
    model: args.modelProfile.id,
    promptVersion: prompt.version,
    language: args.language ?? 'ja',
    durationSec: args.transcript.transcriptSegments.at(-1)?.endTs ?? 0,
  });

  // ── Build telemetry ───────────────────────────────────────────────────────
  // totalTokensIn = sum of estimateTokens over each rendered chunk (prompt side
  // is knowable without sidecar plumbing — plan line 1338).
  // totalTokensOut stays 0: sidecar doesn't surface generated-token counts yet;
  // future work plumbs it through generateWithGrammar response (Minor).
  const telemetry: GenerationTelemetry = {
    noteId: args.sessionId,          // Task 13 / persistence assigns the real note ID
    modelId: args.modelProfile.id,
    promptVariantId: prompt.variantId,
    schemaVersion: 1,
    generationStartedAt,
    generationDurationMs: Date.now() - t0,
    chunkCount: chunks.length,
    totalTokensIn: chunks.reduce(
      (sum, chunk) => sum + estimateTokens(renderTranscriptChunk(chunk)),
      0,
    ),
    totalTokensOut: 0,              // sidecar doesn't expose token counts yet (Minor)
    validationWarnings: [],
    dedupHits: [],
    postDecodeMutations: [],
  };

  args.onProgress?.({ phase: 'persist' });
  args.onTelemetry?.({
    kind: 'finalize-done',
    family: 'lecture',
    totalLatencyMs: Date.now() - t0,
    chunkCount: chunks.length,
    totalAttempts: totalAttemptsAcrossChunks,
    sanitizedTotal: sanitizedAcrossChunks,
    consolidation: { targetCap, ...consolidationStats },
  });
  return { note, telemetry };
}

// ─── finalizeMeeting ──────────────────────────────────────────────────────────

export interface FinalizeMeetingArgs {
  sessionId: string;
  transcript: SessionTranscript;
  sidecar: GrammarCapableSidecar;
  modelProfile: ModelProfile;
  promptVariantId?: string;
  /**
   * Session language (minimal EN support, 2026-06-10). Drives the system-
   * template output-language rule (renderSystemTemplate) and the Note meta.
   * Defaults to 'ja' — the eval'd v2.0 baseline.
   */
  language?: NoteLanguage;
  /** 'ok' = transcript already carries real diarized speakerIds; 'fallback'/'disabled' = collapse to single speaker + warn. */
  diarizationStatus: 'ok' | 'fallback' | 'disabled';
  onProgress?: (e:
    | { phase: 'chunk'; chunkIndex: number; totalChunks: number }
    | { phase: 'merge' }
    | { phase: 'persist' }
  ) => void;
  /** See FinalizeLectureArgs.onTelemetry. */
  onTelemetry?: (e: FinalizeTelemetryEvent) => void;
}

export interface FinalizeMeetingResult {
  note: MeetingNote;
  telemetry: GenerationTelemetry;
}

/**
 * Finalize a meeting session: optionally collapse to single-speaker when
 * diarization is unavailable, chunk the transcript, call the LLM once per
 * chunk with grammar-constrained decode, run the post-decode pipeline, then
 * deterministically merge all partials into a single MeetingNote.
 *
 * No Electron IPC — pure async function. session-finalize.ts wires the IPC.
 *
 * Plan 4 Phase B note: diarizationStatus='disabled' is the alpha path because
 * SessionContext does not yet carry diarized turns. When Plan 4 B lands and
 * SessionContext gains real speakerIds, the caller flips this to 'ok'.
 */
export async function finalizeMeeting(
  args: FinalizeMeetingArgs,
): Promise<FinalizeMeetingResult> {
  const generationStartedAt = new Date().toISOString();
  const t0 = Date.now();

  const fam = familyCoreRegistry['meeting'];
  if (!fam) throw new Error('MEETING_FAMILY_NOT_REGISTERED');

  const grammar = zodToGbnf(fam.schema, 'MeetingNote');

  const prompt = selectPromptVariant(
    fam.prompts,
    fam.defaultPromptVariant,
    args.promptVariantId ? { userPreference: args.promptVariantId } : undefined,
  );

  // ── Diarization fallback BEFORE chunking ──────────────────────────────────
  // When Plan 4 diarization is unavailable, collapse all segments to speaker 0
  // and record the warning so users know attributions are unreliable.
  let activeTranscript = args.transcript;
  const validationWarnings: string[] = [];
  if (args.diarizationStatus !== 'ok') {
    const degraded = degradeToSingleSpeaker(args.transcript);
    activeTranscript = degraded.transcript;
    validationWarnings.push(degraded.warning);
  }

  const tuning = args.modelProfile.perFamily['meeting'];
  const chunks = chunkTranscript(activeTranscript, tuning.recommendedChunkTokens);

  if (chunks.length === 0) {
    throw new Error('EMPTY_TRANSCRIPT');
  }

  const generator = makeSidecarGenerator(args.sidecar);
  const partials: Array<Partial<MeetingNote>> = [];

  let totalAttemptsAcrossChunks = 0;
  let sanitizedAcrossChunks = 0;

  for (let i = 0; i < chunks.length; i++) {
    args.onProgress?.({ phase: 'chunk', chunkIndex: i, totalChunks: chunks.length });

    const userPrompt = prompt.chunkUserTemplate({
      chunkIndex: i,
      totalChunks: chunks.length,
      transcript: renderTranscriptWithSpeakers(chunks[i]!, activeTranscript.speakers),
    });
    const systemPrompt = renderSystemTemplate(prompt.systemTemplate, args.language ?? 'ja');

    // baseSeed 6000 (lecture 5000) keeps seeds distinct across families; with
    // POST_DECODE_SEED_OFFSET=10000, lecture outer 1 (15000+i) and meeting
    // outer 1 (16000+i) stay disjoint for any plausible chunk count.
    const chunkResult = await runChunkWithGrammar({
      family: 'meeting',
      fam,
      chunkIndex: i,
      totalChunks: chunks.length,
      systemPrompt,
      userPrompt,
      grammar,
      baseSeed: 6000 + i,
      tuning,
      generator,
      transcriptForPostDecode: activeTranscript,
      expectedLanguage: args.language ?? 'ja',
      onTelemetry: args.onTelemetry,
    });
    partials.push(chunkResult.validated as Partial<MeetingNote>);
    totalAttemptsAcrossChunks += chunkResult.innerAttemptsTotal;
    sanitizedAcrossChunks += chunkResult.sanitizedTotal;
  }

  args.onProgress?.({ phase: 'merge' });
  const merged = deterministicMerge<Record<string, unknown>>(
    partials as Array<Partial<Record<string, unknown>>>,
    fam.mergeStrategy,
  );

  // Bubble the diarization warning into the merged note before schema parse.
  if (validationWarnings.length > 0) {
    merged.validation_warnings = [
      ...((merged.validation_warnings as string[] | undefined) ?? []),
      ...validationWarnings,
    ];
  }

  // Without diarization every SpeakerRef the model emitted is a hallucination
  // (founder P1, 2026-06-10) — normalize to the lone speaker 0 and drop the
  // now-meaningless roster.
  if (args.diarizationStatus !== 'ok') {
    collapseSpeakerRefsToZero(merged);
    delete merged.participants;
  }

  const note = fam.schema.parse(merged) as MeetingNote;
  applyGeneratedMeta(note, {
    generatedAt: generationStartedAt,
    model: args.modelProfile.id,
    promptVersion: prompt.version,
    language: args.language ?? 'ja',
    durationSec: activeTranscript.transcriptSegments.at(-1)?.endTs ?? 0,
  });

  const telemetry: GenerationTelemetry = {
    noteId: args.sessionId,
    modelId: args.modelProfile.id,
    promptVariantId: prompt.variantId,
    schemaVersion: 1,
    generationStartedAt,
    generationDurationMs: Date.now() - t0,
    chunkCount: chunks.length,
    totalTokensIn: chunks.reduce(
      (sum, chunk) => sum + estimateTokens(renderTranscriptWithSpeakers(chunk, activeTranscript.speakers)),
      0,
    ),
    totalTokensOut: 0,
    validationWarnings: [...validationWarnings],
    dedupHits: [],
    postDecodeMutations: [],
  };

  args.onProgress?.({ phase: 'persist' });
  args.onTelemetry?.({
    kind: 'finalize-done',
    family: 'meeting',
    totalLatencyMs: Date.now() - t0,
    chunkCount: chunks.length,
    totalAttempts: totalAttemptsAcrossChunks,
    sanitizedTotal: sanitizedAcrossChunks,
  });
  return { note, telemetry };
}

// ─── finalizeInterview ──────────────────────────────────────────────────────────

export interface FinalizeInterviewArgs {
  sessionId: string;
  transcript: SessionTranscript;
  sidecar: GrammarCapableSidecar;
  modelProfile: ModelProfile;
  promptVariantId?: string;
  /**
   * Session language (minimal EN support, 2026-06-10). Drives the system-
   * template output-language rule (renderSystemTemplate) and the Note meta.
   * Defaults to 'ja' — the eval'd v2.0 baseline.
   */
  language?: NoteLanguage;
  /** 'ok' = transcript already carries real diarized speakerIds; 'fallback'/'disabled' = collapse to single speaker + warn. */
  diarizationStatus: 'ok' | 'fallback' | 'disabled';
  onProgress?: (e:
    | { phase: 'chunk'; chunkIndex: number; totalChunks: number }
    | { phase: 'merge' }
    | { phase: 'persist' }
  ) => void;
  /** See FinalizeLectureArgs.onTelemetry. */
  onTelemetry?: (e: FinalizeTelemetryEvent) => void;
}

export interface FinalizeInterviewResult {
  note: InterviewNote;
  telemetry: GenerationTelemetry;
}

/**
 * Finalize an interview session. Like finalizeMeeting (interview also
 * requiresDiarization: interviewer + interviewee), but the cross-chunk merge is
 * the HYBRID runMergeLLMCall (Task 7): qa_pairs + participants are unioned
 * deterministically (a 3B drops structured turns — spike 1.1 MIXED), only the
 * derived prose (themes / key_takeaways / subject_summary) comes from the merge
 * LLM. On merge-LLM failure we fall back to a fully deterministic merge that
 * still preserves every qa_pair.
 *
 * No Electron IPC — pure async function. session-finalize.ts wires the IPC.
 */
export async function finalizeInterview(
  args: FinalizeInterviewArgs,
): Promise<FinalizeInterviewResult> {
  const generationStartedAt = new Date().toISOString();
  const t0 = Date.now();

  const fam = familyCoreRegistry['interview'];
  if (!fam) throw new Error('INTERVIEW_FAMILY_NOT_REGISTERED');

  const grammar = zodToGbnf(fam.schema, 'InterviewNote');

  const prompt = selectPromptVariant(
    fam.prompts,
    fam.defaultPromptVariant,
    args.promptVariantId ? { userPreference: args.promptVariantId } : undefined,
  );

  // Diarization fallback BEFORE chunking (interview requiresDiarization=true).
  let activeTranscript = args.transcript;
  const validationWarnings: string[] = [];
  if (args.diarizationStatus !== 'ok') {
    const degraded = degradeToSingleSpeaker(args.transcript);
    activeTranscript = degraded.transcript;
    validationWarnings.push(degraded.warning);
  }

  const tuning = args.modelProfile.perFamily['interview'];
  const chunks = chunkTranscript(activeTranscript, tuning.recommendedChunkTokens);

  if (chunks.length === 0) {
    throw new Error('EMPTY_TRANSCRIPT');
  }

  const generator = makeSidecarGenerator(args.sidecar);
  const partials: Array<Record<string, unknown>> = [];

  let totalAttemptsAcrossChunks = 0;
  let sanitizedAcrossChunks = 0;

  for (let i = 0; i < chunks.length; i++) {
    args.onProgress?.({ phase: 'chunk', chunkIndex: i, totalChunks: chunks.length });

    const userPrompt = prompt.chunkUserTemplate({
      chunkIndex: i,
      totalChunks: chunks.length,
      transcript: renderTranscriptWithSpeakers(chunks[i]!, activeTranscript.speakers),
    });
    const systemPrompt = renderSystemTemplate(prompt.systemTemplate, args.language ?? 'ja');

    // baseSeed 7000 (lecture 5000, meeting 6000) keeps seeds distinct across families.
    const chunkResult = await runChunkWithGrammar({
      family: 'interview',
      fam,
      chunkIndex: i,
      totalChunks: chunks.length,
      systemPrompt,
      userPrompt,
      grammar,
      baseSeed: 7000 + i,
      tuning,
      generator,
      transcriptForPostDecode: activeTranscript,
      expectedLanguage: args.language ?? 'ja',
      onTelemetry: args.onTelemetry,
    });
    partials.push(chunkResult.validated as Record<string, unknown>);
    totalAttemptsAcrossChunks += chunkResult.innerAttemptsTotal;
    sanitizedAcrossChunks += chunkResult.sanitizedTotal;
  }

  // ── Merge ───────────────────────────────────────────────────────────────────
  // Single chunk → pass-through (already validated by the per-chunk pipeline).
  // Multi-chunk → hybrid merge-LLM; on failure, deterministic fallback that
  // still preserves every qa_pair.
  let merged: Record<string, unknown>;
  const mergeWarnings: string[] = [];
  if (partials.length === 1) {
    merged = partials[0]!;
  } else {
    args.onProgress?.({ phase: 'merge' });
    const r = await runMergeLLMCall({
      family: 'interview',
      partials,
      transcript: activeTranscript,
      baseSeed: 7500,
      generator,
    });
    if (r.ok) {
      merged = r.merged as unknown as Record<string, unknown>;
      mergeWarnings.push(...r.validationWarnings);
    } else {
      merged = deterministicMerge<Record<string, unknown>>(partials, fam.mergeStrategy);
      mergeWarnings.push(
        `merge: LLM merge failed (${r.finalReason}); fell back to deterministic merge (derived fields from first chunk only)`,
      );
    }
  }

  const allWarnings = [...validationWarnings, ...mergeWarnings];
  if (allWarnings.length > 0) {
    merged.validation_warnings = [
      ...((merged.validation_warnings as string[] | undefined) ?? []),
      ...allWarnings,
    ];
  }

  // The merge-LLM path re-enters LLM-derived prose AFTER the per-chunk
  // pipeline ran, so the merged tree needs the same empty-item sweep — and
  // without diarization every SpeakerRef is a hallucination (founder P1,
  // 2026-06-10): normalize to 0 and drop the roster.
  dropEmptyUserVisibleItems(merged, 'interview');
  if (args.diarizationStatus !== 'ok') {
    collapseSpeakerRefsToZero(merged);
    delete merged.participants;
  }

  const note = fam.schema.parse(merged) as InterviewNote;
  applyGeneratedMeta(note, {
    generatedAt: generationStartedAt,
    model: args.modelProfile.id,
    promptVersion: prompt.version,
    language: args.language ?? 'ja',
    durationSec: activeTranscript.transcriptSegments.at(-1)?.endTs ?? 0,
  });

  const telemetry: GenerationTelemetry = {
    noteId: args.sessionId,
    modelId: args.modelProfile.id,
    promptVariantId: prompt.variantId,
    schemaVersion: 1,
    generationStartedAt,
    generationDurationMs: Date.now() - t0,
    chunkCount: chunks.length,
    totalTokensIn: chunks.reduce(
      (sum, chunk) => sum + estimateTokens(renderTranscriptWithSpeakers(chunk, activeTranscript.speakers)),
      0,
    ),
    totalTokensOut: 0,
    validationWarnings: allWarnings,
    dedupHits: [],
    postDecodeMutations: [],
  };

  args.onProgress?.({ phase: 'persist' });
  args.onTelemetry?.({
    kind: 'finalize-done',
    family: 'interview',
    totalLatencyMs: Date.now() - t0,
    chunkCount: chunks.length,
    totalAttempts: totalAttemptsAcrossChunks,
    sanitizedTotal: sanitizedAcrossChunks,
  });
  return { note, telemetry };
}

// ─── finalizeBrainstorm ─────────────────────────────────────────────────────────

export interface FinalizeBrainstormArgs {
  sessionId: string;
  transcript: SessionTranscript;
  sidecar: GrammarCapableSidecar;
  modelProfile: ModelProfile;
  promptVariantId?: string;
  /**
   * Session language (minimal EN support, 2026-06-10). Drives the system-
   * template output-language rule (renderSystemTemplate) and the Note meta.
   * Defaults to 'ja' — the eval'd v2.0 baseline.
   */
  language?: NoteLanguage;
  /**
   * 'ok' = transcript carries real diarized speakerIds; 'fallback'/'disabled' =
   * any SpeakerRef the model emits is a hallucination → collapse to 0 post-merge.
   * Brainstorm requiresDiarization=false, so unlike meeting/interview the
   * transcript itself is never degraded.
   */
  diarizationStatus: 'ok' | 'fallback' | 'disabled';
  onProgress?: (e:
    | { phase: 'chunk'; chunkIndex: number; totalChunks: number }
    | { phase: 'merge' }
    | { phase: 'persist' }
  ) => void;
  /** See FinalizeLectureArgs.onTelemetry. */
  onTelemetry?: (e: FinalizeTelemetryEvent) => void;
}

export interface FinalizeBrainstormResult {
  note: BrainstormNote;
  telemetry: GenerationTelemetry;
}

/**
 * Finalize a brainstorm session. Brainstorm requiresDiarization=false (treated
 * single-speaker), so the transcript is never degraded — but model-hallucinated
 * SpeakerRefs (ideas[].contributed_by, next_steps[].owner) still need the same
 * post-merge collapse as finalizeMeeting/finalizeInterview when diarization
 * didn't run. The cross-chunk merge is the HYBRID runMergeLLMCall (Task
 * 7): idea_clusters are synthesized by the merge LLM (semantically unifying
 * cross-chunk themes), and idea UUIDs are assigned by the post-decode pipeline.
 * On merge-LLM failure we fall back to a deterministic merge (first-chunk
 * clusters; parking_lot/conclusions/next_steps concatenated).
 *
 * No Electron IPC — pure async function. session-finalize.ts wires the IPC.
 */
export async function finalizeBrainstorm(
  args: FinalizeBrainstormArgs,
): Promise<FinalizeBrainstormResult> {
  const generationStartedAt = new Date().toISOString();
  const t0 = Date.now();

  const fam = familyCoreRegistry['brainstorm'];
  if (!fam) throw new Error('BRAINSTORM_FAMILY_NOT_REGISTERED');

  const grammar = zodToGbnf(fam.schema, 'BrainstormNote');

  const prompt = selectPromptVariant(
    fam.prompts,
    fam.defaultPromptVariant,
    args.promptVariantId ? { userPreference: args.promptVariantId } : undefined,
  );

  const tuning = args.modelProfile.perFamily['brainstorm'];
  const chunks = chunkTranscript(args.transcript, tuning.recommendedChunkTokens);

  if (chunks.length === 0) {
    throw new Error('EMPTY_TRANSCRIPT');
  }

  const generator = makeSidecarGenerator(args.sidecar);
  const partials: Array<Record<string, unknown>> = [];

  let totalAttemptsAcrossChunks = 0;
  let sanitizedAcrossChunks = 0;

  for (let i = 0; i < chunks.length; i++) {
    args.onProgress?.({ phase: 'chunk', chunkIndex: i, totalChunks: chunks.length });

    const userPrompt = prompt.chunkUserTemplate({
      chunkIndex: i,
      totalChunks: chunks.length,
      transcript: renderTranscriptWithSpeakers(chunks[i]!, args.transcript.speakers),
    });
    const systemPrompt = renderSystemTemplate(prompt.systemTemplate, args.language ?? 'ja');

    // baseSeed 8000 (lecture 5000, meeting 6000, interview 7000) keeps seeds distinct.
    const chunkResult = await runChunkWithGrammar({
      family: 'brainstorm',
      fam,
      chunkIndex: i,
      totalChunks: chunks.length,
      systemPrompt,
      userPrompt,
      grammar,
      baseSeed: 8000 + i,
      tuning,
      generator,
      transcriptForPostDecode: args.transcript,
      expectedLanguage: args.language ?? 'ja',
      onTelemetry: args.onTelemetry,
    });
    partials.push(chunkResult.validated as Record<string, unknown>);
    totalAttemptsAcrossChunks += chunkResult.innerAttemptsTotal;
    sanitizedAcrossChunks += chunkResult.sanitizedTotal;
  }

  // ── Merge ───────────────────────────────────────────────────────────────────
  let merged: Record<string, unknown>;
  const warnings: string[] = [];
  if (partials.length === 1) {
    merged = partials[0]!;
  } else {
    args.onProgress?.({ phase: 'merge' });
    const r = await runMergeLLMCall({
      family: 'brainstorm',
      partials,
      transcript: args.transcript,
      baseSeed: 8500,
      generator,
    });
    if (r.ok) {
      merged = r.merged as unknown as Record<string, unknown>;
      warnings.push(...r.validationWarnings);
    } else {
      merged = deterministicMerge<Record<string, unknown>>(partials, fam.mergeStrategy);
      warnings.push(
        `merge: LLM merge failed (${r.finalReason}); fell back to deterministic merge (idea_clusters from first chunk only)`,
      );
    }
  }

  if (warnings.length > 0) {
    merged.validation_warnings = [
      ...((merged.validation_warnings as string[] | undefined) ?? []),
      ...warnings,
    ];
  }

  // Merge-LLM output re-enters after the per-chunk pipeline — sweep empties
  // (and clusters left without ideas) before the final parse.
  dropEmptyUserVisibleItems(merged, 'brainstorm');
  // Without diarization every SpeakerRef is a hallucination (founder P1,
  // 2026-06-10): contributed_by/owner would render as phantom 話者N tags.
  // Brainstorm has no participants roster, so the collapse alone suffices.
  if (args.diarizationStatus !== 'ok') {
    collapseSpeakerRefsToZero(merged);
  }

  const note = fam.schema.parse(merged) as BrainstormNote;
  applyGeneratedMeta(note, {
    generatedAt: generationStartedAt,
    model: args.modelProfile.id,
    promptVersion: prompt.version,
    language: args.language ?? 'ja',
    durationSec: args.transcript.transcriptSegments.at(-1)?.endTs ?? 0,
  });

  const telemetry: GenerationTelemetry = {
    noteId: args.sessionId,
    modelId: args.modelProfile.id,
    promptVariantId: prompt.variantId,
    schemaVersion: 1,
    generationStartedAt,
    generationDurationMs: Date.now() - t0,
    chunkCount: chunks.length,
    totalTokensIn: chunks.reduce(
      (sum, chunk) => sum + estimateTokens(renderTranscriptWithSpeakers(chunk, args.transcript.speakers)),
      0,
    ),
    totalTokensOut: 0,
    validationWarnings: warnings,
    dedupHits: [],
    postDecodeMutations: [],
  };

  args.onProgress?.({ phase: 'persist' });
  args.onTelemetry?.({
    kind: 'finalize-done',
    family: 'brainstorm',
    totalLatencyMs: Date.now() - t0,
    chunkCount: chunks.length,
    totalAttempts: totalAttemptsAcrossChunks,
    sanitizedTotal: sanitizedAcrossChunks,
  });
  return { note, telemetry };
}

// ─── file-local helpers ───────────────────────────────────────────────────────

/** Render a chunk's segments as a timestamp-prefixed transcript string. */
function renderTranscriptChunk(chunk: SessionTranscript): string {
  return chunk.transcriptSegments
    .map(s => `[${formatTs(s.ts)}] ${s.text}`)
    .join('\n');
}

function formatTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Render a meeting transcript chunk with a speaker map header and per-line
 * speaker prefix. The speaker map lets the LLM reverse-look-up name→SpeakerRef
 * for integer fields like decisions.made_by and next_steps.owner.
 *
 * Format:
 *   Speaker map: Speaker 0 = 佐藤, Speaker 1 = 山田
 *
 *   [0:05] [佐藤] 本日はよろしくお願いします。
 */
function renderTranscriptWithSpeakers(
  chunk: SessionTranscript,
  speakers: SessionTranscript['speakers'],
): string {
  const lookup = new Map(speakers.map((s) => [s.id, s.name ?? `話者${s.id}`]));
  const speakerMap = speakers.map((s) => `Speaker ${s.id} = ${s.name ?? `話者${s.id}`}`).join(', ');
  const lines = chunk.transcriptSegments
    .map((s) => `[${formatTs(s.ts)}] [${lookup.get(s.speakerId) ?? `Speaker ${s.speakerId}`}] ${s.text}`)
    .join('\n');
  return `Speaker map: ${speakerMap}\n\n${lines}`;
}

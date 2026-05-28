import type { STTEngine, LLMEngine, Language, TranscriptSegment, ChatMessage } from '@shared/engine-interfaces';
import type { Note } from '@shared/types';
import type { SessionPhase } from '@shared/ipc-protocol';
import { withTimeout } from '@shared/with-timeout';
import { buildJaNoteV1Prompt } from './prompts/ja-note-v1';
import { TIMEOUTS, TIMEOUT_CODES } from './timeouts';

// ─── finalizeLecture / finalizeMeeting imports ───────────────────────────────
import type { SessionTranscript } from '@shared/note-schema/transcript';
import type { ModelProfile } from '@shared/models/profiles';
import type { GenerationTelemetry } from '@shared/note-schema/telemetry';
import type { LectureNote } from '@shared/families/lecture/schema';
import type { MeetingNote } from '@shared/families/meeting/schema';
import { z } from 'zod';
import { familyCoreRegistry, selectPromptVariant } from '@shared/families';
import { zodToGbnf } from '@shared/note-schema/zod-to-gbnf';
import { chunkTranscript } from '@shared/note-schema/chunking';
import { estimateTokens } from '@shared/note-schema/tokens';
import { runPostDecodePipeline } from '@shared/post-decode/pipeline';
import { deterministicMerge } from '@shared/post-decode/deterministic-merge';
import { callWithGrammar, makeSidecarGenerator, type GrammarCapableSidecar } from './grammar-call';
import { degradeToSingleSpeaker } from '@shared/families/meeting/degrade-to-single-speaker';

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

  async onChunk(audio: Float32Array): Promise<TranscriptSegment[]> {
    const segs = await this.opts.stt.transcribe(audio);
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
      const messages = (this.opts.buildPrompt ?? defaultPrompt)(this.opts.language, this.segments);
      // generate() is per-token streaming; the GENERATE_TIMEOUT (no-progress
      // 60s) is enforced inside LlamaCppLLM → SidecarClient.sendStream, so
      // no extra wrapping here.
      let md = '';
      for await (const tok of this.opts.llm.generate(messages, { maxTokens: 4096, temperature: 0.4 })) md += tok;
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
  onProgress?: (e:
    | { phase: 'chunk'; chunkIndex: number; totalChunks: number }
    | { phase: 'merge' }
    | { phase: 'persist' }
  ) => void;
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

  // ── Per-chunk: call LLM + post-decode pipeline ────────────────────────────
  for (let i = 0; i < chunks.length; i++) {
    args.onProgress?.({ phase: 'chunk', chunkIndex: i, totalChunks: chunks.length });

    // ── Correction F: systemTemplate (not system) ──────────────────────────
    const userPrompt = prompt.chunkUserTemplate({
      chunkIndex: i,
      totalChunks: chunks.length,
      transcript: renderTranscriptChunk(chunks[i]!),
    });
    const combinedPrompt = `${prompt.systemTemplate}\n\n${userPrompt}`;

    // ── Correction A: callWithGrammar with z.unknown() pass-through ────────
    const result = await callWithGrammar<unknown>({
      prompt: combinedPrompt,
      schema: z.unknown(),
      grammar,
      baseSeed: 5000 + i,
      temperature: tuning.temperature,
      maxAttempts: 3,
      maxTokens: tuning.maxGenTokens,
      generator,
    });

    if (!result.ok) {
      throw new Error(`CHUNK_FAILED:${i}:${result.finalReason}`);
    }

    // ── Correction C: re-serialize → runPostDecodePipeline ─────────────────
    // callWithGrammar parses JSON internally (with z.unknown(), it passes through).
    // runPostDecodePipeline expects a raw JSON string — the double round-trip
    // is acceptable for chunk-sized JSON (a few KB) and keeps Task 8's pipeline
    // contract unchanged (per task spec: do NOT refactor pipeline to accept object).
    const rawJson = JSON.stringify(result.value);
    const validated = runPostDecodePipeline(rawJson, fam, args.transcript);
    partials.push(validated as Partial<LectureNote>);
  }

  // ── Merge partials ────────────────────────────────────────────────────────
  args.onProgress?.({ phase: 'merge' });
  const merged = deterministicMerge<Record<string, unknown>>(
    partials as Array<Partial<Record<string, unknown>>>,
    fam.mergeStrategy,
  );

  // Re-parse the merged object through the family schema for final validation
  const note = fam.schema.parse(merged) as LectureNote;

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
  return { note, telemetry };
}

// ─── finalizeMeeting ──────────────────────────────────────────────────────────

export interface FinalizeMeetingArgs {
  sessionId: string;
  transcript: SessionTranscript;
  sidecar: GrammarCapableSidecar;
  modelProfile: ModelProfile;
  promptVariantId?: string;
  /** 'ok' = transcript already carries real diarized speakerIds; 'fallback'/'disabled' = collapse to single speaker + warn. */
  diarizationStatus: 'ok' | 'fallback' | 'disabled';
  onProgress?: (e:
    | { phase: 'chunk'; chunkIndex: number; totalChunks: number }
    | { phase: 'merge' }
    | { phase: 'persist' }
  ) => void;
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

  for (let i = 0; i < chunks.length; i++) {
    args.onProgress?.({ phase: 'chunk', chunkIndex: i, totalChunks: chunks.length });

    const userPrompt = prompt.chunkUserTemplate({
      chunkIndex: i,
      totalChunks: chunks.length,
      transcript: renderTranscriptWithSpeakers(chunks[i]!, activeTranscript.speakers),
    });
    const combinedPrompt = `${prompt.systemTemplate}\n\n${userPrompt}`;

    // baseSeed 6000 (lecture uses 5000) keeps seeds distinct across families.
    const result = await callWithGrammar<unknown>({
      prompt: combinedPrompt,
      schema: z.unknown(),
      grammar,
      baseSeed: 6000 + i,
      temperature: tuning.temperature,
      maxAttempts: 3,
      maxTokens: tuning.maxGenTokens,
      generator,
    });

    if (!result.ok) {
      throw new Error(`CHUNK_FAILED:${i}:${result.finalReason}`);
    }

    const rawJson = JSON.stringify(result.value);
    const validated = runPostDecodePipeline(rawJson, fam, activeTranscript);
    partials.push(validated as Partial<MeetingNote>);
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

  const note = fam.schema.parse(merged) as MeetingNote;

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

import type { STTEngine, LLMEngine, Language, TranscriptSegment } from '@shared/engine-interfaces';
import type { Note } from '@shared/types';
import type { SessionPhase } from '@shared/ipc-protocol';
import { withTimeout } from '@shared/with-timeout';
import { buildJaNoteV1Prompt } from './prompts/ja-note-v1';
import { TIMEOUTS, TIMEOUT_CODES } from './timeouts';

interface Opts {
  stt: STTEngine;
  llm: LLMEngine;
  sttModelPath: string;
  llmModelPath: string;
  language: Language;
  buildPrompt?(language: Language, segments: TranscriptSegment[]): string;
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
      const prompt = (this.opts.buildPrompt ?? defaultPrompt)(this.opts.language, this.segments);
      // generate() is per-token streaming; the GENERATE_TIMEOUT (no-progress
      // 60s) is enforced inside LlamaCppLLM → SidecarClient.sendStream, so
      // no extra wrapping here.
      let md = '';
      for await (const tok of this.opts.llm.generate(prompt, { maxTokens: 4096, temperature: 0.4 })) md += tok;
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

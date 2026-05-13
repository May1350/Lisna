import type { STTEngine, LLMEngine, Language, TranscriptSegment } from '@shared/engine-interfaces';
import type { Note } from '@shared/types';

interface Opts {
  stt: STTEngine;
  llm: LLMEngine;
  sttModelPath: string;
  llmModelPath: string;
  language: Language;
  buildPrompt?(language: Language, segments: TranscriptSegment[]): string;
}

const defaultPrompt = (lang: Language, segs: TranscriptSegment[]): string => {
  const transcript = segs.map(s => `[${s.startSec.toFixed(1)}s] ${s.text}`).join('\n');
  return `You are a meeting note writer. Output Markdown.\nLanguage: ${lang}\n\nTranscript:\n${transcript}\n\nNote:\n`;
};

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
 *   `generate()` does not leave the model resident.
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
    await this.opts.stt.loadModel(this.opts.sttModelPath, this.opts.language);
  }

  async onChunk(audio: Float32Array): Promise<TranscriptSegment[]> {
    const segs = await this.opts.stt.transcribe(audio);
    this.segments.push(...segs);
    return segs;
  }

  async stop(): Promise<Note> {
    try {
      await this.opts.stt.unloadModel();      // OS reclaim 까지 await (어댑터 → 사이드카 → C++)
      await this.opts.llm.loadModel(this.opts.llmModelPath);
      const prompt = (this.opts.buildPrompt ?? defaultPrompt)(this.opts.language, this.segments);
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
      await this.opts.llm.unloadModel().catch(() => {});
    }
  }
}

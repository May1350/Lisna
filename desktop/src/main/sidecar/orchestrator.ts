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
    await this.opts.stt.unloadModel();      // OS reclaim 까지 await (어댑터 → 사이드카 → C++)
    await this.opts.llm.loadModel(this.opts.llmModelPath);
    const prompt = (this.opts.buildPrompt ?? defaultPrompt)(this.opts.language, this.segments);
    let md = '';
    for await (const tok of this.opts.llm.generate(prompt, { maxTokens: 4096, temperature: 0.4 })) md += tok;
    await this.opts.llm.unloadModel();
    return {
      language: this.opts.language,
      generatedAt: new Date().toISOString(),
      markdown: md,
      transcriptSegments: this.segments,
    };
  }
}

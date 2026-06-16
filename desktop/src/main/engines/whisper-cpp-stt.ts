import type { STTEngine, Language, TranscriptSegment, TranscribeOpts } from '@shared/engine-interfaces';
import type { SidecarClient } from '../sidecar/client';
import { filterSegments } from './segment-filters';

export class WhisperCppSTT implements STTEngine {
  // Track language so transcribe() can apply the language-specific blocklist (Layer E).
  // Re-load with a different language: simple reassignment, no state-clear needed
  // (filter is stateless across calls).
  private language: Language | null = null;

  constructor(private client: SidecarClient) {}

  async loadModel(path: string, language: Language): Promise<void> {
    const r = await this.client.send(
      { type: 'load', kind: 'stt', path, language },
      { timeoutMs: Infinity },
    );
    if (r.type === 'error') throw new Error(`STT load failed [${r.code}]: ${r.message}`);
    if (r.type !== 'ok') throw new Error(`STT load: unexpected response ${JSON.stringify(r)}`);
    this.language = language;
  }

  async unloadModel(): Promise<void> {
    const r = await this.client.send({ type: 'unload', kind: 'stt' }, { timeoutMs: Infinity });
    if (r.type === 'error') throw new Error(`STT unload failed [${r.code}]: ${r.message}`);
    if (r.type !== 'ok') throw new Error(`STT unload: unexpected response ${JSON.stringify(r)}`);
    this.language = null;
  }

  async transcribe(audio: Float32Array, opts?: TranscribeOpts): Promise<TranscriptSegment[]> {
    const bytes = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
    const audioBase64 = Buffer.from(bytes).toString('base64');
    // Omit `initialPrompt` when empty/whitespace so the wire stays minimal and
    // old sidecar binaries (which ignore the field) behave identically.
    const initialPrompt = opts?.initialPrompt?.trim();
    const r = await this.client.send(
      initialPrompt
        ? { type: 'transcribe', audioBase64, sampleRate: 16000, initialPrompt }
        : { type: 'transcribe', audioBase64, sampleRate: 16000 },
      { timeoutMs: 120_000 },
    );
    if (r.type === 'error') throw new Error(`STT transcribe failed [${r.code}]: ${r.message}`);
    if (r.type !== 'segments') throw new Error(`STT transcribe: unexpected response ${JSON.stringify(r)}`);
    if (this.language === null) return r.segments;
    return filterSegments(r.segments, { language: this.language });
  }

  async transcribeFile(path: string, opts?: TranscribeOpts): Promise<TranscriptSegment[]> {
    const initialPrompt = opts?.initialPrompt?.trim();
    const r = await this.client.send(
      initialPrompt
        ? { type: 'transcribeFile', path, sampleRate: 16000, initialPrompt }
        : { type: 'transcribeFile', path, sampleRate: 16000 },
      // Infinite timeout — the whole-file pass is bounded by a main-side stall
      // watchdog added in a later task; a wall-clock cap here would abort long
      // recordings prematurely (e.g. an 84-min lecture).
      { timeoutMs: Infinity },
    );
    if (r.type === 'error') throw new Error(`STT transcribeFile failed [${r.code}]: ${r.message}`);
    if (r.type !== 'segments') throw new Error(`STT transcribeFile: unexpected response ${JSON.stringify(r)}`);
    if (this.language === null) return r.segments;
    return filterSegments(r.segments, { language: this.language });
  }
}

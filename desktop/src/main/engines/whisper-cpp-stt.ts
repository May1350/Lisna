import type { STTEngine, Language, TranscriptSegment } from '@shared/engine-interfaces';
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

  async transcribe(audio: Float32Array): Promise<TranscriptSegment[]> {
    const bytes = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
    const audioBase64 = Buffer.from(bytes).toString('base64');
    const r = await this.client.send(
      { type: 'transcribe', audioBase64, sampleRate: 16000 },
      { timeoutMs: 120_000 },
    );
    if (r.type === 'error') throw new Error(`STT transcribe failed [${r.code}]: ${r.message}`);
    if (r.type !== 'segments') throw new Error(`STT transcribe: unexpected response ${JSON.stringify(r)}`);
    if (this.language === null) return r.segments;
    return filterSegments(r.segments, { language: this.language });
  }
}

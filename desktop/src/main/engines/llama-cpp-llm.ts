import type { LLMEngine, GenOpts } from '@shared/engine-interfaces';
import type { SidecarClient } from '../sidecar/client';

export class LlamaCppLLM implements LLMEngine {
  constructor(private client: SidecarClient) {}

  async loadModel(path: string): Promise<void> {
    const r = await this.client.send(
      { type: 'load', kind: 'llm', path },
      { timeoutMs: Infinity },
    );
    if (r.type === 'error') throw new Error(`LLM load failed [${r.code}]: ${r.message}`);
    if (r.type !== 'ok') throw new Error(`LLM load: unexpected response ${JSON.stringify(r)}`);
  }

  async unloadModel(): Promise<void> {
    const r = await this.client.send({ type: 'unload', kind: 'llm' }, { timeoutMs: Infinity });
    if (r.type === 'error') throw new Error(`LLM unload failed [${r.code}]: ${r.message}`);
    if (r.type !== 'ok') throw new Error(`LLM unload: unexpected response ${JSON.stringify(r)}`);
  }

  generate(prompt: string, opts: GenOpts): AsyncIterable<string> {
    return this.client.sendStream(
      {
        type: 'generate',
        prompt,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        stop: opts.stop,
      },
      { timeoutMs: 120_000 },
    );
  }
}

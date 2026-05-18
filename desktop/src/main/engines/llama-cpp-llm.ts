import type { LLMEngine, GenOpts, ChatMessage } from '@shared/engine-interfaces';
import type { SidecarClient } from '../sidecar/client';
import { TIMEOUTS, TIMEOUT_CODES } from '../sidecar/timeouts';

export class LlamaCppLLM implements LLMEngine {
  constructor(private client: SidecarClient) {}

  async loadModel(path: string): Promise<void> {
    // Note: the LLM_LOAD wall-clock timeout is enforced by SessionOrchestrator
    // wrapping this call in `withTimeout`. We keep `timeoutMs: Infinity` here
    // so the adapter doesn't get a second, finer-grained timeout that fights
    // the orchestrator's policy. The sidecar protocol itself is reliable.
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

  /**
   * Stream generation. The per-token progress timeout (`GENERATE_NO_PROGRESS_MS`,
   * 60s) is enforced inside `SidecarClient.sendStream` — if no token, done, or
   * error arrives within that window, the stream rejects with the bare
   * `"sidecar stream <id> timed out after Nms (no progress)"` message. We
   * remap that to the typed `GENERATE_TIMEOUT` code here so ErrorView's
   * friendly-map can show a meaningful JA message.
   *
   * Non-timeout errors (`sidecar stream <id> failed [...]`) propagate unchanged
   * so the underlying diagnostic is preserved for log inspection.
   *
   * **Preserves SidecarClient.sendStream's synchronous side-effects contract**:
   * the subscription, stdin write, and timer arm must run at *call* time, not
   * lazily on first `.next()`. We call `sendStream` synchronously and only
   * wrap the consumption inside the inner async generator's try/catch.
   */
  generate(messages: ChatMessage[], opts: GenOpts): AsyncIterable<string> {
    // Side-effects: subscribe, write request, arm timer — run NOW (sync).
    const stream = this.client.sendStream(
      {
        type: 'generate',
        messages,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        stop: opts.stop,
      },
      { timeoutMs: TIMEOUTS.GENERATE_NO_PROGRESS_MS },
    );
    async function* withRemap(): AsyncGenerator<string> {
      try {
        for await (const tok of stream) yield tok;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('timed out after') && msg.includes('no progress')) {
          throw new Error(TIMEOUT_CODES.GENERATE_TIMEOUT);
        }
        throw err;
      }
    }
    return withRemap();
  }
}

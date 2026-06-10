import { describe, it, expect, vi } from 'vitest';
import { makeRecoveringGrammarSidecar } from '../recovering-grammar-sidecar';
import type { GrammarCapableSidecar } from '../grammar-call';

const okResult = { text: '{"ok":true}', seed: 1 };
const req = { prompt: 'p', grammar: 'g', seed: 1, temperature: 0.6, maxTokens: 100 };

function sidecarReturning(impl: () => Promise<{ text: string; seed: number }>): GrammarCapableSidecar {
  return { generateWithGrammar: impl };
}

describe('makeRecoveringGrammarSidecar', () => {
  it('passes through a successful generate untouched', async () => {
    const recover = vi.fn();
    const wrapped = makeRecoveringGrammarSidecar({
      getSidecar: () => sidecarReturning(() => Promise.resolve(okResult)),
      recover,
    });
    await expect(wrapped.generateWithGrammar(req)).resolves.toEqual(okResult);
    expect(recover).not.toHaveBeenCalled();
  });

  it('throws SIDECAR_DOWN when no client is available', async () => {
    const wrapped = makeRecoveringGrammarSidecar({ getSidecar: () => null, recover: vi.fn() });
    await expect(wrapped.generateWithGrammar(req)).rejects.toThrow('SIDECAR_DOWN');
  });

  it('runs recover() on a no-progress stall, then rethrows the original error', async () => {
    const recover = vi.fn(() => Promise.resolve());
    const stall = new Error('sidecar stream abc timed out after 60000ms (no progress)');
    const wrapped = makeRecoveringGrammarSidecar({
      getSidecar: () => sidecarReturning(() => Promise.reject(stall)),
      recover,
    });
    await expect(wrapped.generateWithGrammar(req)).rejects.toBe(stall);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('does NOT recover on non-stall errors (parse fail, process exit, plain timeout)', async () => {
    const recover = vi.fn();
    for (const msg of [
      'Unexpected token in JSON',
      'sidecar process exited',
      'sidecar request 42 timed out after 5000ms', // plain request timeout, not a stream stall
    ]) {
      const wrapped = makeRecoveringGrammarSidecar({
        getSidecar: () => sidecarReturning(() => Promise.reject(new Error(msg))),
        recover,
      });
      await expect(wrapped.generateWithGrammar(req)).rejects.toThrow();
    }
    expect(recover).not.toHaveBeenCalled();
  });

  it('rethrows the stall even when recover() itself fails', async () => {
    const stall = new Error('stream x timed out after 60000ms (no progress)');
    const wrapped = makeRecoveringGrammarSidecar({
      getSidecar: () => sidecarReturning(() => Promise.reject(stall)),
      recover: () => Promise.reject(new Error('restart failed')),
    });
    // The original stall propagates — recovery failure is the recover()
    // implementation's concern (cache invalidation), not the caller's.
    await expect(wrapped.generateWithGrammar(req)).rejects.toBe(stall);
  });

  it('single-flights concurrent recoveries', async () => {
    let resolveRecover!: () => void;
    const recoverGate = new Promise<void>((r) => { resolveRecover = r; });
    const recover = vi.fn(() => recoverGate);
    const stall = () =>
      Promise.reject(new Error('stream y timed out after 60000ms (no progress)'));
    const wrapped = makeRecoveringGrammarSidecar({
      getSidecar: () => sidecarReturning(stall),
      recover,
    });
    const p1 = wrapped.generateWithGrammar(req).catch(() => 'rejected');
    const p2 = wrapped.generateWithGrammar(req).catch(() => 'rejected');
    await new Promise((r) => setTimeout(r, 20)); // both stalls observed
    resolveRecover();
    expect(await p1).toBe('rejected');
    expect(await p2).toBe('rejected');
    expect(recover).toHaveBeenCalledTimes(1); // shared, not two restarts
  });

  it('resolves the sidecar lazily — a post-restart client is picked up on retry', async () => {
    const stale = sidecarReturning(() =>
      Promise.reject(new Error('stream z timed out after 60000ms (no progress)')));
    const fresh = sidecarReturning(() => Promise.resolve(okResult));
    let active = stale;
    const wrapped = makeRecoveringGrammarSidecar({
      getSidecar: () => active,
      recover: () => {
        active = fresh; // restart swaps the client
        return Promise.resolve();
      },
    });
    await expect(wrapped.generateWithGrammar(req)).rejects.toThrow('no progress');
    // Next attempt (callWithGrammar's fresh-seed retry) hits the fresh client.
    await expect(wrapped.generateWithGrammar(req)).resolves.toEqual(okResult);
  });
});

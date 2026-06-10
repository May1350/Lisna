import type { GrammarCapableSidecar } from './grammar-call';

export interface RecoveryDeps {
  /**
   * Resolve the CURRENT sidecar lazily, once per generate call. Capturing a
   * client at finalize start would go stale after a mid-finalize restart —
   * every retry would then hit a dead process.
   */
  getSidecar(): GrammarCapableSidecar | null;
  /**
   * Kill + respawn the wedged sidecar and reload the LLM. Invoked when a
   * generate stream stalls (no-progress timeout). Implementations should
   * surface their own telemetry; a rejection here is swallowed (the original
   * stall error propagates) but should invalidate any "LLM already loaded"
   * cache so the next finalize re-runs the full prep.
   */
  recover(): Promise<void>;
}

/**
 * Wedged-retry fix (2026-06-10 RCA): the C++ sidecar dispatch loop is
 * single-threaded and blocking — when a generate stalls mid-decode, the TS
 * stream timeout rejects the attempt but the C++ side keeps decoding, so
 * every subsequent request queues unread behind the doomed generation and
 * times out at exactly its no-progress ceiling with zero tokens. Observed
 * live: 14:22 run attempt3 latency 761s (= queue wait), 15:34 run attempts
 * 2/3 at exactly 60.0s with no progress.
 *
 * This wrapper restores retry semantics: on a no-progress stall it restarts
 * the sidecar (+ LLM reload) BEFORE rethrowing, so callWithGrammar's next
 * fresh-seed attempt runs against a live process instead of a wedged one.
 * Recovery is single-flight — concurrent stalls (e.g. parallel chunk
 * finalizers, future) share one restart.
 */
export function makeRecoveringGrammarSidecar(deps: RecoveryDeps): GrammarCapableSidecar {
  let recovering: Promise<void> | null = null;
  return {
    async generateWithGrammar(req) {
      const sidecar = deps.getSidecar();
      if (!sidecar) throw new Error('SIDECAR_DOWN');
      try {
        return await sidecar.generateWithGrammar(req);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('no progress')) {
          recovering ??= deps.recover().finally(() => {
            recovering = null;
          });
          // Recovery failure must not mask the original stall — the attempt
          // is burned either way, and the recover() impl is responsible for
          // invalidating LLM-loaded caches on its own failure.
          await recovering.catch(() => undefined);
        }
        throw e;
      }
    },
  };
}

/**
 * Race a promise against a timer. If the timer fires first, reject with
 * `new Error(code)` — the *bare code string* as `.message`, so downstream
 * `ErrorView.tsx` friendly-fallback maps and the orchestrator's exception
 * handlers can pattern-match on `err.message === code` or `err.message.includes(code)`.
 *
 * If the underlying promise settles first (resolve or reject), the timer is
 * cleared and the original outcome is propagated unchanged. This is
 * important: callers must see the actual upstream error message (e.g.
 * `'STT load failed [DECODE]: ...'`) to surface a useful diagnostic, not
 * a generic `STT_TIMEOUT` for every load failure.
 *
 * **Why `code` as `.message` not as a typed error class:** the rest of the
 * codebase already encodes error states as bare strings (`SIDECAR_DOWN`,
 * `EMPTY_TRANSCRIPT`, etc.) thrown via `new Error(code)`, and ErrorView's
 * `FRIENDLY` map keys on that. Introducing a subclass here would force a
 * second pattern downstream. Step 5 §3 has structured-code split as an
 * explicit non-goal (§8 line 203: "flat string OK for v2.0 alpha").
 *
 * **Timer cleanup:** runs in both branches of the race so the test's
 * "advance past timeout after resolution" probe sees no spurious unhandled
 * rejection. Without `clearTimeout` in the resolve branch, the timer fires
 * later and the no-op reject is still scheduled — Node's microtask queue
 * silently swallows it but Vitest's unhandledRejection tracking flags it.
 */
export function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  code: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

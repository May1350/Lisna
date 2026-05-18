/**
 * Per-operation timeout budgets used by SessionOrchestrator and the engine
 * adapters. Centralized so tests can tweak via direct import and an
 * eventual Settings UI can override per-environment.
 *
 * **Spec divergence note** (Step 5 §3.5 task 1 listed 5s for STT load): the
 * spec body itself acknowledges in §3.3 that "STT cold load is 3-10s; with
 * TCC prompt stacked, total can be 30-40s." A 5s budget would always trip
 * on first-launch where macOS shows the microphone-permission dialog and
 * the user takes >5s to click Allow. We raise STT load to 60s. STT unload
 * is a cheap synchronous-equivalent op that should never take >5s — that
 * value matches the spec.
 *
 * LLM load (Q4_K_M, ~2GB, mmap + Metal backend init) on M1 cold disk: 5-15s.
 * Spec said 10s — we go 30s to absorb cold filesystem variance. Unload 5s.
 *
 * Generate: per-token progress timeout (no progress for 60s during a stream
 * means the sidecar has wedged). Enforced inside `SidecarClient.sendStream`
 * which `LlamaCppLLM.generate` wires up; the bare timeout error is remapped
 * to `GENERATE_TIMEOUT` at the adapter layer.
 *
 * All codes are 1:1 with ErrorView's friendly-map keys; adding one here
 * MUST add the corresponding JA copy in Phase E.
 */
export const TIMEOUTS = {
  STT_LOAD_MS: 60_000,
  STT_UNLOAD_MS: 5_000,
  LLM_LOAD_MS: 30_000,
  LLM_UNLOAD_MS: 5_000,
  GENERATE_NO_PROGRESS_MS: 60_000,
} as const;

export const TIMEOUT_CODES = {
  STT_TIMEOUT: 'STT_TIMEOUT',
  LLM_LOAD_TIMEOUT: 'LLM_LOAD_TIMEOUT',
  LLM_UNLOAD_TIMEOUT: 'LLM_UNLOAD_TIMEOUT',
  GENERATE_TIMEOUT: 'GENERATE_TIMEOUT',
} as const;

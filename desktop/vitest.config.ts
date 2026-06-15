import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Vitest by default scans the whole workspace for *.{test,spec}.{js,ts,...}.
// Without an explicit exclude, the C++ submodule under sidecar/deps/whisper.cpp
// (e.g. examples/addon.node/__test__/whisper.spec.js) gets picked up and fails
// because it expects a native addon that we never build.
//
// The `@shared/*` alias mirrors electron.vite.config.ts and tsconfig.json so
// runtime (non-type-only) imports from `@shared/` resolve in tests. Until
// Step 5 §3.5 (withTimeout), no production file did a runtime `@shared/` import,
// so the alias wasn't strictly required here — `import type` is erased by tsc.
// Now it is. Keep the three configs (vitest / electron.vite / tsconfig) in sync.
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
  },
  test: {
    // `spikes/**` is EXCLUDED from the default suite (`pnpm test` / `verify`).
    // Spike tests under spikes/phase-0/ include hardware-gated real-LLM round
    // trips (e.g. 01-zod-to-gbnf/round-trip.test.ts) that fork `llama-completion`
    // for multi-minute real inference. Their only gate is "model + spike binary
    // exist" (PREREQS_PRESENT) — both DO exist on a dev machine, so an unfiltered
    // `vitest run` forks Llama-3.2-3B and pegs RAM (8GB M1 → swap thrash →
    // kernel-panic risk). The 4-layer zombie defense only reaps orphans on EXIT,
    // not a test that is legitimately mid-inference. Run spikes explicitly by
    // path when you mean to. Founder incident 2026-06-15: a backgrounded
    // `pnpm verify` forked a runaway llama-completion. pitfalls.md (vitest-scope).
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', 'sidecar/deps/**', 'spikes/**'],
    // L2 zombie defense — pkill llama-completion before AND after the
    // test run. See vitest.global-setup.ts for the 4-layer strategy.
    // Founder incident 2026-06-09: 2.31 GB orphan in Activity Monitor
    // during a verify; per-test afterAll is L1 but doesn't catch
    // leftovers from prior crashed runs.
    globalSetup: './vitest.global-setup.ts',
  },
});

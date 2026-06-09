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
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', 'sidecar/deps/**'],
    // L2 zombie defense — pkill llama-completion before AND after the
    // test run. See vitest.global-setup.ts for the 4-layer strategy.
    // Founder incident 2026-06-09: 2.31 GB orphan in Activity Monitor
    // during a verify; per-test afterAll is L1 but doesn't catch
    // leftovers from prior crashed runs.
    globalSetup: './vitest.global-setup.ts',
  },
});

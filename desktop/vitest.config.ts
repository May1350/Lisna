import { defineConfig } from 'vitest/config';

// Vitest by default scans the whole workspace for *.{test,spec}.{js,ts,...}.
// Without an explicit exclude, the C++ submodule under sidecar/deps/whisper.cpp
// (e.g. examples/addon.node/__test__/whisper.spec.js) gets picked up and fails
// because it expects a native addon that we never build.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', 'sidecar/deps/**'],
  },
});

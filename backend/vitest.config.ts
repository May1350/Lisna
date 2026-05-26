import { defineConfig, configDefaults } from 'vitest/config'

// Vitest 4 dropped `**/dist/**` from its default exclude list (it was present
// through v3). Without this, `pnpm build` (tsc → dist/) leaves compiled
// `dist/tests/**/*.test.js` duplicates of every source test, and vitest runs
// both copies. The dist copies resolve FS-asset paths (manifests/, migrations/)
// relative to `dist/src/lib/`, which `tsc` never populates → ENOENT in CI.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
})

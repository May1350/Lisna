/**
 * Spec §10.1 row 18 — fsync rejection: file fsync throws → no rename →
 * models.json absent, error propagates to caller.
 *
 * Lives in its own file because vi.mock('node:fs', ...) is hoisted to the
 * top of module evaluation. The sibling model-resolver.test.ts uses the
 * real fs module to write fixtures, so the two cannot share a file.
 *
 * Why vi.mock instead of vi.spyOn: on Node 25 + Vitest 2.1.9, the
 * `node:fs` ESM namespace exports are `configurable: false`. vi.spyOn
 * calls Object.defineProperty under the hood, which throws "Cannot
 * redefine property" on a non-configurable property. vi.mock with the
 * importOriginal factory is hoisted before module evaluation, so the
 * wrapper module it builds is fully configurable.
 *
 * Why mock 'node:fs' (not 'node:fs/promises'): production code imports
 *   `import { promises as fs } from 'node:fs';`
 * so the wrapper must replace the `promises` namespace on the 'node:fs'
 * module. Mocking 'node:fs/promises' instead would not intercept the
 * production call site.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import realFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Counter so the test can confirm the rigged sync fired exactly once
// during the saveModelsJson call.
let mockSyncCallCount = 0;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const wrappedPromises = {
    ...actual.promises,
    open: async (...args: Parameters<typeof actual.promises.open>) => {
      const handle = await actual.promises.open(...args);
      const originalSync = handle.sync.bind(handle);
      // Rig fileFd.sync to reject on first call only. Subsequent opens
      // (the directory fsync inside saveModelsJson) get a real sync.
      handle.sync = async () => {
        if (mockSyncCallCount === 0) {
          mockSyncCallCount += 1;
          throw new Error('mock fsync failure');
        }
        mockSyncCallCount += 1;
        return originalSync();
      };
      return handle;
    },
  };
  return {
    ...actual,
    promises: wrappedPromises,
    default: { ...actual, promises: wrappedPromises },
  };
});

// Import AFTER vi.mock — the import resolves through the mocked module so
// the `promises` object inside model-resolver.ts is the wrapped one.
import { saveModelsJson, type ModelsJson } from '../model-resolver';

// Use real fs for tmpdir setup/teardown via the unmocked default-import path.
// The mock only rewires the `promises.open` function — `mkdtemp`, `rm`,
// `stat` are wrapped but pass through to the real implementations.
const fs = realFs.promises;

let tmpDir: string;

beforeEach(async () => {
  mockSyncCallCount = 0;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lisna-mr-fsync-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('saveModelsJson — fsync failure', () => {
  it('propagates fsync rejection and leaves no models.json (spec §10.1 row 18)', async () => {
    const content: ModelsJson = { version: 1, sttPath: '/a', llmPath: '/b' };
    await expect(saveModelsJson(tmpDir, content)).rejects.toThrow('mock fsync failure');

    // rename never ran → final file absent.
    await expect(fs.stat(path.join(tmpDir, 'models.json'))).rejects.toThrow();

    // Mock fired exactly once — the file fsync, before throwing.
    // Dir fsync was never reached because the function aborted earlier.
    expect(mockSyncCallCount).toBe(1);
  });
});

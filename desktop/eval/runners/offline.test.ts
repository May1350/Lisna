import { it, expect } from 'vitest';
import { makeOfflineRunner } from './offline';

it('derives modelId from the model filename (1B is not mislabelled as 3B)', () => {
  const r1b = makeOfflineRunner({ runnerId: 'offline-1b', sidecarBin: 'x',
    llmModelPath: '/any/dir/Llama-3.2-1B-Instruct-Q4_K_M.gguf' });
  expect(r1b.id).toBe('offline-1b');
  expect(r1b.modelId).toBe('llama-3.2-1b-q4-km');

  const r3b = makeOfflineRunner({ runnerId: 'offline-3b', sidecarBin: 'x',
    llmModelPath: '/any/dir/Llama-3.2-3B-Instruct-Q4_K_M.gguf' });
  expect(r3b.modelId).toBe('llama-3.2-3b-q4-km');
});

it('throws on an unknown model filename (fail fast at factory time)', () => {
  expect(() => makeOfflineRunner({ runnerId: 'offline-3b', sidecarBin: 'x',
    llmModelPath: '/any/dir/not-a-model.gguf' })).toThrow('UNKNOWN_MODEL_PROFILE');
});

it('no longer rejects interview/brainstorm at the family guard', () => {
  // The family guard that used to throw UNSUPPORTED_FAMILY_FOR_OFFLINE_RUNNER for
  // interview/brainstorm is removed (they are now wired). The factory resolves a
  // runner for any profiled model and exposes a four-family run() without throwing
  // synchronously. Real inference is covered by the controller smoke (Task 14).
  const runner = makeOfflineRunner({ runnerId: 'offline-3b', sidecarBin: '/nonexistent',
    llmModelPath: '/x/Llama-3.2-3B-Instruct-Q4_K_M.gguf' });
  expect(runner.modelId).toBe('llama-3.2-3b-q4-km');
  expect(typeof runner.run).toBe('function');
});

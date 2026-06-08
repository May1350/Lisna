import { it, expect } from 'vitest';
import { makeOfflineRunner } from './offline';
import type { FixtureMeta, FixtureTranscript } from '../fixtures/_schema';

const ft = { bucket_seconds: 10, speakers: [{ id: 0 }],
  transcripts: [{ ts: 0, text: 'x', speakerId: 0 }] } as FixtureTranscript;

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

it('throws UNSUPPORTED_FAMILY before spawning for interview/brainstorm', async () => {
  const runner = makeOfflineRunner({ runnerId: 'offline-3b', sidecarBin: '/nonexistent',
    llmModelPath: '/nonexistent/Llama-3.2-3B-Instruct-Q4_K_M.gguf' });
  const meta = { fixtureId: 'i1', family: 'interview', language: 'ja', durationSec: 5,
    bucketSeconds: 10, scenarioTags: [], expectedSlots: [], sourceUrl: null } as FixtureMeta;
  await expect(runner.run({ meta, transcript: ft }))
    .rejects.toThrow('UNSUPPORTED_FAMILY_FOR_OFFLINE_RUNNER:interview');
});

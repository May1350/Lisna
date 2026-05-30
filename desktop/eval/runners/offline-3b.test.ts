import { it, expect } from 'vitest';
import { makeOffline3bRunner } from './offline-3b';
import type { FixtureMeta, FixtureTranscript } from '../fixtures/_schema';

const ft = { bucket_seconds: 10, speakers: [{ id: 0 }],
  transcripts: [{ ts: 0, text: 'x', speakerId: 0 }] } as FixtureTranscript;

it('throws UNSUPPORTED_FAMILY before spawning for interview/brainstorm', async () => {
  const runner = makeOffline3bRunner({ sidecarBin: '/nonexistent', llmModelPath: '/nonexistent' });
  const meta = { fixtureId: 'i1', family: 'interview', language: 'ja', durationSec: 5,
    bucketSeconds: 10, scenarioTags: [], expectedSlots: [], sourceUrl: null } as FixtureMeta;
  await expect(runner.run({ meta, transcript: ft }))
    .rejects.toThrow('UNSUPPORTED_FAMILY_FOR_OFFLINE_RUNNER:interview');
});

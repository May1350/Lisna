import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureMetaSchema, FixtureTranscriptSchema } from '../fixtures/_schema';
import { makeOfflineRunner } from './offline';
import { LECTURE_RULES } from '../contract/families/lecture';
import { runContractTest } from '../contract/contract-test';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const llmModel = process.env.LISNA_TEST_LLM_MODEL ?? '';
const sidecarBin = resolve(__dirname, '../../resources/sidecar');
const fixtureDir = resolve(__dirname, '../fixtures/lecture/smoke-ja-mini');
const gate = llmModel && existsSync(sidecarBin) ? describe : describe.skip;

gate('offline-3b grammar real-run gate (JA lecture)', () => {
  it('produces valid JSON that parses to a schema-valid LectureNote with ≥1 section', async () => {
    const meta = FixtureMetaSchema.parse(JSON.parse(readFileSync(join(fixtureDir, 'meta.json'), 'utf8')));
    const transcript = FixtureTranscriptSchema.parse(JSON.parse(readFileSync(join(fixtureDir, 'transcript.json'), 'utf8')));
    const runner = makeOfflineRunner({ runnerId: 'offline-3b', sidecarBin, llmModelPath: llmModel });
    const { note, retryAttempts } = await runner.run({ meta, transcript });

    const ct = runContractTest({ family: 'lecture', schema: z.object({}).passthrough(),
      note: { ...(note as object), _meta: { expectedSlots: meta.expectedSlots } },
      rules: LECTURE_RULES, transcript });
    expect(ct.schemaParse, JSON.stringify(ct.schemaParseError)).toBe('PASS');
    expect((note as { sections?: unknown[] }).sections?.length ?? 0).toBeGreaterThanOrEqual(1);
    // Retry envelope (Spike 0.1): ≤2 attempts per chunk typical.
    for (const a of retryAttempts) expect(a).toBeLessThanOrEqual(3);
    console.log('[gate] retryAttempts/chunk:', retryAttempts);
  }, 300_000);
});

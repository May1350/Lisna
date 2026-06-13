// desktop/eval/runners/single-fixture.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runSingleFixture } from './single-fixture';
import { STUB_RUNNER } from './pipeline-stub';

function writeFixture(dir: string, meta: object, transcript: object, groundTruth?: object): string {
  const d = join(dir, 'interview', 'tmp-fab');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'meta.json'), JSON.stringify(meta));
  writeFileSync(join(d, 'transcript.json'), JSON.stringify(transcript));
  if (groundTruth) writeFileSync(join(d, 'ground-truth.json'), JSON.stringify(groundTruth));
  return d;
}

describe('runSingleFixture (stub)', () => {
  it('runs the Lecture procedural-physics-em fixture with stub runner, skipping LLM judge', async () => {
    const result = await runSingleFixture({
      fixtureDir: 'eval/fixtures/lecture/procedural-physics-em',
      runner: STUB_RUNNER,
      skipLlmJudge: true,
    });
    expect(result.fixtureId).toBe('procedural-physics-em');
    expect(result.family).toBe('lecture');
    expect(result.contractTest.schemaParse).toBe('PASS');
    expect(result.judge).toBeUndefined();   // skipped
    expect(result.retryHistogram?.samples).toBe(3);
  });

  it('runs the meeting sprint-planning-4spk fixture with stub runner', async () => {
    const result = await runSingleFixture({
      fixtureDir: 'eval/fixtures/meeting/sprint-planning-4spk',
      runner: STUB_RUNNER,
      skipLlmJudge: true,
    });
    expect(result.family).toBe('meeting');
    expect(result.contractTest.overall).toBe('PASS');
  });

  it('runs interview and brainstorm fixtures with stub runner', async () => {
    const r1 = await runSingleFixture({
      fixtureDir: 'eval/fixtures/interview/product-research-2spk',
      runner: STUB_RUNNER, skipLlmJudge: true,
    });
    expect(r1.family).toBe('interview');
    expect(r1.contractTest.overall).toBe('PASS');

    const r2 = await runSingleFixture({
      fixtureDir: 'eval/fixtures/brainstorm/feature-ideation-3spk',
      runner: STUB_RUNNER, skipLlmJudge: true,
    });
    expect(r2.family).toBe('brainstorm');
    expect(r2.contractTest.overall).toBe('PASS');
  });
});

describe('runSingleFixture — Phase 1 faithfulness + coverage (no LLM judge)', () => {
  it('always runs the deterministic pre-pass and reports a gate', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fx-'));
    try {
      const dir = writeFixture(root,
        { fixtureId: 'tmp-fab', family: 'interview', language: 'ja', durationSec: 100, bucketSeconds: 10, scenarioTags: [], expectedSlots: [], sourceUrl: null },
        { bucket_seconds: 10, transcripts: [{ ts: 0, text: '売上は前年比で減少した', speakerId: 0 }] },
        { fixtureId: 'tmp-fab', facts: ['売上は前年比で減少した'], qaPairs: [{ q: '売上の状況', a: '減少', mustAppear: true }] },
      );
      const r = await runSingleFixture({ fixtureDir: dir, runner: STUB_RUNNER, skipLlmJudge: true });
      expect(r.faithfulness).toBeDefined();
      expect(r.faithfulness!.prepass).toBeDefined();
      expect(['PASS', 'FAIL']).toContain(r.faithfulness!.gate);
      expect(r.faithfulness!.judge).toBeUndefined(); // skipLlmJudge → no judge call
      expect(r.coverage).toBeDefined();
      expect(r.coverage!.total).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('gates FAIL when the stub note is an English flip of a JA fixture', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fx-'));
    try {
      const dir = writeFixture(root,
        { fixtureId: 'tmp-fab', family: 'interview', language: 'ja', durationSec: 100, bucketSeconds: 10, scenarioTags: [], expectedSlots: [], sourceUrl: null },
        { bucket_seconds: 10, transcripts: [{ ts: 0, text: '売上は前年比で減少した', speakerId: 0 }] },
        { fixtureId: 'tmp-fab', facts: ['売上は前年比で減少した'] },
      );
      const r = await runSingleFixture({ fixtureDir: dir, runner: STUB_RUNNER, skipLlmJudge: true });
      expect(r.faithfulness!.prepass.languageFlip).toBe(true);
      expect(r.faithfulness!.gate).toBe('FAIL');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// desktop/eval/runners/single-fixture.test.ts
import { describe, it, expect } from 'vitest';
import { runSingleFixture } from './single-fixture';
import { STUB_RUNNER } from './pipeline-stub';

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

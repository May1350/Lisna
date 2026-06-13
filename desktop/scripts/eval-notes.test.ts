import { describe, it, expect } from 'vitest';
import { __testOnly_parseArgs, __testOnly_resolveRunner } from './eval-notes';

describe('eval-notes argparse', () => {
  it('parses defaults', () => {
    const o = __testOnly_parseArgs(['node', 'eval-notes', '--family', 'lecture']);
    expect(o.family).toBe('lecture');
    expect(o.runnerId).toBe('stub');
    expect(o.skipLlmJudge).toBe(false);
  });

  it('parses all flags', () => {
    const o = __testOnly_parseArgs(['node', 'eval-notes',
      '--family', 'meeting',
      '--fixture', 'sprint-planning-4spk',
      '--runner', 'offline-3b',
      '--baseline', 'v1',
      '--against', 'v0',
      '--judge', 'claude-opus-4-x',
      '--no-llm-judge',
      '--dry-run',
    ]);
    expect(o.family).toBe('meeting');
    expect(o.fixtureFilter).toBe('sprint-planning-4spk');
    expect(o.runnerId).toBe('offline-3b');
    expect(o.saveAs).toBe('v1');
    expect(o.against).toBe('v0');
    expect(o.judgeModelId).toBe('claude-opus-4-x');
    expect(o.skipLlmJudge).toBe(true);
    expect(o.dryRun).toBe(true);
  });

  it('parses brainstorm family', () => {
    const o = __testOnly_parseArgs(['node', 'eval-notes', '--family', 'brainstorm']);
    expect(o.family).toBe('brainstorm');
  });
});

describe('eval-notes resolveRunner', () => {
  it('resolves offline-1b to a correctly-labelled runner from the model dir', async () => {
    const r = await __testOnly_resolveRunner('offline-1b', { modelDir: '/models', sidecarBin: '/sc' });
    expect(r.id).toBe('offline-1b');
    expect(r.modelId).toBe('llama-3.2-1b-q4-km');
  });

  it('resolves offline-3b modelId from the 3B profile filename', async () => {
    const r = await __testOnly_resolveRunner('offline-3b', { modelDir: '/models', sidecarBin: '/sc' });
    expect(r.modelId).toBe('llama-3.2-3b-q4-km');
  });

  it('returns the stub runner for the stub id', async () => {
    const r = await __testOnly_resolveRunner('stub', {});
    expect(r.id).toBe('stub');
  });

  it('throws a helpful error when the offline model dir is not configured', async () => {
    const saved = process.env.LISNA_LLM_MODEL_DIR;
    delete process.env.LISNA_LLM_MODEL_DIR;
    try {
      await expect(__testOnly_resolveRunner('offline-3b', {})).rejects.toThrow(/LISNA_LLM_MODEL_DIR/);
    } finally {
      if (saved !== undefined) process.env.LISNA_LLM_MODEL_DIR = saved;
    }
  });
});

import { __testOnly_gateVerdict } from '../eval/scorecard';
import type { FixtureResult } from '../eval/baseline/format';

describe('eval-notes faithfulness exit gate (helper contract)', () => {
  it('a FAIL faithfulness fixture yields a FAIL suite verdict', () => {
    const fail: FixtureResult = {
      fixtureId: 'finance-fabrication-2spk', family: 'interview',
      contractTest: { schemaParse: 'PASS', overall: 'PASS', findings: [] }, runMs: 1,
      faithfulness: { prepass: { jaRatio: 0, languageFlip: true, groundingJa: 0, groundingAscii: 0 }, gate: 'FAIL' },
    };
    expect(__testOnly_gateVerdict([fail])).toBe('FAIL');
  });
});

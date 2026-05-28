import { describe, it, expect } from 'vitest';
import { __testOnly_parseArgs } from './eval-notes';

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

import { describe, it, expect } from 'vitest';
import { validateEvalBaselines } from './_validator';

describe('validateEvalBaselines', () => {
  it('accepts registered IDs that exist', async () => {
    const result = await validateEvalBaselines({
      lecture: ['procedural-physics-em', 'narrative-ukraine-russia', 'formula-latex-roe'],
      meeting: ['sprint-planning-4spk'],
      interview: [], brainstorm: [],
    }, 'eval/fixtures');
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports missing fixture IDs', async () => {
    const result = await validateEvalBaselines({
      lecture: ['procedural-physics-em', 'does-not-exist'],
      meeting: [], interview: [], brainstorm: [],
    }, 'eval/fixtures');
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('does-not-exist');
  });

  it('accepts a registration with empty arrays for all families', async () => {
    const result = await validateEvalBaselines({
      lecture: [], meeting: [], interview: [], brainstorm: [],
    }, 'eval/fixtures');
    expect(result.ok).toBe(true);
  });
});

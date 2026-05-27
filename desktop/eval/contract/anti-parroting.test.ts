// desktop/eval/contract/anti-parroting.test.ts
import { describe, it, expect } from 'vitest';
import { detectParrotedFormulas, parrotingRule } from './anti-parroting';
import type { FixtureTranscript } from '../fixtures/_schema';

const transcript = (lines: string[]): FixtureTranscript => ({
  bucket_seconds: 10,
  speakers: [{ id: 0 }],
  transcripts: lines.map((text, i) => ({ ts: i * 10, text, speakerId: 0 })),
});

describe('detectParrotedFormulas', () => {
  it('returns empty for note with no formula extras', () => {
    const note = { sections: [{ extras: [] }] };
    const out = detectParrotedFormulas(note as any, transcript(['静電ポテンシャル']), undefined);
    expect(out.total).toBe(0);
    expect(out.parroted.length).toBe(0);
  });

  it('flags E=mc² when transcript is about electromagnetics, no GT allowlist', () => {
    const note = {
      sections: [{ extras: [{ type: 'formula', items: [{ expression: 'E = mc^2', label: 'mass-energy' }] }] }],
    };
    const out = detectParrotedFormulas(note as any, transcript(['静電ポテンシャル', '電位']), undefined);
    expect(out.total).toBe(1);
    expect(out.parroted.length).toBe(1);
    expect(out.parroted[0].expression).toBe('E = mc^2');
  });

  it('accepts a formula that is literally present in the transcript', () => {
    const note = {
      sections: [{ extras: [{ type: 'formula', items: [{ expression: 'F = qE', label: 'Lorentz' }] }] }],
    };
    const out = detectParrotedFormulas(note as any, transcript(['F = qE は重要']), undefined);
    expect(out.parroted.length).toBe(0);
  });

  it('accepts a formula via ground-truth allowlist even if not in transcript', () => {
    const note = {
      sections: [{ extras: [{ type: 'formula', items: [{ expression: 'V = -∫E·dr', label: 'potential' }] }] }],
    };
    const out = detectParrotedFormulas(note as any, transcript(['静電ポテンシャル']), { fixtureId: 'x', expectedFormulas: ['V = -∫E·dr'] });
    expect(out.parroted.length).toBe(0);
  });

  it('parrotingRule warns when >30% parroted', () => {
    const noteHalfParroted = {
      sections: [{ extras: [{ type: 'formula', items: [
        { expression: 'E = mc^2', label: 'parroted' },
        { expression: 'F = qE', label: 'in transcript' },
        { expression: 'a = b', label: 'parroted' },
      ] }] }],
    };
    const res = parrotingRule.run({ family: 'lecture', note: noteHalfParroted as any, transcript: transcript(['F = qE は']) } as any);
    expect(res.pass).toBe(false);  // 2/3 = 66% parroted → warning fires
  });
});

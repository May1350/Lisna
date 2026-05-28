import { describe, it, expect } from 'vitest';
import { computeSlotDistribution } from './slot-distribution';

describe('computeSlotDistribution', () => {
  it('returns zeros for note with no extras', () => {
    const d = computeSlotDistribution({ sections: [] });
    expect(d.slotTypes).toBe(0);
    expect(d.slotsEmerged).toBe(0);
    expect(d.byType).toEqual({});
  });

  it('counts distinct slot types and occurrences separately', () => {
    const note = {
      sections: [
        { extras: [{ type: 'formula', items: [] }, { type: 'formula', items: [] }] },
        { extras: [{ type: 'procedure_steps', items: [] }] },
        { extras: [{ type: 'formula', items: [] }] },
      ],
    };
    const d = computeSlotDistribution(note);
    expect(d.slotTypes).toBe(2);
    expect(d.slotsEmerged).toBe(4);
    expect(d.byType).toEqual({ formula: 3, procedure_steps: 1 });
  });

  it('handles missing sections gracefully', () => {
    const d = computeSlotDistribution({});
    expect(d.slotTypes).toBe(0);
    expect(d.slotsEmerged).toBe(0);
  });

  it('skips extras without a string type', () => {
    const note = {
      sections: [{ extras: [{ type: 'formula' }, { type: null }, { type: 42 }, {}] }],
    };
    const d = computeSlotDistribution(note);
    expect(d.slotTypes).toBe(1);
    expect(d.slotsEmerged).toBe(1);
    expect(d.byType).toEqual({ formula: 1 });
  });
});

export interface SlotDistribution {
  slotTypes: number;        // distinct extra.type values
  slotsEmerged: number;     // total extras occurrences
  byType: Record<string, number>;
}

export function computeSlotDistribution(note: any): SlotDistribution {
  const sections: any[] = note?.sections ?? [];
  const byType: Record<string, number> = {};
  let slotsEmerged = 0;
  for (const s of sections) {
    for (const e of s.extras ?? []) {
      const t = e?.type;
      if (typeof t !== 'string') continue;
      byType[t] = (byType[t] ?? 0) + 1;
      slotsEmerged += 1;
    }
  }
  return {
    slotTypes: Object.keys(byType).length,
    slotsEmerged,
    byType,
  };
}

// desktop/eval/contract/families/lecture.ts
import type { ContractRule } from '../contract-test';

// Per spec §3.3 + §7.2 + P7. Encodes the v1-plateau insight:
// mode-collapse looks like a "valid but bland" note where each section
// has ≤1 key_term, all key_terms are 'inferred', no formula slot fires.

const sectionsMin3: ContractRule = {
  id: 'lecture-sections-min-3',
  severity: 'error',
  description: 'A Lecture should have ≥3 sections to be a useful note.',
  run: ({ note }) => {
    const n = Array.isArray(note.sections) ? note.sections.length : 0;
    return { pass: n >= 3, message: `sections.length=${n}, want ≥3`, detail: { n } };
  },
};

const sectionsHaveKeyTerms: ContractRule = {
  id: 'lecture-sections-have-key-terms',
  severity: 'error',
  description: 'Every section must produce ≥1 key_term.',
  run: ({ note }) => {
    const sections: any[] = note.sections ?? [];
    const empty = sections.filter(s => !Array.isArray(s.key_terms) || s.key_terms.length === 0);
    return {
      pass: empty.length === 0,
      message: `${empty.length} section(s) have no key_terms (headings: ${empty.map((s: any) => s.heading).join(', ')})`,
      detail: { emptySectionHeadings: empty.map((s: any) => s.heading) },
    };
  },
};

const fromTranscriptRatio: ContractRule = {
  id: 'lecture-from-transcript-ratio',
  severity: 'warning',
  description: '≥80% of key_terms should be from:transcript (rest from:inferred). Below = mode collapse.',
  run: ({ note }) => {
    const sections: any[] = note.sections ?? [];
    const allKeyTerms = sections.flatMap((s: any) => s.key_terms ?? []);
    if (allKeyTerms.length === 0) {
      return { pass: false, message: 'no key_terms in any section' };
    }
    const fromTranscript = allKeyTerms.filter((kt: any) => kt.from === 'transcript').length;
    const ratio = fromTranscript / allKeyTerms.length;
    return {
      pass: ratio >= 0.8,
      message: `from:transcript ratio = ${(ratio * 100).toFixed(1)}% (want ≥80%)`,
      detail: { ratio, fromTranscript, total: allKeyTerms.length },
    };
  },
};

const slotsEmergeWhenExpected: ContractRule = {
  id: 'lecture-slots-emerge-when-expected',
  severity: 'warning',
  description: 'When meta.expectedSlots is non-empty, at least one expected slot must appear in extras.',
  run: ({ note }) => {
    // We piggy-back on meta via Task 18's runner — at rule run-time we
    // see `note._meta.expectedSlots` injected by the runner before parsing.
    const expected: string[] = (note._meta?.expectedSlots as string[]) ?? [];
    if (expected.length === 0) return { pass: true, message: 'no expectedSlots — rule N/A' };
    const sections: any[] = note.sections ?? [];
    const emerged = new Set<string>();
    for (const s of sections) {
      for (const e of s.extras ?? []) {
        if (typeof e?.type === 'string') emerged.add(e.type);
      }
    }
    const hit = expected.some(t => emerged.has(t));
    return {
      pass: hit,
      message: hit
        ? `slot(s) emerged: ${[...emerged].join(', ')}`
        : `expected one of [${expected.join(', ')}] but extras emitted [${[...emerged].join(', ') || 'none'}]`,
      detail: { expected, emerged: [...emerged] },
    };
  },
};

export const LECTURE_RULES: ContractRule[] = [
  sectionsMin3,
  sectionsHaveKeyTerms,
  fromTranscriptRatio,
  slotsEmergeWhenExpected,
];

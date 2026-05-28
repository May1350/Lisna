// desktop/eval/contract/families/interview.ts
import type { ContractRule } from '../contract-test';

const requiresQaPairs: ContractRule = {
  id: 'interview-qa-pairs-min-3',
  severity: 'error',
  description: 'An Interview note with <3 qa_pairs failed to extract the conversational structure.',
  run: ({ note }) => {
    const n = Array.isArray(note.qa_pairs) ? note.qa_pairs.length : 0;
    return { pass: n >= 3, message: `qa_pairs=${n}, want ≥3`, detail: { n } };
  },
};

const qaSpeakerParity: ContractRule = {
  id: 'interview-qa-speaker-parity',
  severity: 'error',
  description: 'Every qa_pair must reference distinct asked_by and answered_by speakers.',
  run: ({ note }) => {
    const pairs: any[] = note.qa_pairs ?? [];
    const bad = pairs.filter(p => p.asked_by === p.answered_by);
    return {
      pass: bad.length === 0,
      message: bad.length === 0 ? 'all pairs have distinct speakers' : `${bad.length} pair(s) self-questioning`,
      detail: { selfQuestioningPairs: bad.length },
    };
  },
};

const themesNonEmpty: ContractRule = {
  id: 'interview-themes-non-empty',
  severity: 'warning',
  description: 'Interview themes should be extracted (≥1).',
  run: ({ note }) => ({
    pass: Array.isArray(note.themes) && note.themes.length >= 1,
    message: `themes.length=${(note.themes ?? []).length}, want ≥1`,
  }),
};

const groundTruthQaCoverage: ContractRule = {
  id: 'interview-ground-truth-qa-coverage',
  severity: 'warning',
  description: '≥60% of ground-truth qaPairs questions appear in the note (substring).',
  run: ({ note, groundTruth }) => {
    if (!groundTruth?.qaPairs) return { pass: true, message: 'no ground-truth qaPairs, rule N/A' };
    const required = groundTruth.qaPairs;
    const noteQs: string[] = (note.qa_pairs ?? []).map((p: any) => String(p.question ?? ''));
    const matched = required.filter(req => noteQs.some(q => normContains(q, req.q)));
    const ratio = matched.length / required.length;
    return {
      pass: ratio >= 0.6,
      message: `${matched.length}/${required.length} ground-truth Qs covered (${(ratio * 100).toFixed(0)}%)`,
      detail: { ratio },
    };
  },
};

function normContains(h: string, n: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  return norm(h).includes(norm(n));
}

export const INTERVIEW_RULES: ContractRule[] = [
  requiresQaPairs,
  qaSpeakerParity,
  themesNonEmpty,
  groundTruthQaCoverage,
];

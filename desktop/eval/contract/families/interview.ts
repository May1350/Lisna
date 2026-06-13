// desktop/eval/contract/families/interview.ts
import type { ContractRule } from '../contract-test';
import { computeCoverage } from '../../coverage';

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
  description: '≥60% of mustAppear ground-truth qaPairs questions appear in the note (substring).',
  run: ({ note, groundTruth }) => {
    if (!groundTruth?.qaPairs) return { pass: true, message: 'no ground-truth qaPairs, rule N/A' };
    const cov = computeCoverage('interview', note, groundTruth);
    if (cov.total === 0) return { pass: true, message: 'no mustAppear qaPairs, rule N/A' };
    return {
      pass: cov.ratio >= 0.6,
      message: `${cov.captured}/${cov.total} ground-truth Qs covered (${(cov.ratio * 100).toFixed(0)}%)`,
      detail: { ratio: cov.ratio, missing: cov.missing },
    };
  },
};

export const INTERVIEW_RULES: ContractRule[] = [
  requiresQaPairs,
  qaSpeakerParity,
  themesNonEmpty,
  groundTruthQaCoverage,
];

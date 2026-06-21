// desktop/eval/contract/families/meeting.ts
import type { ContractRule } from '../contract-test';
import { meetingDecisionCaptured } from '../../anchor-match';

const requiresDecisionOrAction: ContractRule = {
  id: 'meeting-must-have-decision-or-action',
  severity: 'error',
  description: 'A Meeting note that contains neither a decision nor an action_item failed to extract anything useful.',
  run: ({ note }) => {
    const decisions = Array.isArray(note.decisions) ? note.decisions.length : 0;
    const actions = Array.isArray(note.next_steps) ? note.next_steps.length : 0;
    return {
      pass: decisions + actions > 0,
      message: `decisions=${decisions}, next_steps=${actions} — at least one required`,
      detail: { decisions, actions },
    };
  },
};

const requiresExecutiveSummary: ContractRule = {
  id: 'meeting-executive-summary-non-empty',
  severity: 'error',
  run: ({ note }) => {
    const s = typeof note.executive_summary === 'string' ? note.executive_summary.trim() : '';
    return { pass: s.length >= 20, message: `executive_summary length=${s.length}, want ≥20 chars` };
  },
};

const topicArcCoverage: ContractRule = {
  id: 'meeting-topic-arc-covers-decisions',
  severity: 'warning',
  description: 'topic_arc should reflect the discussions that produced decisions.',
  run: ({ note }) => {
    const arc: any[] = note.topic_arc ?? [];
    const decisions: any[] = note.decisions ?? [];
    if (decisions.length === 0) return { pass: true, message: 'no decisions, rule N/A' };
    if (arc.length === 0) {
      return { pass: false, message: 'topic_arc empty despite decisions present' };
    }
    return { pass: arc.length >= Math.min(decisions.length, 2), message: `arc=${arc.length}, decisions=${decisions.length}` };
  },
};

const groundTruthDecisionsMustAppear: ContractRule = {
  id: 'meeting-ground-truth-decisions-coverage',
  severity: 'warning',
  description: 'Each ground-truth decision marked mustAppear=true must appear in the note (substring match).',
  run: ({ note, groundTruth }) => {
    if (!groundTruth?.decisions) return { pass: true, message: 'no ground-truth decisions, rule N/A' };
    const required = groundTruth.decisions.filter(d => d.mustAppear);
    if (required.length === 0) return { pass: true, message: 'no mustAppear decisions, rule N/A' };
    const missing = required.filter(req => !meetingDecisionCaptured(req.text, note));
    return {
      pass: missing.length === 0,
      message: missing.length === 0
        ? `all ${required.length} required decision(s) appear`
        : `missing ${missing.length}/${required.length}: ${missing.map(m => m.text).join('; ')}`,
      detail: { required: required.length, missing: missing.map(m => m.text) },
    };
  },
};

export const MEETING_RULES: ContractRule[] = [
  requiresDecisionOrAction,
  requiresExecutiveSummary,
  topicArcCoverage,
  groundTruthDecisionsMustAppear,
];

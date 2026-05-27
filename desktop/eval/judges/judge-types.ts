import type { FixtureTranscript, FixtureGroundTruth } from '../fixtures/_schema';

export type NoteFamily = 'lecture' | 'meeting' | 'interview' | 'brainstorm';

// Axes common to every family (mirrors v1 backend judge for direct comparability)
export interface CommonAxisScores {
  coverage: number;        // 0-10
  accuracy: number;        // 0-10
  hierarchy: number;       // 0-10
  conciseness: number;     // 0-10
  importance: number;      // 0-10
  provenance: number;      // 0-10 — standalone (NOT in overall weight)
}

// Per-family axes layered ON TOP of common axes:
export interface LectureAxes {
  sectionCoherence: number;     // 0-10
  contentFidelity: number;      // 0-10 — anti-parroting
}
export interface MeetingAxes {
  decisionCapture: number;      // 0-10
  actionItemClarity: number;    // 0-10
  participantAttribution: number; // 0-10
}
export interface InterviewAxes {
  qaParity: number;             // 0-10 — Q/A correspondence
  themeExtraction: number;      // 0-10
  quotableSelection: number;    // 0-10
}
export interface BrainstormAxes {
  clusterCoherence: number;     // 0-10
  ideaDiversity: number;        // 0-10
  argumentChainDepth: number;   // 0-10 (cross-idea reasoning)
}

export type FamilyAxes<F extends NoteFamily> =
  F extends 'lecture' ? LectureAxes :
  F extends 'meeting' ? MeetingAxes :
  F extends 'interview' ? InterviewAxes :
  F extends 'brainstorm' ? BrainstormAxes :
  never;

export type JudgeAxisScores<F extends NoteFamily> = CommonAxisScores & FamilyAxes<F>;

export interface JudgeResult<F extends NoteFamily = NoteFamily> {
  family: F;
  judgeModelId: string;
  axes: JudgeAxisScores<F>;
  overall: number;                // weighted average, judge-computed
  issues: string[];               // anchor-specific, e.g. "transcript 03:20 X missing"
  wins: string[];
}

export interface JudgeRequest<F extends NoteFamily = NoteFamily> {
  family: F;
  note: any;                      // validated note (post-Zod)
  transcript: FixtureTranscript;
  groundTruth?: FixtureGroundTruth;
  previousNote?: any;             // optional, mirrors v1 stability check
  judgeModelId?: string;          // override default per request (judge-swap matrix)
}

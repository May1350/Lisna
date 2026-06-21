/**
 * Topic-boundary synthesis for MeetingNote assembly.
 * Task 3: detectTopicBoundaries, assignToTopics, synthesizeTopicArcAndDiscussions
 */
import type { SessionTranscript } from '@shared/note-schema';
import type { ExtractedAtoms } from './extract-schema';
import { MEETING_ARRAY_CAPS } from './schema';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function uniq<T>(arr: T[]): T[] { return [...new Set(arr)]; }

export function deterministicSummary(
  label: string,
  decisions: Array<{ text: string }>,
  questions: Array<{ text: string }>,
  actions: Array<{ text: string }>,
): string {
  return `「${label}」について、決定${decisions.length}件・論点${questions.length}件・宿題${actions.length}件。`;
}

// ---------------------------------------------------------------------------
// detectTopicBoundaries
// ---------------------------------------------------------------------------

export const CUE_RE = /(?:次は|次に|続いて|それでは次|次の議題|最後に|まず|一つ目|二つ目|三つ目|では、)/;

/** Scan segments for transition cues; fall back to even ts-buckets. Always ≥1, caps at 7. */
export function detectTopicBoundaries(
  transcript: SessionTranscript,
  opts?: { target?: number },
): Array<{ ts: number; label: string }> {
  const target = opts?.target ?? 6;
  const segs = [...transcript.transcriptSegments].sort((a, b) => a.ts - b.ts);
  if (segs.length === 0) return [{ ts: 0, label: '議題1' }];
  const cued: Array<{ ts: number; label: string }> = [];
  for (const s of segs) {
    const m = s.text.match(CUE_RE);
    if (m) {
      const after = s.text.slice((m.index ?? 0) + m[0].length).replace(/^[、，\s]+/, '').slice(0, 24);
      cued.push({ ts: s.ts, label: after.length > 0 ? after : s.text.slice(0, 24) });
    }
  }
  let boundaries = cued;
  if (boundaries.length < 2) {
    const t0 = segs[0]!.ts;
    const t1 = segs[segs.length - 1]!.endTs;
    const span = Math.max(1, t1 - t0);
    boundaries = Array.from({ length: target }, (_, i) => ({
      ts: t0 + Math.floor((span * i) / target),
      label: `議題${i + 1}`,
    }));
  }
  const seen = new Set<number>();
  const out: Array<{ ts: number; label: string }> = [];
  for (const b of boundaries.sort((a, c) => a.ts - c.ts)) {
    if (seen.has(b.ts)) continue;
    seen.add(b.ts);
    out.push(b);
    if (out.length >= 7) break;
  }
  return out.length > 0 ? out : [{ ts: 0, label: '議題1' }];
}

// ---------------------------------------------------------------------------
// assignToTopics
// ---------------------------------------------------------------------------

/** Bucket atoms into the boundary whose [ts_i, ts_{i+1}) contains atom.ts. Falls back to fallbackTs when ts is 0. */
export function assignToTopics<T extends { ts?: number }>(
  atoms: ReadonlyArray<{ atom: T; fallbackTs: number }>,
  boundaries: Array<{ ts: number; label: string }>,
): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (let i = 0; i < boundaries.length; i++) m.set(i, []);
  for (const { atom, fallbackTs } of atoms) {
    const t = atom.ts && atom.ts > 0 ? atom.ts : fallbackTs;
    let idx = 0;
    for (let i = 0; i < boundaries.length; i++) {
      const lo = boundaries[i]!.ts;
      const hi = i + 1 < boundaries.length ? boundaries[i + 1]!.ts : Number.POSITIVE_INFINITY;
      if (t >= lo && t < hi) { idx = i; break; }
      if (t >= lo) idx = i;
    }
    m.get(idx)!.push(atom);
  }
  return m;
}

// ---------------------------------------------------------------------------
// synthesizeTopicArcAndDiscussions
// ---------------------------------------------------------------------------

type DA = { text: string; ts?: number; made_by?: number };
type QA = { text: string; ts?: number; asked_by?: number };
type RA = { text: string; ts?: number; raised_by?: number };
type AA = { text: string; ts?: number; owner?: number; due?: string };
type FA = { label: string; value: string; ts?: number };

export interface TopicSynthInput {
  transcript: SessionTranscript;
  chunkExtracts: ReadonlyArray<{ atoms: ExtractedAtoms; tsRange: [number, number] }>;
  decisions: DA[]; nextStepsRaw: AA[]; openQuestions: QA[]; risks: RA[]; keyFigures: FA[];
  actionsPerChunk: AA[][];
}
export interface TopicSynthOutput {
  topic_arc: Array<{ topic: string; ts: number; speakers_involved: number[] }>;
  discussions: Array<{ topic: string; ts_start: number; ts_end?: number; summary: string; key_points?: string[] }>;
}

/** Build topic_arc + discussions from deduped atoms and transcript. */
export function synthesizeTopicArcAndDiscussions(input: TopicSynthInput): TopicSynthOutput {
  const { transcript, chunkExtracts, decisions, nextStepsRaw, openQuestions, risks, keyFigures, actionsPerChunk } = input;
  const boundaries = detectTopicBoundaries(transcript);

  // Fallback-ts maps: midpoint of the source chunk for each atom.
  const figureMid = new Map<FA, number>();
  const contentMid = new Map<object, number>();
  chunkExtracts.forEach((c, ci) => {
    const mid = (c.tsRange[0] + c.tsRange[1]) / 2;
    for (const f of c.atoms.key_figures) if (!figureMid.has(f)) figureMid.set(f, mid);
    for (const a of c.atoms.decisions) if (!contentMid.has(a)) contentMid.set(a, mid);
    for (const a of c.atoms.open_questions) if (!contentMid.has(a)) contentMid.set(a, mid);
    for (const a of c.atoms.risks) if (!contentMid.has(a)) contentMid.set(a, mid);
    for (const a of actionsPerChunk[ci]!) if (!contentMid.has(a)) contentMid.set(a, mid);
  });
  const fb = (a: object, byval?: FA): number => byval ? figureMid.get(byval) ?? 0 : contentMid.get(a) ?? 0;

  // Bucket all atom kinds.
  const decIdx = assignToTopics(decisions.map((a) => ({ atom: a, fallbackTs: fb(a) })), boundaries);
  const figIdx = assignToTopics(keyFigures.map((f) => ({ atom: f, fallbackTs: fb(f, f) })), boundaries);
  const qIdx   = assignToTopics(openQuestions.map((a) => ({ atom: a, fallbackTs: fb(a) })), boundaries);
  const rIdx   = assignToTopics(risks.map((a) => ({ atom: a, fallbackTs: fb(a) })), boundaries);
  const actIdx = assignToTopics(nextStepsRaw.map((a) => ({ atom: a, fallbackTs: fb(a) })), boundaries);

  type Bucket = { decisions: DA[]; figures: FA[]; questions: QA[]; risks: RA[]; actions: AA[]; speakerRefs: number[] };
  const buckets = new Map<number, Bucket>();
  for (let i = 0; i < boundaries.length; i++) {
    buckets.set(i, { decisions: [], figures: [], questions: [], risks: [], actions: [], speakerRefs: [] });
  }
  for (const [idx, items] of decIdx) { const b = buckets.get(idx)!; for (const a of items) { b.decisions.push(a); if (a.made_by !== undefined) b.speakerRefs.push(a.made_by); } }
  for (const [idx, items] of figIdx) { const b = buckets.get(idx)!; for (const f of items) b.figures.push(f); }
  for (const [idx, items] of qIdx)   { const b = buckets.get(idx)!; for (const a of items) { b.questions.push(a); if (a.asked_by !== undefined) b.speakerRefs.push(a.asked_by); } }
  for (const [idx, items] of rIdx)   { const b = buckets.get(idx)!; for (const a of items) { b.risks.push(a); if (a.raised_by !== undefined) b.speakerRefs.push(a.raised_by); } }
  for (const [idx, items] of actIdx) { const b = buckets.get(idx)!; for (const a of items) { b.actions.push({ text: a.text, ts: a.ts, owner: a.owner, due: a.due }); if (a.owner !== undefined) b.speakerRefs.push(a.owner); } }

  const topic_arc: Array<{ topic: string; ts: number; speakers_involved: number[] }> = [];
  const discussions: Array<{ topic: string; ts_start: number; ts_end?: number; summary: string; key_points?: string[] }> = [];

  for (let i = 0; i < boundaries.length; i++) {
    const b = buckets.get(i)!;
    if (b.decisions.length + b.figures.length + b.questions.length + b.risks.length + b.actions.length === 0) continue;
    const label = boundaries[i]!.label;
    const ts = boundaries[i]!.ts;
    const tsEnd = i + 1 < boundaries.length ? boundaries[i + 1]!.ts : undefined;
    // Cap to MeetingNoteSchema's `.max(MAX_PARTICIPANTS)` so a topic that gathers
    // >12 distinct speaker refs can't throw `too_big` at schema.parse. Unreachable
    // while diarization is forced off (refs collapse to [0]) but pre-empts the
    // crash when Plan 4 enables real speaker attribution.
    const speakers = uniq(b.speakerRefs).slice(0, MEETING_ARRAY_CAPS.participants);
    topic_arc.push({ topic: label, ts, speakers_involved: speakers.length > 0 ? speakers : [0] });
    const keyPoints = [...b.decisions.map((d) => d.text), ...b.figures.map((f) => `${f.label}: ${f.value}`)];
    discussions.push({
      topic: label, ts_start: ts,
      ...(tsEnd !== undefined ? { ts_end: tsEnd } : {}),
      summary: deterministicSummary(label, b.decisions, b.questions, b.actions),
      ...(keyPoints.length > 0 ? { key_points: keyPoints.slice(0, 12) } : {}),
    });
  }

  if (topic_arc.length === 0) {
    const label = boundaries[0]?.label ?? '会議メモ';
    const ts = boundaries[0]?.ts ?? 0;
    topic_arc.push({ topic: label, ts, speakers_involved: [0] });
    discussions.push({ topic: label, ts_start: ts, summary: deterministicSummary(label, [], [], []) });
  }

  return { topic_arc, discussions };
}

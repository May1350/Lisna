import { describe, it, expect } from 'vitest';
import {
  consolidateMeetingNote,
  consolidateInterviewNote,
  consolidateBrainstormNote,
} from '../consolidate-conversation';
import { type MeetingNote, MEETING_ARRAY_CAPS } from '../../families/meeting/schema';
import { type InterviewNote, INTERVIEW_ARRAY_CAPS } from '../../families/interview/schema';
import { type BrainstormNote, BRAINSTORM_ARRAY_CAPS } from '../../families/brainstorm/schema';

// Distinct, low-trigram-overlap strings so the dedup pass does NOT fire and the
// cap-SLICE is what's exercised (a `${i}` suffix alone would near-dup on the
// shared prefix — see cap-fit.test.ts).
const NATO = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
  'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa',
  'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'xray',
  'yankee', 'zulu', 'mango', 'pixel', 'quartz', 'walnut',
];
// Distinct WORD-PAIRs (first = i/30, second = i%30) → 900 unique low-overlap
// strings. A `${i}` trailing number would NOT make `topic ${i}` trigram-distinct.
const distinct = (i: number): string =>
  `${NATO[Math.floor(i / NATO.length) % NATO.length]} ${NATO[i % NATO.length]}`;
const many = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));

describe('consolidateMeetingNote', () => {
  it('fits every over-cap top-level array to its schema bound (required + optional)', () => {
    const note = {
      topic_arc: many(40, (i) => ({ topic: distinct(i) })),
      discussions: many(40, (i) => ({ topic: distinct(i) })),
      decisions: many(40, (i) => ({ text: distinct(i) })),
      open_questions: many(40, (i) => ({ text: distinct(i) })),
      agenda: many(40, (i) => distinct(i)),
      participants: many(20, (i) => ({ speakerRef: i })),
      proposals: many(40, (i) => ({ text: distinct(i) })),
      risks_or_concerns: many(40, (i) => ({ text: distinct(i) })),
    } as unknown as MeetingNote;
    const { note: out, stats } = consolidateMeetingNote(note);
    expect(out.topic_arc.length).toBe(MEETING_ARRAY_CAPS.topic_arc);
    expect(out.discussions.length).toBe(MEETING_ARRAY_CAPS.discussions);
    expect(out.decisions.length).toBe(MEETING_ARRAY_CAPS.decisions);
    expect(out.open_questions.length).toBe(MEETING_ARRAY_CAPS.open_questions);
    expect(out.agenda!.length).toBe(MEETING_ARRAY_CAPS.agenda);
    expect(out.participants!.length).toBe(MEETING_ARRAY_CAPS.participants);
    expect(out.proposals!.length).toBe(MEETING_ARRAY_CAPS.proposals);
    expect(out.risks_or_concerns!.length).toBe(MEETING_ARRAY_CAPS.risks_or_concerns);
    expect(stats.truncated).toBeGreaterThan(0);
  });

  it('preserves absent optional arrays as undefined (no [] coercion)', () => {
    const note = {
      topic_arc: many(2, (i) => ({ topic: distinct(i) })),
      discussions: many(2, (i) => ({ topic: distinct(i) })),
      decisions: many(2, (i) => ({ text: distinct(i) })),
      open_questions: many(2, (i) => ({ text: distinct(i) })),
    } as unknown as MeetingNote;
    const { note: out } = consolidateMeetingNote(note);
    expect(out.agenda).toBeUndefined();
    expect(out.participants).toBeUndefined();
    expect(out.proposals).toBeUndefined();
    expect(out.risks_or_concerns).toBeUndefined();
    expect(out.topic_arc.length).toBe(2); // under cap → untouched
  });
});

describe('consolidateInterviewNote', () => {
  it('fits qa_pairs and the other arrays to their caps', () => {
    const note = {
      qa_pairs: many(100, (i) => ({ question: distinct(i) })),
      themes: many(20, (i) => ({ name: distinct(i) })),
      quotable_lines: many(30, (i) => ({ text: distinct(i) })),
      key_takeaways: many(25, (i) => ({ text: distinct(i) })),
    } as unknown as InterviewNote;
    const { note: out } = consolidateInterviewNote(note);
    expect(out.qa_pairs.length).toBe(INTERVIEW_ARRAY_CAPS.qa_pairs); // 80
    expect(out.themes.length).toBe(INTERVIEW_ARRAY_CAPS.themes);
    expect(out.quotable_lines.length).toBe(INTERVIEW_ARRAY_CAPS.quotable_lines);
    expect(out.key_takeaways.length).toBe(INTERVIEW_ARRAY_CAPS.key_takeaways);
    expect(out.participants).toBeUndefined();
  });
});

describe('consolidateBrainstormNote', () => {
  it('fits idea_clusters, each cluster ideas, and parking_lot to caps', () => {
    const note = {
      idea_clusters: many(20, (i) => ({
        theme: distinct(i),
        ideas: many(40, (j) => ({ text: distinct(j) })),
      })),
      parking_lot: many(30, (i) => ({ text: distinct(i) })),
    } as unknown as BrainstormNote;
    const { note: out } = consolidateBrainstormNote(note);
    expect(out.idea_clusters.length).toBe(BRAINSTORM_ARRAY_CAPS.idea_clusters); // 15
    for (const cl of out.idea_clusters) {
      expect(cl.ideas.length).toBeLessThanOrEqual(BRAINSTORM_ARRAY_CAPS.ideas_per_cluster); // 30
    }
    expect(out.parking_lot!.length).toBe(BRAINSTORM_ARRAY_CAPS.parking_lot); // 20
  });
});

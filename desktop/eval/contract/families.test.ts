// desktop/eval/contract/families.test.ts
import { describe, it, expect } from 'vitest';
import { LECTURE_RULES } from './families/lecture';
import { MEETING_RULES } from './families/meeting';
import { INTERVIEW_RULES } from './families/interview';
import { BRAINSTORM_RULES } from './families/brainstorm';
import type { RuleInput } from './contract-test';

const lectureNoteValid = {
  schemaVersion: 1, family: 'lecture', title: 'Test', generatedAt: '2026-05-27T00:00:00Z',
  generatedBy: { model: 'm', promptVersion: 1 }, language: 'ja', durationSec: 660,
  sections: [
    {
      heading: 'Intro', ts: 0, summary: 'Intro section',
      key_terms: [
        { term: 'A', definition: 'a', ts: 0, from: 'transcript' },
        { term: 'B', definition: 'b', ts: 30, from: 'transcript' },
      ],
      examples: [], points: [],
    },
    { heading: 'Mid', ts: 100, summary: 'm', key_terms: [
        { term: 'C', definition: 'c', ts: 100, from: 'transcript' },
        { term: 'E', definition: 'e', ts: 150, from: 'transcript' },
      ], examples: [], points: [] },
    { heading: 'End', ts: 500, summary: 'e', key_terms: [{ term: 'D', definition: 'd', ts: 500, from: 'inferred' }], examples: [], points: [] },
  ],
};

const baseInput = (note: any): RuleInput => ({
  family: 'lecture',
  note,
  transcript: { transcripts: [{ ts: 0, text: 'x', speakerId: 0 }], bucket_seconds: 10, speakers: [{ id: 0 }] } as any,
});

describe('LECTURE_RULES', () => {
  it('passes a structurally valid LectureNote', () => {
    for (const rule of LECTURE_RULES) {
      const r = rule.run(baseInput(lectureNoteValid));
      expect.soft(r.pass, `rule ${rule.id} failed: ${r.message}`).toBe(true);
    }
  });

  it('fails sections-min-3 on 2-section note', () => {
    const note = { ...lectureNoteValid, sections: lectureNoteValid.sections.slice(0, 2) };
    const r = LECTURE_RULES.find(x => x.id === 'lecture-sections-min-3')!.run(baseInput(note));
    expect(r.pass).toBe(false);
  });

  it('fails sections-have-key-terms when a section is empty', () => {
    const note = {
      ...lectureNoteValid,
      sections: [
        { ...lectureNoteValid.sections[0], key_terms: [] },
        ...lectureNoteValid.sections.slice(1),
      ],
    };
    const r = LECTURE_RULES.find(x => x.id === 'lecture-sections-have-key-terms')!.run(baseInput(note));
    expect(r.pass).toBe(false);
  });

  it('warns when from-transcript ratio < 0.8', () => {
    const note = {
      ...lectureNoteValid,
      sections: [
        {
          heading: 'S1', ts: 0, summary: 'x',
          key_terms: Array.from({ length: 10 }, (_, i) => ({
            term: `T${i}`, definition: 'd', ts: i * 10,
            from: i < 5 ? 'transcript' : 'inferred',
          })),
          examples: [], points: [],
        },
        ...lectureNoteValid.sections.slice(1),
      ],
    };
    const r = LECTURE_RULES.find(x => x.id === 'lecture-from-transcript-ratio')!.run(baseInput(note));
    expect(r.pass).toBe(false);
  });

  it('warns on stripped-LaTeX residue (sanitizer false-positive fingerprint, 2026-06-11)', () => {
    // What the founder saw when sanitizeEscapeLiteralsInStrings nuked the
    // backslashes off legit LaTeX: `frac{text{…}}` with no backslash.
    const note = {
      ...lectureNoteValid,
      sections: [
        {
          ...lectureNoteValid.sections[0],
          extras: [{
            type: 'formula', ts: 0, from: 'transcript',
            expression: 'ROE = frac{text{利益}}{text{資本}}',
          }],
        },
        ...lectureNoteValid.sections.slice(1),
      ],
    };
    const rule = LECTURE_RULES.find(x => x.id === 'lecture-no-stripped-latex-residue');
    expect(rule).toBeDefined();
    const r = rule!.run(baseInput(note));
    expect(r.pass).toBe(false);
    expect(r.message).toContain('expression');
  });

  it('does NOT flag intact LaTeX or plain prose', () => {
    const note = {
      ...lectureNoteValid,
      sections: [
        {
          ...lectureNoteValid.sections[0],
          extras: [{
            type: 'formula', ts: 0, from: 'transcript',
            expression: 'ROE = \\frac{\\text{利益}}{\\text{資本}}',
          }],
        },
        ...lectureNoteValid.sections.slice(1),
      ],
    };
    const rule = LECTURE_RULES.find(x => x.id === 'lecture-no-stripped-latex-residue');
    expect(rule).toBeDefined();
    const r = rule!.run(baseInput(note));
    expect(r.pass).toBe(true);
  });
});

describe('MEETING_RULES', () => {
  const meetingValid = {
    family: 'meeting', schemaVersion: 1, title: 't', generatedAt: 'x',
    generatedBy: { model: 'm', promptVersion: 1 },
    language: 'ja', durationSec: 100, purpose: 'p',
    executive_summary: 'This was a productive meeting with three concrete outcomes.',
    topic_arc: [
      { topic: 'x', ts: 0, speakers_involved: [0] },
      { topic: 'y', ts: 50, speakers_involved: [1] },
    ],
    discussions: [],
    decisions: [{ text: 'Ship Q3', ts: 0, from: 'transcript' }],
    open_questions: [],
    next_steps: [{ text: 'do thing', ts: 10, from: 'transcript' }],
  };

  it('passes a valid Meeting', () => {
    for (const r of MEETING_RULES) {
      const res = r.run({ family: 'meeting', note: meetingValid, transcript: { transcripts: [] } as any });
      expect.soft(res.pass, `rule ${r.id} failed: ${res.message}`).toBe(true);
    }
  });

  it('fails when no decisions AND no actions', () => {
    const bad = { ...meetingValid, decisions: [], next_steps: [] };
    const res = MEETING_RULES.find(r => r.id === 'meeting-must-have-decision-or-action')!
      .run({ family: 'meeting', note: bad, transcript: { transcripts: [] } as any });
    expect(res.pass).toBe(false);
  });
});

describe('INTERVIEW_RULES', () => {
  const interviewValid = {
    family: 'interview', schemaVersion: 1, title: 't', generatedAt: 'x',
    generatedBy: { model: 'm', promptVersion: 1 },
    language: 'ja', durationSec: 100, purpose: 'p', subject_summary: 's',
    qa_pairs: [
      { question: 'q1', answer: 'a1', ts: 0, asked_by: 0, answered_by: 1, from: 'transcript' },
      { question: 'q2', answer: 'a2', ts: 10, asked_by: 0, answered_by: 1, from: 'transcript' },
      { question: 'q3', answer: 'a3', ts: 20, asked_by: 0, answered_by: 1, from: 'transcript' },
    ],
    themes: [{ name: 'theme1', appears_at_ts: [0] }],
    quotable_lines: [],
    key_takeaways: [],
  };

  it('passes a valid Interview', () => {
    for (const r of INTERVIEW_RULES) {
      const res = r.run({ family: 'interview', note: interviewValid, transcript: { transcripts: [] } as any });
      expect.soft(res.pass, `rule ${r.id} failed: ${res.message}`).toBe(true);
    }
  });

  it('fails self-questioning qa_pair', () => {
    const bad = {
      ...interviewValid,
      qa_pairs: [
        ...interviewValid.qa_pairs,
        { question: 'q4', answer: 'a4', ts: 30, asked_by: 1, answered_by: 1, from: 'transcript' },
      ],
    };
    const res = INTERVIEW_RULES.find(r => r.id === 'interview-qa-speaker-parity')!
      .run({ family: 'interview', note: bad, transcript: { transcripts: [] } as any });
    expect(res.pass).toBe(false);
  });
});

describe('BRAINSTORM_RULES', () => {
  const bsValid = {
    family: 'brainstorm', schemaVersion: 1, title: 't', generatedAt: 'x',
    generatedBy: { model: 'm', promptVersion: 1 },
    language: 'ja', durationSec: 100, purpose: 'p',
    idea_clusters: [{
      theme: 'speed',
      ideas: [
        { id: 'u1', text: 'idea-1', ts: 0, from: 'transcript' },
        { id: 'u2', text: 'idea-2', ts: 10, from: 'transcript' },
      ],
    }],
  };

  it('passes a valid Brainstorm', () => {
    for (const r of BRAINSTORM_RULES) {
      const res = r.run({ family: 'brainstorm', note: bsValid, transcript: { transcripts: [] } as any });
      expect.soft(res.pass, `rule ${r.id} failed: ${res.message}`).toBe(true);
    }
  });

  it('fails on duplicate idea id', () => {
    const bad = {
      ...bsValid,
      idea_clusters: [{
        theme: 'x',
        ideas: [
          { id: 'X', text: 'a', ts: 0, from: 'transcript' },
          { id: 'X', text: 'b', ts: 10, from: 'transcript' },
        ],
      }],
    };
    const res = BRAINSTORM_RULES.find(r => r.id === 'brainstorm-unique-idea-ids')!
      .run({ family: 'brainstorm', note: bad, transcript: { transcripts: [] } as any });
    expect(res.pass).toBe(false);
  });
});

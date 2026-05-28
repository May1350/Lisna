// desktop/eval/runners/pipeline-stub.ts
import type { FixtureTranscript, FixtureMeta } from '../fixtures/_schema';

export interface PipelineResult {
  note: any;
  retryAttempts: number[];                // per-call attemptsUsed from Plan 2 wrapper
  runMs: number;
}

export interface PipelineRunner {
  id: string;                              // e.g. 'stub', 'offline-3b', 'offline-1b'
  modelId: string;                         // ModelProfile.id
  promptVariantId: string;
  run: (input: { meta: FixtureMeta; transcript: FixtureTranscript }) => Promise<PipelineResult>;
}

// Stub that returns a deterministic, schema-passing note per family.
// Used by Tasks 18-20 plumbing tests AND for diff-vs-actual debugging.
export const STUB_RUNNER: PipelineRunner = {
  id: 'stub',
  modelId: 'stub-deterministic',
  promptVariantId: 'stub-v0',
  async run({ meta, transcript }) {
    const base = {
      schemaVersion: 1,
      family: meta.family,
      title: `Stub note for ${meta.fixtureId}`,
      generatedAt: new Date().toISOString(),
      generatedBy: { model: 'stub-deterministic', promptVersion: 0 },
      language: meta.language,
      durationSec: meta.durationSec,
    };
    if (meta.family === 'lecture') {
      const ts0 = transcript.transcripts[0]?.ts ?? 0;
      const ts1 = transcript.transcripts[Math.floor(transcript.transcripts.length / 2)]?.ts ?? 0;
      const ts2 = transcript.transcripts[transcript.transcripts.length - 1]?.ts ?? 0;
      return {
        note: {
          ...base,
          tldr: 'Stub tl;dr',
          sections: [
            { heading: 'Intro', ts: ts0, summary: 'stub', key_terms: [{ term: 'A', definition: 'a', ts: ts0, from: 'transcript' }], examples: [], points: [] },
            { heading: 'Mid', ts: ts1, summary: 'stub', key_terms: [{ term: 'B', definition: 'b', ts: ts1, from: 'transcript' }], examples: [], points: [] },
            { heading: 'End', ts: ts2, summary: 'stub', key_terms: [{ term: 'C', definition: 'c', ts: ts2, from: 'transcript' }], examples: [], points: [] },
          ],
        },
        retryAttempts: [1, 1, 1],
        runMs: 1,
      };
    }
    if (meta.family === 'meeting') {
      return {
        note: {
          ...base,
          purpose: 'stub purpose',
          executive_summary: 'A stub executive summary for plumbing verification.',
          topic_arc: [{ topic: 't', ts: 0, speakers_involved: [0] }],
          discussions: [],
          decisions: [{ text: 'stub decision', ts: 0, from: 'transcript' }],
          open_questions: [],
          next_steps: [{ text: 'stub action', ts: 10, from: 'transcript' }],
        },
        retryAttempts: [1],
        runMs: 1,
      };
    }
    if (meta.family === 'interview') {
      return {
        note: {
          ...base,
          purpose: 'stub purpose',
          subject_summary: 'stub subject',
          qa_pairs: Array.from({ length: 3 }, (_, i) => ({
            question: `stub q${i}`, answer: `stub a${i}`, ts: i * 10, asked_by: 0, answered_by: 1, from: 'transcript',
          })),
          themes: [{ name: 'stub theme', appears_at_ts: [0] }],
          quotable_lines: [],
          key_takeaways: [],
        },
        retryAttempts: [1],
        runMs: 1,
      };
    }
    // brainstorm
    return {
      note: {
        ...base,
        purpose: 'stub purpose',
        idea_clusters: [{
          theme: 'stub theme',
          ideas: [
            { id: 'stub-1', text: 'stub idea 1', ts: 0, from: 'transcript' },
            { id: 'stub-2', text: 'stub idea 2', ts: 10, from: 'transcript' },
          ],
        }],
      },
      retryAttempts: [1],
      runMs: 1,
    };
  },
};

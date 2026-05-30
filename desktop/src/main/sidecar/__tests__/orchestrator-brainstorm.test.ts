/**
 * Tests for finalizeBrainstorm (Plan 6 Task 13).
 * Mirrors finalizeInterview but brainstorm requiresDiarization=false (no
 * diarization fallback) and the merge-llm field is idea_clusters. Idea UUIDs
 * are assigned by the post-decode pipeline (Stage 2), not the LLM.
 *
 * Cases:
 *   1. single-chunk happy path → BrainstormNote, ideas carry UUIDs + from
 *   2. multi-chunk → idea_clusters synthesized by the merge LLM, UUIDs assigned
 *   3. merge LLM exhausts retries → deterministic fallback (first-chunk clusters) + warns
 *   4. empty transcript → throws EMPTY_TRANSCRIPT
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { finalizeBrainstorm, type FinalizeBrainstormArgs } from '../orchestrator';
import type { GrammarCapableSidecar } from '../grammar-call';
import type { SessionTranscript } from '@shared/note-schema/transcript';
import { modelProfiles } from '@shared/models/profiles';
import type { ModelProfile } from '@shared/models/profiles';
import type { BrainstormNote } from '@shared/families/brainstorm/schema';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ─── inline mock sidecar ──────────────────────────────────────────────────────

type MockOpts = { responses?: string[] };

function mockSidecar(
  opts: MockOpts = {},
): GrammarCapableSidecar & { calls: Array<{ prompt: string; grammar: string; seed: number }> } {
  const responses = opts.responses;
  const calls: Array<{ prompt: string; grammar: string; seed: number }> = [];
  let idx = 0;
  return {
    calls,
    async generateWithGrammar(req) {
      calls.push({ prompt: req.prompt, grammar: req.grammar, seed: req.seed });
      const text = responses ? (responses[idx] ?? '{}') : makeBrainstormNoteJson();
      idx++;
      return { text, seed: req.seed };
    },
  };
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

function ideaRaw(text: string, ts: number): Record<string, unknown> {
  // No `id` (post-decode UUID) and no `from` (post-decode provenance).
  return { text, ts };
}

/** Minimal valid per-chunk BrainstormNote JSON. */
function makeBrainstormNoteJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    family: 'brainstorm',
    title: 'ブレスト',
    generatedAt: '2026-05-29T00:00:00.000Z',
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 1800,
    purpose: 'テスト目的',
    idea_clusters: [{ theme: '高速化', ideas: [ideaRaw('アイデア', 0)] }],
    ...over,
  });
}

function makeTranscript(): SessionTranscript {
  return {
    sessionId: 'test-brainstorm',
    speakers: [{ id: 0 }, { id: 1 }],
    transcriptSegments: [
      { ts: 0, endTs: 4, text: 'アイデア一つ目。', speakerId: 0 },
      { ts: 5, endTs: 9, text: 'アイデア二つ目。', speakerId: 1 },
    ],
  };
}

/** Override brainstorm's recommendedChunkTokens to force one segment per chunk. */
function profileWithBrainstormChunkBudget(budget: number): ModelProfile {
  const base = modelProfiles['llama-3.2-3b-q4-km']!;
  return {
    ...base,
    perFamily: {
      ...base.perFamily,
      brainstorm: { ...base.perFamily['brainstorm']!, recommendedChunkTokens: budget },
    },
  };
}

beforeAll(async () => {
  await import('@shared/families/brainstorm/core');
});

const modelProfile = modelProfiles['llama-3.2-3b-q4-km']!;

// ─── tests ─────────────────────────────────────────────────────────────────────

describe('finalizeBrainstorm', () => {
  it('single-chunk happy path → BrainstormNote, ideas carry UUIDs + from', async () => {
    const sidecar = mockSidecar({ responses: [makeBrainstormNoteJson()] });
    const args: FinalizeBrainstormArgs = {
      sessionId: 'test',
      transcript: makeTranscript(),
      sidecar,
      modelProfile,
    };
    const result = await finalizeBrainstorm(args);

    expect(sidecar.calls).toHaveLength(1);
    expect(result.note.family).toBe('brainstorm');
    expect(result.telemetry.chunkCount).toBe(1);
    const idea = (result.note as BrainstormNote).idea_clusters[0]!.ideas[0]!;
    expect(idea.id).toMatch(UUID_RE);       // Stage 2 post-decode UUID
    expect(idea.from).toBe('transcript');    // Stage 3 provenance (ts=0 matches segment)
    expect(result.note.validation_warnings ?? []).toEqual([]);
  });

  it('multi-chunk: idea_clusters synthesized by the merge LLM, UUIDs assigned', async () => {
    const profile = profileWithBrainstormChunkBudget(5); // 1 segment per chunk → 2 chunks
    const sidecar = mockSidecar({
      responses: [
        makeBrainstormNoteJson({ idea_clusters: [{ theme: '高速化', ideas: [ideaRaw('アイデア0', 0)] }] }),
        makeBrainstormNoteJson({ idea_clusters: [{ theme: '高速化', ideas: [ideaRaw('アイデア1', 5)] }] }),
        // merge LLM unifies the cluster (ids omitted — pipeline assigns them).
        JSON.stringify({ idea_clusters: [{ theme: '高速化', ideas: [ideaRaw('アイデア0', 0), ideaRaw('アイデア1', 5)] }] }),
      ],
    });

    const result = await finalizeBrainstorm({
      sessionId: 'test',
      transcript: makeTranscript(),
      sidecar,
      modelProfile: profile,
    });

    expect(sidecar.calls).toHaveLength(3); // 2 chunks + 1 merge
    expect(result.telemetry.chunkCount).toBe(2);
    const ideas = (result.note as BrainstormNote).idea_clusters[0]!.ideas;
    expect(ideas).toHaveLength(2);
    for (const i of ideas) expect(i.id).toMatch(UUID_RE);
    expect(result.note.validation_warnings ?? []).toEqual([]);
  });

  it('merge LLM exhausts retries → deterministic fallback (first-chunk clusters) + warns', async () => {
    const profile = profileWithBrainstormChunkBudget(5);
    const sidecar = mockSidecar({
      responses: [
        makeBrainstormNoteJson({ idea_clusters: [{ theme: '高速化', ideas: [ideaRaw('アイデア0', 0)] }] }),
        makeBrainstormNoteJson({ idea_clusters: [{ theme: 'UX', ideas: [ideaRaw('アイデア1', 5)] }] }),
        'not json {',
        'not json {',
        'not json {',
      ],
    });

    const result = await finalizeBrainstorm({
      sessionId: 'test',
      transcript: makeTranscript(),
      sidecar,
      modelProfile: profile,
    });

    const note = result.note as BrainstormNote;
    // idea_clusters (merge-llm) falls back to the first chunk's clusters.
    expect(note.idea_clusters[0]!.ideas[0]!.id).toMatch(UUID_RE);
    expect((note.validation_warnings ?? []).join(' ')).toMatch(/merge/i);
    expect(result.telemetry.validationWarnings.join(' ')).toMatch(/merge/i);
  });

  it('empty transcript → throws EMPTY_TRANSCRIPT', async () => {
    const sidecar = mockSidecar();
    await expect(
      finalizeBrainstorm({
        sessionId: 'empty',
        transcript: { sessionId: 'empty', speakers: [{ id: 0 }], transcriptSegments: [] },
        sidecar,
        modelProfile,
      }),
    ).rejects.toThrow('EMPTY_TRANSCRIPT');
  });
});

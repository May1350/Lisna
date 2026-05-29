/**
 * Tests for runMergeLLMCall (Plan 6 Task 7 — productionized merge).
 *
 * Spike 1.1 verdict = MIXED: a 3B model cannot be trusted to UNION structured
 * turns across chunk partials (worst case dropped a whole chunk's qa_pairs:
 * 4/8). So the production merge is a HYBRID:
 *   - Structural/extractive fields (qa_pairs, participants, quotable_lines) are
 *     merged DETERMINISTICALLY (deterministicMerge + interviewMergeStrategy).
 *   - Only the genuinely-derived prose (themes, key_takeaways, subject_summary
 *     for Interview; idea_clusters for Brainstorm) is taken from the LLM.
 *
 * These tests are fail-first regressions: each asserts a behavior that a naive
 * pure-LLM merge (the original plan pseudo-code) would FAIL. The mock generator
 * deliberately drops/omits structured fields the way the real 3B did.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runMergeLLMCall } from '../merge-llm';
import type { LlmGenerator } from '../grammar-call';
import type { InterviewNote } from '@shared/families/interview/schema';
import type { BrainstormNote } from '@shared/families/brainstorm/schema';
import type { SessionTranscript } from '@shared/note-schema/transcript';

// ─── register families (side-effect) ─────────────────────────────────────────
beforeAll(async () => {
  await import('@shared/families/interview/core');
  await import('@shared/families/brainstorm/core');
});

// ─── helpers ──────────────────────────────────────────────────────────────────

/** A generator that returns the same canned text for every call (ignores prompt/grammar). */
function cannedGenerator(text: string): LlmGenerator {
  return async ({ seed }) => ({ text, seed });
}

const TRANSCRIPT: SessionTranscript = {
  sessionId: 'merge-test',
  speakers: [{ id: 0 }, { id: 1 }],
  transcriptSegments: [
    { ts: 10, endTs: 12, text: 'はい', speakerId: 1 },
    { ts: 1800, endTs: 1802, text: 'そうですね', speakerId: 1 },
  ],
};

/** Minimal valid post-pipeline InterviewNote partial (qa_pairs already carry `from`). */
function interviewPartial(over: Partial<InterviewNote>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    family: 'interview',
    title: 'インタビュー',
    generatedAt: '2026-05-29T00:00:00.000Z',
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 1800,
    purpose: 'テスト目的',
    subject_summary: 'チャンク単位のサマリー',
    qa_pairs: [],
    themes: [],
    quotable_lines: [],
    key_takeaways: [],
    ...over,
  };
}

function qa(question: string, answer: string, ts: number): Record<string, unknown> {
  return { question, answer, ts, asked_by: 0, answered_by: 1, from: 'transcript' };
}

/** Minimal valid post-pipeline BrainstormNote partial (ideas carry `id` + `from`). */
function brainstormPartial(over: Partial<BrainstormNote>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    family: 'brainstorm',
    title: 'ブレスト',
    generatedAt: '2026-05-29T00:00:00.000Z',
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 1800,
    purpose: 'テスト目的',
    idea_clusters: [],
    ...over,
  };
}

function idea(text: string, ts: number): Record<string, unknown> {
  return { id: '11111111-1111-4111-8111-111111111111', text, ts, from: 'transcript' };
}

// ─── Interview ─────────────────────────────────────────────────────────────────

describe('runMergeLLMCall — Interview', () => {
  it('unions ALL qa_pairs across chunks even when the LLM drops a chunk (deterministic, ts-sorted)', async () => {
    const partials = [
      interviewPartial({ qa_pairs: [qa('Q0a', 'A0a', 10), qa('Q0b', 'A0b', 20)] as never }),
      interviewPartial({ qa_pairs: [qa('Q1a', 'A1a', 1800), qa('Q1b', 'A1b', 1820)] as never }),
    ];
    // LLM "merge" output drops chunk-1's turns (the 4/8 failure) — must be IGNORED for qa_pairs.
    const llm = JSON.stringify({
      themes: [{ name: '意思決定', appears_at_ts: [12] }],
      key_takeaways: [{ text: '洞察' }],
      subject_summary: '統合サマリー',
      qa_pairs: [qa('Q0a', 'A0a', 10)], // dropped 3 — should NOT be used
    });

    const result = await runMergeLLMCall({
      family: 'interview',
      partials,
      transcript: TRANSCRIPT,
      baseSeed: 7000,
      generator: cannedGenerator(llm),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const note = result.merged as InterviewNote;
    expect(note.qa_pairs).toHaveLength(4);
    expect(note.qa_pairs.map(q => q.question)).toEqual(['Q0a', 'Q0b', 'Q1a', 'Q1b']);
    expect(note.qa_pairs.map(q => q.ts)).toEqual([10, 20, 1800, 1820]);
  });

  it('dedups boundary-duplicate qa_pairs by ts proximity + question trigram', async () => {
    const partials = [
      interviewPartial({ qa_pairs: [qa('最後に一言お願いします', 'ありがとう', 900)] as never }),
      // same question, ts within window (chunk-boundary overlap) → one survives
      interviewPartial({ qa_pairs: [qa('最後に一言お願いします', 'ありがとうございました', 901)] as never }),
    ];
    const llm = JSON.stringify({ themes: [], key_takeaways: [], subject_summary: 'S' });

    const result = await runMergeLLMCall({
      family: 'interview', partials, transcript: TRANSCRIPT, baseSeed: 7000,
      generator: cannedGenerator(llm),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.merged as InterviewNote).qa_pairs).toHaveLength(1);
  });

  it('carries participants deterministically when the LLM omits them', async () => {
    const partials = [
      interviewPartial({
        participants: [
          { speakerRef: 0, role: 'interviewer' },
          { speakerRef: 1, role: 'interviewee' },
        ] as never,
        qa_pairs: [qa('Q', 'A', 10)] as never,
      }),
      interviewPartial({ qa_pairs: [qa('Q2', 'A2', 1800)] as never }),
    ];
    const llm = JSON.stringify({ themes: [], key_takeaways: [], subject_summary: 'S' }); // no participants

    const result = await runMergeLLMCall({
      family: 'interview', partials, transcript: TRANSCRIPT, baseSeed: 7000,
      generator: cannedGenerator(llm),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.merged as InterviewNote).participants).toHaveLength(2);
  });

  it('merges quotable_lines deterministically (extractive — never dropped by the LLM)', async () => {
    const partials = [
      interviewPartial({ quotable_lines: [{ text: '引用A', speakerRef: 1, ts: 15 }] as never, qa_pairs: [qa('Q', 'A', 10)] as never }),
      interviewPartial({ quotable_lines: [{ text: '引用B', speakerRef: 1, ts: 1810 }] as never, qa_pairs: [qa('Q2', 'A2', 1800)] as never }),
    ];
    const llm = JSON.stringify({ themes: [], key_takeaways: [], subject_summary: 'S' }); // LLM drops quotes

    const result = await runMergeLLMCall({
      family: 'interview', partials, transcript: TRANSCRIPT, baseSeed: 7000,
      generator: cannedGenerator(llm),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const texts = (result.merged as InterviewNote).quotable_lines.map(q => q.text);
    expect(texts).toContain('引用A');
    expect(texts).toContain('引用B');
  });

  it('takes themes / key_takeaways / subject_summary from the LLM (derived prose)', async () => {
    const partials = [
      interviewPartial({ themes: [{ name: '意思決定', appears_at_ts: [12] }] as never, qa_pairs: [qa('Q', 'A', 10)] as never }),
      interviewPartial({ themes: [{ name: '意思決定', appears_at_ts: [1820] }] as never, qa_pairs: [qa('Q2', 'A2', 1800)] as never }),
    ];
    const llm = JSON.stringify({
      themes: [{ name: '意思決定', appears_at_ts: [12, 1820] }], // LLM merged the cross-chunk theme
      key_takeaways: [{ text: '統合された洞察' }],
      subject_summary: '統合された被取材者サマリー',
    });

    const result = await runMergeLLMCall({
      family: 'interview', partials, transcript: TRANSCRIPT, baseSeed: 7000,
      generator: cannedGenerator(llm),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const note = result.merged as InterviewNote;
    expect(note.themes).toHaveLength(1);
    expect(note.themes[0]!.appears_at_ts).toEqual([12, 1820]);
    expect(note.key_takeaways[0]!.text).toBe('統合された洞察');
    expect(note.subject_summary).toBe('統合された被取材者サマリー');
    expect(result.validationWarnings).toEqual([]);
  });

  it('returns ok:false when the merge LLM call exhausts retries', async () => {
    const partials = [
      interviewPartial({ qa_pairs: [qa('Q', 'A', 10)] as never }),
      interviewPartial({ qa_pairs: [qa('Q2', 'A2', 1800)] as never }),
    ];
    const result = await runMergeLLMCall({
      family: 'interview', partials, transcript: TRANSCRIPT, baseSeed: 7000,
      maxAttempts: 3,
      generator: cannedGenerator('not valid json {'),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.attemptsUsed).toBe(3);
    expect(typeof result.finalReason).toBe('string');
  });
});

// ─── Brainstorm ─────────────────────────────────────────────────────────────────

describe('runMergeLLMCall — Brainstorm', () => {
  it('overlays merged idea_clusters from the LLM and re-assigns idea UUIDs', async () => {
    const partials = [
      brainstormPartial({ idea_clusters: [{ theme: '高速化', ideas: [idea('アイデア0', 10)] }] as never }),
      brainstormPartial({ idea_clusters: [{ theme: '高速化', ideas: [idea('アイデア1', 1800)] }] as never }),
    ];
    // LLM output omits ids (postDecodeOnly) + from — the pipeline fills them.
    const llm = JSON.stringify({
      idea_clusters: [{ theme: '高速化', ideas: [{ text: 'アイデア0', ts: 10 }, { text: 'アイデア1', ts: 1800 }] }],
    });

    const result = await runMergeLLMCall({
      family: 'brainstorm', partials, transcript: TRANSCRIPT, baseSeed: 8000,
      generator: cannedGenerator(llm),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const note = result.merged as BrainstormNote;
    expect(note.idea_clusters[0]!.ideas).toHaveLength(2);
    for (const i of note.idea_clusters[0]!.ideas) {
      expect(i.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(result.validationWarnings).toEqual([]);
  });

  it('warns when the LLM grossly drops ideas (fewer than the richest single chunk)', async () => {
    const partials = [
      brainstormPartial({ idea_clusters: [{ theme: '高速化', ideas: [idea('アイデア0', 10)] }] as never }),
      brainstormPartial({ idea_clusters: [{ theme: '高速化', ideas: [idea('アイデア1', 1800)] }] as never }),
    ];
    const llm = JSON.stringify({ idea_clusters: [] }); // dropped everything

    const result = await runMergeLLMCall({
      family: 'brainstorm', partials, transcript: TRANSCRIPT, baseSeed: 8000,
      generator: cannedGenerator(llm),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.validationWarnings.length).toBeGreaterThan(0);
    expect(result.validationWarnings.join(' ')).toMatch(/idea/i);
  });
});

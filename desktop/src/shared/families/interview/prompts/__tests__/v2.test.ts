/**
 * interview-v2 prompt contract tests (fabrication-incident fix, 2026-06-12).
 *
 * These pin the three v1 defects the incident implicated, so a future prompt
 * edit can't silently reintroduce them:
 *   1. 家族 mistranslation at the generation boundary
 *   2. missing explicit Japanese-output rule
 *   3. English instruction sentence as the final prose before generation
 *
 * Grounded-output behavior itself is validated against the real recording via
 * scripts/note-quality-eval.ts (real-3B, dump-replay) — not unit-testable.
 */
import { describe, it, expect } from 'vitest';
import { interviewPromptsV2 } from '../v2';
import { interviewPromptsV1 } from '../v1';
import { InterviewFamilyCore } from '../../core';

describe('interviewPromptsV2 — prompt contract', () => {
  const chunkCtx = { chunkIndex: 0, totalChunks: 1, transcript: '[0:01] [話者0] テスト' };

  it('is registered in the family core alongside v1', () => {
    const ids = InterviewFamilyCore.prompts.map((p) => p.variantId);
    expect(ids).toContain('interview-v1');
    expect(ids).toContain('interview-v2');
  });

  it('system template carries the three 最重要 rules (JA-only / grounding / real-ts)', () => {
    const s = interviewPromptsV2.systemTemplate;
    expect(s).toContain('最重要ルール');
    expect(s).toMatch(/必ず日本語で書くこと/);
    expect(s).toMatch(/捏造/);
    // round-placeholder-ts ban names the incident's exact pattern
    expect(s).toMatch(/0, 10, 20/);
  });

  it('never says 家族 (the v1 "note family" mistranslation)', () => {
    expect(interviewPromptsV2.systemTemplate).not.toContain('家族');
    expect(interviewPromptsV2.chunkUserTemplate(chunkCtx)).not.toContain('家族');
  });

  it('chunk template tail is Japanese — no English instruction sentence priming EN continuation', () => {
    const rendered = interviewPromptsV2.chunkUserTemplate(chunkCtx);
    expect(rendered).not.toContain('Produce the InterviewNote JSON');
    // The text after the transcript must demand Japanese strings + JSON-only.
    const tail = rendered.slice(rendered.indexOf('テスト'));
    expect(tail).toMatch(/日本語/);
    expect(tail).toMatch(/JSON のみ/);
  });

  it('keeps v1 structure anchors (roles / anti-parroting / budget) so only the fixes differ', () => {
    const s = interviewPromptsV2.systemTemplate;
    expect(s).toContain('# 役割');
    expect(s).toContain('# 重要 (anti-parroting)');
    expect(s).toContain('# Budget');
    expect(s).toContain('qa_pairs ≤ 80');
  });

  it('merge template delegates to v1 byte-for-byte (merge path not implicated)', () => {
    const ctx = { partials: [{ a: 1 }] };
    expect(interviewPromptsV2.mergeUserTemplate!(ctx)).toBe(interviewPromptsV1.mergeUserTemplate!(ctx));
  });
});

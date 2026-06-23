/**
 * Regression: replay the REAL 3B extraction output from the 2026-06-23 founder
 * failure (a 10-min JA meeting) through the assembler and assert the cheap
 * deterministic fixes remove the visible garbage — WITHOUT running any model.
 *
 * The `atoms` below are taken verbatim from the failure dump's llm-calls.ndjson
 * rawText (markers, mixed-script homoglyph mutation, hallucinated placeholders).
 * STEP 0 must: strip "[ts] [話者id]" markers, drop the out-of-script garble, drop
 * the meta-placeholder questions/risks, and stop the exec_summary from counting
 * garbage. It does NOT (and should not) invent real decisions — the chitchat
 * the 3B copied is the model-capacity residual that the model swap (STEP 1)
 * addresses; we only assert it is marker-stripped, and we MEASURE the copy-rate.
 */
import { describe, it, expect } from 'vitest';
import type { ExtractedAtoms } from '../extract-schema';
import type { SessionTranscript } from '@shared/note-schema';
import { assembleMeetingNote } from '../assemble';
import { hasLeakedMarker, hasMixedScript, isVerbatimSegmentCopy } from '../quality-filters';

// Verbatim from the dump rawText (subset that exercises every pathology).
const realAtoms: ExtractedAtoms = {
  decisions: [
    { text: '[0] [話者0] はい、完成です!' },          // marker + chitchat copy
    { text: '[4] [話者0] めちゃくちゃ楽しみにしてるから' }, // marker + chitchat copy
    { text: '[51] [話者0] 2時間半でやろうと思います' },   // marker + a real-ish line
  ],
  action_items: [
    { task: 'ビジョン、ミッ션、バリュールの解像度' },  // hangul homoglyph garble
    { task: 'ビジョン、ミッيشن、バリュール' },        // arabic garble
    { task: '社内向けの行動指針を13時までに策定する' }, // clean, real action
  ],
  key_figures: [{ label: '会議の主な話者', value: '0' }],
  open_questions: [
    { text: 'この会議で何が話されましたか?' },  // hallucinated placeholder
    { text: 'この会議の結果は何ですか?' },        // hallucinated placeholder
  ],
  risks: [{ text: 'この会議でどのようなリスクが生じるか?' }], // hallucinated placeholder
  title: '会議の記録',
};

const segmentTexts = [
  'はい、完成です!',
  'めちゃくちゃ楽しみにしてるから',
  '2時間半でやろうと思います',
];

const transcript: SessionTranscript = {
  sessionId: 'realdump',
  language: 'ja',
  transcriptSegments: segmentTexts.map((text, i) => ({
    ts: i * 30,
    endTs: i * 30 + 28,
    speakerId: 0,
    text,
  })),
} as unknown as SessionTranscript;

/** Recursively collect every string value in the assembled note. */
function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => allStrings(x, out));
  return out;
}

describe('assemble — real 2026-06-23 failure replay', () => {
  const note = assembleMeetingNote([{ atoms: realAtoms, tsRange: [0, 84] }], transcript);
  const strings = allStrings(note);

  it('strips ALL leaked [N]/[話者N] markers from every note string', () => {
    const leaked = strings.filter(hasLeakedMarker);
    expect(leaked).toEqual([]);
  });

  it('removes ALL out-of-script (mixed-script) garble from every note string', () => {
    const garbled = strings.filter(hasMixedScript);
    expect(garbled).toEqual([]);
  });

  it('drops the hallucinated placeholder questions and risks', () => {
    const q = (note.open_questions as Array<{ text: string }> | undefined) ?? [];
    expect(q.map((x) => x.text)).not.toContain('この会議で何が話されましたか?');
    expect(q.map((x) => x.text)).not.toContain('この会議の結果は何ですか?');
    // every placeholder was dropped → no open_questions survive in this fixture
    expect(q).toEqual([]);
    expect(note.risks_or_concerns).toBeUndefined();
  });

  it('keeps the one real action item (and only it) after dropping garble', () => {
    const steps = (note.next_steps as Array<{ text: string }> | undefined) ?? [];
    expect(steps.map((s) => s.text)).toEqual(['社内向けの行動指針を13時までに策定する']);
  });

  it('exec_summary count reflects the cleaned set, not the 3B garbage (was "15件")', () => {
    const decisions = note.decisions as Array<{ text: string }>;
    const steps = (note.next_steps as Array<unknown> | undefined) ?? [];
    expect(note.executive_summary).toContain(`${decisions.length}件の決定`);
    expect(note.executive_summary).toContain(`${steps.length}件の宿題`);
    // sanity: not the inflated original count
    expect(note.executive_summary).not.toContain('15件の決定');
  });

  it('MEASURES the residual: chitchat decisions are still verbatim copies (STEP 1 target)', () => {
    const decisions = note.decisions as Array<{ text: string }>;
    // marker-stripped, but the model copied chitchat verbatim — a model-capacity
    // problem the deterministic layer deliberately does NOT mask. Documented, measured.
    const copyRate = decisions.filter((d) => isVerbatimSegmentCopy(d.text, segmentTexts)).length / decisions.length;
    expect(copyRate).toBeGreaterThan(0); // proves the failure is still present pre-model-swap
    // but the markers are gone even on the surviving chitchat:
    expect(decisions.every((d) => !hasLeakedMarker(d.text))).toBe(true);
  });
});

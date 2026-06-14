/**
 * Unit tests for the per-chunk 2-pass ladder in runChunkWithGrammar
 * (per-chunk fabrication fix, 2026-06-14; spec
 * 2026-06-14-v2-per-chunk-2pass-fabrication-fix-design.md).
 *
 * A mock LlmGenerator drives the ladder; we assert the GENERATION COUNT and
 * final success, which is how the bounded ladder's branching (pass-1 reseed
 * on ran-to-cap / language-mismatch vs pass-2 reseed on the SAME prose) is
 * observable from the outside.
 *
 * VALID_LECTURE_JSON shape: a minimal pre-postDecode LectureNote — identical
 * shape to lecture-orchestrator.test.ts's makeLectureNoteJson (the proven
 * known-valid emitted note). `from` is deliberately OMITTED on key_terms /
 * points (runPostDecodePipeline Stage 3 fills it); schemaVersion is
 * overwritten by Stage 1. All user-visible strings are JA so the pass-2
 * language guard inside callWithGrammar passes too.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { runChunkWithGrammar } from '../orchestrator';
import type { LlmGenerator } from '../grammar-call';
import { familyCoreRegistry } from '../../../shared/families';
import { adaptToV2Transcript } from '../../../shared/note-schema/adapt-legacy-transcript';

// Register the lecture family before the registry lookup below.
beforeAll(async () => {
  await import('../../../shared/families/lecture/core');
});

const transcript = adaptToV2Transcript(
  [{ startSec: 0, endSec: 5, text: '日本語のテスト発話です。' }],
  't',
);

const VALID_LECTURE_JSON = JSON.stringify({
  schemaVersion: 1,
  family: 'lecture',
  title: 'テスト講義',
  generatedAt: new Date().toISOString(),
  generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
  language: 'ja',
  durationSec: 60,
  sections: [
    {
      heading: 'セクション',
      ts: 0,
      summary: 'テストの要約です。',
      key_terms: [{ term: '概念', definition: '定義', ts: 0 }],
      examples: [],
      points: [{ text: '重要な点', ts: 0, important: true }],
    },
  ],
});

// A grounded JA prose blob comfortably over the 100-char language-guard floor.
const JA_PROSE = '日本語の要約です。十分な長さの文章をここに書きます。' + 'あ'.repeat(120);

function baseOpts() {
  const fam = familyCoreRegistry['lecture']!;
  return {
    family: 'lecture' as const,
    fam: fam as never,
    chunkIndex: 0,
    totalChunks: 1,
    pass1System: 'sys1',
    pass1User: 'u1',
    pass2System: 'sys2',
    pass2UserPrefix: 'p2',
    grammar: 'root ::= "{}"',
    baseSeed: 5000,
    tuning: { temperature: 0.4, maxGenTokens: 2000 },
    transcriptForPostDecode: transcript,
    expectedLanguage: 'ja' as const,
  };
}

/** Mock generator returning a scripted sequence; the last entry repeats. */
function gen(seq: Array<{ text: string; tokensOut: number }>): LlmGenerator {
  let i = 0;
  return vi.fn(async () => {
    const r = seq[Math.min(i, seq.length - 1)]!;
    i++;
    return { text: r.text, seed: 1, stats: { tokensOut: r.tokensOut, genMs: 10 } };
  });
}

/** Per-generation grammar string ('' = pass-1 free-gen, non-empty = pass-2).
 * This is what distinguishes a pass-1 reseed from a pass-2 reseed. */
function grammarsPerCall(g: LlmGenerator): string[] {
  return (g as ReturnType<typeof vi.fn>).mock.calls.map(
    (c) => (c[0] as { grammar: string }).grammar,
  );
}

describe('runChunkWithGrammar 2-pass', () => {
  it('happy path: 1 pass-1 + 1 pass-2 = 2 generations', async () => {
    const generator = gen([
      { text: JA_PROSE, tokensOut: 300 }, // pass-1 prose
      { text: VALID_LECTURE_JSON, tokensOut: 400 }, // pass-2 JSON
    ]);
    const r = await runChunkWithGrammar({ ...baseOpts(), generator } as never);
    expect(r.validated).toBeDefined();
    expect((generator as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('pass-1 ran-to-cap ⇒ pass-1 reseed, truncated prose never fed to pass-2', async () => {
    const generator = gen([
      { text: 'あ'.repeat(2000), tokensOut: 1600 /* PASS1_MAX_TOKENS */ }, // ran-to-cap → reseed pass-1
      { text: JA_PROSE, tokensOut: 300 }, // good pass-1
      { text: VALID_LECTURE_JSON, tokensOut: 400 }, // pass-2
    ]);
    const r = await runChunkWithGrammar({ ...baseOpts(), generator } as never);
    expect(r.validated).toBeDefined();
    expect((generator as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    // The truncated prose triggers a fresh PASS-1 (empty grammar), NOT a pass-2
    // reseed against the bad prose. gen[0]=pass1(cap), gen[1]=pass1(ok), gen[2]=pass2.
    expect(grammarsPerCall(generator)).toEqual(['', '', 'root ::= "{}"']);
  });

  it('pass-1 English ⇒ language guard reseeds pass-1', async () => {
    const EN =
      'This is an English summary that is clearly not Japanese at all, well over one hundred characters long to clear the floor reliably here.';
    const generator = gen([
      { text: EN, tokensOut: 300 }, // pass-1 English → reseed pass-1
      { text: JA_PROSE, tokensOut: 300 }, // good JA pass-1
      { text: VALID_LECTURE_JSON, tokensOut: 400 }, // pass-2
    ]);
    const r = await runChunkWithGrammar({ ...baseOpts(), generator } as never);
    expect(r.validated).toBeDefined();
    expect((generator as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    // English prose ⇒ fresh PASS-1, not a pass-2 attempt on English.
    expect(grammarsPerCall(generator)).toEqual(['', '', 'root ::= "{}"']);
  });

  it('pass-2 reseeds against the SAME prose before re-doing pass-1', async () => {
    const generator = gen([
      { text: JA_PROSE, tokensOut: 300 }, // pass-1 (ONCE)
      { text: 'not json', tokensOut: 50 }, // pass-2 fail → reseed pass-2
      { text: VALID_LECTURE_JSON, tokensOut: 400 }, // pass-2 ok
    ]);
    const r = await runChunkWithGrammar({ ...baseOpts(), generator } as never);
    expect(r.validated).toBeDefined();
    // p1 ONCE, p2 twice — NOT a 2nd pass-1. The grammar sequence proves it:
    // a single empty-grammar generation followed by two grammar-constrained ones.
    expect((generator as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    expect(grammarsPerCall(generator)).toEqual(['', 'root ::= "{}"', 'root ::= "{}"']);
  });

  it('total generations capped at 8 then CHUNK_FAILED', async () => {
    const generator = gen([{ text: 'not json', tokensOut: 50 }]); // everything fails
    await expect(runChunkWithGrammar({ ...baseOpts(), generator } as never)).rejects.toThrow(
      /CHUNK_FAILED:0:/,
    );
    expect((generator as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(8);
  });
});

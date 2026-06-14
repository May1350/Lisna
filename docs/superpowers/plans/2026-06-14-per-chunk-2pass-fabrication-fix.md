# Per-chunk 2-pass fabrication fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the 3B from flipping to English-fabricated notes on hard conversation inputs by generating grounded JA prose first (no grammar), then structuring that prose into the family JSON under grammar — both per-chunk, inside the existing per-chunk seam.

**Architecture:** Insert a 2-pass into `runChunkWithGrammar` (orchestrator.ts): pass-1 = free-gen (empty grammar) → grounded JA prose, guarded by its own language check + a ran-to-cap detector; pass-2 = `callWithGrammar(schema: z.unknown(), FULL grammar)` structuring the prose → existing `runPostDecodePipeline`. Bounded retry ladder (≤8 generations/chunk) favoring pass-2 reseeds over pass-1 re-gen. Prompts come from a new shared 2-pass prompt builder (per-family emphasis hint; pass-2 family-agnostic). KV is cleared per `generate()` (#126) so 2 passes × N chunks = independent fresh-context decodes — no accumulation. Spec: `docs/superpowers/specs/2026-06-14-v2-per-chunk-2pass-fabrication-fix-design.md`.

**Tech Stack:** TypeScript (Node 20), Vitest, llama.cpp sidecar (Llama-3.2-3B-Q4_K_M), Zod, GBNF grammar.

---

## Background the implementer MUST know (zero-context primer)

- **Per-chunk seam:** `desktop/src/main/sidecar/orchestrator.ts::runChunkWithGrammar` (currently lines ~226-332). All four `finalize{Lecture,Meeting,Interview,Brainstorm}` build `systemPrompt`/`userPrompt`/`grammar` and call it once per chunk; it returns a validated chunk partial. Today it does ONE grammar call (`callWithGrammar` with `schema: z.unknown()`) then `runPostDecodePipeline(rawJson, fam, transcript)` (fills `postDecodeOnly` fields like `from` + runs the real `fam.schema.parse`), with a 2-outer × 3-inner fresh-seed retry.
- **WHY z.unknown() and not the family schema:** `from: ProvenanceSchema` is `postDecodeOnly` → STRIPPED from the GBNF grammar → the LLM never emits it. Parsing the FULL family schema on raw grammar output throws `ZodError` on `from`. `runPostDecodePipeline` fills those fields THEN validates. **Never** pass `fam.schema` to `callWithGrammar` here.
- **callWithGrammar** (`desktop/src/main/sidecar/grammar-call.ts:363`): runs the generator, `JSON.parse`, `sanitizeEscapeLiteralsInStrings`, `findEscapeLiteralInStrings`, `findLanguageMismatch` (only when `expectedLanguage==='ja'`), then `schema.parse`. With `maxAttempts: 1` it does exactly one generation. Result: `{ok, value, attempts[]}` or `{ok:false, attempts[], finalReason}`. Each attempt carries `tokensOut`, `reason`, `sanitizedSlots`.
- **`findLanguageMismatch(value, expectedLanguage)`** (`grammar-call.ts:334`, exported): accepts ANY value INCLUDING a raw string (its `collectCheckedText` pushes a string leaf directly). Returns `{ratio, checkedChars}` when ja-expected and the text is <5% JA script, else `null`. Has a 100-char floor (short text → null).
- **Free-gen path:** the sidecar treats empty grammar as plain generation (`llama_engine.cpp:255 if(!opts.grammar.empty())`). So pass-1 = `generator({grammar: '', ...})`.
- **Retry constants today** (orchestrator.ts:346-353): `INNER_GRAMMAR_ATTEMPTS=3`, `POST_DECODE_OUTER_ATTEMPTS=2`, `POST_DECODE_SEED_OFFSET=10000`.
- **Telemetry:** `emitGrammarAttempts(onTelemetry, ctx, attempts)` + `attempt-start`/`chunk-done` events; preserve them.
- **Tests:** Vitest. Existing orchestrator tests: `desktop/src/main/sidecar/__tests__/orchestrator*.test.ts` (grep for `runChunkWithGrammar` / `finalizeInterview`). Mock the generator (a function), never the sidecar binary. `pnpm --filter @lisna/desktop test`, `pnpm --filter @lisna/desktop typecheck`, `pnpm --filter @lisna/desktop lint`. **Run lint too** (`pitfalls.md pre-push-lint` — `desktop-ci` gates on `pnpm verify`).
- **Spike-proven** (do not re-derive): pass-1 free-gen jaRatio 0.92; pass-2 structuring the prose → 0.94 JA / 0.79 grounded / clean EOS. Lighter grammar is OUT OF SCOPE (arms were byte-identical).

## File structure

- **Create** `desktop/src/shared/families/util/two-pass-prompts.ts` — `buildPass1Prompts`, `buildPass2Prompts`, `PASS1_EMPHASIS`. Pure functions; one responsibility (2-pass prompt strings).
- **Create** `desktop/src/shared/families/util/__tests__/two-pass-prompts.test.ts`.
- **Modify** `desktop/src/main/sidecar/orchestrator.ts` — `RunChunkOpts` (swap prompt fields), `runChunkWithGrammar` (2-pass + bounded ladder), new constants, the 4 `finalize*` call sites, telemetry pass-attribution.
- **Modify** `desktop/src/main/sidecar/__tests__/orchestrator-runchunk.test.ts` (create if absent) — retry-ladder + ran-to-cap + pass-1-guard unit tests with a mock generator.
- **Validation only (no commit):** `desktop/scripts/` ad-hoc tsx for the real-3B e2e gate (Task 9), deleted after.

---

### Task 1: 2-pass prompt builder

**Files:**
- Create: `desktop/src/shared/families/util/two-pass-prompts.ts`
- Test: `desktop/src/shared/families/util/__tests__/two-pass-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { buildPass1Prompts, buildPass2Prompts, PASS1_EMPHASIS } from '../two-pass-prompts';

describe('buildPass1Prompts', () => {
  it('produces a JA-native free-prose system + a transcript-bearing user (ja)', () => {
    const { system, user } = buildPass1Prompts('interview', { chunkIndex: 0, totalChunks: 3, transcript: '[0:01] [話者0] こんにちは' }, 'ja');
    expect(system).toContain('日本語');          // language anchor
    expect(system).toContain('JSON');            // explicit "no JSON" instruction present
    expect(system).toContain(PASS1_EMPHASIS.interview);
    expect(user).toContain('こんにちは');         // transcript embedded
    expect(user).toContain('1');                 // chunk 1 of 3
  });
  it('emphasis differs per family', () => {
    expect(PASS1_EMPHASIS.lecture).not.toBe(PASS1_EMPHASIS.interview);
    expect(buildPass1Prompts('lecture', { chunkIndex: 0, totalChunks: 1, transcript: 'x' }, 'ja').system)
      .toContain(PASS1_EMPHASIS.lecture);
  });
  it('non-ja swaps the language word', () => {
    expect(buildPass1Prompts('meeting', { chunkIndex: 0, totalChunks: 1, transcript: 'x' }, 'en').system).toContain('English');
  });
});

describe('buildPass2Prompts', () => {
  it('instructs structure-only, no new info, concise title, split items (ja)', () => {
    const { system, userPrefix } = buildPass2Prompts('ja');
    expect(system).toContain('日本語');
    expect(system).toMatch(/title/i);
    expect(userPrefix.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lisna/desktop test two-pass-prompts`
Expected: FAIL ("Cannot find module '../two-pass-prompts'").

- [ ] **Step 3: Write the implementation**

```typescript
import type { ChunkContext } from './prompts';
import type { NoteFamily, NoteLanguage } from '@shared/note-schema';

const LANG_WORD: Record<NoteLanguage, string> = { ja: '日本語', en: 'English', ko: '한국어' };

/** Per-family one-line emphasis for the free-prose pass — what to foreground.
 *  The grounding/JA/no-JSON rules are shared (see SYSTEM below). */
export const PASS1_EMPHASIS: Record<NoteFamily, string> = {
  lecture: 'この回で説明された概念・用語・例を、教わった順に分かりやすくまとめてください。',
  meeting: '誰が何を主張し、どんな論点・決定・宿題が出たかが分かるようにまとめてください。',
  interview: '質問と回答の流れ（誰が何を尋ね、どう答えたか）が分かるようにまとめてください。',
  brainstorm: '出されたアイデアと、その背景・賛否・発展が分かるようにまとめてください。',
};

/** Pass-1: free JA prose (NO grammar). The grounding step. */
export function buildPass1Prompts(
  family: NoteFamily,
  ctx: ChunkContext,
  language: NoteLanguage,
): { system: string; user: string } {
  const L = LANG_WORD[language];
  const system = `あなたは会話・講義の記録者です。文字起こしの一部を読み、${L}の散文で内容を要約します。

# 最重要ルール (違反した出力は破棄され、やり直しになります)
- 必ず${L}で書くこと。英語の文や見出しを書いてはいけません（人名・社名・専門用語の原語表記のみ可）。
- 文字起こしに実際に出てきた内容だけを書くこと。推測・新情報・一般論を加えてはいけません（捏造禁止）。
- JSON・記号・マークダウン・箇条書き記号は使わず、ふつうの文章で書くこと。

# この回で重視すること
- ${PASS1_EMPHASIS[family]}`;
  const user = `パート ${ctx.chunkIndex + 1}/${ctx.totalChunks}

文字起こし:
${ctx.transcript}

上の文字起こしの内容を${L}の散文で要約してください。`;
  return { system, user };
}

/** Pass-2: structure the pass-1 prose into the family JSON (grammar enforces shape). */
export function buildPass2Prompts(language: NoteLanguage): { system: string; userPrefix: string } {
  const L = LANG_WORD[language];
  const system = `あなたは${L}の要約を、指定されたJSON構造に変換するアシスタントです。

# 最重要ルール
- 入力の${L}の要約に書かれている内容だけを使うこと。新しい情報や英語への翻訳を加えてはいけません。
- 出力の文字列値は必ず${L}にすること。
- title は内容を表す簡潔な1行にすること。要約全体を title に入れてはいけません。
- 質疑・議論・アイデアなどの配列は、項目ごとに1要素に分割すること（1要素に複数を詰め込まない）。
- 文字起こしに無い数値・時刻を作らないこと（ts は不明なら 0）。
- 指定されたJSONスキーマに厳密に従うこと。`;
  const userPrefix = `以下の${L}の要約を、指定スキーマのJSONに構造化してください。`;
  return { system, userPrefix };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lisna/desktop test two-pass-prompts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/families/util/two-pass-prompts.ts desktop/src/shared/families/util/__tests__/two-pass-prompts.test.ts
git commit -m "feat(v2): 2-pass prompt builder (free-prose pass-1 + structure pass-2)"
```

---

### Task 2: new retry constants + a string-language guard helper

**Files:**
- Modify: `desktop/src/main/sidecar/orchestrator.ts` (near the existing constants ~346-353)

- [ ] **Step 1: Add constants (no test — pure consts, exercised by Task 3 tests)**

Add beside `POST_DECODE_SEED_OFFSET`:

```typescript
// ── 2-pass (per-chunk fabrication fix, 2026-06-14) ───────────────────────────
// pass-1 = free JA prose (grounds), pass-2 = structure under grammar. Bounded so
// 2h worst-case latency is predictable (spec §5): ≤2 pass-1 × ≤3 pass-2 = ≤8 gen/chunk.
const PASS1_MAX_ATTEMPTS = 2;          // fresh-seed pass-1 reseeds (ran-to-cap / lang-mismatch)
const PASS2_MAX_ATTEMPTS_PER_PROSE = 3; // pass-2 fresh-seed reseeds against one good prose
const MAX_GEN_PER_CHUNK = 8;            // hard ceiling across both passes
const PASS1_MAX_TOKENS = 1600;          // dense-chunk JA summary headroom (spec §3; spike sparse=376)
const PASS1_CAP_EPSILON = 16;           // tokensOut >= max-ε ⇒ ran-to-cap ⇒ retriable, never fed forward
const PASS1_SEED_OFFSET = 20000;        // distinct from pass-2 seed blocks (POST_DECODE_SEED_OFFSET=10000)
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/main/sidecar/orchestrator.ts
git commit -m "chore(v2): 2-pass retry/budget constants"
```

---

### Task 3: rewrite runChunkWithGrammar as bounded 2-pass

This is the core task. The implementer MUST keep the existing `RunChunkResult` shape, telemetry calls, and `CHUNK_FAILED:<i>:<reason>` semantics.

**Files:**
- Modify: `desktop/src/main/sidecar/orchestrator.ts` (`RunChunkOpts` ~155-190, `runChunkWithGrammar` ~226-332)
- Test: `desktop/src/main/sidecar/__tests__/orchestrator-runchunk.test.ts` (create)

- [ ] **Step 1: Change `RunChunkOpts` — swap the single prompt pair for 2-pass fields**

Replace the `systemPrompt` + `userPrompt` fields with:

```typescript
  /** Pass-1 (free-gen) prompts — from buildPass1Prompts. */
  pass1System: string;
  pass1User: string;
  /** Pass-2 (structure) prompts — from buildPass2Prompts. pass2User = `${pass2UserPrefix}\n\n${prose}`. */
  pass2System: string;
  pass2UserPrefix: string;
```

(`grammar`, `baseSeed`, `tuning`, `generator`, `transcriptForPostDecode`, `expectedLanguage`, `onTelemetry`, `fam`, `family`, `chunkIndex`, `totalChunks` stay.)

- [ ] **Step 2: Write the failing tests (mock generator drives the ladder)**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
// NOTE: runChunkWithGrammar is module-private. Export it for test
// (add `export` to the `async function runChunkWithGrammar`), or test via a
// thin finalize* path. Prefer exporting the function.
import { runChunkWithGrammar } from '../orchestrator';
import type { LlmGenerator } from '../grammar-call';

// A minimal family whose post-decode is identity-ish: build the smallest real
// family that runPostDecodePipeline accepts. Simplest: reuse the lecture family
// core (import '../../shared/families/lecture/core' + familyCoreRegistry).
import { familyCoreRegistry } from '../../../shared/families';
import '../../../shared/families/lecture/core';
import { adaptToV2Transcript } from '../../../shared/note-schema/adapt-legacy-transcript';

const fam = familyCoreRegistry['lecture']!;
const transcript = adaptToV2Transcript([{ startSec: 0, endSec: 5, text: '日本語のテスト発話です。' }], 't');
const baseOpts = {
  family: 'lecture' as const, fam: fam as never, chunkIndex: 0, totalChunks: 1,
  pass1System: 'sys1', pass1User: 'u1', pass2System: 'sys2', pass2UserPrefix: 'p2',
  grammar: 'root ::= "{}"', baseSeed: 5000,
  tuning: { temperature: 0.4, maxGenTokens: 2000 },
  transcriptForPostDecode: transcript, expectedLanguage: 'ja' as const,
};

// Build a valid lecture-note JSON string the grammar/post-decode will accept.
// (Use a real minimal LectureNote shape; fill required user-visible fields with JA.)
const VALID_LECTURE_JSON = JSON.stringify({ /* … minimal valid pre-postDecode lecture note … */ });

function gen(seq: Array<{ text: string; tokensOut: number }>): LlmGenerator {
  let i = 0;
  return vi.fn(async () => { const r = seq[Math.min(i, seq.length - 1)]!; i++; return { text: r.text, seed: 1, stats: { tokensOut: r.tokensOut, genMs: 10 } }; });
}

describe('runChunkWithGrammar 2-pass', () => {
  it('happy path: 1 pass-1 + 1 pass-2 = 2 generations', async () => {
    const generator = gen([
      { text: '日本語の要約です。十分な長さの文章をここに書きます。' + 'あ'.repeat(120), tokensOut: 300 }, // pass-1 prose
      { text: VALID_LECTURE_JSON, tokensOut: 400 },                                                          // pass-2 JSON
    ]);
    const r = await runChunkWithGrammar({ ...baseOpts, generator } as never);
    expect(r.validated).toBeDefined();
    expect((generator as any).mock.calls.length).toBe(2);
  });

  it('pass-1 ran-to-cap ⇒ pass-1 reseed, truncated prose never fed to pass-2', async () => {
    const generator = gen([
      { text: 'あ'.repeat(2000), tokensOut: PASS1_MAX_TOKENS }, // ran-to-cap pass-1 → reseed
      { text: '日本語の要約です。' + 'い'.repeat(120), tokensOut: 300 }, // good pass-1
      { text: VALID_LECTURE_JSON, tokensOut: 400 },
    ]);
    const r = await runChunkWithGrammar({ ...baseOpts, generator } as never);
    expect(r.validated).toBeDefined();
    expect((generator as any).mock.calls.length).toBe(3); // p1(cap) + p1(ok) + p2
  });

  it('pass-1 English ⇒ language guard reseeds pass-1', async () => {
    const generator = gen([
      { text: 'This is an English summary that is clearly not Japanese at all, well over one hundred characters long to clear the floor.', tokensOut: 300 },
      { text: '日本語の要約です。' + 'う'.repeat(120), tokensOut: 300 },
      { text: VALID_LECTURE_JSON, tokensOut: 400 },
    ]);
    const r = await runChunkWithGrammar({ ...baseOpts, generator } as never);
    expect(r.validated).toBeDefined();
    expect((generator as any).mock.calls.length).toBe(3);
  });

  it('pass-2 reseeds against the SAME prose before re-doing pass-1', async () => {
    const generator = gen([
      { text: '日本語の要約です。' + 'え'.repeat(120), tokensOut: 300 }, // pass-1 (ONCE)
      { text: 'not json', tokensOut: 50 },                                // pass-2 fail (reseed pass-2)
      { text: VALID_LECTURE_JSON, tokensOut: 400 },                       // pass-2 ok
    ]);
    const r = await runChunkWithGrammar({ ...baseOpts, generator } as never);
    expect(r.validated).toBeDefined();
    expect((generator as any).mock.calls.length).toBe(3); // p1 once, p2 twice — NOT a 2nd pass-1
  });

  it('total generations are capped at MAX_GEN_PER_CHUNK and then CHUNK_FAILED', async () => {
    const generator = gen([{ text: 'not json', tokensOut: 50 }]); // everything fails
    await expect(runChunkWithGrammar({ ...baseOpts, generator } as never)).rejects.toThrow(/CHUNK_FAILED:0:/);
    expect((generator as any).mock.calls.length).toBeLessThanOrEqual(8);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @lisna/desktop test orchestrator-runchunk`
Expected: FAIL (old single-pass signature; `runChunkWithGrammar` not exported / prompt fields renamed).

- [ ] **Step 4: Implement the 2-pass body**

Export the function and replace its body. New body (drop-in; preserves the `finally` telemetry block):

```typescript
export async function runChunkWithGrammar(opts: RunChunkOpts): Promise<RunChunkResult> {
  const chunkT0 = Date.now();
  let genUsed = 0;
  let innerAttemptsThisChunk = 0;
  let sanitizedThisChunk = 0;
  let outerAttemptsUsed = 0;
  let lastReason = 'no attempts run';

  try {
    for (let p1 = 0; p1 < PASS1_MAX_ATTEMPTS && genUsed < MAX_GEN_PER_CHUNK; p1++) {
      outerAttemptsUsed = p1 + 1;
      // ── PASS 1 — free JA prose (no grammar) ──
      opts.onTelemetry?.({ kind: 'attempt-start', family: opts.family, chunkIndex: opts.chunkIndex, totalChunks: opts.totalChunks, attempt: genUsed + 1, maxAttempts: MAX_GEN_PER_CHUNK, seed: opts.baseSeed + p1 * PASS1_SEED_OFFSET });
      const p1res = await opts.generator({ prompt: opts.pass1User, system: opts.pass1System, grammar: '', seed: opts.baseSeed + p1 * PASS1_SEED_OFFSET, temperature: opts.tuning.temperature, maxTokens: PASS1_MAX_TOKENS });
      genUsed++;
      const prose = p1res.text;
      const ranToCap = (p1res.stats?.tokensOut ?? 0) >= PASS1_MAX_TOKENS - PASS1_CAP_EPSILON;
      if (ranToCap) { lastReason = `PASS1_RAN_TO_CAP:${p1res.stats?.tokensOut}`; continue; }
      const mismatch = findLanguageMismatch(prose, opts.expectedLanguage);
      if (mismatch) { lastReason = `PASS1_LANGUAGE_MISMATCH:ratio=${mismatch.ratio.toFixed(3)}`; continue; }

      // ── PASS 2 — structure the prose under grammar (z.unknown + post-decode) ──
      const pass2User = `${opts.pass2UserPrefix}\n\n${prose}`;
      for (let p2 = 0; p2 < PASS2_MAX_ATTEMPTS_PER_PROSE && genUsed < MAX_GEN_PER_CHUNK; p2++) {
        const seed = opts.baseSeed + p1 * PASS1_SEED_OFFSET + (p2 + 1) * POST_DECODE_SEED_OFFSET;
        const result = await callWithGrammar<unknown>({
          prompt: pass2User, system: opts.pass2System, schema: z.unknown(), grammar: opts.grammar,
          baseSeed: seed, temperature: opts.tuning.temperature, maxAttempts: 1, maxTokens: opts.tuning.maxGenTokens,
          generator: opts.generator, expectedLanguage: opts.expectedLanguage,
        });
        genUsed++;
        const stats = emitGrammarAttempts(opts.onTelemetry, { family: opts.family, chunkIndex: opts.chunkIndex, totalChunks: opts.totalChunks, outerAttempt: p1 }, result.attempts);
        innerAttemptsThisChunk += stats.innerAttempts;
        sanitizedThisChunk += stats.sanitizedCount;
        if (!result.ok) { lastReason = result.finalReason; continue; } // reseed pass-2 vs SAME prose
        try {
          const validated = runPostDecodePipeline(JSON.stringify(result.value), opts.fam, opts.transcriptForPostDecode);
          return { validated, innerAttemptsTotal: innerAttemptsThisChunk, sanitizedTotal: sanitizedThisChunk };
        } catch (e) {
          if (e instanceof z.ZodError) { lastReason = `POST_DECODE_ZOD:${e.issues[0]?.message ?? '?'}`; continue; }
          throw e; // ForwardIncompat / Syntax — not retriable
        }
      }
      // pass-2 exhausted on this prose → fresh pass-1 (next p1)
    }
    throw new Error(`CHUNK_FAILED:${opts.chunkIndex}:${lastReason}`);
  } finally {
    opts.onTelemetry?.({ kind: 'chunk-done', family: opts.family, chunkIndex: opts.chunkIndex, totalChunks: opts.totalChunks, totalLatencyMs: Date.now() - chunkT0, outerAttempts: outerAttemptsUsed, totalAttempts: innerAttemptsThisChunk, freshSeedRetries: Math.max(0, outerAttemptsUsed - 1), sanitizedTotal: sanitizedThisChunk });
  }
}
```

Add imports at top of orchestrator if missing: `findLanguageMismatch` from `./grammar-call`. (`callWithGrammar`, `z`, `runPostDecodePipeline`, `emitGrammarAttempts` already imported.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @lisna/desktop test orchestrator-runchunk`
Expected: PASS (5/5). If `VALID_LECTURE_JSON` shape is wrong, fix it to a minimal valid pre-postDecode lecture note (inspect `runPostDecodePipeline` + lecture schema for required emitted fields).

- [ ] **Step 6: Commit**

```bash
git add desktop/src/main/sidecar/orchestrator.ts desktop/src/main/sidecar/__tests__/orchestrator-runchunk.test.ts
git commit -m "feat(v2): per-chunk 2-pass in runChunkWithGrammar (bounded ladder + pass-1 guard)"
```

---

### Task 4: wire the 4 finalize* call sites to build 2-pass prompts

Each `finalize*` currently builds `systemPrompt = renderSystemTemplate(prompt.systemTemplate, lang)` and `userPrompt = prompt.chunkUserTemplate({...})` and passes them. Replace with the 2-pass builders. The chunk transcript render (`renderTranscriptWithSpeakers(chunks[i], activeTranscript.speakers)`) stays — it feeds pass-1.

**Files:**
- Modify: `desktop/src/main/sidecar/orchestrator.ts` — the chunk loops in `finalizeLecture` (~626), `finalizeMeeting` (~820), `finalizeInterview` (~980), `finalizeBrainstorm` (~1190).

- [ ] **Step 1: At the top of orchestrator, import the builders**

```typescript
import { buildPass1Prompts, buildPass2Prompts } from '@shared/families/util/two-pass-prompts';
```

- [ ] **Step 2: In EACH finalize* chunk loop, replace the prompt construction + the runChunkWithGrammar args**

For interview (apply the SAME shape to lecture/meeting/brainstorm, substituting the family literal + baseSeed already in place):

```typescript
    const rendered = renderTranscriptWithSpeakers(chunks[i]!, activeTranscript.speakers);
    const lang = args.language ?? 'ja';
    const p1 = buildPass1Prompts('interview', { chunkIndex: i, totalChunks: chunks.length, transcript: rendered }, lang);
    const p2 = buildPass2Prompts(lang);

    const chunkResult = await runChunkWithGrammar({
      family: 'interview',
      fam,
      chunkIndex: i,
      totalChunks: chunks.length,
      pass1System: p1.system,
      pass1User: p1.user,
      pass2System: p2.system,
      pass2UserPrefix: p2.userPrefix,
      grammar,
      baseSeed: 7000 + i,           // lecture 5000+i / meeting 6000+i / brainstorm 8000+i (unchanged per family)
      tuning,
      generator,
      transcriptForPostDecode: activeTranscript,  // lecture/brainstorm use args.transcript (unchanged)
      expectedLanguage: lang,
      onTelemetry: args.onTelemetry,
    });
```

Delete the now-unused `systemPrompt`/`userPrompt`/`renderSystemTemplate(prompt.systemTemplate,…)`/`prompt.chunkUserTemplate(…)` lines in each loop. `prompt.version` is still used by `applyGeneratedMeta` post-merge — keep the `prompt` variable; only its per-chunk templating is removed. If `renderSystemTemplate` becomes unused after all four, remove its import (lint will flag — `pitfalls.md pre-push-lint`).

- [ ] **Step 3: Typecheck + run the full existing finalize* test suite**

Run: `pnpm --filter @lisna/desktop typecheck && pnpm --filter @lisna/desktop test orchestrator`
Expected: typecheck clean. Existing finalize* tests that asserted on the OLD single-pass prompt shape will need their mock generators updated to return a pass-1 prose THEN a JSON (two responses per chunk). Update those mocks (don't weaken assertions). Expected: PASS.

- [ ] **Step 4: Lint**

Run: `pnpm --filter @lisna/desktop lint`
Expected: 0 errors (fix any now-unused import/var).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/sidecar/orchestrator.ts desktop/src/main/sidecar/__tests__/
git commit -m "feat(v2): wire all 4 finalize* to per-chunk 2-pass prompts"
```

---

### Task 5: telemetry pass-attribution (optional fields, non-breaking)

So the finalize progress UI (#122) + eval can see pass-1 vs pass-2 cost. Keep additive (don't break existing event consumers).

**Files:**
- Modify: `desktop/src/main/sidecar/orchestrator.ts` (the `attempt-start` emit in Task 3) + the `FinalizeTelemetryEvent` type (grep for its definition).

- [ ] **Step 1: Add an optional `pass?: 1 | 2` to the `attempt-start` event type** (find `FinalizeTelemetryEvent` / `attempt-start` union member; add `pass?: 1 | 2`).
- [ ] **Step 2: In `runChunkWithGrammar`, tag the pass-1 `attempt-start` with `pass: 1`; add a `pass: 2` attempt-start before each pass-2 `callWithGrammar` (mirror the existing onAttemptStart pattern).**
- [ ] **Step 3: Typecheck + test** — `pnpm --filter @lisna/desktop typecheck && pnpm --filter @lisna/desktop test orchestrator`. Expected PASS (existing consumers ignore the optional field).
- [ ] **Step 4: Commit** — `git commit -am "feat(v2): telemetry attributes pass-1 vs pass-2 per chunk"`

---

### Task 6: full desktop verify

- [ ] **Step 1:** `pnpm --filter @lisna/desktop typecheck` → clean.
- [ ] **Step 2:** `pnpm --filter @lisna/desktop test` → all green (note the count).
- [ ] **Step 3:** `pnpm --filter @lisna/desktop lint` → 0 errors.
- [ ] **Step 4:** If anything fails, fix and re-run the FULL command (no partial-run claims — `superpowers:verification-before-completion`).

---

### Task 7: fold the fabrication-culprit rationale onto mainline

The proof that grammar (not sampler) is the culprit lives ONLY in the `sampler-alignment` worktree (`desktop/docs/superpowers/decisions/2026-06-12-fabrication-culprit.md`), not on `main`. The spec references it; put the premise on-record.

- [ ] **Step 1:** Copy that decision doc (or a faithful 1-page summary of its B-vs-R5 single-variable isolation) to `docs/superpowers/decisions/2026-06-12-fabrication-culprit.md` on this branch. Do NOT invent results — copy the real file from the worktree (`.claude/worktrees/sampler-alignment/desktop/docs/superpowers/decisions/2026-06-12-fabrication-culprit.md`) if present; else summarize only what the spec already states.
- [ ] **Step 2:** Commit — `git add docs/superpowers/decisions/ && git commit -m "docs(v2): land fabrication-culprit rationale on mainline (2-pass premise)"`

---

### Task 8 (CONTROLLER): brainstorm extractClaims dead-field fix (folded-in chip)

`desktop/eval/judges/faithfulness-judge.ts:97-100` has a dead `conclusions` field + is MISSING `subject_summary`/`themes`/`key_takeaways`/`parking_lot` for brainstorm. Correct extracted set = `{subject_summary, themes, key_takeaways, idea_clusters, parking_lot}`.

- [ ] **Step 1:** Read `faithfulness-judge.ts:80-120` + the brainstorm schema (`src/shared/families/brainstorm/schema.ts`) to confirm the real field names.
- [ ] **Step 2:** Fix `extractClaims` for brainstorm to pull the correct fields; add/adjust a unit test asserting the extracted claim set.
- [ ] **Step 3:** `pnpm --filter @lisna/desktop test faithfulness` → PASS. Commit — `git commit -am "fix(eval): brainstorm faithfulness-judge extracts correct fields"`.

---

### Task 9 (CONTROLLER): real-3B ≥8-chunk e2e validation gate (BLOCKING before PR merge)

The 1-chunk spike + synthetic unit tests do NOT jointly substitute. **FOREGROUND only** (real LLM — `pitfalls.md spike-llm`; `pgrep lisna_sidecar` before + after; `pkill -9 -f llama-completion` cleanup).

- [ ] **Step 1:** Pick a REAL ≥8-chunk (≥30-40 min) JA conversation. Either an existing dump under `~/Library/Application Support/@lisna/desktop/sessions/`, the `long-84min-ja` fixture (in `.claude/worktrees/lecture-consolidation`, lecture), OR record one via `pnpm --filter @lisna/desktop dev` (`feedback_recording_via_desktop_app`).
- [ ] **Step 2:** Write an ad-hoc `desktop/scripts/_2pass-e2e.mts` (untracked, delete after) that runs the chosen family's `finalize*` through the REAL bespoke sidecar (`resources/sidecar`) + real 3B (model `/Users/guntak/.lisna-test-models/...`), diarizationStatus 'disabled', and reports per-chunk pass-1/pass-2 outcomes + merged jaRatio/groundingJa/parseOk + total gen/chunk.
- [ ] **Step 3:** ACCEPTANCE: no `CHUNK_FAILED`; merged jaRatio ≥0.5; groundingJa ≥0.6; schema.parse OK; gen/chunk ≤ MAX_GEN_PER_CHUNK; no zombie sidecar after. Record numbers in the loop memory.
- [ ] **Step 4 (if founder greenlit, see decision brief):** repeat Step 2-3 with the ALIGNED sidecar (`.claude/worktrees/sampler-alignment/desktop/resources/sidecar`) and record the latency delta (the ~2× speed lever).
- [ ] **Step 5:** Delete the ad-hoc script. Verify `pgrep lisna_sidecar` empty.

---

### Final: independent review + finish

- [ ] Dispatch the final independent code reviewer (opus, ≠author) over the whole branch — correctness/security/data-loss only.
- [ ] Independent 2h-feasibility expert review (loop gate): does the e2e evidence + bounded ladder genuinely handle 2h on 8GB?
- [ ] Use `superpowers:finishing-a-development-branch`. Pre-push gate fires → spawn the independent prepush reviewer (runs desktop typecheck+test, writes the JSON marker) → push → open PR → ci+desktop-ci green → auto-merge (founder session grant). NEVER `--no-verify`, never hand-write the marker.
- [ ] Consolidated WRAP PushNotification to founder: 2-pass shipped + e2e numbers + the latency/sampler decision (adopt aligned, or defer).

---

## Self-review (against the spec)

- **Spec §2 (insertion layer):** Task 3 (runChunkWithGrammar) + Task 4 (4 finalize*). ✓
- **§3 (pass-1 free-gen + maxTokens 1600 + ran-to-cap):** Task 2 (consts) + Task 3 (ran-to-cap branch). ✓
- **§3 finding B (pass-1 own language guard):** Task 3 (`findLanguageMismatch(prose, …)` → pass-1 reseed) + test. ✓
- **§4 (pass-2 z.unknown + full grammar + defenses):** Task 3 (callWithGrammar schema:z.unknown, existing defenses via callWithGrammar). ✓
- **§4 finding E (NO lighter grammar):** not built. ✓
- **§5 finding C (bounded retry ladder, pass-2-first):** Task 3 loop + `MAX_GEN_PER_CHUNK` + the "pass-2 reseeds same prose" test. ✓
- **§6 (timeout):** Task 9 e2e confirms dense pass-1 survives 60s no-progress (raise if it stalls). ✓ (validation, not code unless it stalls)
- **§7 (4 families):** Task 4. ✓
- **§8 (unit + e2e gate):** Task 3 tests + Task 9. ✓
- **§9 known limitation:** in founder brief (no code). ✓
- **§10 (latency/sampler):** Task 9 Step 4 + wrap. ✓
- **provenance:** Task 7. ✓
- **chip:** Task 8. ✓

Type-consistency check: `buildPass1Prompts(family, ctx, language)` / `buildPass2Prompts(language)` signatures match Task 1 ↔ Task 4 usage; `RunChunkOpts` fields `pass1System/pass1User/pass2System/pass2UserPrefix` match Task 1 ↔ Task 3 ↔ Task 4; constants from Task 2 used in Task 3. ✓

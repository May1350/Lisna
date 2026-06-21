# Extraction-Driven Meeting Note — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `finalizeMeeting`'s per-chunk-full-note + concat-merge path with the hardened-B pipeline — the on-device LLM does only LOCAL flat-atom extraction per chunk, CODE does GLOBAL assembly (union + field-specific dedup + DETERMINISTIC topic_arc/discussions synthesis + a deterministic executive_summary), and the eval coverage matcher is fixed so it scores atomized output fairly.

**Architecture:** Per chunk, the 3B emits a small flat-atom object (`decisions / action_items / key_figures / open_questions / risks`) under a small dedicated GBNF. A pure, unit-testable assembler unions those atoms, deduplicates with field-specific rules (key_figures by value+label anchor — never trigram; decisions/actions/questions/risks by content-anchor + trigram), synthesizes `topic_arc` + `discussions` deterministically from transcript transition-cues + ts-bucketing, and emits a deterministic `executive_summary`/`title`/`purpose`. The assembled note is routed once through the existing `runPostDecodePipeline` (fills `from` provenance, drops empties, validates) then `applyGeneratedMeta`. **No merge-LLM call. No LLM prose in Phase 1** (the LLM executive_summary is Phase 2). `finalizeMeeting`'s public signature is unchanged.

**Tech Stack:** TypeScript, Zod, Vitest, the existing `desktop/` sidecar/post-decode/eval stack. Llama-3.2-3B-Q4 via the existing grammar-call sidecar (production only; all tests mock the generator/sidecar).

## Global Constraints

- **On-device, ≤5 min finalize, 8 GB RAM, small model only.** No cloud, no 7B+. (Design spec `docs/superpowers/specs/2026-06-21-on-device-note-quality-design.md`.)
- **`finalizeMeeting` signature is FROZEN:** `export async function finalizeMeeting(args: FinalizeMeetingArgs): Promise<FinalizeMeetingResult>`. `FinalizeMeetingArgs` and `FinalizeMeetingResult` do not change.
- **`MeetingNoteSchema` is FROZEN** (`desktop/src/shared/families/meeting/schema.ts`). No new note fields, no schemaVersion bump. `key_figures` are woven into `discussions[].key_points` (the schema has no top-level figures field).
- **Layering:** `desktop/src/shared/**` MUST NOT import from `desktop/src/main/**`. The pure assembler/schema live in `shared/`; the LLM-calling extractor lives in `main/sidecar/`.
- **Never pre-fill `from` provenance.** `runPostDecodePipeline` → `fillProvenanceRecursive` only fills `from` on leaves where `from === undefined` AND the leaf has a text discriminator AND a numeric `ts`/`ts_start`. Pre-filling silently breaks provenance.
- **Tests mock the LLM. Implementer subagents MUST NOT run real Llama:** no `note-loop-run.ts`, no full `pnpm verify`/`pnpm test`, no `run_in_background` for any test. Scoped Vitest with explicit file paths only. The real on-device eval (Task 8) is run by the controller, foreground, serial, with a `pkill -9` zombie sweep after.
- **Verification per task:** `pnpm --filter @lisna/desktop run typecheck` (exit 0) + `pnpm --filter @lisna/desktop exec eslint <changed files>` (clean) + scoped `pnpm --filter @lisna/desktop exec vitest run <explicit test file(s)>` (0 failures). Eslint matters: `desktop-ci` gates on it and it catches unused imports/vars `tsc` ignores.
- **Conventional commits**, `type(scope): subject` ≤72 chars, one concern per commit, end body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Existing signatures this plan consumes (verified 2026-06-21)

- `zodToGbnf(schema: z.ZodType, rootName: string): string` — `desktop/src/shared/note-schema/zod-to-gbnf.ts:62`. Runtime GBNF from a Zod schema; skips `postDecodeOnly()`-marked fields.
- `callWithGrammar<T>(opts: GrammarCallOpts<T>): Promise<GrammarCallResult<T>>` — `desktop/src/main/sidecar/grammar-call.ts:368`. `opts`: `{ prompt, system?, schema, grammar, baseSeed, temperature, maxAttempts, maxTokens, generator, sampling?, expectedLanguage?, onAttemptStart? }`. Fresh seed per attempt = `baseSeed + (attempt-1)*100`. Success: `{ ok:true, value, attemptsUsed, attempts }`. Failure: `{ ok:false, finalReason, attempts }`. `schema: z.unknown()` in production (real parse deferred).
- `type LlmGenerator = (opts: { prompt; system?; grammar; seed; temperature; maxTokens; sampling? }) => Promise<{ text: string; seed: number; stats? }>` — `grammar-call.ts:14`.
- `makeSidecarGenerator(client: GrammarCapableSidecar): LlmGenerator` — `grammar-call.ts:461`. `finalizeMeeting` already builds `const generator = makeSidecarGenerator(args.sidecar)`.
- `runPostDecodePipeline(rawJson: string, family: FamilyCoreDefinition<NoteBase>, transcript: SessionTranscript): unknown` — `desktop/src/shared/post-decode/pipeline.ts:28`. 5 stages: JSON.parse → fill ids → `dropEmptyUserVisibleItems` → `fillProvenanceRecursive` → `family.schema.parse`. Returns the validated note. Mutates the parsed tree.
- `trigrams(text: string): Set<string>` — `desktop/src/shared/post-decode/deterministic-merge.ts:7`. NFKC + lowercase 3-grams; empty Set for strings <3 chars.
- `jaccard(a: Set<string>, b: Set<string>): number` — `deterministic-merge.ts:16`. Returns **1 when both sets are empty** (hazard for short strings — guard with a `size > 0` check).
- `dedupFitArray<T>(arr, keyFn, cap): { kept: T[]; stats }` — `desktop/src/shared/post-decode/cap-fit.ts:35`. Trigram jaccard ≥ 0.7 dedup then slice to cap; skips dedup when `keyFn(x)` < 3 chars.
- `collapseSpeakerRefsToZero(node: unknown): void` — `desktop/src/shared/post-decode/collapse-speaker-refs.ts:32`. In-place; zeroes every SpeakerRef field/array.
- `chunkTranscript(transcript, maxTokens, slackSec?): SessionTranscript[]` — `desktop/src/shared/note-schema/chunking.ts:59`.
- `SessionTranscript = { sessionId; speakers: Speaker[]; transcriptSegments: TranscriptSegment[] }`; `TranscriptSegment = { ts; endTs; text; speakerId; meta? }` — `desktop/src/shared/note-schema/transcript.ts`.
- `SpeakerRefSchema = z.number().int().nonnegative()` — `desktop/src/shared/note-schema/base.ts:29`.
- `ProvenanceSchema = postDecodeOnly(z.enum(['transcript','inferred']))` — `base.ts:25`.
- `MeetingNoteSchema` (`desktop/src/shared/families/meeting/schema.ts:16`) + `MEETING_ARRAY_CAPS` (same file). Required: `executive_summary`, `topic_arc`, `discussions`, `decisions`, `open_questions`, plus base `title`, `purpose`. Optional: `agenda`, `participants`, `proposals`, `risks_or_concerns`, `atmosphere`, `next_steps`, `conclusions`.
- `MeetingFamilyCore` (`desktop/src/shared/families/meeting/core.ts:7`) — used as the `family` arg to `runPostDecodePipeline`. Reachable via the family registry the orchestrator already imports.
- `finalizeMeeting` current body — `orchestrator.ts:979–1125`. Keep: diarization degrade (~1000-1005), `chunkTranscript` (~1008), `makeSidecarGenerator` (~1014), diarization sweep (~1079-1082), `applyGeneratedMeta` (~1089-1095), telemetry (~1097-1113), return (~1115-1124). Replace: the per-chunk `runChunkWithGrammar` loop (~1020-1060) and `deterministicMerge` + `consolidateMeetingNote` (~1062-1087).

---

## File Structure

| File | Responsibility |
|---|---|
| `desktop/src/shared/families/meeting/extract-schema.ts` (CREATE) | `MeetingExtractSchema` (flat atoms) + `ExtractedAtoms` type + per-chunk caps. Pure schema, no LLM, no `from`. |
| `desktop/src/shared/families/meeting/assemble.ts` (CREATE) | Pure assembler: field-specific dedup helpers, deterministic topic synthesis, `assembleMeetingNote()`. No LLM, no `import` from `main/`. The load-bearing unit. |
| `desktop/src/shared/families/meeting/__tests__/extract-schema.test.ts` (CREATE) | Schema parse/shape tests. |
| `desktop/src/shared/families/meeting/__tests__/assemble.test.ts` (CREATE) | Dedup (incl. number-trap fail-first regression), topic synthesis, full-assembly tests. |
| `desktop/src/main/sidecar/meeting-extract.ts` (CREATE) | `extractMeetingAtoms()` — builds the extract prompt + grammar, one `callWithGrammar` per chunk, validates against `MeetingExtractSchema`. |
| `desktop/src/main/sidecar/__tests__/meeting-extract.test.ts` (CREATE) | Extraction with a mocked `LlmGenerator`. |
| `desktop/src/main/sidecar/orchestrator.ts` (MODIFY `finalizeMeeting`) | Rewire: extract → assemble → `runPostDecodePipeline` → `applyGeneratedMeta`. |
| `desktop/src/main/sidecar/__tests__/meeting-orchestrator.test.ts` (MODIFY) | Update mocks to return flat atoms; assert synthesized note. |
| `desktop/eval/coverage.ts` (MODIFY meeting branch) | Anchor-containment matcher so atomized output scores fairly. |
| `desktop/eval/contract/families/meeting.ts` (MODIFY decisions-must-appear rule) | Same anchor matcher as `coverage.ts` (shared helper). |
| `desktop/eval/coverage.test.ts` (MODIFY) | Fail-first test for the atomized-vs-compound matcher. |

---

## Task 1: `MeetingExtractSchema` (flat-atom extraction schema)

**Files:**
- Create: `desktop/src/shared/families/meeting/extract-schema.ts`
- Test: `desktop/src/shared/families/meeting/__tests__/extract-schema.test.ts`

**Interfaces:**
- Produces: `MeetingExtractSchema` (Zod), `ExtractedAtoms = z.infer<typeof MeetingExtractSchema>`, and per-chunk caps `MAX_EXTRACT_*`. Each atom carries `ts?` (LLM-emitted, unreliable) and NO `from` (provenance is filled later on the assembled note, not on atoms).

- [ ] **Step 1: Write the failing test**

```ts
// desktop/src/shared/families/meeting/__tests__/extract-schema.test.ts
import { describe, it, expect } from 'vitest';
import { MeetingExtractSchema } from '../extract-schema';

describe('MeetingExtractSchema', () => {
  it('parses a full flat-atom object with all five arrays', () => {
    const parsed = MeetingExtractSchema.parse({
      title: 'Q3 全体会議',
      purpose: '四半期の進捗確認',
      decisions: [{ text: 'プロプランを3,480円に値上げする', made_by: 1, ts: 12 }],
      action_items: [{ task: '負荷試験をステージングで実施', owner: 2, due: '10月14日', ts: 30 }],
      key_figures: [{ label: 'MRR', value: '4,200万円', ts: 5 }],
      open_questions: [{ text: '英語版の出荷時期は？', asked_by: 3, ts: 40 }],
      risks: [{ text: 'バックエンドの負荷が懸念', raised_by: 2, ts: 50 }],
    });
    expect(parsed.decisions).toHaveLength(1);
    expect(parsed.key_figures?.[0]?.value).toBe('4,200万円');
  });

  it('accepts empty arrays and omitted optional scalars', () => {
    const parsed = MeetingExtractSchema.parse({
      decisions: [], action_items: [], key_figures: [], open_questions: [], risks: [],
    });
    expect(parsed.title).toBeUndefined();
  });

  it('rejects a `from` field on atoms (provenance is post-decode only)', () => {
    expect(() =>
      MeetingExtractSchema.parse({
        decisions: [{ text: 'x', ts: 0, from: 'transcript' }],
        action_items: [], key_figures: [], open_questions: [], risks: [],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && pnpm exec vitest run src/shared/families/meeting/__tests__/extract-schema.test.ts`
Expected: FAIL — cannot resolve `../extract-schema`.

- [ ] **Step 3: Write minimal implementation**

```ts
// desktop/src/shared/families/meeting/extract-schema.ts
import { z } from 'zod';
import { SpeakerRefSchema } from '@shared/note-schema';

// Per-chunk caps — generous; the assembler caps the merged note to MEETING_ARRAY_CAPS.
export const MAX_EXTRACT_DECISIONS = 15;
export const MAX_EXTRACT_ACTION_ITEMS = 15;
export const MAX_EXTRACT_KEY_FIGURES = 20;
export const MAX_EXTRACT_OPEN_QUESTIONS = 15;
export const MAX_EXTRACT_RISKS = 15;

/**
 * Flat per-chunk extraction atoms. Deliberately simple so the 3B can emit it
 * reliably under a small GBNF (the 3B's strength is local extraction). NO `from`
 * provenance (filled later on the assembled note by runPostDecodePipeline). `ts`
 * is the LLM's best guess and is often 0 — the assembler anchors atoms to the
 * chunk's ts-range when ts is unreliable.
 */
export const MeetingExtractSchema = z
  .object({
    title: z.string().min(1).optional(),
    purpose: z.string().min(1).optional(),
    decisions: z
      .array(z.object({ text: z.string().min(1), made_by: SpeakerRefSchema.optional(), ts: z.number().nonnegative().optional() }))
      .max(MAX_EXTRACT_DECISIONS),
    action_items: z
      .array(z.object({ task: z.string().min(1), owner: SpeakerRefSchema.optional(), due: z.string().min(1).optional(), ts: z.number().nonnegative().optional() }))
      .max(MAX_EXTRACT_ACTION_ITEMS),
    key_figures: z
      .array(z.object({ label: z.string().min(1), value: z.string().min(1), ts: z.number().nonnegative().optional() }))
      .max(MAX_EXTRACT_KEY_FIGURES),
    open_questions: z
      .array(z.object({ text: z.string().min(1), asked_by: SpeakerRefSchema.optional(), ts: z.number().nonnegative().optional() }))
      .max(MAX_EXTRACT_OPEN_QUESTIONS),
    risks: z
      .array(z.object({ text: z.string().min(1), raised_by: SpeakerRefSchema.optional(), ts: z.number().nonnegative().optional() }))
      .max(MAX_EXTRACT_RISKS),
  })
  .strict();

export type ExtractedAtoms = z.infer<typeof MeetingExtractSchema>;
```

Note: `@shared/note-schema` re-exports `SpeakerRefSchema` (confirm the barrel exports it; if not, import from `@shared/note-schema/base`). The five arrays are required (the LLM always emits the key, possibly `[]`) → a stable grammar shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && pnpm exec vitest run src/shared/families/meeting/__tests__/extract-schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: typecheck + lint + commit**

```bash
cd desktop && pnpm run typecheck && pnpm exec eslint src/shared/families/meeting/extract-schema.ts src/shared/families/meeting/__tests__/extract-schema.test.ts
cd /Users/guntak/Lisna && git add desktop/src/shared/families/meeting/extract-schema.ts desktop/src/shared/families/meeting/__tests__/extract-schema.test.ts
git commit -m "feat(note-quality): flat-atom MeetingExtractSchema for extraction-driven note

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: assembler dedup helpers + number-trap fail-first regression

**Files:**
- Create: `desktop/src/shared/families/meeting/assemble.ts` (dedup helpers only this task)
- Test: `desktop/src/shared/families/meeting/__tests__/assemble.test.ts`

**Interfaces:**
- Consumes: `ExtractedAtoms` (Task 1); `trigrams`, `jaccard` from `@shared/post-decode/deterministic-merge`.
- Produces (exported for tests + Task 4):
  - `normalizeFigureValue(v: string): string` — strips `, 、 円` + spaces, full-width→ascii digits, KEEPS unit suffixes (`万`/`億`/`%`) so magnitude stays distinct.
  - `unionKeyFigures(perChunk: ReadonlyArray<ReadonlyArray<{label:string;value:string;ts?:number}>>): Array<{label:string;value:string;ts?:number}>` — dedup by `normLabel + '::' + normalizeFigureValue(value)`, first occurrence wins. NEVER trigram. Distinct numbers always survive.
  - `unionContentAtoms<T extends {text:string;ts?:number}>(perChunk: ReadonlyArray<ReadonlyArray<T>>, opts?: {threshold?: number}): T[]` — concat, then drop a later atom only if it shares a content anchor (a number token OR a proper-noun token) with an earlier kept atom AND question/text trigram jaccard ≥ threshold (default 0.8). Order-preserving.
  - `extractAnchors(text: string): { numbers: string[]; nouns: string[] }` — number tokens (`[0-9０-9][0-9０-9,\.，]*` incl. trailing `万/億/%/円`) + proper-noun-ish tokens (katakana runs ≥2, latin runs ≥2). Shared by `unionContentAtoms` and the coverage matcher (Task 7).

- [ ] **Step 1: Write the failing test** (number-trap regression FAIL-FIRST + dedup behavior)

```ts
// desktop/src/shared/families/meeting/__tests__/assemble.test.ts
import { describe, it, expect } from 'vitest';
import { dedupFitArray } from '@shared/post-decode/cap-fit';
import { normalizeFigureValue, unionKeyFigures, unionContentAtoms, extractAnchors } from '../assemble';

describe('unionKeyFigures — adversarial number traps survive dedup', () => {
  // The fixture exists to prove distinct figures are NEVER collapsed.
  const figs = [
    [{ label: 'MRR', value: '4,200万円' }, { label: 'MRR', value: '3,600万円' }],
    [{ label: 'MRR', value: '4,000万円' }, { label: 'Proプラン', value: '3,480円' }, { label: 'Proプラン', value: '3,800円' }],
  ];

  it('FAIL-FIRST: the naive trigram dedup (dedupFitArray on value text) WOULD collapse distinct numbers', () => {
    const flat = figs.flat();
    const { kept } = dedupFitArray(flat, (f) => `${f.label} ${f.value}`, 50);
    // Document the hazard: trigram 0.7 on "MRR 4,200万円"/"MRR 4,000万円" collapses them.
    expect(kept.length).toBeLessThan(flat.length);
  });

  it('value+label-keyed dedup keeps every distinct number', () => {
    const out = unionKeyFigures(figs);
    const values = out.map((f) => `${f.label}:${f.value}`).sort();
    expect(values).toEqual(
      ['MRR:3,600万円', 'MRR:4,000万円', 'MRR:4,200万円', 'Proプラン:3,480円', 'Proプラン:3,800円'].sort(),
    );
  });

  it('collapses only true duplicates (same label + same normalized value)', () => {
    const out = unionKeyFigures([[{ label: 'MRR', value: '4,200万円' }], [{ label: 'MRR', value: '4,200万' }]]);
    expect(out).toHaveLength(1);
  });

  it('normalizeFigureValue keeps magnitude (万) but strips separators/円', () => {
    expect(normalizeFigureValue('4,200万円')).toBe(normalizeFigureValue('4200万'));
    expect(normalizeFigureValue('4,200')).not.toBe(normalizeFigureValue('4,200万'));
  });
});

describe('unionContentAtoms — content-anchor + trigram', () => {
  it('dedups a decision restated across a chunk boundary', () => {
    const out = unionContentAtoms([
      [{ text: 'プロプランを3,480円に値上げする', ts: 10 }],
      [{ text: 'プロプランを3,480円に値上げすることに決定', ts: 11 }],
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps two decisions that differ by number even if wording overlaps', () => {
    const out = unionContentAtoms([
      [{ text: '解約9社をウィンバックする', ts: 10 }],
      [{ text: '解約14社をウィンバックする', ts: 60 }],
    ]);
    expect(out).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && pnpm exec vitest run src/shared/families/meeting/__tests__/assemble.test.ts`
Expected: FAIL — cannot resolve `../assemble` (and once stubbed, the value+label test fails until implemented). The FAIL-FIRST naive-dedup test must PASS immediately (it proves the hazard on existing `dedupFitArray`); if it does not collapse, adjust the trap values until it empirically collapses, so the regression has teeth.

- [ ] **Step 3: Write minimal implementation**

```ts
// desktop/src/shared/families/meeting/assemble.ts  (dedup helpers — topic synthesis + assembleMeetingNote added in Tasks 3-4)
import { trigrams, jaccard } from '@shared/post-decode/deterministic-merge';

const toAsciiDigits = (s: string): string =>
  s.replace(/[０-９]/g, (d) => String('０１２３４５６７８９'.indexOf(d)));

/** Strip separators + 円, normalize digits, KEEP unit suffixes (万/億/%) so
 *  4,200 and 4,200万 stay distinct. */
export function normalizeFigureValue(v: string): string {
  return toAsciiDigits(v).replace(/[,，、\s円]/g, '');
}

const normLabel = (s: string): string => toAsciiDigits(s).replace(/\s/g, '').toLowerCase();

export function unionKeyFigures<T extends { label: string; value: string; ts?: number }>(
  perChunk: ReadonlyArray<ReadonlyArray<T>>,
): T[] {
  const byKey = new Map<string, T>();
  for (const chunk of perChunk) {
    for (const f of chunk) {
      const key = `${normLabel(f.label)}::${normalizeFigureValue(f.value)}`;
      if (!byKey.has(key)) byKey.set(key, f);
    }
  }
  return [...byKey.values()];
}

const NUM_RE = /[0-9][0-9,，.．]*(?:万|億|%|％|円)?/g;
const KATA_RE = /[ァ-ヴー]{2,}/g;
const LATIN_RE = /[A-Za-z][A-Za-z0-9]{1,}/g;

export function extractAnchors(text: string): { numbers: string[]; nouns: string[] } {
  const t = toAsciiDigits(text);
  const numbers = (t.match(NUM_RE) ?? []).map((n) => n.replace(/[,，.．]/g, ''));
  const nouns = [...(text.match(KATA_RE) ?? []), ...(text.match(LATIN_RE) ?? [])].map((s) => s.toLowerCase());
  return { numbers, nouns };
}

/** Concat then drop a later atom only when it shares an anchor (number OR noun)
 *  with an earlier kept atom AND text trigram jaccard >= threshold. */
export function unionContentAtoms<T extends { text: string; ts?: number }>(
  perChunk: ReadonlyArray<ReadonlyArray<T>>,
  opts?: { threshold?: number },
): T[] {
  const threshold = opts?.threshold ?? 0.8;
  const kept: Array<{ atom: T; grams: Set<string>; anchors: ReturnType<typeof extractAnchors> }> = [];
  for (const chunk of perChunk) {
    for (const atom of chunk) {
      const grams = trigrams(atom.text);
      const anchors = extractAnchors(atom.text);
      const dup = kept.some((k) => {
        const sharesAnchor =
          anchors.numbers.some((n) => k.anchors.numbers.includes(n)) ||
          anchors.nouns.some((n) => k.anchors.nouns.includes(n));
        return sharesAnchor && grams.size > 0 && k.grams.size > 0 && jaccard(grams, k.grams) >= threshold;
      });
      if (!dup) kept.push({ atom, grams, anchors });
    }
  }
  return kept.map((k) => k.atom);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && pnpm exec vitest run src/shared/families/meeting/__tests__/assemble.test.ts`
Expected: PASS (all `describe` blocks above).

- [ ] **Step 5: typecheck + lint + commit**

```bash
cd desktop && pnpm run typecheck && pnpm exec eslint src/shared/families/meeting/assemble.ts src/shared/families/meeting/__tests__/assemble.test.ts
cd /Users/guntak/Lisna && git add desktop/src/shared/families/meeting/assemble.ts desktop/src/shared/families/meeting/__tests__/assemble.test.ts
git commit -m "feat(note-quality): field-specific dedup + number-trap regression (assemble)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: deterministic topic synthesis (boundaries + atom assignment)

**Files:**
- Modify: `desktop/src/shared/families/meeting/assemble.ts` (add topic-synthesis functions)
- Modify: `desktop/src/shared/families/meeting/__tests__/assemble.test.ts` (add synthesis tests)

**Interfaces:**
- Consumes: `SessionTranscript` / `TranscriptSegment` from `@shared/note-schema`.
- Produces (exported):
  - `detectTopicBoundaries(transcript: SessionTranscript, opts?: {target?: number}): Array<{ ts: number; label: string }>` — scans segments in ts order for transition cues; seeds a boundary at each cue with the label = trimmed text after the cue (fallback: the segment text head). If fewer than 3 boundaries found, fall back to even ts-bucketing into `target` (default 6) buckets labelled by the most frequent katakana/latin anchor in each bucket (fallback `議題N`). Always returns ≥1 boundary; caps at 7.
  - `assignToTopics<T extends { ts?: number }>(atoms: ReadonlyArray<{ atom: T; fallbackTs: number }>, boundaries: Array<{ts:number;label:string}>): Map<number, T[]>` — bucket each atom into the boundary index whose `[ts_i, ts_{i+1})` contains `atom.ts ?? fallbackTs`.

- [ ] **Step 1: Write the failing test**

```ts
// append to assemble.test.ts
import { detectTopicBoundaries, assignToTopics } from '../assemble';
import type { SessionTranscript } from '@shared/note-schema';

const seg = (ts: number, text: string, speakerId = 0) => ({ ts, endTs: ts + 5, text, speakerId });
const tx = (segs: ReturnType<typeof seg>[]): SessionTranscript => ({ sessionId: 's', speakers: [{ id: 0 }], transcriptSegments: segs });

describe('detectTopicBoundaries', () => {
  it('seeds boundaries on transition cues', () => {
    const b = detectTopicBoundaries(tx([
      seg(0, '料金改定について話します'),
      seg(60, '次は、解約対策の議題です'),
      seg(120, '続いて、英語版の開発状況'),
    ]));
    expect(b.length).toBeGreaterThanOrEqual(2);
    expect(b.map((x) => x.ts)).toContain(60);
  });

  it('falls back to even ts-buckets when no cues found', () => {
    const b = detectTopicBoundaries(tx([seg(0, 'aaa'), seg(50, 'bbb'), seg(100, 'ccc'), seg(150, 'ddd')]), { target: 2 });
    expect(b.length).toBe(2);
    expect(b[0]!.ts).toBe(0);
  });

  it('never returns more than 7 topics', () => {
    const segs = Array.from({ length: 20 }, (_, i) => seg(i * 30, `次は議題${i}`));
    expect(detectTopicBoundaries(tx(segs)).length).toBeLessThanOrEqual(7);
  });
});

describe('assignToTopics', () => {
  it('buckets atoms by ts into the containing boundary range', () => {
    const boundaries = [{ ts: 0, label: 'A' }, { ts: 100, label: 'B' }];
    const m = assignToTopics([
      { atom: { ts: 10 }, fallbackTs: 10 },
      { atom: { ts: 150 }, fallbackTs: 150 },
      { atom: { ts: 0 }, fallbackTs: 55 }, // ts unreliable(0) → fallbackTs used? ts=0 is a real value here → topic 0
    ], boundaries);
    expect(m.get(0)).toHaveLength(2); // ts 10 and ts 0
    expect(m.get(1)).toHaveLength(1); // ts 150
  });
});
```

Note on `ts` vs `fallbackTs`: treat `atom.ts` as authoritative only when `> 0`; when `0`/undefined use `fallbackTs` (the chunk-range midpoint, supplied by Task 4). Encode that rule inside `assignToTopics` (`const t = atom.ts && atom.ts > 0 ? atom.ts : fallbackTs;`) and adjust the third case's expectation to match your final rule — the test must reflect the implemented rule exactly.

- [ ] **Step 2: Run test to verify it fails** — `vitest run …/assemble.test.ts` → FAIL (functions undefined).

- [ ] **Step 3: Write minimal implementation** (append to `assemble.ts`)

```ts
import type { SessionTranscript } from '@shared/note-schema';

const CUE_RE = /(?:次は|次に|続いて|それでは次|次の議題|最後に|まず|一つ目|二つ目|三つ目|では、)/;

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
  if (boundaries.length < 3) {
    // even ts-bucket fallback
    const t0 = segs[0]!.ts;
    const t1 = segs[segs.length - 1]!.endTs;
    const span = Math.max(1, t1 - t0);
    boundaries = Array.from({ length: target }, (_, i) => ({ ts: t0 + Math.floor((span * i) / target), label: `議題${i + 1}` }));
  }
  // de-dupe near-identical ts, cap at 7, keep order
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
```

- [ ] **Step 4: Run test to verify it passes** — adjust the `ts:0` expectation to your implemented rule, then `vitest run …/assemble.test.ts` → PASS.

- [ ] **Step 5: typecheck + lint + commit**

```bash
cd desktop && pnpm run typecheck && pnpm exec eslint src/shared/families/meeting/assemble.ts src/shared/families/meeting/__tests__/assemble.test.ts
cd /Users/guntak/Lisna && git add -u && git commit -m "feat(note-quality): deterministic topic-boundary synthesis (assemble)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `assembleMeetingNote()` — top-level pure assembler

**Files:**
- Modify: `desktop/src/shared/families/meeting/assemble.ts`
- Modify: `desktop/src/shared/families/meeting/__tests__/assemble.test.ts`

**Interfaces:**
- Consumes: `ExtractedAtoms` (Task 1), the dedup + synthesis helpers (Tasks 2-3), `MEETING_ARRAY_CAPS` from `./schema`.
- Produces: `assembleMeetingNote(chunkExtracts: ReadonlyArray<{ atoms: ExtractedAtoms; tsRange: [number, number] }>, transcript: SessionTranscript): Record<string, unknown>` — a `Partial<MeetingNote>`-shaped plain object WITHOUT `from`/system-meta (those are added by `runPostDecodePipeline` + `applyGeneratedMeta` in Task 6). Required output keys: `family:'meeting'`, `schemaVersion:1`, `title`, `purpose`, `executive_summary`, `topic_arc`, `discussions`, `decisions`, `open_questions`; plus `next_steps` (from action_items), `risks_or_concerns` (from risks). Arrays sliced to `MEETING_ARRAY_CAPS`.

Mapping rules (deterministic):
- `decisions` ← `unionContentAtoms(decisions per chunk)` → `{ text, ts: atom.ts ?? 0, made_by? }`.
- `next_steps` ← `unionContentAtoms(action_items, keyed on task)` → `{ text: task, owner?, due?, ts: atom.ts ?? 0 }`. (Map `action_items.task`→`text` first.)
- `open_questions` ← `unionContentAtoms` → `{ text, ts: atom.ts ?? 0, asked_by? }`.
- `risks_or_concerns` ← `unionContentAtoms` → `{ text, ts: atom.ts ?? 0, raised_by? }`.
- `key_figures` ← `unionKeyFigures` → woven into the matching discussion's `key_points` as `"${label}: ${value}"`.
- `topic_arc` / `discussions` ← `detectTopicBoundaries` + `assignToTopics` (atoms = decisions ∪ figures ∪ questions ∪ risks ∪ actions, each with `fallbackTs = midpoint of its chunk's tsRange`). One topic per non-empty bucket: `topic_arc[i] = { topic: label, ts, speakers_involved: uniq(made_by/owner/asked_by/raised_by) || [0] }`; `discussions[i] = { topic: label, ts_start: ts, ts_end?, summary: deterministicSummary, key_points: [decision texts… , "MRR: 4,200万円"…] }`.
- `executive_summary` (deterministic): `本会議では、${topicLabels.join('、')}について議論し、${nDecisions}件の決定と${nNextSteps}件の宿題を確認した。` (trim to non-empty; fallback `会議の記録` when no topics).
- `title` ← longest non-empty extract `title`, else first topic label, else `会議メモ`.
- `purpose` ← longest non-empty extract `purpose`, else `会議の記録`.
- Cap-fit: `.slice(0, MEETING_ARRAY_CAPS[field])` per array.

- [ ] **Step 1: Write the failing test**

```ts
// append to assemble.test.ts
import { assembleMeetingNote } from '../assemble';
import { MeetingNoteSchema } from '../schema';
import { runPostDecodePipeline } from '@shared/post-decode/pipeline';
import { MeetingFamilyCore } from '../core';

it('assembles a schema-valid MeetingNote from two chunks (round-trips through post-decode)', () => {
  const transcript = tx([seg(0, '料金改定について'), seg(80, '次は、解約対策です')]);
  const assembled = assembleMeetingNote(
    [
      { tsRange: [0, 60], atoms: MeetingExtractSchema.parse({
        title: 'Q3会議', purpose: '進捗確認',
        decisions: [{ text: 'プロプランを3,480円に値上げ', ts: 10 }],
        action_items: [{ task: '負荷試験を実施', owner: 1, ts: 20 }],
        key_figures: [{ label: 'MRR', value: '4,200万円', ts: 5 }],
        open_questions: [], risks: [],
      }) },
      { tsRange: [60, 140], atoms: MeetingExtractSchema.parse({
        decisions: [{ text: '解約9社をウィンバック', ts: 90 }],
        action_items: [], key_figures: [], open_questions: [{ text: '英語版は？', ts: 100 }], risks: [],
      }) },
    ],
    transcript,
  );
  expect(assembled.family).toBe('meeting');
  expect((assembled.decisions as unknown[]).length).toBe(2);
  expect((assembled.topic_arc as unknown[]).length).toBeGreaterThanOrEqual(1);
  expect(typeof assembled.executive_summary).toBe('string');
  // The assembled note (no `from`) must validate after runPostDecodePipeline fills provenance.
  const note = runPostDecodePipeline(JSON.stringify(assembled), MeetingFamilyCore, transcript);
  expect(() => MeetingNoteSchema.parse(note)).not.toThrow();
});
```

(Import `MeetingExtractSchema` at the top of the test file.)

- [ ] **Step 2: Run test to verify it fails** — `vitest run …/assemble.test.ts` → FAIL (`assembleMeetingNote` undefined).

- [ ] **Step 3: Write minimal implementation** — implement `assembleMeetingNote` per the mapping rules above, plus a private `deterministicSummary(label, atoms)` returning a non-empty JA string (e.g. `「${label}」について、決定${nDec}件・論点${nQ}件・宿題${nAct}件。`). Slice arrays to `MEETING_ARRAY_CAPS`. Do NOT set `from` on any item. Set `schemaVersion: 1` (overwritten later by `applyGeneratedMeta`).

- [ ] **Step 4: Run test to verify it passes** — `vitest run …/assemble.test.ts` → PASS. If `runPostDecodePipeline` rejects, inspect which required field/`from` is missing and fix the mapping (do NOT pre-fill `from`).

- [ ] **Step 5: typecheck + lint + commit**

```bash
cd desktop && pnpm run typecheck && pnpm exec eslint src/shared/families/meeting/assemble.ts src/shared/families/meeting/__tests__/assemble.test.ts
cd /Users/guntak/Lisna && git add -u && git commit -m "feat(note-quality): assembleMeetingNote — union+dedup+synthesis (pure)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `meeting-extract.ts` — per-chunk LLM extraction

**Files:**
- Create: `desktop/src/main/sidecar/meeting-extract.ts`
- Test: `desktop/src/main/sidecar/__tests__/meeting-extract.test.ts`

**Interfaces:**
- Consumes: `MeetingExtractSchema` (Task 1), `zodToGbnf`, `callWithGrammar`, `LlmGenerator`.
- Produces: `extractMeetingAtoms(opts: { chunk: SessionTranscript; generator: LlmGenerator; language: NoteLanguage; chunkIndex: number; totalChunks: number; speakers: Speaker[]; sampling?: SamplingParams; temperature?: number; }): Promise<{ atoms: ExtractedAtoms; tsRange: [number, number]; ok: boolean; reason?: string }>` — single grammar call; on failure returns `{ ok:false, atoms: <empty atoms>, tsRange }` (a failed chunk contributes nothing rather than losing the whole finalize). Also `buildMeetingExtractPrompt(chunkText: string, language: NoteLanguage): { system: string; user: string }`.

- [ ] **Step 1: Write the failing test** (mocked generator — NO real Llama)

```ts
// desktop/src/main/sidecar/__tests__/meeting-extract.test.ts
import { describe, it, expect } from 'vitest';
import { extractMeetingAtoms } from '../meeting-extract';
import type { LlmGenerator } from '../grammar-call';

const atomsJson = JSON.stringify({
  decisions: [{ text: 'プロプランを3,480円に値上げ', ts: 10 }],
  action_items: [], key_figures: [{ label: 'MRR', value: '4,200万円', ts: 5 }],
  open_questions: [], risks: [],
});
const mockGen = (): LlmGenerator => async (o) => ({ text: atomsJson, seed: o.seed, stats: { tokensOut: 50, genMs: 10 } });

describe('extractMeetingAtoms', () => {
  it('parses flat atoms from one chunk and reports the chunk ts-range', async () => {
    const r = await extractMeetingAtoms({
      chunk: { sessionId: 's', speakers: [{ id: 0 }], transcriptSegments: [{ ts: 0, endTs: 12, text: 'プロプランの料金を上げます', speakerId: 0 }] },
      generator: mockGen(), language: 'ja', chunkIndex: 0, totalChunks: 1, speakers: [{ id: 0 }],
    });
    expect(r.ok).toBe(true);
    expect(r.atoms.decisions).toHaveLength(1);
    expect(r.tsRange).toEqual([0, 12]);
  });

  it('returns ok:false with empty atoms when the model output is unparseable', async () => {
    const bad: LlmGenerator = async (o) => ({ text: 'not json', seed: o.seed });
    const r = await extractMeetingAtoms({
      chunk: { sessionId: 's', speakers: [{ id: 0 }], transcriptSegments: [{ ts: 0, endTs: 5, text: 'x', speakerId: 0 }] },
      generator: bad, language: 'ja', chunkIndex: 0, totalChunks: 1, speakers: [{ id: 0 }],
    });
    expect(r.ok).toBe(false);
    expect(r.atoms.decisions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `cd desktop && pnpm exec vitest run src/main/sidecar/__tests__/meeting-extract.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write minimal implementation** — build the extract grammar once via `zodToGbnf(MeetingExtractSchema, 'MeetingExtract')`; render the chunk transcript with a SMALL LOCAL renderer (do NOT import `renderTranscriptWithSpeakers` — it is file-local in `orchestrator.ts:1566` and importing it would create a circular dep, since the orchestrator imports `meeting-extract`). A local `renderChunk(chunk, speakers)` mapping each segment to `[${seg.ts}] [話者${seg.speakerId}] ${seg.text}` joined by newlines is sufficient. `buildMeetingExtractPrompt` returns a JA system (rules: この区間のみ; 数値・日付・固有名詞は文字起こしのとおり正確に、言い直しは最後の確定値; 雑談・休憩は除外; 決定/宿題(担当者)/数値/質問/リスクに分類; JSONのみ) + a user carrying the rendered transcript; call `callWithGrammar<unknown>({ prompt, system, schema: z.unknown(), grammar, baseSeed: 6000 + chunkIndex, temperature: temperature ?? 0.2, maxAttempts: 3, maxTokens: 2048, generator, sampling, expectedLanguage: language })`; on `ok`, `MeetingExtractSchema.parse(result.value)`; on any failure (call or parse) return empty atoms `{decisions:[],action_items:[],key_figures:[],open_questions:[],risks:[]}` with `ok:false`. Compute `tsRange = [segs[0].ts, segs.at(-1).endTs]` (or `[0,0]` if empty).

- [ ] **Step 4: Run test to verify it passes** — `vitest run …/meeting-extract.test.ts` → PASS (2 tests).

- [ ] **Step 5: typecheck + lint + commit**

```bash
cd desktop && pnpm run typecheck && pnpm exec eslint src/main/sidecar/meeting-extract.ts src/main/sidecar/__tests__/meeting-extract.test.ts
cd /Users/guntak/Lisna && git add desktop/src/main/sidecar/meeting-extract.ts desktop/src/main/sidecar/__tests__/meeting-extract.test.ts
git commit -m "feat(note-quality): per-chunk flat-atom meeting extraction (meeting-extract)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: rewire `finalizeMeeting`

**Files:**
- Modify: `desktop/src/main/sidecar/orchestrator.ts` (`finalizeMeeting` body, ~979-1125)
- Modify: `desktop/src/main/sidecar/__tests__/meeting-orchestrator.test.ts`

**Interfaces:**
- Consumes: `extractMeetingAtoms` (Task 5), `assembleMeetingNote` (Task 4), existing `runPostDecodePipeline`, `collapseSpeakerRefsToZero`, `applyGeneratedMeta`, `chunkTranscript`, `makeSidecarGenerator`.
- The public `finalizeMeeting` signature, `FinalizeMeetingArgs`, `FinalizeMeetingResult` are UNCHANGED.

New internal flow (replace lines ~1020-1088, keep the rest):
1. `const generator = makeSidecarGenerator(args.sidecar)` (already present ~1014 — keep).
2. Per chunk i: `const r = await extractMeetingAtoms({ chunk: chunks[i], generator, language: lang, chunkIndex: i, totalChunks: chunks.length, speakers: activeTranscript.speakers, sampling: args.modelProfile.sampling, temperature: tuning.temperature }); chunkExtracts.push({ atoms: r.atoms, tsRange: r.tsRange }); if (!r.ok) warnings.push(\`extract: chunk ${i} failed (${r.reason})\`);` Fire `args.onProgress?.({ phase:'chunk', chunkIndex:i, totalChunks })` and an `onTelemetry` chunk-done event (mirror the existing shape; extract is one attempt per chunk).
3. `args.onProgress?.({ phase: 'merge' })`.
4. `const assembled = assembleMeetingNote(chunkExtracts, activeTranscript)` (returns a mutable `Record<string, unknown>`).
5. Diarization sweep (KEEP semantics): if `args.diarizationStatus !== 'ok'` → `collapseSpeakerRefsToZero(assembled); delete assembled.participants;` and push the existing SINGLE_SPEAKER warning.
6. Attach warnings: `assembled.validation_warnings = [...existing, ...warnings]`.
7. `const validated = runPostDecodePipeline(JSON.stringify(assembled), fam, activeTranscript) as MeetingNote` — fills `from`, drops empties, runs `MeetingNoteSchema.parse`. (Replaces the old `consolidateMeetingNote` + `fam.schema.parse`. The assembler already cap-fits, so `.max()` won't throw.)
8. `applyGeneratedMeta(validated, { ... })` exactly as today (~1089-1095).
9. Telemetry (~1097-1113): keep the shape; `chunkCount = chunks.length`; drop merge-retry counters that no longer exist (set to 0 or omit). Return `{ note: validated, telemetry }`.

Remove: the `runChunkWithGrammar` call for meeting, the `buildPass1Prompts`/`buildPass2Prompts(lang,'meeting')` calls in `finalizeMeeting`, the `deterministicMerge` + `consolidateMeetingNote` calls. (Leave `meetingMergeStrategy` in `meeting/merge.ts` — interview/brainstorm patterns reference the type; just unused by meeting now. Leave the iter2 `two-pass-prompts.ts` changes — still used by interview/brainstorm.)

- [ ] **Step 1: Update the failing tests** — rewrite `meeting-orchestrator.test.ts` so `mockSidecar`'s `responses` are flat-atom JSON (matching `MeetingExtractSchema`) rather than full MeetingNote JSON. Keep the existing intents, retargeted:
  - dedup test → two chunks emit the same decision atom → assembled `note.decisions` has 1 entry.
  - diarization fallback (`status:'disabled'`) → `note.validation_warnings` contains the SINGLE_SPEAKER warning AND every `made_by`/`speakers_involved` is `0`.
  - single chunk → one extract call, valid note.
  - a chunk whose extract fails (bad JSON) → finalize still returns a valid note (no throw), with an `extract: chunk N failed` warning.
  Add a `makeAtomsJson(n)` helper. Each `it` asserts the produced `note` parses as a `MeetingNote` and has synthesized `topic_arc.length >= 1`.

- [ ] **Step 2: Run tests to verify they fail** — `cd desktop && pnpm exec vitest run src/main/sidecar/__tests__/meeting-orchestrator.test.ts` → FAIL (old flow).

- [ ] **Step 3: Implement the rewire** in `orchestrator.ts` per the flow above.

- [ ] **Step 4: Run tests to verify they pass** — `vitest run src/main/sidecar/__tests__/meeting-orchestrator.test.ts` → PASS. Then run the broader sidecar suite scoped to the touched files to catch regressions in interview/brainstorm/lecture finalize:
  `pnpm exec vitest run src/main/sidecar/__tests__/meeting-orchestrator.test.ts src/main/sidecar/__tests__/meeting-extract.test.ts src/shared/families/meeting/__tests__/`
  Expected: all PASS. (Do NOT run the whole suite — it pulls real-LLM round-trip tests.)

- [ ] **Step 5: typecheck + lint + commit**

```bash
cd desktop && pnpm run typecheck && pnpm exec eslint src/main/sidecar/orchestrator.ts src/main/sidecar/__tests__/meeting-orchestrator.test.ts
cd /Users/guntak/Lisna && git add -u && git commit -m "feat(note-quality): rewire finalizeMeeting to extract->assemble (hardened-B)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: coverage matcher fix (score atomized output fairly)

**Files:**
- Modify: `desktop/eval/coverage.ts` (meeting branch, lines ~52-55)
- Modify: `desktop/eval/contract/families/meeting.ts` (the gold-decisions-must-appear rule, ~43-63)
- Modify: `desktop/eval/coverage.test.ts`

**Interfaces:**
- SELF-CONTAINED in `desktop/eval/` — `desktop/eval/` has NO `@shared` imports today; do NOT pioneer an eval→app dependency for a 5-line regex. Add a small local `anchorsOf(text)` (numbers + katakana/latin tokens, same logic as Task 2's `extractAnchors`) inside `coverage.ts` (or a new `desktop/eval/anchor-match.ts` shared by `coverage.ts` + the contract rule). Duplicating the tiny regex is acceptable: scoring (eval) and assembly (app) are distinct concerns.
- Produces: a `meetingDecisionCaptured(goldText: string, note: any): boolean` helper used by BOTH `coverage.ts` and the contract rule. Rule: a gold decision is captured if EITHER (a) normalized-substring match against any `note.decisions[].text` / `note.next_steps[].text` (legacy fast-path), OR (b) ≥⅔ of the gold's anchors (numbers ∪ nouns) appear across the note haystack of `decisions ∪ next_steps ∪ discussions.key_points`. This scores atomized sub-facts fairly without rewriting fixtures.

- [ ] **Step 1: Write the failing test** (FAIL-FIRST — proves the current matcher under-scores atomized output)

```ts
// add to desktop/eval/coverage.test.ts
import { computeCoverage } from './coverage';

it('meeting coverage credits atomized decisions against a compound gold (anchor containment)', () => {
  const gold = { decisions: [{ text: 'プロプランを3,480円に値上げし、解約9社をウィンバックする', mustAppear: true }] } as any;
  const note = {
    decisions: [{ text: 'プロプランを3,480円に値上げする' }],
    next_steps: [{ text: '解約9社をウィンバックする' }],
    discussions: [],
  } as any;
  const cov = computeCoverage('meeting', note, gold);
  // OLD substring matcher → 0 (compound gold not a substring of either atom). NEW anchor matcher → 1.
  expect(cov.captured).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails** — `cd desktop && pnpm exec vitest run eval/coverage.test.ts` → FAIL (current matcher returns `captured: 0`).

- [ ] **Step 3: Implement the anchor matcher** — add `meetingDecisionCaptured` (legacy substring OR ≥⅔ anchor containment over the decisions ∪ next_steps ∪ discussions.key_points haystack) backed by a local `anchorsOf(text)` in `desktop/eval/`. Use it in `coverage.ts` meeting branch and in `meeting.ts`'s decisions-must-appear contract rule (both in `desktop/eval/`, so they can share the local helper).

- [ ] **Step 4: Run test to verify it passes** — `vitest run eval/coverage.test.ts` (+ `eval/contract/families.test.ts` if it covers meeting) → PASS. Confirm the existing coverage tests still pass.

- [ ] **Step 5: typecheck + lint + commit**

```bash
cd desktop && pnpm run typecheck && pnpm exec eslint eval/coverage.ts eval/contract/families/meeting.ts eval/coverage.test.ts
cd /Users/guntak/Lisna && git add -u && git commit -m "fix(note-quality): anchor-containment coverage matcher for atomized meeting notes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 (CONTROLLER-ONLY — NOT a subagent): on-device eval, baseline vs Phase 1

This step runs the REAL Llama-3.2-3B. It MUST be run by the controlling session, FOREGROUND, SERIAL, with a zombie sweep after each run. Never delegate to a subagent, never `run_in_background`.

- [ ] **Step 1: zombie pre-sweep** — `pgrep -fl "llama-completion|llama-cli|whisper-cli|desktop/resources/sidecar|vitest" || echo clean`.
- [ ] **Step 2: baseline run (iter2 prompts, current main of this branch BEFORE the rewire — optional if already recorded as 20/45).** Skip if the banked 20/45 is trusted.
- [ ] **Step 3: Phase 1 run** —
  `LISNA_LLM_MODEL_DIR="$HOME/.lisna-test-models" pnpm --filter @lisna/desktop exec tsx scripts/note-loop-run.ts "$(pwd)/desktop/eval/fixtures/meeting/q3-allhands-noisy-ja" phase1-b-flat`
- [ ] **Step 4: zombie post-sweep** — `pkill -9 -f "llama-completion|llama-cli|desktop/resources/sidecar" 2>/dev/null; pgrep -fl "llama|sidecar|vitest" || echo clean`.
- [ ] **Step 5: read `/tmp/lisna-note-eval/runs/phase1-b-flat/{note.json,scorecard.json}`**, score against the rubric (`note-quality-loop-detail-2026-06-21.md` §rubric), compare to the 20/45 baseline. Record: topic count (target ~6, was 22), number-trap survival, decision/figure capture (coverage now scores fairly), latency (target <5 min, was 5.5). Honest target: high-20s/low-30s (model-floor residual is expected per spec §7).

---

## Self-Review (run against the spec)

- **§4.1 chunk** — reuses `chunkTranscript` (Task 6 keeps it). ✓
- **§4.2 EXTRACT (flat atoms, small GBNF, single call, chat-template)** — Tasks 1 + 5. `expectedLanguage` guard + `callWithGrammar` chat-template path. ✓
- **§4.3 ASSEMBLE (union + field-specific dedup + deterministic topic_arc/discussions, route through runPostDecodePipeline for `from`)** — Tasks 2-4 + 6 step 7. ✓
- **§4.4 DERIVED PROSE** — deferred to Phase 2 per §10; Phase 1 ships a deterministic `executive_summary` (Task 4). ✓ (documented divergence, intentional)
- **§4.5 emit MeetingNote, drop iter3 + per-chunk-full-note** — Task 6 removes `runChunkWithGrammar`/`deterministicMerge`; iter3 was never on this branch (excluded from the iter2 commit). ✓
- **§5 dedup hardening (key_figures by value+label, NEVER trigram; decisions by anchor+trigram; fail-first number-trap fixture)** — Task 2. ✓
- **§6 eval + coverage matcher fix** — Task 7 + Task 8. ✓
- **§10 Phase 1 scope** — extract + assemble + rewire + coverage fix + number-trap regression: Tasks 1-7. ✓ (prose = Phase 2, LLM-grouping = Phase 3, both out of scope here.)

**Placeholder scan:** none — every task has concrete code or an exact mapping rule + exact commands.

**Type consistency:** `ExtractedAtoms` (Task 1) is the return type of `extractMeetingAtoms` (Task 5) and the input element of `assembleMeetingNote` (Task 4); `extractAnchors` (Task 2) is reused by the coverage matcher (Task 7); `assembleMeetingNote` output is consumed by `runPostDecodePipeline` (Task 6). Names verified consistent across tasks.

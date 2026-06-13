# Note Quality Eval — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing-but-never-aimed v2 note eval harness into a faithfulness-**gated**, coverage-**scored** instrument that catches the JA→English fabrication failure, by authoring a fail-first fabrication fixture, adding an answer-key (`facts[]` + `mustAppear`), a Claude-backed per-claim faithfulness gate judge, wiring interview/brainstorm into the offline runner (with the rig's anti-wedge warmup), and a hard scorecard gate.

**Architecture:** Build ON the harness, never rebuild. The on-device 3B generates the note → a cheap deterministic pre-pass (`jaRatio` language-flip + normalized-substring grounding, lifted from `scripts/note-quality-eval.ts::scoreNote`) fails fast on a language flip → a separate strong judge (Claude, Groq-70b fallback) returns per-claim verdicts (supported / unsupported / partial) against the fixture's authored `facts[]` → the scorecard hard-FAILs on any unsupported claim over tolerance OR a language flip, and SCOREs coverage (% of `mustAppear` answer-key points captured). Runner and judge never import each other.

**Tech Stack:** TypeScript (Node 20, ESM, `tsx`), Vitest 2, Zod 3, `@anthropic-ai/sdk` (already a dep), `openai` SDK pointed at Groq (already a dep), the real llama.cpp sidecar + Llama-3.2-3B-Instruct-Q4_K_M for the controller (foreground-only) tasks.

---

## 0. Before you start — read these (they hold the exact shapes this plan extends)

| File | Why |
|---|---|
| `docs/superpowers/specs/2026-06-13-note-quality-eval-design.md` | The spec. §4 is Phase 1; §6 is OUT. |
| `desktop/eval/fixtures/_schema.ts` | `FixtureGroundTruthSchema` — you ADD `facts[]` + `mustAppear` here. |
| `desktop/eval/runners/offline.ts` | The runner you wire interview/brainstorm into + port the warmup/primer. |
| `desktop/scripts/note-quality-eval.ts` lines 88-155 (`scoreNote`) + 200-235 (warmup/primer) | The deterministic pre-pass + the only sequence that unwedges the grammar call on 8GB. |
| `desktop/eval/judges/llm-judge.ts` | The Anthropic client pattern (`anth()`, `judgeViaAnthropic`) the new judge reuses. |
| `desktop/eval/judges/content-fidelity-judge.ts` | The JA judge prompt style + `__testOnly_parse*` test seam to mirror. |
| `desktop/eval/runners/single-fixture.ts` | Where the faithfulness judge + coverage get wired into `FixtureResult`. |
| `desktop/eval/scorecard.ts` + `scorecard.test.ts` | Where the GATE renders + the `__testOnly` test seam lives. |
| `desktop/eval/contract/families/interview.ts` (+ `meeting.ts`, `brainstorm.ts`, `lecture.ts`) | The `*-ground-truth-qa-coverage` rule you extend to emit a coverage %. |
| `desktop/eval/baseline/format.ts` | `FixtureResultSchema` — you add optional `faithfulness` + `coverage` here. |
| `.claude/rules/testing.md` (regression-fixture) + `.claude/rules/pitfalls.md` (spike-llm, llm-grammar, node-stream) | Fail-first is a hard gate; real-LLM eval is FOREGROUND-only. |

**Hard preconditions confirmed against the live tree (do not skip Task 0):**
- This worktree has **no `node_modules`** — nothing runs until `pnpm install`.
- `pnpm typecheck` is `tsc -p tsconfig.json` with `include: ["src/**/*"]`, and `pnpm lint` is `eslint src`. **Neither typechecks nor lints `desktop/eval/**` or `desktop/scripts/**`.** Type/lint drift in the eval code is caught ONLY by Vitest at runtime (the test files import the modules) — so every eval-side task ends by running its Vitest file, and the scoped typecheck in Task 1 is your only static net for the schema. Do not assume `pnpm verify` will catch an eval-side type error.
- Vitest is `^2` here (NOT 4) — the `pitfalls.md (vitest-discovery)` dist-duplication trap does not apply.
- `@anthropic-ai/sdk` and `openai` are already dependencies. **No new dependency is added by this plan.**

---

## 1. File Structure

Every file this plan creates or modifies, and its single responsibility.

### Created

| File | Responsibility |
|---|---|
| `desktop/eval/fixtures/interview/finance-fabrication-2spk/transcript.json` | The fail-first fixture transcript: a sparse JA accounting/finance interview that triggers the model's English-finance prior. |
| `desktop/eval/fixtures/interview/finance-fabrication-2spk/meta.json` | Meta for the fixture (family=interview, language=ja). |
| `desktop/eval/fixtures/interview/finance-fabrication-2spk/ground-truth.json` | The answer key: `facts[]` (every true claim) + `qaPairs` with `mustAppear`. |
| `desktop/eval/judges/faithfulness-judge.ts` | The faithfulness GATE judge: note + `facts[]` → per-claim verdicts (`supported`/`unsupported`/`partial`) + cited spans + overall verdict. Claude default, Groq-70b fallback. |
| `desktop/eval/judges/faithfulness-judge.test.ts` | Unit tests for the judge's response parser + judge-sanity (faithful→PASS / fabricated→FAIL) seam. |
| `desktop/eval/faithfulness-prepass.ts` | The deterministic pre-pass: `jaRatio` language-flip + normalized-substring grounding, lifted from `note-quality-eval.ts::scoreNote`. Pure, no LLM. |
| `desktop/eval/faithfulness-prepass.test.ts` | Unit tests for the pre-pass (flip detection + grounding). |
| `desktop/eval/coverage.ts` | `computeCoverage(family, note, groundTruth)` → `{ captured, total, ratio, missing[] }` over `mustAppear` answer-key points. Pure. |
| `desktop/eval/coverage.test.ts` | Unit tests for coverage over interview qaPairs + lecture key-terms. |

### Modified

| File | Change |
|---|---|
| `desktop/eval/fixtures/_schema.ts` | Add `facts: z.array(z.string()).optional()`; widen `qaPairs` item to include `mustAppear: z.boolean().optional()`; widen `expectedKeyTerms` to accept either `string[]` or `{ term, mustAppear? }[]`. |
| `desktop/eval/fixtures/_schema.test.ts` | Add cases for `facts[]` + `qaPairs.mustAppear` + key-term importance. |
| `desktop/eval/baseline/format.ts` | Add optional `faithfulness` + `coverage` fields to `FixtureResultSchema`. |
| `desktop/eval/runners/single-fixture.ts` | Wire the pre-pass + faithfulness judge + `computeCoverage` into `FixtureResult` (behind `skipLlmJudge` for the LLM half). |
| `desktop/eval/scorecard.ts` | Render the faithfulness PASS/FAIL gate + fabricated spans + coverage %; expose `__testOnly_gateVerdict`. |
| `desktop/eval/scorecard.test.ts` | Add gate-FAIL-on-unsupported, gate-FAIL-on-flip, coverage-render cases. |
| `desktop/eval/runners/offline.ts` | Remove the interview/brainstorm guard; call `finalizeInterview`/`finalizeBrainstorm`; replace the flat 10s `waitForReady` with the rig's warmup + plain-no-grammar primer + longer windows. |
| `desktop/eval/runners/offline.test.ts` | Update the unit assertion that interview/brainstorm throw `UNSUPPORTED_FAMILY_FOR_OFFLINE_RUNNER` (they no longer do). |
| `desktop/eval/contract/families/interview.ts` | Extend `interview-ground-truth-qa-coverage` to honour `mustAppear` and report the captured %. |
| `desktop/eval/contract/families/lecture.ts` | Add `lecture-ground-truth-keyterm-coverage` rule consuming `expectedKeyTerms` + `mustAppear`. |

**Not touched (Phase 2 / out of scope):** the F2 history viewer, `finalizeFromDump`, `note-quality-eval.ts` itself (we COPY its logic, we don't retire it), any `web/` or `src/renderer/` file, any new model/sidecar build.

---

## 2. Data flow (target state)

```
author fixture (transcript + answer key: facts[] + qaPairs{mustAppear})
        │
        └─► offline runner (warmup + plain primer) ─► real 3B finalizeInterview ─► note
                                   │
                                   ▼
   single-fixture.ts:
     ├─ faithfulness-prepass.ts  : jaRatio flip + substring grounding (fast, no LLM)
     ├─ faithfulness-judge.ts    : Claude per-claim verdicts vs facts[]   → unsupported spans
     └─ coverage.ts              : mustAppear answer-key points captured   → coverage %
                                   │
                                   ▼
   scorecard.ts __testOnly_gateVerdict:
     FAIL if (any prepass flip) OR (unsupported claims > tolerance)
     render coverage % + missing mustAppear points + baseline delta
```

---

## 3. Naming & shape contract (use these EXACT names everywhere)

These names appear across multiple tasks. A mismatch is a bug — keep them identical.

- Answer-key field: **`facts`** — `string[]` on `FixtureGroundTruth`. Each entry is one atomic, true factual claim from the transcript.
- qaPairs item gains optional **`mustAppear`** — `boolean | undefined`; coverage treats `undefined` as `true` (every authored Q is required unless explicitly opted out).
- Pre-pass result type: **`FaithfulnessPrepass`** = `{ jaRatio: number; languageFlip: boolean; groundingJa: number; groundingAscii: number }`.
- Judge per-claim verdict: **`ClaimVerdict`** = `{ claim: string; verdict: 'supported' | 'unsupported' | 'partial'; span: string }` (`span` = the cited note substring, or `''`).
- Judge result type: **`FaithfulnessResult`** = `{ verdicts: ClaimVerdict[]; unsupportedCount: number; overall: 'PASS' | 'FAIL'; judgeModelId: string }`.
- Coverage result type: **`CoverageResult`** = `{ captured: number; total: number; ratio: number; missing: string[] }`.
- Gate tolerance constant: **`FAITHFULNESS_UNSUPPORTED_TOLERANCE = 0`** (founder's "any fabrication = fail"; a named const so it is tunable in one place).
- Language-flip threshold constant: **`JA_FLIP_MIN_RATIO = 0.15`** (the #118 guard: a JA-expected note with `jaRatio < 0.15` is a wholesale English flip). Mirrors the rig's "healthy JA ≥ 0.15" comment.

---

## 4. Controller vs subagent tasks

Tasks that spawn **real 3B inference are CONTROLLER tasks** — the controlling session runs them in the foreground, never a subagent, never `run_in_background` (`pitfalls.md spike-llm`: 8GB M3 + background LLM = swap thrash / kernel panic). They also need the model + sidecar present and ~3-15 min each.

- **CONTROLLER (real-3B, foreground):** Task 7 (fail-first proof), Task 10 (interview wiring smoke), Task 14 (end-to-end gate demo).
- **Subagent-safe (pure unit / no LLM):** Tasks 0, 1, 2, 3, 4, 5, 6, 8, 9, 11, 12, 13.

Controller-task preflight (run once, before Task 7): confirm the model + sidecar exist, else the controller tasks BLOCK (they are environment-gated, not code-gated):

```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval/desktop
ls -la resources/sidecar && ls -la "${LISNA_LLM_MODEL_DIR:-$HOME/.lisna-test-models}"/Llama-3.2-3B-Instruct-Q4_K_M.gguf
# Expected: both exist. If the sidecar is missing, build via the lisna-sidecar-rebuild skill.
# If the model is missing, the controller tasks BLOCK — report and stop (do not fabricate a pass).
```

API-key needs (judge tasks): **`ANTHROPIC_API_KEY`** for the Claude default path; **`GROQ_API_KEY`** for the Groq-70b fallback. Unit tests (Tasks 8, 9) use the `__testOnly_parse*` seam and need NO key. The live judge call inside Task 14 needs a key — name only the env-var, never the value (`~/.claude` secret rule).

---

## 5. Tasks

> Convention for every task: **Write failing test → run-see-fail → implement → run-see-pass → commit.** Commit subjects ≤ 72 chars, `type(scope): summary`. Run scoped Vitest as `pnpm test <relativepath>` from `desktop/` (the `test` script forwards `"$@"` to `vitest run` via `scripts/test-with-cleanup.sh`, which also pkills orphan llama processes). Never run a bare directory through Vitest (`pitfalls.md vitest-scope`); always a file path or `src/`.

---

### Task 0: Install deps + green baseline

**Files:** none (environment).

- [ ] **Step 1: Install workspace dependencies**

Run:
```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval && pnpm install
```
Expected: completes; `desktop/node_modules/.bin/vitest` now exists.

- [ ] **Step 2: Confirm the existing eval tests are green before any change**

Run:
```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval/desktop && pnpm test eval/scorecard.test.ts eval/fixtures/_schema.test.ts eval/runners/offline.test.ts scripts/eval-notes.test.ts
```
Expected: all PASS (this is the pre-change snapshot — if anything is red here, STOP and report; the worktree is not in a clean state to build on).

- [ ] **Step 3: No commit** (install + baseline only). Proceed to Task 1.

---

### Task 1: Answer-key schema — `facts[]` + `mustAppear` on qaPairs + key-term importance

**Files:**
- Modify: `desktop/eval/fixtures/_schema.ts:31-44` (`FixtureGroundTruthSchema`)
- Test: `desktop/eval/fixtures/_schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `desktop/eval/fixtures/_schema.test.ts` inside the existing top-level `describe('FixtureMetaSchema', …)`/file (add a new `describe`):

```typescript
describe('FixtureGroundTruthSchema — Phase 1 answer-key fields', () => {
  it('accepts a facts[] answer key', () => {
    const gt = {
      fixtureId: 'finance-fabrication-2spk',
      facts: ['月次の売上は前年比で減少した', '原価率の改善を最優先にする'],
      qaPairs: [{ q: '売上の状況は', a: '前年比で減少', mustAppear: true }],
    };
    expect(FixtureGroundTruthSchema.safeParse(gt).success).toBe(true);
  });

  it('accepts qaPairs without mustAppear (back-compat with existing fixtures)', () => {
    const gt = {
      fixtureId: 'pm-candidate-2spk',
      qaPairs: [{ q: 'プロダクト失敗体験', a: 'ユーザー調査不足' }],
    };
    const parsed = FixtureGroundTruthSchema.safeParse(gt);
    expect(parsed.success).toBe(true);
  });

  it('accepts expectedKeyTerms as bare strings (lecture back-compat)', () => {
    const gt = { fixtureId: 'lec', expectedKeyTerms: ['電位', '静電ポテンシャル'] };
    expect(FixtureGroundTruthSchema.safeParse(gt).success).toBe(true);
  });

  it('accepts expectedKeyTerms as importance-tagged objects', () => {
    const gt = {
      fixtureId: 'lec',
      expectedKeyTerms: [{ term: '電位', mustAppear: true }, { term: '余談', mustAppear: false }],
    };
    expect(FixtureGroundTruthSchema.safeParse(gt).success).toBe(true);
  });

  it('rejects a fact entry that is not a string', () => {
    const gt = { fixtureId: 'x', facts: ['ok', 42] };
    expect(FixtureGroundTruthSchema.safeParse(gt).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd desktop && pnpm test eval/fixtures/_schema.test.ts`
Expected: the four new "accepts" cases FAIL (`facts`/`mustAppear` unknown or wrong shape) — actually they pass-through today because Zod objects are non-strict, so the discriminating failure is the importance-object case AND the negative case. Confirm: `rejects a fact entry that is not a string` FAILS (no `facts` validation exists yet) and `accepts expectedKeyTerms as importance-tagged objects` FAILS (current type is `z.array(z.string())`, so an object array is rejected). If both of those fail, you have a real red. Expected: FAIL.

- [ ] **Step 3: Implement the schema change**

In `desktop/eval/fixtures/_schema.ts`, replace the `FixtureGroundTruthSchema` block (lines 31-44) with:

```typescript
// A coverage point's importance flag. `undefined` is treated as `true` by the
// coverage scorer — every authored point is required unless explicitly opted
// out. Mirrors the meeting decisions/actionItems `mustAppear` already in use.
const KeyTermSchema = z.union([
  z.string(),
  z.object({ term: z.string(), mustAppear: z.boolean().optional() }),
]);

export const FixtureGroundTruthSchema = z.object({
  fixtureId: z.string().min(1),
  // Faithfulness answer key (Phase 1): the COMPLETE set of true factual claims
  // from this fixture's transcript. The faithfulness judge checks every note
  // claim against this list; anything not entailed here is a fabrication.
  facts: z.array(z.string()).optional(),
  // Lecture-family ground truths
  expectedSections: z.array(z.object({ heading: z.string(), ts: z.number() })).optional(),
  expectedKeyTerms: z.array(KeyTermSchema).optional(),
  expectedFormulas: z.array(z.string()).optional(),         // anti-parroting allowlist (literal expressions actually IN this fixture)
  // Meeting/Interview/Brainstorm ground truths
  decisions: z.array(z.object({ text: z.string(), mustAppear: z.boolean() })).optional(),
  actionItems: z.array(z.object({ text: z.string(), mustAppear: z.boolean() })).optional(),
  qaPairs: z.array(z.object({ q: z.string(), a: z.string(), mustAppear: z.boolean().optional() })).optional(),
  themes: z.array(z.string()).optional(),
  ideaCount: z.number().int().nonnegative().optional(),
  participantCount: z.number().int().positive().optional(),
});
export type FixtureGroundTruth = z.infer<typeof FixtureGroundTruthSchema>;

// Normalize an expectedKeyTerms entry to { term, mustAppear } — consumers
// (coverage.ts) call this so they never branch on string-vs-object.
export function normalizeKeyTerm(k: z.infer<typeof KeyTermSchema>): { term: string; mustAppear: boolean } {
  return typeof k === 'string' ? { term: k, mustAppear: true } : { term: k.term, mustAppear: k.mustAppear ?? true };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd desktop && pnpm test eval/fixtures/_schema.test.ts`
Expected: PASS (all cases, including the existing meta/transcript ones).

- [ ] **Step 5: Scoped typecheck (the only static net for eval code)**

Run:
```bash
cd desktop && pnpm tsx --eval "import('./eval/fixtures/_schema.ts').then(m => { const r = m.FixtureGroundTruthSchema.safeParse({ fixtureId: 'x', facts: ['a'], qaPairs: [{ q: 'q', a: 'a', mustAppear: true }] }); if (!r.success) { console.error(r.error); process.exit(1); } console.log('schema OK; normalizeKeyTerm:', JSON.stringify(m.normalizeKeyTerm('t'))); })"
```
Expected: prints `schema OK; normalizeKeyTerm: {"term":"t","mustAppear":true}` (this both typechecks the module via tsx's transpile and exercises the new export). If tsx reports a type/transpile error, fix before committing.

- [ ] **Step 6: Commit**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval
git add desktop/eval/fixtures/_schema.ts desktop/eval/fixtures/_schema.test.ts
git commit -m "feat(eval): add facts[] + mustAppear answer-key fields"
```

---

### Task 2: Deterministic faithfulness pre-pass (jaRatio flip + grounding)

**Files:**
- Create: `desktop/eval/faithfulness-prepass.ts`
- Test: `desktop/eval/faithfulness-prepass.test.ts`

Lift the scoring from `scripts/note-quality-eval.ts` (`collectStrings` lines 90-102, `scoreNote` grounding lines 126-155) into a reusable, note-only function. Drop the ts-plausibility + count fields — Phase 1's pre-pass only needs language-flip + grounding.

- [ ] **Step 1: Write the failing test**

Create `desktop/eval/faithfulness-prepass.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { faithfulnessPrepass, JA_FLIP_MIN_RATIO } from './faithfulness-prepass';

describe('faithfulnessPrepass', () => {
  const transcript = '月次の売上は前年比で減少した。原価率の改善を最優先にする。';

  it('flags a wholesale JA→EN flip (jaRatio below threshold)', () => {
    const note = { qa_pairs: [{ question: 'What is the revenue trend?', answer: 'It declined year over year and margins compressed.' }] };
    const r = faithfulnessPrepass(note, transcript);
    expect(r.languageFlip).toBe(true);
    expect(r.jaRatio).toBeLessThan(JA_FLIP_MIN_RATIO);
  });

  it('does NOT flag a healthy JA note', () => {
    const note = { qa_pairs: [{ question: '売上の状況は', answer: '前年比で減少した' }], themes: [{ name: '原価率の改善' }] };
    const r = faithfulnessPrepass(note, transcript);
    expect(r.languageFlip).toBe(false);
    expect(r.jaRatio).toBeGreaterThanOrEqual(JA_FLIP_MIN_RATIO);
  });

  it('reports JA grounding: a kanji run present in the transcript counts', () => {
    const note = { themes: [{ name: '売上' }, { name: '架空の数値' }] };
    const r = faithfulnessPrepass(note, transcript);
    // 売上 is in the transcript; 架空 / 数値 are not — grounding < 1.
    expect(r.groundingJa).toBeGreaterThan(0);
    expect(r.groundingJa).toBeLessThan(1);
  });

  it('ignores system keys (family/model/generatedAt) when scoring', () => {
    const note = { family: 'interview', model: 'llama-3.2-3b', generatedAt: '2026-06-13T00:00:00Z', themes: [{ name: '売上' }] };
    const r = faithfulnessPrepass(note, transcript);
    // Only 売上 contributes — jaRatio is ~1.0, not diluted by the EN system values.
    expect(r.jaRatio).toBeGreaterThan(0.8);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd desktop && pnpm test eval/faithfulness-prepass.test.ts`
Expected: FAIL — `Cannot find module './faithfulness-prepass'`.

- [ ] **Step 3: Implement the pre-pass**

Create `desktop/eval/faithfulness-prepass.ts`:

```typescript
// desktop/eval/faithfulness-prepass.ts
//
// Deterministic, no-LLM faithfulness pre-pass. Lifted from
// scripts/note-quality-eval.ts::scoreNote (the dump-replay rig) so the
// fixture-based runner shares the SAME #118 language-flip guard + grounding
// without an LLM round-trip. Fails fast on a wholesale JA→EN flip before any
// judge call is made.

/** A JA note whose jaRatio drops below this is a wholesale English flip (the
 *  #118 fabrication signature; healthy JA notes sit ≥ 0.15). */
export const JA_FLIP_MIN_RATIO = 0.15;

export interface FaithfulnessPrepass {
  jaRatio: number;       // JA-script share of user-visible strings
  languageFlip: boolean; // jaRatio < JA_FLIP_MIN_RATIO
  groundingJa: number;   // fraction of kanji/katakana runs (≥2) found in transcript
  groundingAscii: number; // fraction of ASCII words (≥4) found in transcript
}

const JA_SCRIPT_RE = /[぀-ゟ゠-ヿ一-鿿㐀-䶿｡-ﾟ　-〿]/g;
// System/meta keys carry model/language identifiers, never note CONTENT — exclude
// them so an English model id can't dilute jaRatio. Mirrors the rig's SYSTEM_KEYS.
const SYSTEM_KEYS = new Set(['family', 'language', 'from', 'model', 'generatedAt', 'experimentArmId', 'schemaVersion', 'generatedBy', 'promptVersion']);

function collectStrings(v: unknown, out: string[]): void {
  if (typeof v === 'string') { out.push(v); return; }
  if (Array.isArray(v)) { for (const x of v) collectStrings(x, out); return; }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (SYSTEM_KEYS.has(k)) continue;
      collectStrings(x, out);
    }
  }
}

export function faithfulnessPrepass(note: unknown, transcriptText: string): FaithfulnessPrepass {
  const parts: string[] = [];
  collectStrings(note, parts);
  const text = parts.join('');
  const jaChars = (text.match(JA_SCRIPT_RE) ?? []).length;
  const jaRatio = text.length ? jaChars / text.length : 0;

  const jaRuns = [...new Set(text.match(/[一-鿿㐀-䶿゠-ヿ]{2,}/g) ?? [])];
  const groundedJa = jaRuns.filter((r) => transcriptText.includes(r)).length;
  const asciiWords = [...new Set((text.match(/[a-zA-Z]{4,}/g) ?? []).map((w) => w.toLowerCase()))];
  const groundedAscii = asciiWords.filter((w) => transcriptText.toLowerCase().includes(w)).length;

  return {
    jaRatio: +jaRatio.toFixed(3),
    languageFlip: jaRatio < JA_FLIP_MIN_RATIO,
    groundingJa: jaRuns.length ? +(groundedJa / jaRuns.length).toFixed(3) : 0,
    groundingAscii: asciiWords.length ? +(groundedAscii / asciiWords.length).toFixed(3) : 0,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd desktop && pnpm test eval/faithfulness-prepass.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval
git add desktop/eval/faithfulness-prepass.ts desktop/eval/faithfulness-prepass.test.ts
git commit -m "feat(eval): deterministic faithfulness pre-pass (jaRatio flip)"
```

---

### Task 3: Coverage scorer (`mustAppear` answer-key points captured)

**Files:**
- Create: `desktop/eval/coverage.ts`
- Test: `desktop/eval/coverage.test.ts`

Pure function consumed by `single-fixture.ts` AND the contract rules. Uses the same JA-friendly normalized-substring match the existing rules use, and `normalizeKeyTerm` from Task 1.

- [ ] **Step 1: Write the failing test**

Create `desktop/eval/coverage.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeCoverage } from './coverage';
import type { FixtureGroundTruth } from './fixtures/_schema';

describe('computeCoverage', () => {
  it('interview: counts mustAppear qaPairs questions found in note.qa_pairs', () => {
    const gt: FixtureGroundTruth = {
      fixtureId: 'fx',
      qaPairs: [
        { q: '売上の状況', a: '減少', mustAppear: true },
        { q: '原価率の方針', a: '改善', mustAppear: true },
        { q: '余談の天気', a: '晴れ', mustAppear: false }, // optional — not counted in total
      ],
    };
    const note = { qa_pairs: [{ question: '売上の状況はどうですか', answer: '前年比で減少' }] };
    const r = computeCoverage('interview', note, gt);
    expect(r.total).toBe(2);          // only mustAppear
    expect(r.captured).toBe(1);       // 売上の状況 matched; 原価率の方針 missing
    expect(r.ratio).toBeCloseTo(0.5);
    expect(r.missing).toEqual(['原価率の方針']);
  });

  it('interview: qaPairs without explicit mustAppear default to required', () => {
    const gt: FixtureGroundTruth = { fixtureId: 'fx', qaPairs: [{ q: 'A', a: 'a' }, { q: 'B', a: 'b' }] };
    const note = { qa_pairs: [{ question: 'A point', answer: 'x' }] };
    const r = computeCoverage('interview', note, gt);
    expect(r.total).toBe(2);
    expect(r.captured).toBe(1);
  });

  it('lecture: counts mustAppear expectedKeyTerms found anywhere in the note', () => {
    const gt: FixtureGroundTruth = {
      fixtureId: 'lec',
      expectedKeyTerms: [{ term: '電位', mustAppear: true }, { term: '静電ポテンシャル', mustAppear: true }, { term: '余談', mustAppear: false }],
    };
    const note = { sections: [{ heading: '電位とは', key_terms: [{ term: '電位', definition: '...' }] }] };
    const r = computeCoverage('lecture', note, gt);
    expect(r.total).toBe(2);
    expect(r.captured).toBe(1);
    expect(r.missing).toEqual(['静電ポテンシャル']);
  });

  it('returns total=0 when the family ground truth has no coverage points', () => {
    const r = computeCoverage('brainstorm', { idea_clusters: [] }, { fixtureId: 'fx' });
    expect(r.total).toBe(0);
    expect(r.ratio).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd desktop && pnpm test eval/coverage.test.ts`
Expected: FAIL — `Cannot find module './coverage'`.

- [ ] **Step 3: Implement coverage**

Create `desktop/eval/coverage.ts`:

```typescript
// desktop/eval/coverage.ts
//
// SCORED coverage: fraction of mustAppear answer-key points the note captured.
// Pure — consumed by single-fixture.ts (scorecard) AND the contract qa-coverage
// rules. Match is JA-friendly normalized-substring (same as the existing rules).

import { normalizeKeyTerm, type FixtureGroundTruth } from './fixtures/_schema';
import type { NoteFamily } from './judges/judge-types';

export interface CoverageResult {
  captured: number;
  total: number;
  ratio: number;        // captured / total, or 0 when total === 0
  missing: string[];    // the required points NOT found in the note
}

function normContains(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  return norm(haystack).includes(norm(needle));
}

/** Flatten every user-visible string in the note into one haystack for
 *  family-agnostic "does this point appear anywhere" matching. */
function noteHaystack(v: unknown, out: string[]): void {
  if (typeof v === 'string') { out.push(v); return; }
  if (Array.isArray(v)) { for (const x of v) noteHaystack(x, out); return; }
  if (v && typeof v === 'object') for (const x of Object.values(v)) noteHaystack(x, out);
}

export function computeCoverage(
  family: NoteFamily,
  note: any,
  groundTruth: FixtureGroundTruth | undefined,
): CoverageResult {
  const empty: CoverageResult = { captured: 0, total: 0, ratio: 0, missing: [] };
  if (!groundTruth) return empty;

  // Required points + how to test each, per family.
  let required: string[] = [];
  let found: (point: string) => boolean;

  if (family === 'interview' && groundTruth.qaPairs) {
    required = groundTruth.qaPairs.filter(p => p.mustAppear ?? true).map(p => p.q);
    const noteQs: string[] = (note.qa_pairs ?? []).map((p: any) => String(p.question ?? ''));
    found = (point) => noteQs.some(q => normContains(q, point));
  } else if (family === 'lecture' && groundTruth.expectedKeyTerms) {
    required = groundTruth.expectedKeyTerms.map(normalizeKeyTerm).filter(k => k.mustAppear).map(k => k.term);
    const hay: string[] = [];
    noteHaystack(note, hay);
    const blob = hay.join('\n');
    found = (point) => normContains(blob, point);
  } else if (family === 'meeting' && groundTruth.decisions) {
    required = groundTruth.decisions.filter(d => d.mustAppear).map(d => d.text);
    const noteDecisions: string[] = (note.decisions ?? []).map((d: any) => String(d.text ?? ''));
    found = (point) => noteDecisions.some(t => normContains(t, point));
  } else {
    return empty;
  }

  if (required.length === 0) return empty;
  const missing = required.filter(p => !found(p));
  const captured = required.length - missing.length;
  return { captured, total: required.length, ratio: +(captured / required.length).toFixed(3), missing };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd desktop && pnpm test eval/coverage.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval
git add desktop/eval/coverage.ts desktop/eval/coverage.test.ts
git commit -m "feat(eval): mustAppear coverage scorer (interview+lecture+meeting)"
```

---

### Task 4: Faithfulness judge — response parser (no network)

**Files:**
- Create: `desktop/eval/judges/faithfulness-judge.ts`
- Test: `desktop/eval/judges/faithfulness-judge.test.ts`

Build the judge in two tasks: Task 4 = the pure parser + types + gate logic (unit-tested, no key); Task 5 = the Claude/Groq network wiring (reusing `llm-judge.ts`'s clients). This mirrors `content-fidelity-judge.ts`'s `__testOnly_parse*` seam.

First, export the Anthropic + Groq clients from `llm-judge.ts` so the new judge reuses them (DRY — the spec's "reuse its Anthropic client pattern").

- [ ] **Step 1: Export the clients from `llm-judge.ts`**

In `desktop/eval/judges/llm-judge.ts`, change the two client helpers from module-private to exported (lines 32-48). Replace:

```typescript
function groq(): OpenAI {
```
with:
```typescript
export function groqClient(): OpenAI {
```
and replace:
```typescript
function anth(): Anthropic {
```
with:
```typescript
export function anthropicClient(): Anthropic {
```
Then update the two internal call sites in this file: `groq().chat…` → `groqClient().chat…` (line 105) and `anth().messages…` → `anthropicClient().messages…` (line 118).

- [ ] **Step 2: Confirm `llm-judge` still parses/typechecks after the rename**

Run: `cd desktop && pnpm test eval/judges/llm-judge.test.ts`
Expected: PASS (the rename is internal; tests use `__testOnly_*`).

- [ ] **Step 3: Write the failing test for the parser + gate**

Create `desktop/eval/judges/faithfulness-judge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  __testOnly_parseFaithfulness,
  gateFromVerdicts,
  FAITHFULNESS_UNSUPPORTED_TOLERANCE,
} from './faithfulness-judge';

describe('parseFaithfulness', () => {
  it('parses per-claim verdicts and computes unsupportedCount + overall', () => {
    const r = __testOnly_parseFaithfulness(JSON.stringify({
      verdicts: [
        { claim: '売上は減少した', verdict: 'supported', span: 'qa_pairs[0].answer' },
        { claim: 'EBITDA margin 22%', verdict: 'unsupported', span: 'themes[1].name' },
      ],
    }));
    expect(r.verdicts).toHaveLength(2);
    expect(r.unsupportedCount).toBe(1);
    expect(r.overall).toBe('FAIL');   // 1 unsupported > tolerance 0
  });

  it('PASS when all verdicts are supported', () => {
    const r = __testOnly_parseFaithfulness(JSON.stringify({
      verdicts: [{ claim: 'a', verdict: 'supported', span: 'x' }],
    }));
    expect(r.unsupportedCount).toBe(0);
    expect(r.overall).toBe('PASS');
  });

  it('treats partial as NOT unsupported (only hard unsupported gates)', () => {
    const r = __testOnly_parseFaithfulness(JSON.stringify({
      verdicts: [{ claim: 'a', verdict: 'partial', span: 'x' }],
    }));
    expect(r.unsupportedCount).toBe(0);
    expect(r.overall).toBe('PASS');
  });

  it('coerces an unknown verdict string to unsupported (safe default)', () => {
    const r = __testOnly_parseFaithfulness(JSON.stringify({
      verdicts: [{ claim: 'a', verdict: 'maybe', span: '' }],
    }));
    expect(r.verdicts[0].verdict).toBe('unsupported');
    expect(r.overall).toBe('FAIL');
  });

  it('malformed JSON → FAIL with zero verdicts (never silently PASS)', () => {
    const r = __testOnly_parseFaithfulness('not json');
    expect(r.verdicts).toEqual([]);
    expect(r.overall).toBe('FAIL');
  });

  it('gateFromVerdicts respects the tolerance constant', () => {
    expect(FAITHFULNESS_UNSUPPORTED_TOLERANCE).toBe(0);
    expect(gateFromVerdicts(0)).toBe('PASS');
    expect(gateFromVerdicts(1)).toBe('FAIL');
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd desktop && pnpm test eval/judges/faithfulness-judge.test.ts`
Expected: FAIL — `Cannot find module './faithfulness-judge'`.

- [ ] **Step 5: Implement the parser + types + gate (no network yet)**

Create `desktop/eval/judges/faithfulness-judge.ts`:

```typescript
// desktop/eval/judges/faithfulness-judge.ts
//
// Faithfulness GATE judge (Phase 1, founder's #1 criterion: "any fabrication =
// fail"). Checks every note claim against the fixture's authored facts[] and
// returns PER-CLAIM verdicts. Default model = Claude (the strong judge); Groq
// 70b is the cheap fallback. Separate from llm-judge.ts because the result is a
// per-claim verdict array + a hard PASS/FAIL gate, NOT a 0-10 axis map — bolting
// it into JudgeResult.axes (Record<string,number>) would corrupt that contract.
// Reuses llm-judge.ts's Anthropic/Groq clients (the spec's "reuse its client
// pattern"). Mirrors content-fidelity-judge.ts's __testOnly_parse* seam.

import { groqClient, anthropicClient } from './llm-judge';
import type { FixtureGroundTruth } from '../fixtures/_schema';
import type { NoteFamily } from './judge-types';

export type ClaimVerdictKind = 'supported' | 'unsupported' | 'partial';

export interface ClaimVerdict {
  claim: string;
  verdict: ClaimVerdictKind;
  span: string;   // cited note substring/path, or '' if none
}

export interface FaithfulnessResult {
  verdicts: ClaimVerdict[];
  unsupportedCount: number;
  overall: 'PASS' | 'FAIL';
  judgeModelId: string;
}

/** Founder: "any fabrication = fail." A named const so the gate is tunable in
 *  one place. */
export const FAITHFULNESS_UNSUPPORTED_TOLERANCE = 0;

const DEFAULT_JUDGE_MODEL = 'claude-3-5-sonnet-latest';
const GROQ_FALLBACK_MODEL = 'llama-3.3-70b-versatile';

export function gateFromVerdicts(unsupportedCount: number): 'PASS' | 'FAIL' {
  return unsupportedCount > FAITHFULNESS_UNSUPPORTED_TOLERANCE ? 'FAIL' : 'PASS';
}

function coerceVerdict(v: unknown): ClaimVerdictKind {
  return v === 'supported' || v === 'partial' ? v : 'unsupported'; // safe default
}

export function __testOnly_parseFaithfulness(text: string, judgeModelId = DEFAULT_JUDGE_MODEL): FaithfulnessResult {
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { parsed = {}; }
  const rawVerdicts: any[] = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
  const verdicts: ClaimVerdict[] = rawVerdicts.map(v => ({
    claim: typeof v?.claim === 'string' ? v.claim : '',
    verdict: coerceVerdict(v?.verdict),
    span: typeof v?.span === 'string' ? v.span : '',
  }));
  const unsupportedCount = verdicts.filter(v => v.verdict === 'unsupported').length;
  return { verdicts, unsupportedCount, overall: gateFromVerdicts(unsupportedCount), judgeModelId };
}

const SYSTEM_PROMPT = `あなたは AI 生成 note が「事実」に忠実かを検査する厳しい検査官です。
入力: facts[] (この録音から確認された真の事実の完全なリスト) + note の user-visible content fields.
出力は JSON のみ。

判定ルール:
- note 内の各「主張」(qa_pairs の Q/A・themes・key_takeaways・decisions・ideas など) を facts[] と照合する。
- facts[] のいずれかに entail される主張 = "supported"。
- facts[] と矛盾する、または facts[] に存在しない新情報を述べる主張 = "unsupported" (= 捏造)。
- facts[] の内容を部分的にしか反映していない、曖昧な主張 = "partial"。
- 言語が転倒している (日本語の録音なのに note が英語で書かれている) 場合、その英語主張は内容が合っていても "unsupported" とする。

例:
- facts: ["売上は前年比で減少した"]. note.theme: "Revenue grew 30% YoY" → verdict=unsupported (矛盾+言語転倒).
- facts: ["原価率の改善を最優先にする"]. note.key_takeaway: "原価率を下げる方針" → verdict=supported.

出力 (verdicts は note 内の主張ごとに 1 エントリ):
{ "verdicts": [ { "claim": "<note の主張>", "verdict": "supported|unsupported|partial", "span": "<note 内の該当箇所>" } ] }`;

// Extract the user-visible content fields per family that the judge scores.
// Mirrors content-fidelity-judge.ts::extractContentFields.
function extractClaims(family: NoteFamily, note: any): string {
  const out: Record<string, unknown> = {};
  if (family === 'lecture') {
    out.section_summaries = (note.sections ?? []).map((s: any) => ({ heading: s.heading, summary: s.summary }));
    out.key_terms = (note.sections ?? []).flatMap((s: any) => s.key_terms ?? []);
  } else if (family === 'meeting') {
    out.executive_summary = note.executive_summary;
    out.decisions = note.decisions ?? [];
    out.next_steps = note.next_steps ?? [];
  } else if (family === 'interview') {
    out.qa_pairs = note.qa_pairs ?? [];
    out.themes = note.themes ?? [];
    out.key_takeaways = note.key_takeaways ?? [];
    out.quotable_lines = note.quotable_lines ?? [];
  } else if (family === 'brainstorm') {
    out.idea_clusters = note.idea_clusters ?? [];
    out.conclusions = note.conclusions ?? [];
  }
  return JSON.stringify(out, null, 2);
}

export interface FaithfulnessJudgeInput {
  family: NoteFamily;
  note: any;
  groundTruth: FixtureGroundTruth;   // MUST carry facts[]; caller guards
  judgeModelId?: string;
}

export async function judgeFaithfulness(input: FaithfulnessJudgeInput): Promise<FaithfulnessResult> {
  const facts = input.groundTruth.facts ?? [];
  const claimsJson = extractClaims(input.family, input.note);
  const userPrompt = `facts (この録音で確認された真の事実の完全なリスト):\n${facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\nnote.claims (これを採点する):\n${claimsJson}`;
  const modelId = input.judgeModelId ?? DEFAULT_JUDGE_MODEL;
  if (modelId.startsWith('claude-')) {
    return judgeViaAnthropic(modelId, userPrompt);
  }
  return judgeViaGroq(modelId, userPrompt);
}

async function judgeViaAnthropic(modelId: string, userPrompt: string): Promise<FaithfulnessResult> {
  const res = await anthropicClient().messages.create({
    model: modelId,
    max_tokens: 2000,
    system: SYSTEM_PROMPT + '\n\nReturn ONLY a JSON object — no prose, no markdown fences.',
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = res.content.map(c => (c.type === 'text' ? c.text : '')).join('').trim();
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return __testOnly_parseFaithfulness(cleaned, modelId);
}

async function judgeViaGroq(modelId: string, userPrompt: string): Promise<FaithfulnessResult> {
  const res = await groqClient().chat.completions.create({
    model: modelId,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
    response_format: { type: 'json_object' },
    temperature: 0,
  });
  const text = res.choices[0]?.message?.content ?? '{}';
  return __testOnly_parseFaithfulness(text, modelId);
}

export { GROQ_FALLBACK_MODEL, DEFAULT_JUDGE_MODEL };
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd desktop && pnpm test eval/judges/faithfulness-judge.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 7: Commit**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval
git add desktop/eval/judges/llm-judge.ts desktop/eval/judges/faithfulness-judge.ts desktop/eval/judges/faithfulness-judge.test.ts
git commit -m "feat(eval): faithfulness gate judge — per-claim verdicts + parser"
```

---

### Task 5: Judge-sanity harness (hand-written faithful→PASS / fabricated→FAIL)

**Files:**
- Modify: `desktop/eval/judges/faithfulness-judge.test.ts`

Spec §4d "Judge sanity": prove a broken judge can't silently pass everything. We validate the SHAPE end-to-end through the parser using two hand-written judge responses that stand in for "judge saw a faithful note" and "judge saw a fabricated note" — no network, deterministic, runs in CI. (The live-judge sanity on real model output happens in Task 14, controller-gated.)

- [ ] **Step 1: Write the failing sanity test**

Append to `desktop/eval/judges/faithfulness-judge.test.ts`:

```typescript
describe('judge-sanity (shape contract, no network)', () => {
  // A judge that saw a FAITHFUL JA note returns all-supported.
  const FAITHFUL_RESPONSE = JSON.stringify({
    verdicts: [
      { claim: '売上は前年比で減少した', verdict: 'supported', span: 'qa_pairs[0].answer' },
      { claim: '原価率の改善を最優先にする', verdict: 'supported', span: 'key_takeaways[0]' },
    ],
  });
  // A judge that saw a FABRICATED English note returns unsupported on the invented claim.
  const FABRICATED_RESPONSE = JSON.stringify({
    verdicts: [
      { claim: 'Revenue grew 30% YoY', verdict: 'unsupported', span: 'themes[0].name' },
      { claim: 'EBITDA margin reached 22%', verdict: 'unsupported', span: 'themes[1].name' },
    ],
  });

  it('faithful judge response → PASS', () => {
    expect(__testOnly_parseFaithfulness(FAITHFUL_RESPONSE).overall).toBe('PASS');
  });

  it('fabricated judge response → FAIL with both spans cited', () => {
    const r = __testOnly_parseFaithfulness(FABRICATED_RESPONSE);
    expect(r.overall).toBe('FAIL');
    expect(r.unsupportedCount).toBe(2);
    expect(r.verdicts.map(v => v.span)).toEqual(['themes[0].name', 'themes[1].name']);
  });

  it('a judge that flips everything to supported CANNOT hide an empty-verdicts response', () => {
    // Guard: an empty verdict list is treated as FAIL, so a judge returning {} can't pass.
    expect(__testOnly_parseFaithfulness('{}').overall).toBe('FAIL');
  });
});
```

- [ ] **Step 2: Run to verify it fails, then passes**

Run: `cd desktop && pnpm test eval/judges/faithfulness-judge.test.ts`
Expected: these 3 new cases PASS immediately (they exercise the Task 4 parser). If any fails, the Task 4 parser has a gate bug — fix it in Task 4's file, not here. This task is the sanity SPEC; if it's green on first run that is the intended outcome (no new impl needed).

- [ ] **Step 3: Commit**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval
git add desktop/eval/judges/faithfulness-judge.test.ts
git commit -m "test(eval): judge-sanity shape contract for faithfulness gate"
```

---

### Task 6: Wire pre-pass + faithfulness + coverage into `single-fixture.ts` and `FixtureResult`

**Files:**
- Modify: `desktop/eval/baseline/format.ts:46-57` (`FixtureResultSchema`)
- Modify: `desktop/eval/runners/single-fixture.ts`
- Test: `desktop/eval/runners/single-fixture.test.ts`

First extend the persisted result shape, then wire the producers. The faithfulness judge runs ONLY when the fixture has `facts[]` (interview fabrication fixture) AND `skipLlmJudge` is false; the pre-pass + coverage are cheap and always run.

- [ ] **Step 1: Extend `FixtureResultSchema`**

In `desktop/eval/baseline/format.ts`, add two schemas above `FixtureResultSchema` (after `SlotDistributionSchema`, line 44):

```typescript
const FaithfulnessSchema = z.object({
  prepass: z.object({
    jaRatio: z.number(),
    languageFlip: z.boolean(),
    groundingJa: z.number(),
    groundingAscii: z.number(),
  }),
  judge: z.object({
    verdicts: z.array(z.object({
      claim: z.string(),
      verdict: z.enum(['supported', 'unsupported', 'partial']),
      span: z.string(),
    })),
    unsupportedCount: z.number().int().nonnegative(),
    overall: z.enum(['PASS', 'FAIL']),
    judgeModelId: z.string(),
  }).optional(),                                       // optional — skipped when no facts[] or skipLlmJudge
  gate: z.enum(['PASS', 'FAIL']),                      // combined prepass+judge verdict
});

const CoverageSchema = z.object({
  captured: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  ratio: z.number(),
  missing: z.array(z.string()),
});
```

Then add the two optional fields inside `FixtureResultSchema` (after `slotDistribution`, before `derScore`):

```typescript
  faithfulness: FaithfulnessSchema.optional(),         // Phase 1 gate — present when fixture has facts[] or for a flip pre-pass
  coverage: CoverageSchema.optional(),                 // Phase 1 scored coverage
```

- [ ] **Step 2: Write the failing test for `single-fixture` wiring**

The existing `single-fixture.test.ts` may not exist as a standalone file — check first:

Run: `cd desktop && ls eval/runners/single-fixture.test.ts`

If it does NOT exist, create `desktop/eval/runners/single-fixture.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runSingleFixture } from './single-fixture';
import { STUB_RUNNER } from './pipeline-stub';

function writeFixture(dir: string, meta: object, transcript: object, groundTruth?: object): string {
  const d = join(dir, 'interview', 'tmp-fab');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'meta.json'), JSON.stringify(meta));
  writeFileSync(join(d, 'transcript.json'), JSON.stringify(transcript));
  if (groundTruth) writeFileSync(join(d, 'ground-truth.json'), JSON.stringify(groundTruth));
  return d;
}

describe('runSingleFixture — Phase 1 faithfulness + coverage (no LLM judge)', () => {
  it('always runs the deterministic pre-pass and reports a gate', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fx-'));
    try {
      const dir = writeFixture(root,
        { fixtureId: 'tmp-fab', family: 'interview', language: 'ja', durationSec: 100, bucketSeconds: 10, scenarioTags: [], expectedSlots: [], sourceUrl: null },
        { bucket_seconds: 10, transcripts: [{ ts: 0, text: '売上は前年比で減少した', speakerId: 0 }] },
        { fixtureId: 'tmp-fab', facts: ['売上は前年比で減少した'], qaPairs: [{ q: '売上の状況', a: '減少', mustAppear: true }] },
      );
      const r = await runSingleFixture({ fixtureDir: dir, runner: STUB_RUNNER, skipLlmJudge: true });
      expect(r.faithfulness).toBeDefined();
      expect(r.faithfulness!.prepass).toBeDefined();
      expect(['PASS', 'FAIL']).toContain(r.faithfulness!.gate);
      expect(r.faithfulness!.judge).toBeUndefined(); // skipLlmJudge → no judge call
      expect(r.coverage).toBeDefined();
      expect(r.coverage!.total).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('gates FAIL when the stub note is an English flip of a JA fixture', async () => {
    // The stub returns English-ish placeholder strings ("stub q0"…) — for a JA
    // fixture that is a language flip, so the pre-pass alone fails the gate.
    const root = mkdtempSync(join(tmpdir(), 'fx-'));
    try {
      const dir = writeFixture(root,
        { fixtureId: 'tmp-fab', family: 'interview', language: 'ja', durationSec: 100, bucketSeconds: 10, scenarioTags: [], expectedSlots: [], sourceUrl: null },
        { bucket_seconds: 10, transcripts: [{ ts: 0, text: '売上は前年比で減少した', speakerId: 0 }] },
        { fixtureId: 'tmp-fab', facts: ['売上は前年比で減少した'] },
      );
      const r = await runSingleFixture({ fixtureDir: dir, runner: STUB_RUNNER, skipLlmJudge: true });
      expect(r.faithfulness!.prepass.languageFlip).toBe(true);
      expect(r.faithfulness!.gate).toBe('FAIL');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd desktop && pnpm test eval/runners/single-fixture.test.ts`
Expected: FAIL — `r.faithfulness` is `undefined` (wiring not added yet).

- [ ] **Step 4: Wire the producers into `single-fixture.ts`**

In `desktop/eval/runners/single-fixture.ts`, add imports near the existing judge imports (after line 11):

```typescript
import { faithfulnessPrepass } from '../faithfulness-prepass';
import { judgeFaithfulness, gateFromVerdicts, type FaithfulnessResult } from '../judges/faithfulness-judge';
import { computeCoverage } from '../coverage';
```

Then, after the `result` object is built (after line 71, before the `if (!opts.skipLlmJudge)` block), insert:

```typescript
  // ── Phase 1: deterministic pre-pass + coverage (always; no LLM) ─────────────
  const transcriptText = transcript.transcripts.map(b => b.text).join('');
  const prepass = faithfulnessPrepass(pipelineResult.note, transcriptText);
  result.coverage = computeCoverage(meta.family, pipelineResult.note, groundTruth);

  // The judge runs only when an answer key (facts[]) exists AND the LLM half is
  // enabled. The pre-pass language flip alone can fail the gate without a judge.
  let judge: FaithfulnessResult | undefined;
  if (!opts.skipLlmJudge && groundTruth?.facts && groundTruth.facts.length > 0) {
    judge = await judgeFaithfulness({ family: meta.family, note: pipelineResult.note, groundTruth, judgeModelId: opts.judgeModelId });
  }
  // Combined gate: a language flip fails outright; otherwise the judge decides
  // (when present). With no judge and no flip, the gate is PASS (pre-pass-clean).
  const gate: 'PASS' | 'FAIL' = prepass.languageFlip
    ? 'FAIL'
    : (judge ? gateFromVerdicts(judge.unsupportedCount) : 'PASS');
  result.faithfulness = { prepass, judge, gate };
```

Note: `opts.judgeModelId` is already threaded into `runSingleFixture` (used by `judgeNote`). The faithfulness judge defaults to Claude when `judgeModelId` is undefined — that is intended (founder's strong model). The existing `--judge claude-…` flag therefore drives BOTH judges consistently.

- [ ] **Step 5: Run to verify it passes**

Run: `cd desktop && pnpm test eval/runners/single-fixture.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Confirm the baseline schema round-trips the new fields**

Run: `cd desktop && pnpm test eval/baseline/store.test.ts eval/baseline/format.test.ts`
Expected: PASS (the new fields are optional, so existing baselines still parse).

- [ ] **Step 7: Commit**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval
git add desktop/eval/baseline/format.ts desktop/eval/runners/single-fixture.ts desktop/eval/runners/single-fixture.test.ts
git commit -m "feat(eval): wire faithfulness pre-pass + coverage into fixture result"
```

---

### Task 7: ⚠️ CONTROLLER — author the fabrication fixture + PROVE it fails faithfulness (fail-first)

**Files:**
- Create: `desktop/eval/fixtures/interview/finance-fabrication-2spk/transcript.json`
- Create: `desktop/eval/fixtures/interview/finance-fabrication-2spk/meta.json`
- Create: `desktop/eval/fixtures/interview/finance-fabrication-2spk/ground-truth.json`

**This is a CONTROLLER task (real-3B, foreground).** `testing.md regression-fixture` is a HARD GATE: the fixture MUST be empirically shown to FAIL faithfulness on the CURRENT pipeline before it is accepted. A fixture that passes proves nothing. Run the controller-task preflight (section 4) first; if the model/sidecar is absent, this task BLOCKS — report and stop.

- [ ] **Step 1: Author the fixture transcript**

The transcript must be a sparse JA accounting/finance interview that triggers the model's English-finance boilerplate prior (the 2026-06-11 failure mode): short turns, finance vocabulary, few concrete numbers. Create `desktop/eval/fixtures/interview/finance-fabrication-2spk/transcript.json`:

```json
{
  "sessionId": "finance-fabrication-2spk",
  "speakers": [
    { "id": 0, "name": "Interviewer" },
    { "id": 1, "name": "CFO" }
  ],
  "bucket_seconds": 10,
  "transcripts": [
    { "ts": 0, "text": "Interviewer: 今期の財務状況を簡単に教えてください。", "speakerId": 0 },
    { "ts": 10, "text": "CFO: 売上は前年比で少し減りました。原価率の改善が課題です。", "speakerId": 1 },
    { "ts": 20, "text": "Interviewer: 利益への影響はどうですか。", "speakerId": 0 },
    { "ts": 30, "text": "CFO: 粗利は横ばいですが、固定費が重く営業利益は薄いです。", "speakerId": 1 },
    { "ts": 40, "text": "Interviewer: 改善の優先順位は。", "speakerId": 0 },
    { "ts": 50, "text": "CFO: まず原価率を下げること、次に在庫の回転を上げることです。", "speakerId": 1 },
    { "ts": 60, "text": "Interviewer: 資金繰りは大丈夫ですか。", "speakerId": 0 },
    { "ts": 70, "text": "CFO: 当面は問題ありません。来期に向けて運転資金を厚めに持ちます。", "speakerId": 1 }
  ]
}
```

- [ ] **Step 2: Author the meta**

Create `desktop/eval/fixtures/interview/finance-fabrication-2spk/meta.json`:

```json
{
  "fixtureId": "finance-fabrication-2spk",
  "family": "interview",
  "language": "ja",
  "durationSec": 80,
  "bucketSeconds": 10,
  "scenarioTags": ["finance", "2-speaker", "fabrication-stress"],
  "expectedSlots": [],
  "sourceUrl": null,
  "notes": "Reproduces the 2026-06-11 JA finance interview → English-finance fabrication failure. Sparse turns + finance vocabulary trigger the 3B's memorized EN boilerplate prior. FAIL-FIRST verified on current pipeline (Task 7)."
}
```

- [ ] **Step 3: Author the answer key (`facts[]` + `mustAppear` qaPairs)**

`facts[]` = the COMPLETE set of true claims from the transcript; anything the note says beyond these is a fabrication. Create `desktop/eval/fixtures/interview/finance-fabrication-2spk/ground-truth.json`:

```json
{
  "fixtureId": "finance-fabrication-2spk",
  "facts": [
    "売上は前年比で少し減少した",
    "原価率の改善が課題である",
    "粗利は横ばいである",
    "固定費が重く営業利益は薄い",
    "改善の最優先は原価率を下げること",
    "次の優先は在庫の回転を上げること",
    "当面の資金繰りは問題ない",
    "来期に向けて運転資金を厚めに持つ方針"
  ],
  "qaPairs": [
    { "q": "今期の財務状況", "a": "売上は前年比で減少、原価率の改善が課題", "mustAppear": true },
    { "q": "利益への影響", "a": "粗利は横ばい、固定費が重く営業利益は薄い", "mustAppear": true },
    { "q": "改善の優先順位", "a": "原価率を下げる、在庫回転を上げる", "mustAppear": true },
    { "q": "資金繰りの状況", "a": "当面問題なし、運転資金を厚めに", "mustAppear": true }
  ],
  "themes": ["revenue-decline", "cost-ratio", "profitability", "cash-flow"],
  "participantCount": 2
}
```

- [ ] **Step 4: Validate the fixture parses (schema check, no LLM)**

Run:
```bash
cd desktop && pnpm tsx --eval "import('./eval/fixtures/_validator.ts').then(async m => { const r = await m.validateEvalBaselines({ lecture: [], meeting: [], interview: ['finance-fabrication-2spk'], brainstorm: [] }, 'eval/fixtures'); console.log(JSON.stringify(r)); if (!r.ok) process.exit(1); })"
```
Expected: `{"ok":true,"errors":[]}`. (Validates meta + transcript against the schema.)

- [ ] **Step 5: ⚠️ CONTROLLER — run the REAL 3B against the fixture and capture the note**

This spawns real inference. FOREGROUND only. Set the model dir + API key env first (name the env-vars, never paste values). Run the live faithfulness path against the new fixture, with the offline-3b runner — BUT note interview is not wired into the runner yet (Task 10). So for the fail-first PROOF, use the existing dump-replay rig path which already runs interview end-to-end against a transcript, OR run `eval:notes` once Task 10 lands. **Sequencing decision:** do Task 7 fixture authoring now, but run the empirical fail-first proof AFTER Task 10 wires interview into the runner. Until then, this step is BLOCKED-by-Task-10.

Once Task 10 is merged, run:
```bash
cd desktop
export LISNA_LLM_MODEL_DIR="${LISNA_LLM_MODEL_DIR:-$HOME/.lisna-test-models}"
# ANTHROPIC_API_KEY must already be exported in the shell (do not echo it).
pnpm eval:notes --runner offline-3b --family interview --fixture finance-fabrication-2spk --judge claude-3-5-sonnet-latest 2>&1 | tee /tmp/fab-failfirst.log
```
Expected (the fail-first gate): the scorecard shows **`faithfulness: FAIL`** for `finance-fabrication-2spk` — either because the pre-pass detected a language flip (`jaRatio < 0.15`) OR the Claude judge returned ≥1 `unsupported` claim. If the note comes back clean and the gate PASSES, the fixture is too easy — tighten it (fewer turns, more finance jargon, remove concrete numbers) and re-run until it FAILS. **Do not accept a fixture that passes.** Record the observed `jaRatio` + `unsupportedCount` in the commit body.

- [ ] **Step 6: Commit (the fixture + the fail-first evidence)**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval
git add desktop/eval/fixtures/interview/finance-fabrication-2spk/
git commit -m "test(eval): fabrication-stress fixture (fail-first verified)" -m "Fail-first proof on current 3B pipeline: gate=FAIL, jaRatio=<observed>, unsupportedCount=<observed>. testing.md regression-fixture."
```

---

### Task 8: Scorecard gate — render faithfulness PASS/FAIL + fabricated spans + coverage

**Files:**
- Modify: `desktop/eval/scorecard.ts`
- Test: `desktop/eval/scorecard.test.ts`

The scorecard already iterates `results` and renders judge/contentFidelity. Add a faithfulness gate block + coverage line, and expose a `__testOnly_gateVerdict` so the gate logic is unit-testable without formatting noise.

- [ ] **Step 1: Write the failing tests**

Append to `desktop/eval/scorecard.test.ts`:

```typescript
import { __testOnly_gateVerdict } from './scorecard';

describe('formatScorecard — faithfulness gate + coverage', () => {
  const base: FixtureResult = {
    fixtureId: 'finance-fabrication-2spk',
    family: 'interview',
    contractTest: { schemaParse: 'PASS', overall: 'PASS', findings: [] },
    runMs: 30000,
  };

  it('renders FAITHFULNESS FAIL with unsupported spans', () => {
    const r: FixtureResult = {
      ...base,
      faithfulness: {
        prepass: { jaRatio: 0.02, languageFlip: true, groundingJa: 0, groundingAscii: 0.1 },
        judge: { verdicts: [{ claim: 'Revenue grew 30%', verdict: 'unsupported', span: 'themes[0].name' }], unsupportedCount: 1, overall: 'FAIL', judgeModelId: 'claude-3-5-sonnet-latest' },
        gate: 'FAIL',
      },
      coverage: { captured: 0, total: 4, ratio: 0, missing: ['今期の財務状況', '利益への影響', '改善の優先順位', '資金繰りの状況'] },
    };
    const text = formatScorecard([r]);
    expect(text).toContain('FAITHFULNESS: FAIL');
    expect(text).toContain('language flip');         // pre-pass reason surfaced
    expect(text).toContain('Revenue grew 30%');      // fabricated claim surfaced
    expect(text).toContain('coverage');
    expect(text).toContain('0/4');                   // coverage count
  });

  it('renders FAITHFULNESS PASS when gate passes', () => {
    const r: FixtureResult = {
      ...base,
      faithfulness: { prepass: { jaRatio: 0.6, languageFlip: false, groundingJa: 0.9, groundingAscii: 0 }, judge: { verdicts: [{ claim: '売上は減少', verdict: 'supported', span: 'qa_pairs[0]' }], unsupportedCount: 0, overall: 'PASS', judgeModelId: 'claude-3-5-sonnet-latest' }, gate: 'PASS' },
      coverage: { captured: 4, total: 4, ratio: 1, missing: [] },
    };
    const text = formatScorecard([r]);
    expect(text).toContain('FAITHFULNESS: PASS');
    expect(text).toContain('4/4');
  });

  it('__testOnly_gateVerdict: any FAIL fixture makes the suite gate FAIL', () => {
    const pass: FixtureResult = { ...base, faithfulness: { prepass: { jaRatio: 0.6, languageFlip: false, groundingJa: 1, groundingAscii: 0 }, gate: 'PASS' } };
    const fail: FixtureResult = { ...base, fixtureId: 'b', faithfulness: { prepass: { jaRatio: 0.0, languageFlip: true, groundingJa: 0, groundingAscii: 0 }, gate: 'FAIL' } };
    expect(__testOnly_gateVerdict([pass])).toBe('PASS');
    expect(__testOnly_gateVerdict([pass, fail])).toBe('FAIL');
    expect(__testOnly_gateVerdict([{ ...base }])).toBe('PASS'); // no faithfulness block → not gated
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd desktop && pnpm test eval/scorecard.test.ts`
Expected: FAIL — `__testOnly_gateVerdict` is not exported and the gate text isn't rendered.

- [ ] **Step 3: Implement the gate render + verdict helper**

In `desktop/eval/scorecard.ts`, add the faithfulness + coverage render inside the per-fixture loop, immediately after the `if (r.contentFidelity) { … }` block (after line 48):

```typescript
    if (r.faithfulness) {
      lines.push(`    FAITHFULNESS: ${r.faithfulness.gate}`);
      const p = r.faithfulness.prepass;
      if (p.languageFlip) {
        lines.push(`      pre-pass: language flip (jaRatio ${p.jaRatio.toFixed(2)} < 0.15) — note is not in the expected language`);
      } else {
        lines.push(`      pre-pass: jaRatio ${p.jaRatio.toFixed(2)} groundingJa ${p.groundingJa.toFixed(2)}`);
      }
      if (r.faithfulness.judge) {
        const unsupported = r.faithfulness.judge.verdicts.filter(v => v.verdict === 'unsupported');
        lines.push(`      judge (${r.faithfulness.judge.judgeModelId}): ${r.faithfulness.judge.unsupportedCount} unsupported claim(s)`);
        for (const v of unsupported) lines.push(`        ✗ ${v.claim}  [${v.span}]`);
      }
    }
    if (r.coverage) {
      lines.push(`    coverage           ${r.coverage.captured}/${r.coverage.total} (${(r.coverage.ratio * 100).toFixed(0)}%)`);
      if (r.coverage.missing.length) lines.push(`      missing: ${r.coverage.missing.join('; ')}`);
    }
```

Then, at the END of the file (after the existing `formatScorecard` function closes, line 77), add the exported gate-verdict helper:

```typescript

/** Suite-level faithfulness gate: FAIL if ANY fixture with a faithfulness block
 *  failed its gate. Fixtures without a faithfulness block (no facts[]) are not
 *  gated. Used by the CLI to set a non-zero exit code. */
export function __testOnly_gateVerdict(results: FixtureResult[]): 'PASS' | 'FAIL' {
  return results.some(r => r.faithfulness?.gate === 'FAIL') ? 'FAIL' : 'PASS';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd desktop && pnpm test eval/scorecard.test.ts`
Expected: PASS (all cases, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval
git add desktop/eval/scorecard.ts desktop/eval/scorecard.test.ts
git commit -m "feat(eval): scorecard faithfulness gate + coverage render"
```

---

### Task 9: CLI exit-code gate on faithfulness FAIL

**Files:**
- Modify: `desktop/scripts/eval-notes.ts:95-113` (the non-regression `main` path)
- Test: `desktop/scripts/eval-notes.test.ts`

`eval-notes.ts` already exits non-zero on a baseline regression. Make it ALSO exit non-zero when any fixture's faithfulness gate is FAIL, so CI/founder sees a hard failure. The argparse + resolveRunner are already tested; we add the gate to the suite path.

- [ ] **Step 1: Write the failing test (gate helper applied to suite results)**

The `main()` function isn't directly unit-testable (it reads `process.argv` + spawns), so test the imported `__testOnly_gateVerdict` from the scorecard is re-exported / used. Add to `desktop/scripts/eval-notes.test.ts`:

```typescript
import { __testOnly_gateVerdict } from '../eval/scorecard';
import type { FixtureResult } from '../eval/baseline/format';

describe('eval-notes faithfulness exit gate (helper contract)', () => {
  it('a FAIL faithfulness fixture yields a FAIL suite verdict', () => {
    const fail: FixtureResult = {
      fixtureId: 'finance-fabrication-2spk', family: 'interview',
      contractTest: { schemaParse: 'PASS', overall: 'PASS', findings: [] }, runMs: 1,
      faithfulness: { prepass: { jaRatio: 0, languageFlip: true, groundingJa: 0, groundingAscii: 0 }, gate: 'FAIL' },
    };
    expect(__testOnly_gateVerdict([fail])).toBe('FAIL');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd desktop && pnpm test scripts/eval-notes.test.ts`
Expected: FAIL — `__testOnly_gateVerdict` import resolves but the test file doesn't import `FixtureResult` type yet / the helper isn't wired into the CLI. (If the helper import resolves and the assertion passes immediately, that's fine — it proves the contract; the real wiring is Step 3.)

- [ ] **Step 3: Wire the exit gate into `main()`**

In `desktop/scripts/eval-notes.ts`, add the import at the top (after line 7's `formatScorecard` import):

```typescript
import { formatScorecard, __testOnly_gateVerdict } from '../eval/scorecard';
```
(Replace the existing `import { formatScorecard } from '../eval/scorecard';` line — do not duplicate.)

Then in the non-regression suite path, after `console.log(formatScorecard(results));` (line 103), add:

```typescript
  if (__testOnly_gateVerdict(results) === 'FAIL') {
    console.error('FAITHFULNESS GATE FAILED — one or more notes contain fabrication or a language flip');
    process.exitCode = 3;
  }
```

Also apply it in the regression path: after `console.log(formatScorecard(reg.after.results, reg.diff));` (line 88), before the regression check, add:

```typescript
    if (__testOnly_gateVerdict(reg.after.results) === 'FAIL') {
      console.error('FAITHFULNESS GATE FAILED — fabrication/flip in the new run');
      process.exitCode = 3;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd desktop && pnpm test scripts/eval-notes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval
git add desktop/scripts/eval-notes.ts desktop/scripts/eval-notes.test.ts
git commit -m "feat(eval): CLI exits non-zero on faithfulness gate FAIL"
```

---

### Task 10: Wire interview + brainstorm into the offline runner + port the anti-wedge sequence

**Files:**
- Modify: `desktop/eval/runners/offline.ts`
- Test: `desktop/eval/runners/offline.test.ts`

Two changes: (a) remove the lecture/meeting-only guard and call `finalizeInterview`/`finalizeBrainstorm` (parallel signatures, both take `diarizationStatus`); (b) replace the flat `client.waitForReady(10_000)` with the rig's warmup + plain-no-grammar primer + longer windows, so a real 3B run doesn't wedge on 8GB (`pitfalls.md spike-llm`). The warmup/primer mirrors `note-quality-eval.ts:200-235`.

- [ ] **Step 1: Update the failing unit test (guard removed)**

Read the current `desktop/eval/runners/offline.test.ts`:

Run: `cd desktop && cat eval/runners/offline.test.ts`

It asserts interview/brainstorm throw `UNSUPPORTED_FAMILY_FOR_OFFLINE_RUNNER`. Replace that assertion. Edit `desktop/eval/runners/offline.test.ts` — find the test that expects the throw and change it to assert the guard is GONE (the runner now accepts all four families up to the point it would spawn). Replace the unsupported-family test block with:

```typescript
  it('no longer rejects interview/brainstorm at the family guard', () => {
    // The factory resolves a runner for any profiled model; the family guard
    // that used to throw UNSUPPORTED_FAMILY_FOR_OFFLINE_RUNNER for
    // interview/brainstorm is removed (they are now wired). We assert the
    // guard string is absent from the source contract by constructing the
    // runner and checking it exposes the four-family run() without throwing
    // synchronously. (Real inference is covered by the controller smoke.)
    const runner = makeOfflineRunner({ runnerId: 'offline-3b', sidecarBin: '/nonexistent', llmModelPath: '/x/Llama-3.2-3B-Instruct-Q4_K_M.gguf' });
    expect(runner.modelId).toBe('llama-3.2-3b-q4-km');
    expect(typeof runner.run).toBe('function');
  });
```

(If the existing test imports a fixture/meta to drive `.run()` and asserts the rejection, delete that specific assertion and keep any still-valid assertions about modelId derivation.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd desktop && pnpm test eval/runners/offline.test.ts`
Expected: FAIL (the old throw-assertion is gone but the new behavior isn't implemented, OR the import set changed). Confirm red.

- [ ] **Step 3: Implement the runner changes**

In `desktop/eval/runners/offline.ts`:

(a) Add the two finalize imports + the two core side-effect imports. Replace line 9:
```typescript
import { finalizeLecture, finalizeMeeting } from '../../src/main/sidecar/orchestrator';
```
with:
```typescript
import { finalizeLecture, finalizeMeeting, finalizeInterview, finalizeBrainstorm } from '../../src/main/sidecar/orchestrator';
```
and add after line 12 (`import '../../src/shared/families/meeting/core';`):
```typescript
import '../../src/shared/families/interview/core';
import '../../src/shared/families/brainstorm/core';
```

(b) Remove the family guard. Delete lines 41-44:
```typescript
      // Family guard BEFORE spawning anything (cheap, unit-testable).
      if (meta.family !== 'lecture' && meta.family !== 'meeting') {
        throw new Error(`UNSUPPORTED_FAMILY_FOR_OFFLINE_RUNNER:${meta.family}`);
      }
```

(c) Replace the warmup + finalize dispatch. Replace the body from `await client.waitForReady(10_000);` (line 50) through the end of the inner `try` finalize block (line 75) with:

```typescript
        await client.waitForReady(15_000);
        const llm = new LlamaCppLLM(client);
        await llm.loadModel(opts.llmModelPath);

        // ── Anti-wedge sequence (ported from scripts/note-quality-eval.ts:200-235)
        // Real-LLM eval is FOREGROUND-only and slow (pitfalls.md spike-llm). The
        // flat 10s waitForReady is NOT enough: on an 8GB machine the first cold
        // prefill can exceed the production 60s no-progress timeout. We pay that
        // cost once here with (1) a 16-token plain warmup, then (2) a PLAIN
        // (no-grammar) primer on the real first prompt — empirically the only
        // sequence that unwedges the subsequent grammar call (plain-big-prefill →
        // grammar ran at normal speed; cold→grammar and grammar→grammar wedged
        // 300s+). The fixture's first chunk transcript is the warmup payload.
        const st = fixtureToSessionTranscript(transcript, meta);
        const warmText = st.transcriptSegments.map(s => s.text).join('\n').slice(0, 4000);
        for await (const _ of client.sendStream(
          { type: 'generate', messages: [{ role: 'user', content: 'こんにちは' }], seed: 1, temperature: 0.4, maxTokens: 16 },
          { timeoutMs: 180_000 },
        )) { /* drain warmup */ }
        try {
          for await (const _ of client.sendStream(
            { type: 'generate', messages: [{ role: 'user', content: warmText }], seed: 1, temperature: 0.4, maxTokens: 8 },
            { timeoutMs: 600_000 },
          )) { /* drain primer */ }
        } catch { /* primer timeout is non-fatal — continue to the real finalize */ }

        const proxy = countingProxy(makeGrammarSidecar(client));

        // Per-chunk attempts: chunk progress fires BEFORE that chunk's call(s),
        // so snapshot the call count at each chunk start.
        const chunkStarts: number[] = [];
        const onProgress = (e: { phase: string }) => {
          if (e.phase === 'chunk') chunkStarts.push(proxy.total());
        };

        let note: unknown;
        try {
          if (meta.family === 'lecture') {
            ({ note } = await finalizeLecture({ sessionId: st.sessionId, transcript: st,
              sidecar: proxy.sidecar, modelProfile: profile, onProgress }));
          } else if (meta.family === 'meeting') {
            ({ note } = await finalizeMeeting({ sessionId: st.sessionId, transcript: st,
              sidecar: proxy.sidecar, modelProfile: profile, diarizationStatus: 'disabled', onProgress }));
          } else if (meta.family === 'interview') {
            ({ note } = await finalizeInterview({ sessionId: st.sessionId, transcript: st,
              sidecar: proxy.sidecar, modelProfile: profile, diarizationStatus: 'disabled', onProgress }));
          } else {
            ({ note } = await finalizeBrainstorm({ sessionId: st.sessionId, transcript: st,
              sidecar: proxy.sidecar, modelProfile: profile, diarizationStatus: 'disabled', onProgress }));
          }
        } finally {
          await llm.unloadModel().catch(() => {});
        }
```

Note the `const st = fixtureToSessionTranscript(...)` line MOVED up (it was at line 54); make sure it is not duplicated — delete the original `const st = fixtureToSessionTranscript(transcript, meta);` further down if it remains. The `chunkStarts`/`onProgress` block below the finalize (original lines 59-62) is also now ABOVE the finalize — delete the duplicate original.

(d) Confirm the tail (`const finalCount = proxy.total(); … return { note, retryAttempts, runMs };`) is unchanged and still present after the finalize block.

- [ ] **Step 4: Run the unit test + confirm no other eval test broke**

Run: `cd desktop && pnpm test eval/runners/offline.test.ts eval/runners/offline.smoke.test.ts`
Expected: PASS. Note: `offline.smoke.test.ts` is `describe.skip` unless `LISNA_TEST_LLM_MODEL` is set AND the sidecar exists (line 15 `gate = … ? describe : describe.skip`) — it spawns the REAL sidecar, not a mock. So with the env unset it simply skips (PASS-as-skip), and `offline.test.ts` (no real model, constructs with `/nonexistent`, never reaches the warmup because it asserts factory-time behavior) passes. The warmup code therefore has NO unit-level fake to break — it is exercised only by the real-sidecar smoke (controller) and by Task 14. Confirm the unit test's modelId-derivation cases (lines 8-22) still pass unchanged.

- [ ] **Step 5: Commit**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval
git add desktop/eval/runners/offline.ts desktop/eval/runners/offline.test.ts desktop/eval/runners/offline.smoke.test.ts
git commit -m "feat(eval): wire interview+brainstorm offline runner + anti-wedge warmup"
```

---

### Task 11: Extend interview coverage contract rule to consume `mustAppear` + emit %

**Files:**
- Modify: `desktop/eval/contract/families/interview.ts:39-55`
- Test: `desktop/eval/contract/families.test.ts`

The existing `interview-ground-truth-qa-coverage` rule counts ALL qaPairs equally. Extend it to honour `mustAppear` (via `computeCoverage`) and report the captured % — reusing the Task 3 scorer so the rule and the scorecard coverage line never diverge.

- [ ] **Step 1: Write the failing test**

First read the existing family contract test to match its structure:

Run: `cd desktop && sed -n '1,12p' eval/contract/families.test.ts`

`families.test.ts` ALREADY imports `INTERVIEW_RULES` + `LECTURE_RULES` + `MEETING_RULES` + `BRAINSTORM_RULES` at the top (lines 3-6) and `RuleInput` (line 7). Do NOT re-import them — a duplicate `import { INTERVIEW_RULES }` is a redeclaration error. Add ONLY the `FixtureGroundTruth` type import (not already present) at the top of the file, then append the new `describe` block at the bottom. Add to the top imports:

```typescript
import type { FixtureGroundTruth } from '../fixtures/_schema';
```

Append at the bottom of `desktop/eval/contract/families.test.ts`:

```typescript
describe('interview-ground-truth-qa-coverage honours mustAppear', () => {
  const rule = INTERVIEW_RULES.find(r => r.id === 'interview-ground-truth-qa-coverage')!;
  const transcript = { bucket_seconds: 10, speakers: [{ id: 0 }], transcripts: [{ ts: 0, text: 'x', speakerId: 0 }] };

  it('ignores mustAppear:false points in the denominator', () => {
    const groundTruth: FixtureGroundTruth = {
      fixtureId: 'fx',
      qaPairs: [
        { q: '財務状況', a: 'x', mustAppear: true },
        { q: '雑談', a: 'y', mustAppear: false },
      ],
    };
    const note = { qa_pairs: [{ question: '財務状況について', answer: 'x' }] };
    const res = rule.run({ family: 'interview', note, transcript: transcript as any, groundTruth });
    // 1/1 required covered → 100% → pass; the雑談 optional point is excluded.
    expect(res.message).toContain('1/1');
    expect(res.pass).toBe(true);
  });

  it('fails when a required point is missing', () => {
    const groundTruth: FixtureGroundTruth = { fixtureId: 'fx', qaPairs: [{ q: 'A', a: 'a', mustAppear: true }, { q: 'B', a: 'b', mustAppear: true }] };
    const note = { qa_pairs: [{ question: 'A thing', answer: 'x' }] };
    const res = rule.run({ family: 'interview', note, transcript: transcript as any, groundTruth });
    expect(res.message).toContain('1/2');
    expect(res.pass).toBe(false); // 50% < 60% threshold
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd desktop && pnpm test eval/contract/families.test.ts`
Expected: FAIL — the current rule counts all qaPairs (denominator 2 incl. the optional), so the `1/1` assertion fails.

- [ ] **Step 3: Implement — delegate the rule to `computeCoverage`**

In `desktop/eval/contract/families/interview.ts`, add the import at the top (after line 2):

```typescript
import { computeCoverage } from '../../coverage';
```

Replace the `groundTruthQaCoverage` rule (lines 39-55) with:

```typescript
const groundTruthQaCoverage: ContractRule = {
  id: 'interview-ground-truth-qa-coverage',
  severity: 'warning',
  description: '≥60% of mustAppear ground-truth qaPairs questions appear in the note (substring).',
  run: ({ note, groundTruth }) => {
    if (!groundTruth?.qaPairs) return { pass: true, message: 'no ground-truth qaPairs, rule N/A' };
    const cov = computeCoverage('interview', note, groundTruth);
    if (cov.total === 0) return { pass: true, message: 'no mustAppear qaPairs, rule N/A' };
    return {
      pass: cov.ratio >= 0.6,
      message: `${cov.captured}/${cov.total} ground-truth Qs covered (${(cov.ratio * 100).toFixed(0)}%)`,
      detail: { ratio: cov.ratio, missing: cov.missing },
    };
  },
};
```

Then delete the now-unused `normContains` helper at the bottom of the file (lines 57-60) — `computeCoverage` carries its own. (Leave it if any other rule in the file still references it; grep first: `grep -n normContains eval/contract/families/interview.ts`. As written only `groundTruthQaCoverage` used it, so remove it.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd desktop && pnpm test eval/contract/families.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval
git add desktop/eval/contract/families/interview.ts desktop/eval/contract/families.test.ts
git commit -m "refactor(eval): interview qa-coverage rule via shared computeCoverage"
```

---

### Task 12: Lecture key-term coverage rule (lecture is under-keyed)

**Files:**
- Modify: `desktop/eval/contract/families/lecture.ts`
- Test: `desktop/eval/contract/families.test.ts`

Spec §2 item 6: lecture coverage keys off `expectedKeyTerms` (no qaPairs). Add a coverage rule so a lecture answer key (when authored) is scored the same way. Reuses `computeCoverage`.

- [ ] **Step 1: Write the failing test**

`LECTURE_RULES` and the `FixtureGroundTruth` type are already imported in `families.test.ts` (the latter added in Task 11). Do NOT re-import. Append ONLY the new `describe` block at the bottom of `desktop/eval/contract/families.test.ts`:

```typescript
describe('lecture-ground-truth-keyterm-coverage', () => {
  const rule = LECTURE_RULES.find(r => r.id === 'lecture-ground-truth-keyterm-coverage')!;
  const transcript = { bucket_seconds: 10, speakers: [{ id: 0 }], transcripts: [{ ts: 0, text: 'x', speakerId: 0 }] };

  it('passes N/A when no expectedKeyTerms', () => {
    const res = rule.run({ family: 'lecture', note: { sections: [] }, transcript: transcript as any, groundTruth: { fixtureId: 'x' } });
    expect(res.pass).toBe(true);
    expect(res.message).toContain('N/A');
  });

  it('counts mustAppear key terms found anywhere in the note', () => {
    const groundTruth = { fixtureId: 'lec', expectedKeyTerms: [{ term: '電位', mustAppear: true }, { term: '静電ポテンシャル', mustAppear: true }] };
    const note = { sections: [{ heading: '電位', summary: '電位の説明', key_terms: [{ term: '電位' }] }] };
    const res = rule.run({ family: 'lecture', note, transcript: transcript as any, groundTruth });
    expect(res.message).toContain('1/2');
    expect(res.pass).toBe(false); // 50% < 60%
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd desktop && pnpm test eval/contract/families.test.ts`
Expected: FAIL — `rule` is `undefined` (`find` returns nothing; the rule doesn't exist).

- [ ] **Step 3: Implement the lecture coverage rule**

In `desktop/eval/contract/families/lecture.ts`, add the import (after line 2's `parrotingRule` import):

```typescript
import { computeCoverage } from '../../coverage';
```

Add the rule definition just above the `export const LECTURE_RULES` array (before line 124):

```typescript
const groundTruthKeyTermCoverage: ContractRule = {
  id: 'lecture-ground-truth-keyterm-coverage',
  severity: 'warning',
  description: '≥60% of mustAppear ground-truth key terms appear somewhere in the note.',
  run: ({ note, groundTruth }) => {
    if (!groundTruth?.expectedKeyTerms) return { pass: true, message: 'no expectedKeyTerms, rule N/A' };
    const cov = computeCoverage('lecture', note, groundTruth);
    if (cov.total === 0) return { pass: true, message: 'no mustAppear key terms, rule N/A' };
    return {
      pass: cov.ratio >= 0.6,
      message: `${cov.captured}/${cov.total} key terms covered (${(cov.ratio * 100).toFixed(0)}%)`,
      detail: { ratio: cov.ratio, missing: cov.missing },
    };
  },
};
```

Add it to the array (append inside the `LECTURE_RULES` list, after `noStrippedLatexResidue`):

```typescript
export const LECTURE_RULES: ContractRule[] = [
  sectionsMin3,
  sectionsHaveKeyTerms,
  fromTranscriptRatio,
  slotsEmergeWhenExpected,
  parrotingRule,
  noStrippedLatexResidue,
  groundTruthKeyTermCoverage,
];
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd desktop && pnpm test eval/contract/families.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval
git add desktop/eval/contract/families/lecture.ts desktop/eval/contract/families.test.ts
git commit -m "feat(eval): lecture key-term coverage contract rule"
```

---

### Task 13: Full eval test-suite green + scoped typecheck

**Files:** none (verification).

This is the static + unit gate before the controller end-to-end. Because `pnpm typecheck`/`pnpm lint` do NOT cover `eval/**`+`scripts/**`, we run the WHOLE eval+scripts Vitest surface (which imports every changed module) plus a scoped tsx transpile of the new modules.

- [ ] **Step 1: Run the entire eval + scripts test surface**

Run:
```bash
cd desktop && pnpm test eval/ scripts/
```
Wait — `pitfalls.md vitest-scope` forbids a bare directory ONLY because it can sweep a hardware-gated real-LLM test. Confirm no real-LLM test sits under `eval/`: `grep -rl "loadModel\|sendStream\|LISNA_TEST_LLM_MODEL" eval scripts | grep -i test`. The offline `*.test.ts` use mocks, not real models (`offline.test.ts` constructs with `/nonexistent`). If that grep returns ONLY mock-based tests, the directory run is safe here. If it surfaces a real-LLM test, run explicit file paths instead:
```bash
cd desktop && pnpm test eval/faithfulness-prepass.test.ts eval/coverage.test.ts eval/judges/faithfulness-judge.test.ts eval/judges/llm-judge.test.ts eval/runners/single-fixture.test.ts eval/runners/offline.test.ts eval/scorecard.test.ts eval/contract/families.test.ts eval/fixtures/_schema.test.ts eval/baseline/format.test.ts eval/baseline/store.test.ts scripts/eval-notes.test.ts
```
Expected: ALL PASS.

- [ ] **Step 2: Scoped transpile-typecheck of the new modules**

Run:
```bash
cd desktop && pnpm tsx --eval "await Promise.all(['./eval/faithfulness-prepass.ts','./eval/coverage.ts','./eval/judges/faithfulness-judge.ts','./eval/scorecard.ts','./eval/runners/single-fixture.ts','./eval/runners/offline.ts'].map(p => import(p))); console.log('all eval modules import-clean');"
```
Expected: prints `all eval modules import-clean` (a transpile/type error in any module throws here — this is the substitute for `pnpm typecheck` over the eval dir).

- [ ] **Step 3: Run the production typecheck + lint (guards `src/` you touched: none, but confirm no `src` import broke)**

Run:
```bash
cd desktop && pnpm typecheck && pnpm lint
```
Expected: PASS. (You did not modify `src/**`; this confirms the orchestrator imports the runner pulls in still typecheck transitively from the `src` side, and lint is clean. `pitfalls.md pre-push-lint`.)

- [ ] **Step 4: No commit** (verification only). If anything is red, fix in the owning task's file and re-run.

---

### Task 14: ⚠️ CONTROLLER — end-to-end gate demo on the real 3B

**Files:** none (the payoff measurement; may write a baseline artifact).

**CONTROLLER task (real-3B, foreground, ~3-15 min).** This is the spec §7 "process payoff": run the full pipeline against the fabrication fixture and a healthy fixture, and SEE the gate work on real model output. Needs `LISNA_LLM_MODEL_DIR` + `ANTHROPIC_API_KEY` (Groq key as fallback). Run the controller preflight (section 4) first; BLOCK if the model/sidecar is absent.

- [ ] **Step 1: ⚠️ Run the fabrication fixture through the real pipeline (expect gate FAIL)**

Run:
```bash
cd desktop
export LISNA_LLM_MODEL_DIR="${LISNA_LLM_MODEL_DIR:-$HOME/.lisna-test-models}"
# ANTHROPIC_API_KEY exported in-shell already (never echo it).
pnpm eval:notes --runner offline-3b --family interview --fixture finance-fabrication-2spk --judge claude-3-5-sonnet-latest 2>&1 | tee /tmp/fab-e2e.log
echo "exit=$?"
```
Expected: scorecard prints `FAITHFULNESS: FAIL` for `finance-fabrication-2spk` (pre-pass flip and/or ≥1 unsupported claim), `exit=3` (the CLI gate). This is the fail-first proof on the REAL pipeline that Task 7 deferred. If it PASSES, the fixture is too easy — return to Task 7 Step 5 and harden it.

- [ ] **Step 2: ⚠️ Run a healthy interview fixture (expect gate PASS or no-gate)**

The healthy fixtures (`pm-candidate-2spk` etc.) have NO `facts[]`, so the judge won't run, but the pre-pass still runs and should NOT flip (the 3B usually produces JA for a JA transcript). Run:
```bash
cd desktop && pnpm eval:notes --runner offline-3b --family interview --fixture pm-candidate-2spk --judge claude-3-5-sonnet-latest 2>&1 | tee /tmp/healthy-e2e.log
echo "exit=$?"
```
Expected: `FAITHFULNESS: PASS` (or pre-pass clean, no judge), `exit=0`. If THIS one flips/FAILs, investigate whether the runner's warmup wedged the grammar call (read the log for a 300s+ stall) before trusting the result.

- [ ] **Step 3: Sanity-confirm the judge actually discriminated (not a rubber-stamp)**

Inspect `/tmp/fab-e2e.log`: confirm the `judge (claude-…)` line lists ≥1 concrete `✗ <claim> [<span>]` that is genuinely an invented/English claim — not a JA claim mislabeled. If the judge flagged a TRUE JA claim as unsupported, the judge prompt is mis-calibrated; note it for a follow-up (do not silently accept). This is the live half of the §4d judge-sanity check.

- [ ] **Step 4: (Optional) freeze a baseline for future regression runs**

If both runs behaved correctly, freeze the current state as a baseline so the next prompt/sampler change is measured against it:
```bash
cd desktop && pnpm eval:notes --runner offline-3b --family interview --fixture finance-fabrication-2spk --judge claude-3-5-sonnet-latest --baseline fab-v0 2>&1 | tail -5
ls -la eval/baselines/fab-v0.json
```
Expected: `eval/baselines/fab-v0.json` written. (This file is the frozen "fabrication FAIL" record; a future fix flips it to PASS and the diff proves the win.)

- [ ] **Step 5: Commit the controller evidence (log excerpts in the message, baseline if frozen)**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/note-quality-eval
# Only add the baseline artifact if you froze one in Step 4; otherwise commit nothing here.
git add desktop/eval/baselines/fab-v0.json 2>/dev/null || true
git commit -m "test(eval): freeze fabrication baseline (gate=FAIL on 3B)" -m "E2E controller proof: finance-fabrication-2spk gate=FAIL (jaRatio=<obs>, unsupported=<obs>); pm-candidate-2spk gate=PASS. Process payoff for §7." --allow-empty
```

---

### Task 15: Pre-push verification gate (full `pnpm verify` is too heavy — scoped equivalent)

**Files:** none.

`desktop-ci` gates on `pnpm verify`, which runs `build` + `smoke:main` + a full test run — heavy, and `pnpm verify`'s typecheck/lint still won't cover the eval dir. Before declaring the branch push-ready, run the deterministic subset that proves the change + matches what CI will check.

- [ ] **Step 1: Run the eval+scripts unit surface once more (post-all-commits)**

Run the explicit file list from Task 13 Step 1 (fallback form) — this is the authoritative green check for everything this plan added:
```bash
cd desktop && pnpm test eval/faithfulness-prepass.test.ts eval/coverage.test.ts eval/judges/faithfulness-judge.test.ts eval/judges/llm-judge.test.ts eval/runners/single-fixture.test.ts eval/runners/offline.test.ts eval/scorecard.test.ts eval/contract/families.test.ts eval/fixtures/_schema.test.ts eval/baseline/format.test.ts eval/baseline/store.test.ts scripts/eval-notes.test.ts
```
Expected: ALL PASS.

- [ ] **Step 2: Run production typecheck + lint (the `src/`-scoped CI gates)**

Run: `cd desktop && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Hand off to the push gate**

The push itself is in the risky-action class (confirm with the user first) and is intercepted by the prepush-review-gate hook — an INDEPENDENT reviewer (reviewer ≠ author) must approve HEAD before the push proceeds. Do NOT `--no-verify`. When approved, push the branch and open a DRAFT PR per `workflow.md`.

---

## 6. Self-Review (writing-plans discipline)

**1. Spec coverage — every §4 requirement maps to a task:**

| Spec requirement | Task(s) |
|---|---|
| §4a author 1 interview fabrication fixture + answer key | Task 7 |
| §4a schema: add `facts[]` | Task 1 |
| §4a schema: uniform `mustAppear`/importance on qaPairs + expectedKeyTerms | Task 1 |
| §4a lecture coverage keys off `expectedKeyTerms` | Task 12 (rule) + Task 3 (scorer) |
| §4a **fail-first** (fixture FAILS on current pipeline before acceptance) | Task 7 Step 5 + Task 14 Step 1 |
| §4b faithfulness judge: Claude path, per-claim verdicts, consumes `facts[]` | Task 4 |
| §4b judge-placement decision (new file vs extend llm-judge) | Task 4 (new `faithfulness-judge.ts`; reuses llm-judge clients) |
| §4b default Claude, Groq-70b fallback via `--judge` | Task 4 (`judgeFaithfulness` model branch) |
| §4b GATE in scorecard: FAIL on unsupported > tolerance OR jaRatio flip | Task 6 (combined gate) + Task 8 (render) + Task 9 (exit code) |
| §4b deterministic jaRatio check runs FIRST, fails fast without a judge | Task 2 + Task 6 (pre-pass before judge) |
| §4b coverage: extend qa-coverage rules to consume `mustAppear` + emit % | Task 11 + Task 12 |
| §4c remove lecture/meeting-only guard; call finalizeInterview/Brainstorm | Task 10 |
| §4c port rig warmup + plain-no-grammar primer + longer windows | Task 10 |
| §4d scorecard per-fixture: faithfulness PASS/FAIL + score + fabricated spans + coverage % + delta | Task 8 |
| §4d judge sanity (faithful→PASS / fabricated→FAIL) | Task 5 (shape, CI) + Task 14 Step 3 (live) |
| §7 fail-first integration hard gate | Task 7 + Task 14 |
| §7 unit tests for schema/validator/grounding/flip/coverage/scorecard | Tasks 1,2,3,8 |
| §8 runner and judge never import each other | Verified: runner (Task 10) imports orchestrator only; judge (Task 4) imports llm-judge clients only — neither imports the other. |

No §4 requirement is unmapped. (§6 Phase 2 items — in-app viewing, rig/runner unification, usefulness axis, real-recording realism — are correctly ABSENT.)

**2. Placeholder scan:** No "TBD"/"implement later"/"add validation"/"similar to Task N". Every code step carries complete code. Two intentional `<observed>`/`<obs>` tokens appear only inside controller commit-MESSAGE bodies (Task 7, 14) where the engineer fills the empirically observed numbers — these are data placeholders for human-recorded measurements, not code placeholders, and that is the correct shape for a fail-first evidence record.

**3. Type/name consistency (checked across all tasks):**
- `facts` (field) — defined Task 1, consumed Tasks 4, 6, 7, judge prompt. Identical everywhere.
- `mustAppear` — Task 1 (schema, optional default-true), Tasks 3/11/12 (coverage honours it). Consistent default-true semantics.
- `FaithfulnessResult` `{ verdicts, unsupportedCount, overall, judgeModelId }` — Task 4 definition matches Task 6 import + Task 8 `FaithfulnessSchema.judge` shape + Task 9 usage. `ClaimVerdict` `{ claim, verdict, span }` identical in Task 4, the `format.ts` schema (Task 6), and the scorecard render (Task 8).
- `FaithfulnessPrepass` `{ jaRatio, languageFlip, groundingJa, groundingAscii }` — Task 2 definition matches Task 6 `FaithfulnessSchema.prepass` + Task 8 render.
- `CoverageResult` `{ captured, total, ratio, missing }` — Task 3 matches Task 6 `CoverageSchema` + Task 8 render.
- `gateFromVerdicts(unsupportedCount)` — Task 4 export, Task 6 import. Same signature.
- `__testOnly_gateVerdict(results)` — Task 8 export, Task 9 import. Same signature.
- `computeCoverage(family, note, groundTruth)` — Task 3 signature, called identically in Tasks 6, 11, 12.
- `normalizeKeyTerm` — Task 1 export, Task 3 import. Same shape.
- `groqClient()` / `anthropicClient()` — Task 4 Step 1 renames them in `llm-judge.ts`, Task 4 judge imports them. No remaining `groq()`/`anth()` references in `llm-judge.ts` after the rename (Step 1 updates both call sites).
- `FAITHFULNESS_UNSUPPORTED_TOLERANCE = 0` / `JA_FLIP_MIN_RATIO = 0.15` — single definitions (Task 4 / Task 2), imported where used.

No inconsistencies found.

**4. Ordering / dependency sanity:** Task 7's empirical fail-first (Step 5) and Task 14 both depend on Task 10 (interview wired into the runner) — Task 7 explicitly marks Step 5 as BLOCKED-by-Task-10 and the fixture authoring (Steps 1-4) runs earlier. Tasks 1→3→{4,6}, 4→{5,6}, 6→8→9, 2→6, 10 independent of the judge chain, 11/12 depend on 3. The recommended execution order is numeric (0..15); the only cross-dependency that violates strict numeric order is Task 7-Step-5 → Task 10, which is called out inline.

---

## 7. Execution notes

- **Controller tasks (7 partial, 14) are NOT delegable to subagents** — they require real foreground 3B inference on this 8GB-class machine (`pitfalls.md spike-llm`: background LLM stacks processes → swap thrash). The controlling session runs them and records the observed numbers into the commit bodies.
- **API keys:** the judge default is Claude (`ANTHROPIC_API_KEY`); Groq-70b (`GROQ_API_KEY`) is the `--judge llama-3.3-70b-versatile` fallback. Unit tests need no key. Never write a key value into any file, commit, or PR (`~/.claude` secret rule) — name the env-var only.
- **Lint/typecheck blind spot:** `pnpm typecheck` + `pnpm lint` cover only `src/**`. The eval-side static net is the Task 13 + Task 15 scoped tsx import + the full Vitest surface. Treat a green Vitest run as the real gate for eval code.
- **Vitest scope:** always file paths or `src/`/`eval/` with the real-LLM grep guard (Task 13 Step 1); never a bare dir that could sweep a hardware-gated test (`pitfalls.md vitest-scope`).

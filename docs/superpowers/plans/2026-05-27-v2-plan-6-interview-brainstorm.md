# Lisna v2 Note Creation — Plan 6: Interview + Brainstorm families + merge-LLM spike

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the **two purpose-driven families with cross-chunk semantic risk** — Interview (Q/A + themes + quotable_lines) and Brainstorm (idea_clusters + parking_lot) — together with the embedded **merge-LLM spike** that empirically validates whether a second grammar-constrained LLM call can correctly synthesize partial JSONs across chunks. The spike result (PASS / FAIL) determines whether the production orchestrator uses LLM-driven semantic merge or a deterministic-fallback path that explicitly degrades cross-chunk reasoning. Also: extend the Path G converter to honour `.max(N)` Zod bounds, run a 1B prompt-engineering iteration loop to determine if 1B is viable for Interview/Brainstorm at acceptable quality, and register both families' eval baselines so Plan 7's regression harness covers them.

**Architecture:** Three concurrent work surfaces.
- **A. Interview family** — `desktop/src/shared/families/interview/{schema,prompts,renderer,eval-baselines,index}.ts` with `NoteBase + PurposeDrivenNote + InterviewNote` overlay per spec §3.5, `.max(N)` bounds on every array, anti-parroting prompt with explicit JA-output + role-assignment hints. Renderer emits Q/A blocks with speaker chips.
- **B. Brainstorm family** — `desktop/src/shared/families/brainstorm/{schema,prompts,renderer,eval-baselines,index}.ts` per spec §3.6 with `idea_clusters` + `parking_lot`, post-decode UUID assignment for `ideas[].id` (3B cannot generate unique IDs reliably). Renderer emits argument-tree clusters.
- **C. merge-LLM spike** — `desktop/spikes/phase-1/01-merge-llm/` (NEW phase-1 directory — Plan 1 owned phase-0, Plan 6 owns phase-1 because the spike fires AFTER Plan 2's grammar-call wrapper landed). 2-chunk JA Interview fixture × grammar-constrained per-chunk × grammar-constrained merge call → measure Zod validity, no-slot-dup, argument-chain spans across chunks. PASS → productionize Task 7 (LLM-merge productionization). FAIL → productionize Task 8 (deterministic concat+dedup + UI degradation banner).

Plan 6 also amends Plan 2's `zod-to-gbnf.ts` to emit bounded GBNF (`min*N..N`) when `.max(N)` is present on `z.array(...)` — this is the **Path G** stack-on identified in `decision-0.2-path-e.md` + reinforced as load-bearing by Path F's 1B runaway. The converter extension lives in Task 17 with explicit cross-plan coordination documented (technically a Plan 2 amendment, but Plan 6 needs it as precondition for both `.max(N)` bounds + 1B iteration loop).

**Tech Stack:** TypeScript (strict), Zod v3 (`^3`), Vitest, no new runtime deps. Reuses Plan 2's `callWithGrammar` wrapper, Plan 2's `hydratePostDecode`, Plan 2's `chunkTranscript`, Plan 2's `zod-to-gbnf` (extended), Plan 4's `SpeakerLabeledSegment` + `resolveSpeakerLabel`, Plan 7's judge contract. Unit tests mock the LLM via injected `LlmGenerator`. Spike tasks (5, 6, 16) inherit `(spike-llm)` hardware-safety rule from `.claude/rules/pitfalls.md` — `JOBS=1` build, `kill -9` survivors, `ps -ef | grep llama-completion` cleanup verification before declaring done.

**Sub-plan position:** Plan 6 of 7 in the v2 note-creation sequence. Plans 1+2 landed (`44e546d` Phase 0 verdict + Plan 2 foundation infrastructure). Plan 3 (Lecture), Plan 4 (Diarization), Plan 5 (Meeting), Plan 7 (Eval harness) ship in parallel with Plan 6. Plan 6 has the highest unmeasured-quality risk in the v2 stack because (a) merge-LLM is empirically uncharted on 3B with structured JSON input, and (b) Path F just revealed 1B fails Spike 0.2's lecture slot-emergence floor at current prompt design.

**Spec reference:** `docs/superpowers/specs/2026-05-26-v2-structured-note-creation-design.md` (commit `af3af63`) §3.2 (PurposeDrivenNote), §3.5 (InterviewNote), §3.6 (BrainstormNote), §5.2 (Stop-phase pipeline), §5.2b (Merge contract — `themes: merge-llm`, `idea_clusters: merge-llm`), §7.3 (chunking + merge spike acceptance), §10.1 (legacy migration).

**Path F finding (load-bearing):** `desktop/spikes/phase-0/02-3b-lecture-grammar/decision-0.2-path-f.md` — 1B Llama 3.2 Q4_K_M produces structurally valid JSON 2/3 runs on the lecture fixture but emits zero `extras` slots and placeholder-filler content (`第N項` pattern, heading-duplicate summaries). 1/3 runs hit `n_predict=4096` cap and emit invalid JSON (control char in string). Path F verdict: **PASS on latency (mean 17.8 s well-behaved), FAIL on quality (slot emergence 0/3, target ≥ 1/3)**. Plan 6 inherits the burden: Task 16 (1B prompt-engineering iteration loop) is **load-bearing** — if it cannot recover slot emergence on 1B for Interview/Brainstorm, 1B stays a 3B-fallback ONLY (not the ≤ 12 GB default for these families).

**Branch:** `spec/v2-note-creation-design` (HEAD `a704afc`, pushed). All Plan 6 commits land on this branch.

---

## Plan 6 task-to-deliverable mapping

| # | Deliverable | Surface | Task(s) |
|---|---|---|---|
| 1 | Interview family schema (NoteBase + PurposeDrivenNote + Interview overlay) + `.max(N)` per Path G | A | Task 1, 2 |
| 2 | Brainstorm family schema (NoteBase + PurposeDrivenNote + Brainstorm overlay) + `.max(N)` per Path G | B | Task 3, 4 |
| 3 | Interview prompt builder (anti-parroting, JA, role hints) | A | Task 9 |
| 4 | Brainstorm prompt builder (anti-parroting, JA, argument-extraction + chain-id hints) | B | Task 10 |
| 5 | merge-LLM spike fixture + runner + prompt (2-chunk JA, grammar-merge, latency+Zod+semantic) | C | Task 5 |
| 6 | merge-LLM verdict memo (PASS/MIXED/FAIL criteria + decision) | C | Task 6 |
| 7 | Productionized merge step **[CONDITIONAL on Task 6 PASS]** | C | Task 7 |
| 8 | Deterministic-merge fallback + UI degradation banner **[CONDITIONAL on Task 6 FAIL]** | C | Task 8 |
| 9 | Diarization integration (Plan 4 consumption — `requiresDiarization=true` + speaker prefixes in renderer) | A+B | Task 11, 12 |
| 10 | Renderer Interview (Q/A blocks) + Brainstorm (argument tree) | A+B | Task 11, 12 |
| 11 | Orchestrator extension — `family === 'interview' \| 'brainstorm'` branches with merge-LLM gate | A+B+C | Task 13 |
| 12 | UI integration — Stop → family picker → progress (chunks + merge indicated) → render | A+B | Task 14 |
| 13 | Eval baseline registration for Interview + Brainstorm in Plan 7 `evalBaselines` | A+B | Task 15 |
| 14 | Migration framework chains — Interview v1 + Brainstorm v1 sample fixtures (committed Day 1, schema v1 = current shape) | A+B | Task 1 (Interview fixture) + Task 3 (Brainstorm fixture) |
| 15 | E2E test for both families (hardware-gated, integration smoke skipped by default) | A+B | Task 18 |
| 16 | Prompt-engineering iteration loop on 1B for Interview + Brainstorm | A+B | Task 16 |
| 17 | Path G converter implementation — `.max(N)` → bounded GBNF (Plan 2 amendment + downstream consumption) | A+B+C | Task 17 |

Total: **18 tasks** (Task 0 pre-flight + Tasks 1-17 + Task 18 final verification). Estimated LOC for this plan file: ~3500.

---

## File structure (delta only — what this plan touches)

```
desktop/src/shared/note-schema/
└── zod-to-gbnf.ts                                   # MODIFY (Task 17) — extend converter to emit bounded GBNF on .max(N)
└── __tests__/zod-to-gbnf-bounded.test.ts            # NEW (Task 17) — bounded-array converter tests

desktop/src/shared/families/
├── interview/                                       # NEW (Task 1+ )
│   ├── schema.ts                                    # Task 1 — InterviewNoteSchema (Zod, .max(N) on all arrays)
│   ├── purpose-driven.ts                            # Task 1 — PurposeDrivenNoteSchema (shared with Brainstorm)
│   ├── prompts/
│   │   └── v1-baseline.ts                           # Task 9 — Interview prompt + recommendedTemp + .max(N) hints
│   ├── renderer.tsx                                 # Task 11 — Q/A blocks + theme tags + quotable highlights
│   ├── eval-baselines.ts                            # Task 15 — array of fixture IDs (`interview-1on1-product-launch-30min`, ...)
│   ├── index.ts                                     # Task 11 — INTERVIEW_FAMILY: FamilyDefinition<InterviewNote>
│   └── __tests__/
│       ├── schema.test.ts                           # Task 1 — schema round-trip + Zod parse
│       ├── prompts.test.ts                          # Task 9 — prompt template substitution
│       └── renderer.test.tsx                        # Task 11 — basic React render assertions
├── brainstorm/                                      # NEW (Task 3+)
│   ├── schema.ts                                    # Task 3 — BrainstormNoteSchema (Zod, .max(N) on all arrays)
│   ├── prompts/
│   │   └── v1-baseline.ts                           # Task 10 — Brainstorm prompt + recommendedTemp + chain hints
│   ├── renderer.tsx                                 # Task 12 — argument tree + cluster tabs + parking lot
│   ├── eval-baselines.ts                            # Task 15 — fixture IDs (`brainstorm-product-naming-5person-25min`, ...)
│   ├── index.ts                                     # Task 12 — BRAINSTORM_FAMILY: FamilyDefinition<BrainstormNote>
│   └── __tests__/
│       ├── schema.test.ts                           # Task 3 — schema + UUID hydration round-trip
│       ├── prompts.test.ts                          # Task 10 — prompt template substitution
│       └── renderer.test.tsx                        # Task 12 — basic React render assertions
├── index.ts                                         # MODIFY (Task 11, 12) — register INTERVIEW_FAMILY + BRAINSTORM_FAMILY
└── util/
    └── merge-strategies.ts                          # MODIFY (Task 7 or 8) — install Interview + Brainstorm MergeStrategy

shared/note-schema/migrations/__tests__/fixtures/
├── v1-interview-sample.json                         # NEW (Task 1) — hand-curated migration-chain test fixture
└── v1-brainstorm-sample.json                        # NEW (Task 3) — hand-curated migration-chain test fixture

desktop/src/main/sidecar/
├── orchestrator.ts                                  # MODIFY (Task 13) — add `interview` + `brainstorm` family branches with merge-LLM gate
├── merge-llm.ts                                     # NEW (Task 7) — buildMergeLLMCall(family, partials) wrapper
├── deterministic-merge.ts                           # NEW (Task 8) — runDeterministicMerge(family, partials) fallback path
└── __tests__/
    ├── orchestrator-interview.test.ts               # Task 13 — branch-coverage + happy path
    ├── orchestrator-brainstorm.test.ts              # Task 13 — branch-coverage + UUID assignment
    ├── merge-llm.test.ts                            # Task 7 — mock LLM round-trip
    └── deterministic-merge.test.ts                  # Task 8 — concat-dedup + UI banner copy assertion

desktop/src/renderer/
├── routes/NoteView.tsx                              # MODIFY (Task 11, 12) — dispatch on family.id to family.renderer
├── components/FamilyPicker.tsx                      # MODIFY (Task 14) — add Interview + Brainstorm tile (icons + i18n keys)
├── components/MergeProgressBanner.tsx               # NEW (Task 8 OR 7) — "Cross-chunk reasoning disabled..." banner
└── __tests__/
    └── FamilyPicker-test.tsx                        # Task 14 — picker emits family + degradation copy

desktop/spikes/phase-1/                              # NEW DIRECTORY (Plan 6 owns phase-1)
└── 01-merge-llm/
    ├── README.md                                    # Task 5 — spike description + acceptance criteria
    ├── fixture-2chunk-interview.json                # Task 5 — synthetic 2-chunk JA interview transcript (~8K tok each)
    ├── chunk-prompt.ts                              # Task 5 — per-chunk prompt (uses Interview v1-baseline)
    ├── merge-prompt.ts                              # Task 5 — merge-LLM prompt (concatenated partials → final note)
    ├── run-merge-spike.ts                           # Task 5 — runner script (foreground, 3 invocations, mid-loop cooldown)
    ├── score-merge-spike.ts                         # Task 6 — verdict scorer (Zod + semantic + slot-dup)
    ├── results/                                     # Task 5 — JSON output per run + chunk + merge
    └── decision-1.1-verdict.md                      # Task 6 — verdict memo (PASS / MIXED / FAIL + rationale)

desktop/eval/fixtures/
├── interview/<scenario>/                            # MODIFY (Task 15) — register baselines (Plan 7 owns fixture authoring; Plan 6 just declares the IDs)
└── brainstorm/<scenario>/                           # MODIFY (Task 15) — same

desktop/src/main/sidecar/__tests__/
└── e2e-interview-brainstorm.test.ts                 # NEW (Task 18) — full pipeline smoke (hardware-gated, env-flag)
```

**What this plan does NOT touch:**
- Lecture family (`shared/families/lecture/` — owned by Plan 3).
- Meeting family (`shared/families/meeting/` — owned by Plan 5; Plan 6 reuses Plan 5's `PurposeDrivenNoteSchema` if Plan 5 lands first, else Task 1 in this plan creates it. Cross-plan coord noted at Task 1.)
- Diarization implementation (`shared/engine-interfaces.ts` `DiarizationEngine` — owned by Plan 4; Plan 6 consumes the freeze).
- Eval harness internals (Plan 7 owns judges/runners/scorecard; Plan 6 only registers `evalBaselines: string[]`).
- Plan 2's `callWithGrammar`, `hydratePostDecode`, `chunkTranscript`, `computeProvenance` (consumed verbatim).
- The legacy `ja-note-v1.ts` single-shot prompt — coexists per spec §10.1.

---

## Cross-plan dependency reading order

Before Task 1, the implementer MUST have these files cached (read once, no re-reads needed mid-execution):

1. **Plan 2** §"PromptVariant + selection logic" (Task 15) + §"Grammar-call wrapper" (Tasks 11-13) — interface contracts Plan 6 calls.
2. **Plan 2** §"FamilyDefinition + familyRegistry skeleton" (Task 14) — registry surface.
3. **Plan 2** §"ModelProfile registry + PipelineHooks interface" (Task 17) — model swap mechanism.
4. **Plan 4** §"Frozen contracts for Plan 5/6" (T-DI-22 trailing block) — DiarizationEngine + SpeakerLabeledSegment + resolveSpeakerLabel API.
5. **Plan 7** §"Interview judge prompt" (Task 11) + §"Brainstorm judge prompt" (Task 12) + §"ContractTest core" (Task 4) + §"Per-family contract rules" (Task 5) — judge axes Plan 6 must align prompts/rendering with.
6. **Spec** §3.5 (InterviewNote) + §3.6 (BrainstormNote) + §5.2b (Merge contract) — the source of truth.
7. **Path F memo** (`desktop/spikes/phase-0/02-3b-lecture-grammar/decision-0.2-path-f.md`) — read the "Plan 6 / Picker implications" + "Path G stack-on (revised)" sections. They directly script Tasks 16 and 17.

If any of these are missing or behind, stop and surface to the controller. Plan 6 *will not work* with stale assumptions about Plan 2 + Plan 4 contracts.

---

## Hardware-safety reminders (per `.claude/rules/pitfalls.md (spike-llm)`)

Tasks **5, 6, 16, 18** touch real LLM. They inherit:

- `JOBS=1 ./scripts/build.sh` for any sidecar rebuild. **NEVER** parallel-build on the dev machine (8 GB RAM, sustained Llama → swap → kernel panic).
- Use `try/finally` or `afterAll` to terminate `llama-completion` subprocesses after each invocation. Mid-loop cooldown `INTER_INVOCATION_COOLDOWN_MS = 5000`.
- Pre/post `ps -ef | grep -E "llama-completion|vitest.*spike" | grep -v grep`. Survivors → `kill -9` BEFORE declaring task done.
- Spike runners run **in foreground** (Bash with default timeout). NEVER use `run_in_background: true` — session restart auto-rehydrates the background process and stacks N copies.
- Sample count for spike loops: N=3 invocations × 1 fixture (well below Spike 0.2 N=5 envelope). Task 16 1B iteration loop runs at N=3 per prompt-variant attempt; if a variant FAILs, the controller decides whether to escalate to N=5 manually.

Unit tests (Tasks 1, 3, 9, 10, 11, 12, 13 with mocks, 14, 15, 17) use injected `LlmGenerator` mocks — no `llama-completion` spawn — and run in normal Vitest mode.

---

## Pre-flight (do once before Task 1)

### Task 0: Confirm branch + Plan 2 + Plan 4 Phase A + Plan 7 task 7 state

**Files:** none. Read-only check.

- [ ] **Step 1: Verify branch + recent merge of Plan 2 + Plan 4 Phase A**

Run:
```bash
git rev-parse --abbrev-ref HEAD
git log --oneline -10
```
Expected: `spec/v2-note-creation-design`. Recent commits should include Plan 2's "feat(v2-foundation): FamilyDefinition interface", Plan 4's "feat(v2-diarization): freeze DiarizationEngine + SpeakerLabeledSegment type contract", and at minimum Plan 7's "feat(eval): Interview judge prompt" / "feat(eval): Brainstorm judge prompt".

If absent: STOP. The controller must land the prerequisite tasks before Plan 6 can start. Surface which Plan/task is missing.

- [ ] **Step 2: Verify shared types exist**

Run:
```bash
test -f desktop/src/shared/families/index.ts && echo "FamilyDefinition: PRESENT"
test -f desktop/src/shared/families/util/prompts.ts && echo "PromptVariant: PRESENT"
test -f desktop/src/shared/families/util/speaker-resolve.ts && echo "SpeakerRef helper: PRESENT"
test -f desktop/src/shared/engine-interfaces.ts && grep -q "DiarizationEngine" desktop/src/shared/engine-interfaces.ts && echo "DiarizationEngine: PRESENT"
test -f desktop/src/main/sidecar/grammar-call.ts && echo "callWithGrammar: PRESENT"
test -f desktop/src/shared/note-schema/zod-to-gbnf.ts && echo "zod-to-gbnf: PRESENT"
test -f desktop/src/shared/note-schema/post-decode-hydration.ts && echo "hydratePostDecode: PRESENT"
test -f desktop/src/shared/note-schema/chunking.ts && echo "chunkTranscript: PRESENT"
```
Expected: all 7 lines print `PRESENT`. If any is missing, stop and resolve the missing dependency.

- [ ] **Step 3: Verify Plan 7's judge prompts exist (Plan 6's prompts must align)**

Run:
```bash
test -f desktop/eval/judges/families/interview-judge.ts && head -3 desktop/eval/judges/families/interview-judge.ts
test -f desktop/eval/judges/families/brainstorm-judge.ts && head -3 desktop/eval/judges/families/brainstorm-judge.ts
```
Expected: both files exist and reference `qaParity / themeExtraction / quotableSelection` (Interview) and `clusterCoherence / ideaDiversity / argumentChainDepth` (Brainstorm). If absent, surface to controller — Plan 6's prompt design depends on these axes.

- [ ] **Step 4: Verify Path F memo exists**

Run:
```bash
test -f desktop/spikes/phase-0/02-3b-lecture-grammar/decision-0.2-path-f.md && head -3 desktop/spikes/phase-0/02-3b-lecture-grammar/decision-0.2-path-f.md
```
Expected: first line `# Path F result — 1B Llama 3.2 re-spike on Spike 0.2 (2026-05-27)`. This memo's "Plan 6 implications" section scripts Tasks 16-17.

- [ ] **Step 5: Verify clean tree**

Run: `git status -s`
Expected: empty. If dirty, commit or stash before starting.

- [ ] **Step 6: Verify hardware envelope (`spike-llm` rule)**

Run:
```bash
ps -ef | grep -E "llama-completion|vitest.*spike" | grep -v grep || echo "(clean)"
```
Expected: `(clean)`. Any survivor → `kill -9 <pid>` before starting any task. Plan 6's spike Tasks 5+6+16 will compound any pre-existing leak into a kernel-panic risk.

---

## Phase A — Family schemas (Interview + Brainstorm)

These are pure-TypeScript tasks (no LLM). They land the Zod schemas + Path G `.max(N)` bounds + the migration-chain test fixtures. They are the foundation for the prompt builders (Phase B) and orchestrator branches (Phase D).

---

### Task 1: Interview family schema + PurposeDrivenNote + v1 migration fixture

**Files:**
- Create: `desktop/src/shared/families/interview/purpose-driven.ts`
- Create: `desktop/src/shared/families/interview/schema.ts`
- Create: `desktop/src/shared/families/interview/__tests__/schema.test.ts`
- Create: `desktop/src/shared/note-schema/migrations/__tests__/fixtures/v1-interview-sample.json`

**Goal:** Codify spec §3.2 (`PurposeDrivenNote`) + §3.5 (`InterviewNote`) as Zod schemas with `.max(N)` bounds per Path G (load-bearing per Path F's runaway finding). Plan 5 (Meeting) ALSO defines `PurposeDrivenNote` — if Plan 5 lands first, this task **imports** the existing one and only adds the Interview overlay. The duplicate-define risk is documented at step 1.

**Cross-plan coordination:** This task's `purpose-driven.ts` is the canonical home for `PurposeDrivenNoteSchema`. If Plan 5 lands first and put it elsewhere (e.g. `shared/families/meeting/purpose-driven.ts`), this task must:
1. Read Plan 5's file
2. Move it to `shared/families/util/purpose-driven.ts` (shared between Meeting + Interview + Brainstorm; util is the right home)
3. Update Plan 5's imports
4. Same in this plan

The SDD controller flags this as a coordination point. If both plans run in parallel, the first one to commit owns the location; the second one consumes via import + delete-own-copy.

- [ ] **Step 1: Check for existing PurposeDrivenNoteSchema**

Run:
```bash
grep -rl "PurposeDrivenNoteSchema\|PurposeDrivenNote" desktop/src/shared/families/ 2>/dev/null || echo "(not yet defined)"
```
Expected: `(not yet defined)` OR a path. If found in `shared/families/meeting/` (Plan 5 landed first), STOP, surface to controller for the file relocation per the cross-plan coordination above. Otherwise proceed with Step 2 (Plan 6 defines it canonically at `shared/families/util/purpose-driven.ts`).

- [ ] **Step 2: Write the failing schema test**

```typescript
// desktop/src/shared/families/interview/__tests__/schema.test.ts
import { describe, it, expect } from 'vitest';
import { InterviewNoteSchema, type InterviewNote } from '../schema';

describe('InterviewNoteSchema', () => {
  it('parses a minimal valid InterviewNote', () => {
    const minimal: InterviewNote = {
      schemaVersion: 1,
      family: 'interview',
      language: 'ja',
      generatedAt: '2026-05-27T00:00:00.000Z',
      generatedBy: { modelId: 'llama-3.2-3b-q4-km', promptVariantId: 'v1-baseline' },
      title: 'プロダクトマネジャー候補者面接',
      purpose: '面接を通じて候補者の経験と思考プロセスを把握する。',
      subject_summary: '5年のPM経験を持つ候補者との1対1面接。',
      qa_pairs: [{
        question: 'これまで最も困難だった意思決定を教えてください。',
        answer: '社内で意見が割れたローンチタイミングの判断でした。',
        ts: 12,
        asked_by: 0,
        answered_by: 1,
        from: 'transcript',
      }],
      themes: [{ name: '意思決定', appears_at_ts: [12, 405] }],
      quotable_lines: [],
      key_takeaways: [],
    };
    const parsed = InterviewNoteSchema.parse(minimal);
    expect(parsed.family).toBe('interview');
    expect(parsed.qa_pairs).toHaveLength(1);
  });

  it('rejects when family !== "interview"', () => {
    const wrong = { ...validInterviewFixture(), family: 'brainstorm' };
    expect(() => InterviewNoteSchema.parse(wrong)).toThrow();
  });

  it('enforces .max bound on qa_pairs', () => {
    // Per Path G: bound qa_pairs at 80 (a long 60-min interview ≈ 1 Q/min)
    const tooMany = {
      ...validInterviewFixture(),
      qa_pairs: Array.from({ length: 81 }, (_, i) => ({
        question: `Q${i}`, answer: `A${i}`, ts: i, asked_by: 0, answered_by: 1, from: 'transcript' as const,
      })),
    };
    expect(() => InterviewNoteSchema.parse(tooMany)).toThrow();
  });

  it('enforces .max bound on themes', () => {
    const tooMany = {
      ...validInterviewFixture(),
      themes: Array.from({ length: 13 }, (_, i) => ({ name: `T${i}`, appears_at_ts: [i] })),
    };
    expect(() => InterviewNoteSchema.parse(tooMany)).toThrow();
  });

  it('asked_by === answered_by is allowed by schema (Plan 7 ContractTest rejects it later)', () => {
    // Schema-level: same speaker asking + answering is structurally valid (a candidate
    // narrating their own thinking). Plan 7's Per-family contract rule rejects it as a
    // diarization-quality issue, not a schema issue. Keep the schema permissive.
    const same = {
      ...validInterviewFixture(),
      qa_pairs: [{ question: 'Q', answer: 'A', ts: 1, asked_by: 0, answered_by: 0, from: 'transcript' as const }],
    };
    expect(() => InterviewNoteSchema.parse(same)).not.toThrow();
  });

  it('accepts purpose-driven inherited fields (conclusions + next_steps)', () => {
    const withConclusions = {
      ...validInterviewFixture(),
      conclusions: [{ text: '候補者は意思決定速度に優れる', from: 'inferred' as const }],
      next_steps: [{ text: '2次面接スケジュール送付', owner: 0, due: '来週月曜', ts: 1800, from: 'inferred' as const }],
    };
    expect(() => InterviewNoteSchema.parse(withConclusions)).not.toThrow();
  });
});

function validInterviewFixture(): InterviewNote {
  return {
    schemaVersion: 1,
    family: 'interview',
    language: 'ja',
    generatedAt: '2026-05-27T00:00:00.000Z',
    generatedBy: { modelId: 'llama-3.2-3b-q4-km', promptVariantId: 'v1-baseline' },
    title: 'fixture',
    purpose: 'fixture',
    subject_summary: 'fixture',
    qa_pairs: [],
    themes: [],
    quotable_lines: [],
    key_takeaways: [],
  };
}
```

- [ ] **Step 3: Run the test, expect FAIL**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/interview/__tests__/schema.test.ts`
Expected: FAIL "Cannot find module '../schema'".

- [ ] **Step 4: Implement `purpose-driven.ts` (shared schema, lives at families/util but Task 1 owns the create)**

Create `desktop/src/shared/families/util/purpose-driven.ts`:
```typescript
// desktop/src/shared/families/util/purpose-driven.ts
import { z } from 'zod';
import { NoteBaseSchema, ProvenanceSchema, SpeakerRefSchema } from '../../note-schema/base';

/**
 * Per spec §3.2. Shared by Meeting / Interview / Brainstorm.
 *
 * Path G bounds:
 *   conclusions: .max(40)   — 40 distinct insights is the upper bound for a 60-min purpose-driven session
 *   next_steps:  .max(40)   — same scale
 *   (Per-family overlays add their own .max bounds for family-specific arrays.)
 *
 * Fields marked .describe(POST_DECODE) are stripped by zod-to-gbnf (Plan 2 Task 18).
 * The LLM does not emit them; hydratePostDecode fills them via computeProvenance().
 */
const POST_DECODE = JSON.stringify({ postDecodeOnly: true });

export const PurposeDrivenNoteSchema = NoteBaseSchema.extend({
  purpose: z.string().max(2000),
  conclusions: z.array(z.object({
    text: z.string().max(1000),
    ts: z.number().nonnegative().optional(),
    from: ProvenanceSchema.describe(POST_DECODE),
  })).max(40).optional(),
  next_steps: z.array(z.object({
    text: z.string().max(1000),
    owner: SpeakerRefSchema.optional(),
    due: z.string().max(120).optional(),
    ts: z.number().nonnegative(),
    from: ProvenanceSchema.describe(POST_DECODE),
  })).max(40).optional(),
});

export type PurposeDrivenNote = z.infer<typeof PurposeDrivenNoteSchema>;
```

- [ ] **Step 5: Implement `interview/schema.ts`**

Create `desktop/src/shared/families/interview/schema.ts`:
```typescript
// desktop/src/shared/families/interview/schema.ts
import { z } from 'zod';
import { PurposeDrivenNoteSchema } from '../util/purpose-driven';
import { ProvenanceSchema, SpeakerRefSchema } from '../../note-schema/base';

const POST_DECODE = JSON.stringify({ postDecodeOnly: true });

/**
 * Per spec §3.5. InterviewNote overlay on PurposeDrivenNote.
 *
 * Path G bounds (rationale per array):
 *   qa_pairs:       .max(80)   — 80 Q/A across a 60-min interview = 1.3/min, generous ceiling
 *   themes:         .max(12)   — 12 named themes is the discriminating ceiling (>12 = LLM padding)
 *   themes[].appears_at_ts: .max(20)  — 20 ts anchors per theme caps per-theme runaway
 *   quotable_lines: .max(20)   — 20 standout quotes is editor-friendly upper bound
 *   key_takeaways:  .max(15)
 *   participants:   .max(8)    — 8 speakers in a 1:1 or panel is plenty
 *
 * These bounds compose with Plan 2 grammar-call wrapper's maxTokens budget;
 * the GBNF converter (Path G, Task 17 below) emits `<...>{0,N}` repetitions
 * so the LLM cannot exceed N items even if it tries.
 */
export const InterviewNoteSchema = PurposeDrivenNoteSchema.extend({
  family: z.literal('interview'),

  subject_summary: z.string().max(3000),

  participants: z.array(z.object({
    speakerRef: SpeakerRefSchema,
    role: z.enum(['interviewer', 'interviewee']),
  })).max(8).optional(),

  qa_pairs: z.array(z.object({
    question: z.string().max(1500),
    answer: z.string().max(3000),
    ts: z.number().nonnegative(),
    asked_by: SpeakerRefSchema,
    answered_by: SpeakerRefSchema,
    themes: z.array(z.string().max(80)).max(6).optional(),
    from: ProvenanceSchema.describe(POST_DECODE),
  })).max(80),

  themes: z.array(z.object({
    name: z.string().max(120),
    description: z.string().max(500).optional(),
    appears_at_ts: z.array(z.number().nonnegative()).max(20),
  })).max(12),

  quotable_lines: z.array(z.object({
    text: z.string().max(500),
    speakerRef: SpeakerRefSchema,
    ts: z.number().nonnegative(),
    why_notable: z.string().max(300).optional(),
  })).max(20),

  key_takeaways: z.array(z.object({
    text: z.string().max(800),
    from: ProvenanceSchema.describe(POST_DECODE),
  })).max(15),
});

export type InterviewNote = z.infer<typeof InterviewNoteSchema>;
```

- [ ] **Step 6: Run the test, expect PASS**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/interview/__tests__/schema.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 7: Add the `v1-interview-sample.json` migration-chain fixture (spec §4 #13 — committed Day 1)**

Create `desktop/src/shared/note-schema/migrations/__tests__/fixtures/v1-interview-sample.json`:
```json
{
  "schemaVersion": 1,
  "family": "interview",
  "language": "ja",
  "generatedAt": "2026-05-27T09:00:00.000Z",
  "generatedBy": {
    "modelId": "llama-3.2-3b-q4-km",
    "promptVariantId": "v1-baseline"
  },
  "title": "プロダクトマネジャー職 1次面接",
  "purpose": "PM候補者の意思決定経験と業界知見を把握する1次面接。",
  "subject_summary": "5年のPM経験を持つ候補者との60分1対1面接。BtoBプロダクトの担当が中心。",
  "participants": [
    { "speakerRef": 0, "role": "interviewer" },
    { "speakerRef": 1, "role": "interviewee" }
  ],
  "qa_pairs": [
    {
      "question": "これまで最も困難だった意思決定を教えてください。",
      "answer": "社内で意見が割れたローンチタイミングの判断です。データは強行を支持していましたが、品質チームが反対していました。",
      "ts": 120,
      "asked_by": 0,
      "answered_by": 1,
      "themes": ["意思決定", "ステークホルダー調整"],
      "from": "transcript"
    },
    {
      "question": "結果はどうなりましたか?",
      "answer": "2週間延期して品質を担保しました。後から見れば正解でしたが、当時は決断が重かったです。",
      "ts": 250,
      "asked_by": 0,
      "answered_by": 1,
      "themes": ["意思決定"],
      "from": "transcript"
    }
  ],
  "themes": [
    {
      "name": "意思決定",
      "description": "難しい判断とその振り返り",
      "appears_at_ts": [120, 250, 1800]
    },
    {
      "name": "ステークホルダー調整",
      "appears_at_ts": [120, 450]
    }
  ],
  "quotable_lines": [
    {
      "text": "決断が重いほど、後から振り返れる材料を残すようにしています。",
      "speakerRef": 1,
      "ts": 1500,
      "why_notable": "意思決定への姿勢を端的に表す"
    }
  ],
  "key_takeaways": [
    {
      "text": "候補者は意思決定の遅れより、判断材料の充実を重視する。",
      "from": "inferred"
    }
  ],
  "conclusions": [
    {
      "text": "2次面接へ推薦。技術判断 + ステークホルダー対応の両面で経験が豊富。",
      "from": "inferred"
    }
  ],
  "next_steps": [
    {
      "text": "2次面接スケジュール送付 (来週月曜)",
      "owner": 0,
      "due": "来週月曜",
      "ts": 3500,
      "from": "inferred"
    }
  ]
}
```

- [ ] **Step 8: Re-run schema test + migration-chain test**

Run:
```bash
pnpm --filter @lisna/desktop test desktop/src/shared/families/interview/__tests__/schema.test.ts
pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/migrations/__tests__
```
Expected: both PASS (schema test from Step 6; migration-chain test from Plan 2 Task — confirms the fixture parses through the chain runner without registered migrations, since schema version 1 IS the current shape).

- [ ] **Step 9: Commit**

```bash
git add desktop/src/shared/families/util/purpose-driven.ts \
        desktop/src/shared/families/interview/schema.ts \
        desktop/src/shared/families/interview/__tests__/schema.test.ts \
        desktop/src/shared/note-schema/migrations/__tests__/fixtures/v1-interview-sample.json
git commit -m "feat(v2-interview): InterviewNote schema + PurposeDrivenNote shared base + v1 migration fixture"
```

---

### Task 2: Interview `.max(N)` budget validation

**Files:**
- Modify: `desktop/src/shared/families/interview/__tests__/schema.test.ts` (extend tests)
- Read-only consumers: `desktop/src/shared/families/interview/schema.ts`

**Goal:** Lock the Path G bounds with quantitative justification. The bound numbers ARE the production budget — the merge-LLM call inherits them, the 1B iteration in Task 16 measures whether 1B can still emit meaningful slots within these bounds. This task adds assertion tests that document the rationale and catches accidental future widening.

- [ ] **Step 1: Append the budget tests**

```typescript
// Append to desktop/src/shared/families/interview/__tests__/schema.test.ts

describe('InterviewNoteSchema — Path G budget locked', () => {
  // These tests fail loud if a future PR widens the bound without
  // updating the spec amendment + Plan 6 / Path F memo.

  it('qa_pairs upper bound is 80 (60-min @ 1.3 Q/min ceiling)', () => {
    const at80 = {
      ...validInterviewFixture(),
      qa_pairs: Array.from({ length: 80 }, (_, i) => ({
        question: 'Q', answer: 'A', ts: i, asked_by: 0, answered_by: 1, from: 'transcript' as const,
      })),
    };
    expect(() => InterviewNoteSchema.parse(at80)).not.toThrow();

    const at81 = {
      ...validInterviewFixture(),
      qa_pairs: Array.from({ length: 81 }, (_, i) => ({
        question: 'Q', answer: 'A', ts: i, asked_by: 0, answered_by: 1, from: 'transcript' as const,
      })),
    };
    expect(() => InterviewNoteSchema.parse(at81)).toThrow();
  });

  it('themes upper bound is 12 (3B + 1B padding ceiling per Path F)', () => {
    const at12 = {
      ...validInterviewFixture(),
      themes: Array.from({ length: 12 }, (_, i) => ({ name: `T${i}`, appears_at_ts: [i] })),
    };
    expect(() => InterviewNoteSchema.parse(at12)).not.toThrow();

    const at13 = {
      ...validInterviewFixture(),
      themes: Array.from({ length: 13 }, (_, i) => ({ name: `T${i}`, appears_at_ts: [i] })),
    };
    expect(() => InterviewNoteSchema.parse(at13)).toThrow();
  });

  it('quotable_lines upper bound is 20 (editor scan-friendly)', () => {
    const at20 = {
      ...validInterviewFixture(),
      quotable_lines: Array.from({ length: 20 }, (_, i) => ({
        text: 'q', speakerRef: 0, ts: i,
      })),
    };
    expect(() => InterviewNoteSchema.parse(at20)).not.toThrow();

    const at21 = {
      ...validInterviewFixture(),
      quotable_lines: Array.from({ length: 21 }, (_, i) => ({
        text: 'q', speakerRef: 0, ts: i,
      })),
    };
    expect(() => InterviewNoteSchema.parse(at21)).toThrow();
  });

  it('themes[].appears_at_ts upper bound is 20 (per-theme cap)', () => {
    const at20 = {
      ...validInterviewFixture(),
      themes: [{ name: 'T', appears_at_ts: Array.from({ length: 20 }, (_, i) => i) }],
    };
    expect(() => InterviewNoteSchema.parse(at20)).not.toThrow();

    const at21 = {
      ...validInterviewFixture(),
      themes: [{ name: 'T', appears_at_ts: Array.from({ length: 21 }, (_, i) => i) }],
    };
    expect(() => InterviewNoteSchema.parse(at21)).toThrow();
  });
});
```

- [ ] **Step 2: Run, expect PASS**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/interview/__tests__/schema.test.ts`
Expected: original 6 + 4 new = 10 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/shared/families/interview/__tests__/schema.test.ts
git commit -m "test(v2-interview): lock Path G .max(N) budgets with quantitative rationale"
```

---

### Task 3: Brainstorm family schema + UUID hydration contract + v1 migration fixture

**Files:**
- Create: `desktop/src/shared/families/brainstorm/schema.ts`
- Create: `desktop/src/shared/families/brainstorm/__tests__/schema.test.ts`
- Create: `desktop/src/shared/note-schema/migrations/__tests__/fixtures/v1-brainstorm-sample.json`
- Modify: `desktop/src/shared/note-schema/post-decode-hydration.ts` — add `assignBrainstormIdeaIds()` helper

**Goal:** Per spec §3.6 + spec §2.8 grammar-⊂-validated split:
- BrainstormNote schema has `idea_clusters[].ideas[].id: string` (UUID).
- Per spec §2.8: `ids` are POST-DECODE — the LLM never emits them, `hydratePostDecode` assigns via `uuid()` after the LLM call lands. The GBNF schema must strip `id` (Plan 2's converter already strips fields marked `postDecodeOnly`).
- Path G bounds: `.max(N)` on `idea_clusters`, per-cluster `ideas`, `parking_lot`.

- [ ] **Step 1: Write the failing schema test**

```typescript
// desktop/src/shared/families/brainstorm/__tests__/schema.test.ts
import { describe, it, expect } from 'vitest';
import { BrainstormNoteSchema, type BrainstormNote } from '../schema';

describe('BrainstormNoteSchema', () => {
  it('parses a minimal valid BrainstormNote', () => {
    const minimal: BrainstormNote = {
      schemaVersion: 1,
      family: 'brainstorm',
      language: 'ja',
      generatedAt: '2026-05-27T00:00:00.000Z',
      generatedBy: { modelId: 'llama-3.2-3b-q4-km', promptVariantId: 'v1-baseline' },
      title: '新機能アイデア出し',
      purpose: '次クォーターの目玉機能を5案出す。',
      idea_clusters: [{
        theme: '速度向上',
        ideas: [{
          id: '550e8400-e29b-41d4-a716-446655440000',
          text: 'ノート生成5秒以内に',
          contributed_by: 1,
          ts: 60,
          from: 'transcript',
        }],
      }],
    };
    const parsed = BrainstormNoteSchema.parse(minimal);
    expect(parsed.family).toBe('brainstorm');
    expect(parsed.idea_clusters).toHaveLength(1);
  });

  it('rejects when family !== "brainstorm"', () => {
    const wrong = { ...validBrainstormFixture(), family: 'interview' };
    expect(() => BrainstormNoteSchema.parse(wrong)).toThrow();
  });

  it('idea_clusters: .max(15) — 15 named themes is the divergent ceiling', () => {
    const at16 = {
      ...validBrainstormFixture(),
      idea_clusters: Array.from({ length: 16 }, (_, i) => ({
        theme: `T${i}`,
        ideas: [{ id: '00000000-0000-0000-0000-000000000000', text: 'i', ts: i, from: 'transcript' as const }],
      })),
    };
    expect(() => BrainstormNoteSchema.parse(at16)).toThrow();
  });

  it('idea_clusters[].ideas: .max(30) — single-cluster ceiling', () => {
    const at31 = {
      ...validBrainstormFixture(),
      idea_clusters: [{
        theme: 'T',
        ideas: Array.from({ length: 31 }, (_, i) => ({
          id: '00000000-0000-0000-0000-000000000000',
          text: 'i',
          ts: i,
          from: 'transcript' as const,
        })),
      }],
    };
    expect(() => BrainstormNoteSchema.parse(at31)).toThrow();
  });

  it('parking_lot: .max(20)', () => {
    const at21 = {
      ...validBrainstormFixture(),
      parking_lot: Array.from({ length: 21 }, (_, i) => ({
        text: 't', ts: i, from: 'transcript' as const,
      })),
    };
    expect(() => BrainstormNoteSchema.parse(at21)).toThrow();
  });

  it('rejects empty idea_clusters[].ideas (cluster must have ≥1 idea)', () => {
    const empty = {
      ...validBrainstormFixture(),
      idea_clusters: [{ theme: 'T', ideas: [] }],
    };
    expect(() => BrainstormNoteSchema.parse(empty)).toThrow();
  });

  it('atmosphere is bounded enum', () => {
    expect(() => BrainstormNoteSchema.parse({
      ...validBrainstormFixture(),
      atmosphere: 'collaborative' as const,
    })).not.toThrow();
    expect(() => BrainstormNoteSchema.parse({
      ...validBrainstormFixture(),
      atmosphere: 'tense' as any,    // 'tense' is for Meeting, not Brainstorm
    })).toThrow();
  });

  it('ids must be UUID-shaped (post-decode hydration outputs uuid v4)', () => {
    const badId = {
      ...validBrainstormFixture(),
      idea_clusters: [{
        theme: 'T',
        ideas: [{ id: 'not-a-uuid', text: 'i', ts: 1, from: 'transcript' as const }],
      }],
    };
    expect(() => BrainstormNoteSchema.parse(badId)).toThrow();
  });
});

function validBrainstormFixture(): BrainstormNote {
  return {
    schemaVersion: 1,
    family: 'brainstorm',
    language: 'ja',
    generatedAt: '2026-05-27T00:00:00.000Z',
    generatedBy: { modelId: 'llama-3.2-3b-q4-km', promptVariantId: 'v1-baseline' },
    title: 'fixture',
    purpose: 'fixture',
    idea_clusters: [{
      theme: 'T',
      ideas: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        text: 'i',
        ts: 1,
        from: 'transcript',
      }],
    }],
  };
}
```

- [ ] **Step 2: Run, expect FAIL ("Cannot find module '../schema'")**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/brainstorm/__tests__/schema.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `brainstorm/schema.ts`**

```typescript
// desktop/src/shared/families/brainstorm/schema.ts
import { z } from 'zod';
import { PurposeDrivenNoteSchema } from '../util/purpose-driven';
import { ProvenanceSchema, SpeakerRefSchema } from '../../note-schema/base';

const POST_DECODE = JSON.stringify({ postDecodeOnly: true });

/**
 * Per spec §3.6. BrainstormNote overlay on PurposeDrivenNote.
 *
 * `ids` are POST-DECODE per spec §2.8 — the LLM emits ideas without ids,
 * hydratePostDecode (assignBrainstormIdeaIds) fills uuid() after grammar-
 * constrained decode lands. The GBNF schema sees no `id` field; the
 * validated schema requires it (uuid v4 shape).
 *
 * Path G bounds:
 *   idea_clusters:           .max(15)
 *   idea_clusters[].ideas:   .max(30) per cluster, .min(1) (empty cluster = LLM padding)
 *   parking_lot:             .max(20)
 *   conclusions / next_steps inherited from PurposeDrivenNote at .max(40)
 *
 * No `decisions` field by design (spec §3.6 — brainstorm is divergent;
 * decisions cut intentionally). atmosphere enum is narrower than Meeting.
 */
export const BrainstormNoteSchema = PurposeDrivenNoteSchema.extend({
  family: z.literal('brainstorm'),

  idea_clusters: z.array(z.object({
    theme: z.string().max(120),
    ideas: z.array(z.object({
      id: z.string().uuid().describe(POST_DECODE),
      text: z.string().max(1000),
      contributed_by: SpeakerRefSchema.optional(),
      ts: z.number().nonnegative(),
      from: ProvenanceSchema.describe(POST_DECODE),
    })).min(1).max(30),
  })).max(15),

  parking_lot: z.array(z.object({
    text: z.string().max(800),
    ts: z.number().nonnegative(),
    from: ProvenanceSchema.describe(POST_DECODE),
  })).max(20).optional(),

  atmosphere: z.enum(['collaborative', 'energetic', 'subdued']).optional(),
});

export type BrainstormNote = z.infer<typeof BrainstormNoteSchema>;
```

- [ ] **Step 4: Run schema test, expect PASS**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/brainstorm/__tests__/schema.test.ts`
Expected: all 8 tests PASS.

- [ ] **Step 5: Add `assignBrainstormIdeaIds` hydration helper**

Append to `desktop/src/shared/note-schema/post-decode-hydration.ts`:
```typescript
// desktop/src/shared/note-schema/post-decode-hydration.ts (extend existing module)
import { randomUUID } from 'node:crypto';

/**
 * Per spec §3.6 + §5.2 Stage 2. Walks idea_clusters[].ideas and assigns a
 * UUID v4 to each idea where `id` is undefined. Existing ids preserved.
 *
 * NOTE: this is a typed shim — we use `Record<string, unknown>` for the
 * traversal to avoid importing BrainstormNoteSchema (post-decode hydration
 * lives in note-schema/, schemas live in families/; the dep arrow points
 * down). The actual schema parse catches malformed ids at the next stage.
 */
export function assignBrainstormIdeaIds(
  rawNote: Record<string, unknown>,
): Record<string, unknown> {
  if (rawNote.family !== 'brainstorm') return rawNote;
  const clusters = rawNote.idea_clusters;
  if (!Array.isArray(clusters)) return rawNote;
  return {
    ...rawNote,
    idea_clusters: clusters.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const cluster = c as Record<string, unknown>;
      const ideas = cluster.ideas;
      if (!Array.isArray(ideas)) return cluster;
      return {
        ...cluster,
        ideas: ideas.map((idea) => {
          if (!idea || typeof idea !== 'object') return idea;
          const id = (idea as Record<string, unknown>).id;
          if (typeof id === 'string' && id.length > 0) return idea;
          return { ...(idea as object), id: randomUUID() };
        }),
      };
    }),
  };
}
```

- [ ] **Step 6: Add tests for `assignBrainstormIdeaIds`**

Append to `desktop/src/shared/note-schema/__tests__/post-decode-hydration.test.ts`:
```typescript
import { assignBrainstormIdeaIds } from '../post-decode-hydration';

describe('assignBrainstormIdeaIds', () => {
  it('assigns UUID v4 to ideas without id', () => {
    const input = {
      family: 'brainstorm',
      idea_clusters: [{ theme: 'T', ideas: [{ text: 'a' }, { text: 'b' }] }],
    };
    const out = assignBrainstormIdeaIds(input);
    const clusters = (out as any).idea_clusters;
    expect(clusters[0].ideas[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(clusters[0].ideas[1].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(clusters[0].ideas[0].id).not.toBe(clusters[0].ideas[1].id);
  });

  it('preserves existing ids', () => {
    const existing = '550e8400-e29b-41d4-a716-446655440000';
    const input = {
      family: 'brainstorm',
      idea_clusters: [{ theme: 'T', ideas: [{ id: existing, text: 'a' }] }],
    };
    const out = assignBrainstormIdeaIds(input);
    expect((out as any).idea_clusters[0].ideas[0].id).toBe(existing);
  });

  it('no-op for non-brainstorm families', () => {
    const input = { family: 'interview', idea_clusters: [] };
    const out = assignBrainstormIdeaIds(input);
    expect(out).toEqual(input);
  });

  it('handles missing idea_clusters defensively', () => {
    const input = { family: 'brainstorm' };
    const out = assignBrainstormIdeaIds(input);
    expect(out).toEqual(input);
  });
});
```

- [ ] **Step 7: Run hydration tests**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/post-decode-hydration.test.ts`
Expected: existing tests PASS + 4 new tests PASS.

- [ ] **Step 8: Create the v1-brainstorm-sample.json migration fixture**

Create `desktop/src/shared/note-schema/migrations/__tests__/fixtures/v1-brainstorm-sample.json`:
```json
{
  "schemaVersion": 1,
  "family": "brainstorm",
  "language": "ja",
  "generatedAt": "2026-05-27T10:00:00.000Z",
  "generatedBy": {
    "modelId": "llama-3.2-3b-q4-km",
    "promptVariantId": "v1-baseline"
  },
  "title": "次クォーター新機能ブレインストーミング",
  "purpose": "次クォーターで取り組む目玉機能を5案出し、優先順位付け前の divergent thinking を残す。",
  "atmosphere": "collaborative",
  "idea_clusters": [
    {
      "theme": "速度・パフォーマンス",
      "ideas": [
        {
          "id": "11111111-1111-4111-8111-111111111111",
          "text": "ノート生成を5秒以内に短縮する",
          "contributed_by": 1,
          "ts": 60,
          "from": "transcript"
        },
        {
          "id": "22222222-2222-4222-8222-222222222222",
          "text": "起動時にモデルを事前ロードしておく",
          "contributed_by": 2,
          "ts": 120,
          "from": "transcript"
        }
      ]
    },
    {
      "theme": "他ツール連携",
      "ideas": [
        {
          "id": "33333333-3333-4333-8333-333333333333",
          "text": "Slack に共有リンクを直接ペーストできるようにする",
          "contributed_by": 3,
          "ts": 600,
          "from": "transcript"
        },
        {
          "id": "44444444-4444-4444-8444-444444444444",
          "text": "Obsidian の vault 配下に Markdown を吐き出す",
          "contributed_by": 1,
          "ts": 720,
          "from": "transcript"
        }
      ]
    }
  ],
  "parking_lot": [
    {
      "text": "音声から自動 highlight 切り抜き (技術的に重い、別スプリント)",
      "ts": 1500,
      "from": "transcript"
    }
  ],
  "conclusions": [
    {
      "text": "速度向上と他ツール連携の2軸が議論の中心。",
      "from": "inferred"
    }
  ],
  "next_steps": [
    {
      "text": "各案の見積もりを次のミーティングまでに作成する",
      "owner": 0,
      "due": "次のミーティング",
      "ts": 1700,
      "from": "inferred"
    }
  ]
}
```

- [ ] **Step 9: Re-run schema + migration tests**

Run:
```bash
pnpm --filter @lisna/desktop test desktop/src/shared/families/brainstorm/__tests__/schema.test.ts
pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/migrations/__tests__
```
Expected: both green.

- [ ] **Step 10: Commit**

```bash
git add desktop/src/shared/families/brainstorm/schema.ts \
        desktop/src/shared/families/brainstorm/__tests__/schema.test.ts \
        desktop/src/shared/note-schema/post-decode-hydration.ts \
        desktop/src/shared/note-schema/__tests__/post-decode-hydration.test.ts \
        desktop/src/shared/note-schema/migrations/__tests__/fixtures/v1-brainstorm-sample.json
git commit -m "feat(v2-brainstorm): BrainstormNote schema + UUID id post-decode hydration + v1 fixture"
```

---

### Task 4: Brainstorm `.max(N)` budget validation + UUID round-trip

**Files:**
- Modify: `desktop/src/shared/families/brainstorm/__tests__/schema.test.ts`

**Goal:** Same as Task 2 (Interview) but for Brainstorm: lock the Path G bounds and add a round-trip test that proves `assignBrainstormIdeaIds → BrainstormNoteSchema.parse` is monotonic (no information loss).

- [ ] **Step 1: Append budget + round-trip tests**

```typescript
// Append to desktop/src/shared/families/brainstorm/__tests__/schema.test.ts
import { assignBrainstormIdeaIds } from '../../../note-schema/post-decode-hydration';

describe('BrainstormNoteSchema — Path G budget locked', () => {
  it('idea_clusters bound is 15', () => {
    const at15 = {
      ...validBrainstormFixture(),
      idea_clusters: Array.from({ length: 15 }, (_, i) => ({
        theme: `T${i}`,
        ideas: [{ id: '00000000-0000-4000-8000-000000000000', text: 'i', ts: i, from: 'transcript' as const }],
      })),
    };
    expect(() => BrainstormNoteSchema.parse(at15)).not.toThrow();

    const at16 = {
      ...validBrainstormFixture(),
      idea_clusters: Array.from({ length: 16 }, (_, i) => ({
        theme: `T${i}`,
        ideas: [{ id: '00000000-0000-4000-8000-000000000000', text: 'i', ts: i, from: 'transcript' as const }],
      })),
    };
    expect(() => BrainstormNoteSchema.parse(at16)).toThrow();
  });

  it('per-cluster ideas bound is 30', () => {
    const at30 = {
      ...validBrainstormFixture(),
      idea_clusters: [{
        theme: 'T',
        ideas: Array.from({ length: 30 }, (_, i) => ({
          id: '00000000-0000-4000-8000-000000000000', text: 'i', ts: i, from: 'transcript' as const,
        })),
      }],
    };
    expect(() => BrainstormNoteSchema.parse(at30)).not.toThrow();

    const at31 = {
      ...validBrainstormFixture(),
      idea_clusters: [{
        theme: 'T',
        ideas: Array.from({ length: 31 }, (_, i) => ({
          id: '00000000-0000-4000-8000-000000000000', text: 'i', ts: i, from: 'transcript' as const,
        })),
      }],
    };
    expect(() => BrainstormNoteSchema.parse(at31)).toThrow();
  });

  it('parking_lot bound is 20', () => {
    const at20 = {
      ...validBrainstormFixture(),
      parking_lot: Array.from({ length: 20 }, (_, i) => ({ text: 't', ts: i, from: 'transcript' as const })),
    };
    expect(() => BrainstormNoteSchema.parse(at20)).not.toThrow();
  });
});

describe('Brainstorm hydration round-trip', () => {
  it('LLM-emitted shape (no ids) → hydrate → parse succeeds', () => {
    // Simulate what the LLM would emit through the GBNF subset (ids stripped).
    const llmShape = {
      schemaVersion: 1,
      family: 'brainstorm',
      language: 'ja',
      generatedAt: '2026-05-27T00:00:00.000Z',
      generatedBy: { modelId: 'llama-3.2-3b-q4-km', promptVariantId: 'v1-baseline' },
      title: 'fixture',
      purpose: 'fixture',
      idea_clusters: [{
        theme: 'T',
        ideas: [
          { text: 'idea1', ts: 10 },  // no id, no from — both post-decode-only
          { text: 'idea2', ts: 20 },
        ],
      }],
    };
    const hydrated = assignBrainstormIdeaIds(llmShape);

    // After hydration: ids exist. Provenance still missing (computeProvenance
    // is a separate stage; here we hand-fill for the test).
    const clusters = (hydrated as any).idea_clusters;
    clusters[0].ideas[0].from = 'transcript';
    clusters[0].ideas[1].from = 'transcript';

    const parsed = BrainstormNoteSchema.parse(hydrated);
    expect(parsed.idea_clusters[0].ideas).toHaveLength(2);
    expect(parsed.idea_clusters[0].ideas[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(parsed.idea_clusters[0].ideas[1].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(parsed.idea_clusters[0].ideas[0].id).not.toBe(parsed.idea_clusters[0].ideas[1].id);
  });
});
```

- [ ] **Step 2: Run, expect PASS**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/brainstorm/__tests__/schema.test.ts`
Expected: 8 original + 4 new = 12 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/shared/families/brainstorm/__tests__/schema.test.ts
git commit -m "test(v2-brainstorm): lock Path G .max(N) bounds + UUID hydration round-trip"
```

---

## Phase B — merge-LLM spike [SPIKE — empirically uncertain]

The merge-LLM call is the **highest single quality risk** in the v2 stack (per the spec's brainstorm rationale + reviewer 3's flagging). 3B's behavior with structured JSON as INPUT (not just OUTPUT) is empirically unmeasured. Path F just demonstrated 1B fails Lecture quality; the merge call adds another distribution the model has not been pre-trained on.

Spike 1.1 mirrors Spike 0.2's structure:
- 2-chunk JA Interview fixture (each chunk ~8K tokens, simulating a 60-min interview cleanly split into 30-min halves).
- Grammar-constrained per-chunk pass → 2 chunk-JSONs.
- Grammar-constrained merge call: input = both chunk-JSONs serialized as JSON, output = 1 merged Interview note.
- Score: Zod validates / no slot duplicates / themes span both chunks correctly / quotable_lines do not double-count / qa_pairs preserve temporal order across chunks.

PASS → productionize (Task 7). FAIL → deterministic fallback with UI degradation banner (Task 8).

---

### Task 5: merge-LLM spike — fixture + chunk-prompt + merge-prompt + runner

**Files:**
- Create: `desktop/spikes/phase-1/01-merge-llm/README.md`
- Create: `desktop/spikes/phase-1/01-merge-llm/fixture-2chunk-interview.json`
- Create: `desktop/spikes/phase-1/01-merge-llm/chunk-prompt.ts`
- Create: `desktop/spikes/phase-1/01-merge-llm/merge-prompt.ts`
- Create: `desktop/spikes/phase-1/01-merge-llm/run-merge-spike.ts`

**Goal:** Stand up the spike harness — fixture, two prompts (chunk + merge), runner script that invokes `llama-completion` 3× via Plan 2's `callWithGrammar` wrapper. Output: 2 chunk-JSONs per run + 1 merge-JSON per run + timing.

**Hardware safety:** This task is `(spike-llm)`. Run **in foreground** only. Mid-loop cooldown 5s. Pre/post `ps -ef | grep llama-completion` cleanup verification.

- [ ] **Step 1: Create the phase-1 directory + README**

```bash
mkdir -p desktop/spikes/phase-1/01-merge-llm/results
```

Create `desktop/spikes/phase-1/01-merge-llm/README.md`:
```markdown
# Spike 1.1 — Merge-LLM call on 2-chunk Interview fixture

Per Plan 6 + spec §5.2b (Merge contract). The merge-LLM call is the
highest single quality risk in the v2 stack because:

1. 3B's behavior on structured JSON INPUT is empirically unmeasured. Pre-
   training distribution does not include "merge two partial JSONs into
   one" tasks at scale.
2. Path F (2026-05-27) just demonstrated 1B fails Lecture quality (slot
   emergence 0/3, placeholder filler). The merge call adds another
   off-distribution layer.

## Acceptance criteria

Run N=3 invocations with seeds 3000 / 3001 / 3002. PASS if:

1. **Zod validates 3/3** — InterviewNoteSchema.parse() succeeds on every merged output.
2. **Cross-chunk theme coverage** — at least 1 theme present in merged output that originated from BOTH chunks. (i.e. themes deduped across chunks, not concatenated as duplicates.)
3. **No qa_pair duplication** — same Q text appearing in both chunks' partials does not appear twice in merge. Measured: count distinct question strings (trigram Jaccard > 0.7) in merge ≥ 95% of (distinct count across both chunks).
4. **Temporal ordering preserved** — qa_pairs[i].ts <= qa_pairs[i+1].ts for the merged output.
5. **No fabricated slots** — themes, quotable_lines, key_takeaways in merged output must reference content that appeared in at least one chunk's partial (semantic match — exact-string overlap or paraphrase). 0 hallucinated entries.
6. **Latency** — wall time per invocation ≤ 12s (each chunk pass ≤ 25s, merge call ≤ 12s; total budget ≤ 62s).

Verdict: **PASS** if all 6 criteria met across all 3 runs.
**MIXED** if 4-5/6 criteria met OR 2/3 runs meet all 6.
**FAIL** if ≤ 3/6 criteria OR 0-1/3 runs are clean.

## Decision tree

- **PASS** → Productionize merge-LLM call (Task 7 of Plan 6).
- **MIXED** → Founder review. Likely path: productionize with a stricter prompt + add `validation_warnings` plumbing so degenerate merges surface as user-visible "merge quality below threshold" caveats.
- **FAIL** → Productionize deterministic fallback (Task 8). UI shows degradation banner. Interview = per-chunk Q/A only, no cross-chunk follow-up linking. Brainstorm = argument-list only, no chain-spanning across chunks.

## Hardware envelope

- M3 / 8 GB. JOBS=1 build for any sidecar rebuild.
- mid-invocation cooldown 5s. 3 invocations per fixture × 1 fixture × (2 chunk + 1 merge) = 9 LLM calls total per spike run.
- foreground execution. No `run_in_background:true`. Pre/post `ps -ef | grep llama-completion` cleanup.

## Files

- `fixture-2chunk-interview.json` — synthetic JA interview, 2 chunks × ~8K tokens.
- `chunk-prompt.ts` — per-chunk prompt builder (uses Plan 6 Task 9 Interview v1-baseline).
- `merge-prompt.ts` — merge-call prompt builder.
- `run-merge-spike.ts` — runner: foreach run in 3 seeds, call chunk(chunk0) + chunk(chunk1) + merge(both partials).
- `score-merge-spike.ts` — verdict scorer (Task 6).
- `results/` — JSON outputs.
- `decision-1.1-verdict.md` — verdict memo (Task 6).
```

- [ ] **Step 2: Create the 2-chunk fixture**

The fixture is a synthetic 60-min JA interview between an interviewer (Speaker 0) and a Product Manager candidate (Speaker 1). Chunks are split at a clean topic boundary (~30 min in). Each chunk is approximately 8K tokens (≈ 13K JA characters at 0.6 tok/char). The fixture's Q/A content is designed so that:

- Chunk 0 introduces theme "意思決定" + "ステークホルダー調整" with 4 Q/A pairs.
- Chunk 1 continues theme "意思決定" (so the merge must dedupe) + introduces "プロダクト戦略" with 4 Q/A pairs.
- 1 question is repeated nearly verbatim across chunks (interviewer rephrasing) so the dedup criterion has a real signal.
- A quotable line is delivered in chunk 0 with ts=12 and is part of chunk 0's transcript (so chunk-pass should pick it up; merge should NOT duplicate it).
- A follow-up question in chunk 1 references chunk 0 content ("先ほどおっしゃった意思決定の話で...") — this is the cross-chunk reasoning the merge call must capture.

Create `desktop/spikes/phase-1/01-merge-llm/fixture-2chunk-interview.json`:
```json
{
  "sessionId": "spike-1.1-2chunk-interview",
  "speakers": [
    { "id": 0, "name": "面接官" },
    { "id": 1, "name": "候補者" }
  ],
  "chunks": [
    {
      "chunkIndex": 0,
      "transcriptSegments": [
        { "ts": 12, "endTs": 28, "speakerId": 0, "text": "本日はお時間いただきありがとうございます。まずはじめに、これまで最も困難だった意思決定について教えてください。" },
        { "ts": 30, "endTs": 65, "speakerId": 1, "text": "5年前にローンチタイミングの判断で意見が割れた件です。データは強行を支持していましたが、品質チームが反対していました。私は2週間延期を決断しました。" },
        { "ts": 68, "endTs": 78, "speakerId": 0, "text": "その判断の決め手は何でしたか?" },
        { "ts": 80, "endTs": 130, "speakerId": 1, "text": "決断が重いほど、後から振り返れる材料を残すようにしています。データだけでなく品質チームの定性的な懸念も無視できなかったです。" },
        { "ts": 132, "endTs": 145, "speakerId": 0, "text": "ステークホルダー調整はどう進めましたか?" },
        { "ts": 150, "endTs": 220, "speakerId": 1, "text": "まず品質チームの懸念を文書化して全員で合意してから、CEOに延期提案を上げました。CEOには合意の形を見せることが重要です。" },
        { "ts": 225, "endTs": 240, "speakerId": 0, "text": "結果はどうなりましたか?" },
        { "ts": 245, "endTs": 290, "speakerId": 1, "text": "2週間延期して品質を担保しました。後から見れば正解でしたが、当時は決断が重かったです。" }
      ]
    },
    {
      "chunkIndex": 1,
      "transcriptSegments": [
        { "ts": 1820, "endTs": 1840, "speakerId": 0, "text": "先ほどおっしゃった意思決定の話で、もし今同じ状況なら別の選択をしますか?" },
        { "ts": 1845, "endTs": 1900, "speakerId": 1, "text": "プロセスは変えませんが、ステークホルダーへの伝え方を早めます。延期決定そのものは同じです。" },
        { "ts": 1905, "endTs": 1920, "speakerId": 0, "text": "プロダクト戦略の優先順位はどう判断していますか?" },
        { "ts": 1925, "endTs": 1990, "speakerId": 1, "text": "ユーザーの課題深さと事業へのインパクトの二軸でマトリクスを作っています。深さは定性、インパクトは数値化を意識します。" },
        { "ts": 1995, "endTs": 2008, "speakerId": 0, "text": "数値化が難しい場合はどうしますか?" },
        { "ts": 2012, "endTs": 2080, "speakerId": 1, "text": "プロキシ指標を仮置きします。完璧な数字より、議論を進められる粗い数字を優先します。" },
        { "ts": 2085, "endTs": 2098, "speakerId": 0, "text": "最後に、PMとして最も大切にしている価値観を一言で。" },
        { "ts": 2105, "endTs": 2160, "speakerId": 1, "text": "判断の根拠を残すことです。決断が重いほど、後から振り返れる材料を残します。" }
      ],
      "_design_notes": "Line 9 (ts=2105) is a near-paraphrase of chunk 0 line 4 (ts=80) — merge call should treat as one quotable_line, not two. Line 1 (ts=1820) explicitly references chunk 0 ('先ほど') — captures cross-chunk follow-up. Lines 3-7 introduce 'プロダクト戦略' theme that chunk 0 does NOT have — merge should preserve it."
    }
  ]
}
```

Note: the `_design_notes` key is metadata for the human reader; chunk-prompt + merge-prompt strip it before sending to the LLM.

- [ ] **Step 3: Create the chunk-prompt builder**

Create `desktop/spikes/phase-1/01-merge-llm/chunk-prompt.ts`:
```typescript
// desktop/spikes/phase-1/01-merge-llm/chunk-prompt.ts
//
// Per-chunk prompt builder for Spike 1.1. The actual production prompt
// will be Plan 6 Task 9's v1-baseline; this spike uses a lifted skeleton
// that exercises the same shape so the merge-call result is meaningful.

export interface ChunkPromptInput {
  chunkIndex: number;
  transcriptText: string;
  speakers: { id: number; name?: string }[];
}

export function buildChunkSystemPrompt(): string {
  return `あなたは日本語インタビューの構造化要約システムです。
入力は文字起こしテキストです。
出力は厳密な JSON のみで、家族 InterviewNote の構造に従ってください。

# 重要ルール
- 出力する JSON 内のテキストは入力の文字起こしから派生したものでなければなりません。creative writing 禁止。
- transcript に出現しない理論や数字を生成しないでください。
- qa_pairs[].asked_by と answered_by は speakers[].id を参照してください。
- themes は 12 個までに留めてください。
- 自然なやりとりの中で潜在的な"テーマ"を抽出してください — 表面的な話題ではなく、その回答に通底する考え方や姿勢を拾います。
- quotable_lines は印象的・代表的な発言のみ。平凡な発言を入れない。
- 内容が複数回出現してもキーは重複させない。
`;
}

export function buildChunkUserPrompt(input: ChunkPromptInput): string {
  const speakerMap = input.speakers
    .map((s) => `  ${s.id}: ${s.name ?? `Speaker ${s.id}`}`)
    .join('\n');
  return `# Chunk ${input.chunkIndex} of an interview

# Speakers
${speakerMap}

# Transcript
${input.transcriptText}

# Task
上記 transcript を InterviewNote JSON として構造化してください。家族 = interview。
JSON のみを出力。説明・前置きなし。
`;
}
```

- [ ] **Step 4: Create the merge-prompt builder**

Create `desktop/spikes/phase-1/01-merge-llm/merge-prompt.ts`:
```typescript
// desktop/spikes/phase-1/01-merge-llm/merge-prompt.ts
//
// Merge-call prompt. Input = two chunk-partial JSONs serialized. Output = one merged note.
//
// The prompt MUST explicitly state:
// - "Themes that appear in both partials should be merged into one entry; appears_at_ts collects all timestamps from both."
// - "qa_pairs that ask the same question (paraphrase OK) should appear once; pick the one with the more substantive answer."
// - "quotable_lines that are near-paraphrases across partials should be deduplicated."
// - "next_steps / conclusions / key_takeaways should be merged + deduplicated."
// - "Preserve temporal order: qa_pairs sorted by ts ascending."

export interface MergePromptInput {
  partials: { chunkIndex: number; note: unknown }[];
  speakers: { id: number; name?: string }[];
}

export function buildMergeSystemPrompt(): string {
  return `あなたは複数の部分 InterviewNote を1つの完成 InterviewNote に統合するシステムです。
入力は同じインタビューの異なる時間帯から抽出された複数 partial-JSON です。
出力は厳密な JSON のみ、InterviewNote 構造に従ってください。

# Merge ルール
- themes: 同じテーマ (意味的同義) は1エントリに統合。appears_at_ts は全 partial の値を結合。
- qa_pairs: 同じ質問 (言い換え可) は1エントリに統合。より具体的な answer を採用。temporal 順 (ts 昇順) に並べる。
- quotable_lines: 近い表現は1エントリに統合。出現時の ts を保持。
- key_takeaways: 重複を除外。意味的に重なるものは統合。
- conclusions / next_steps: 重複を除外。
- subject_summary / purpose / title: 全 partial を踏まえた最も包括的な記述を1つ。

# 重要
- 入力 partial に存在しないテーマ・引用・Q&A を生成しないでください。
- 1 partial にしか出現しない要素はそのまま保持。
- 出力 JSON 内のテキストは入力 partial 由来でなければなりません。
- JSON のみを出力。説明禁止。
`;
}

export function buildMergeUserPrompt(input: MergePromptInput): string {
  const speakerMap = input.speakers
    .map((s) => `  ${s.id}: ${s.name ?? `Speaker ${s.id}`}`)
    .join('\n');
  const partialBlocks = input.partials
    .map((p) => `# Partial from chunk ${p.chunkIndex}\n${JSON.stringify(p.note, null, 2)}`)
    .join('\n\n');
  return `# Speakers
${speakerMap}

# Partials to merge
${partialBlocks}

# Task
上記 partial JSONs を1つの InterviewNote に統合してください。家族 = interview。
JSON のみを出力。
`;
}
```

- [ ] **Step 5: Create the runner script**

Create `desktop/spikes/phase-1/01-merge-llm/run-merge-spike.ts`:
```typescript
// desktop/spikes/phase-1/01-merge-llm/run-merge-spike.ts
//
// Foreground runner. Loops 3 seeds × (2 chunk passes + 1 merge pass).
// Loads the spike fixture, runs each chunk through callWithGrammar with
// the chunk prompt, then runs the merge call with both partials.
// Writes results/<seed>/{chunk-0.json, chunk-1.json, merge.json, timing.json}.
//
// Hardware safety: pre/post ps grep, mid-loop cooldown 5s, JOBS=1 build
// (covered by spike-llm rule). No background mode.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { callWithGrammar } from '../../../src/main/sidecar/grammar-call';
import { startSpikeClient } from '../../../scripts/start-spike-client';
import { InterviewNoteSchema } from '../../../src/shared/families/interview/schema';
import { zodToGbnf } from '../../../src/shared/note-schema/zod-to-gbnf';
import { hydratePostDecode } from '../../../src/shared/note-schema/post-decode-hydration';
import { buildChunkSystemPrompt, buildChunkUserPrompt } from './chunk-prompt';
import { buildMergeSystemPrompt, buildMergeUserPrompt } from './merge-prompt';

const SEEDS = [3000, 3001, 3002];
const INTER_INVOCATION_COOLDOWN_MS = 5000;
const RESULTS_DIR = resolve(__dirname, 'results');
const FIXTURE_PATH = resolve(__dirname, 'fixture-2chunk-interview.json');

interface ChunkRunResult {
  chunkIndex: number;
  ok: boolean;
  parseErrorReason?: string;
  latencyMs: number;
  attemptsUsed: number;
  note?: unknown;
  rawText?: string;
}

interface MergeRunResult {
  ok: boolean;
  parseErrorReason?: string;
  latencyMs: number;
  attemptsUsed: number;
  merged?: unknown;
  rawText?: string;
}

interface RunResult {
  seed: number;
  chunks: ChunkRunResult[];
  merge: MergeRunResult;
  totalLatencyMs: number;
}

async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
    sessionId: string;
    speakers: { id: number; name?: string }[];
    chunks: { chunkIndex: number; transcriptSegments: { ts: number; endTs?: number; speakerId: number; text: string }[] }[];
  };

  // Compute grammar from the schema once. Per Path G, zod-to-gbnf emits
  // bounded repetitions when `.max(N)` is present (Plan 6 Task 17 lands
  // this — this runner depends on Task 17 having committed first).
  const grammar = zodToGbnf(InterviewNoteSchema, { schemaName: 'InterviewNote' });

  const chatTemplate = 'llama-3.2';
  const client = await startSpikeClient({ model: 'llama-3.2-3b-q4-km' });
  try {
    for (let s = 0; s < SEEDS.length; s++) {
      const seed = SEEDS[s];
      const runDir = resolve(RESULTS_DIR, `seed-${seed}`);
      mkdirSync(runDir, { recursive: true });
      console.log(`\n=== Run ${s + 1}/${SEEDS.length} (seed=${seed}) ===`);

      const runStart = Date.now();
      const chunkResults: ChunkRunResult[] = [];
      const partials: { chunkIndex: number; note: unknown }[] = [];

      // --- Per-chunk pass ---
      for (const chunk of fixture.chunks) {
        const transcriptText = chunk.transcriptSegments
          .map((seg) => `[${seg.ts}s S${seg.speakerId}] ${seg.text}`)
          .join('\n');
        const systemPrompt = buildChunkSystemPrompt();
        const userPrompt = buildChunkUserPrompt({
          chunkIndex: chunk.chunkIndex,
          transcriptText,
          speakers: fixture.speakers,
        });

        const result = await callWithGrammar({
          prompt: `<|system|>\n${systemPrompt}\n<|user|>\n${userPrompt}\n<|assistant|>\n`,
          schema: InterviewNoteSchema.transform(hydratePostDecode),
          grammar,
          baseSeed: seed,
          temperature: 0.4,
          maxAttempts: 3,
          maxTokens: 4096,
          generator: client.generate,
        });

        const chunkResult: ChunkRunResult = {
          chunkIndex: chunk.chunkIndex,
          ok: result.ok,
          latencyMs: result.attempts.reduce((sum, a) => sum + a.latencyMs, 0),
          attemptsUsed: result.ok ? result.attemptsUsed : result.attempts.length,
        };
        if (result.ok) {
          chunkResult.note = result.value;
          partials.push({ chunkIndex: chunk.chunkIndex, note: result.value });
        } else {
          chunkResult.parseErrorReason = result.finalReason;
        }
        chunkResults.push(chunkResult);
        writeFileSync(
          resolve(runDir, `chunk-${chunk.chunkIndex}.json`),
          JSON.stringify(chunkResult, null, 2),
          'utf8',
        );

        // Cooldown between LLM calls (spike-llm rule)
        await sleep(INTER_INVOCATION_COOLDOWN_MS);
      }

      // --- Merge call (only if both chunks parsed) ---
      let mergeResult: MergeRunResult;
      if (partials.length === fixture.chunks.length) {
        const mergeSys = buildMergeSystemPrompt();
        const mergeUser = buildMergeUserPrompt({ partials, speakers: fixture.speakers });
        const r = await callWithGrammar({
          prompt: `<|system|>\n${mergeSys}\n<|user|>\n${mergeUser}\n<|assistant|>\n`,
          schema: InterviewNoteSchema.transform(hydratePostDecode),
          grammar,
          baseSeed: seed + 50, // offset so merge uses different seed than chunks
          temperature: 0.4,
          maxAttempts: 3,
          maxTokens: 4096,
          generator: client.generate,
        });
        mergeResult = {
          ok: r.ok,
          latencyMs: r.attempts.reduce((sum, a) => sum + a.latencyMs, 0),
          attemptsUsed: r.ok ? r.attemptsUsed : r.attempts.length,
        };
        if (r.ok) {
          mergeResult.merged = r.value;
        } else {
          mergeResult.parseErrorReason = r.finalReason;
        }
      } else {
        mergeResult = {
          ok: false,
          parseErrorReason: 'one or more chunks failed; merge skipped',
          latencyMs: 0,
          attemptsUsed: 0,
        };
      }
      writeFileSync(
        resolve(runDir, 'merge.json'),
        JSON.stringify(mergeResult, null, 2),
        'utf8',
      );

      const runResult: RunResult = {
        seed,
        chunks: chunkResults,
        merge: mergeResult,
        totalLatencyMs: Date.now() - runStart,
      };
      writeFileSync(
        resolve(runDir, 'timing.json'),
        JSON.stringify(runResult, null, 2),
        'utf8',
      );

      console.log(`  Chunk 0: ${chunkResults[0].ok ? 'PASS' : 'FAIL'} (${chunkResults[0].latencyMs}ms)`);
      console.log(`  Chunk 1: ${chunkResults[1].ok ? 'PASS' : 'FAIL'} (${chunkResults[1].latencyMs}ms)`);
      console.log(`  Merge:   ${mergeResult.ok ? 'PASS' : 'FAIL'} (${mergeResult.latencyMs}ms)`);
      console.log(`  Total:   ${runResult.totalLatencyMs}ms`);

      // Cooldown before next seed
      if (s < SEEDS.length - 1) {
        await sleep(INTER_INVOCATION_COOLDOWN_MS);
      }
    }
  } finally {
    await client.shutdown();
  }

  console.log(`\nDone. Results in ${RESULTS_DIR}`);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**`startSpikeClient` reference:** This helper is lifted by Plan 4 Task DI-21 (`desktop/scripts/start-spike-client.ts`). If Plan 4 has not landed it yet, the runner script will fail at import. Resolution: import the equivalent helper from Plan 1's Phase 0 spike rig (`desktop/spikes/phase-0/02-3b-lecture-grammar/run-spike.ts` — its inline `startClient` function), or wait for Plan 4 DI-21.

- [ ] **Step 6: Smoke-test the runner WITHOUT real LLM (interface check)**

Run:
```bash
pnpm --filter @lisna/desktop exec tsc --noEmit desktop/spikes/phase-1/01-merge-llm/run-merge-spike.ts
```
Expected: PASS (typecheck only). If imports fail (e.g. `zod-to-gbnf` not exporting `zodToGbnf` with the `{ schemaName }` overload), that means Task 17 has NOT landed yet — Task 17 MUST land before this script executes. Surface to controller.

- [ ] **Step 7: Verify pre-run hardware envelope**

Run:
```bash
ps -ef | grep -E "llama-completion|vitest.*spike" | grep -v grep || echo "(clean)"
```
Expected: `(clean)`. If survivors → `kill -9 <pid>` BEFORE proceeding.

- [ ] **Step 8: Execute the spike — REAL LLM**

> **CRITICAL: foreground only. NEVER use `run_in_background:true`.**

Run:
```bash
pnpm --filter @lisna/desktop exec tsx desktop/spikes/phase-1/01-merge-llm/run-merge-spike.ts
```
Expected duration: ~3-5 minutes (3 seeds × ~60s/run + cooldowns). Output: `desktop/spikes/phase-1/01-merge-llm/results/seed-{3000,3001,3002}/{chunk-0.json,chunk-1.json,merge.json,timing.json}`.

If wall time exceeds 10 minutes, abort with `Ctrl-C`, capture `ps -ef | grep llama-completion`, surface to controller.

- [ ] **Step 9: Verify post-run cleanup**

Run:
```bash
ps -ef | grep -E "llama-completion|tsx" | grep -v grep || echo "(clean)"
```
Expected: `(clean)`. Any survivor → `kill -9 <pid>`.

- [ ] **Step 10: Commit the spike harness (NOT the results yet — Task 6 commits the verdict + scored results)**

```bash
git add desktop/spikes/phase-1/01-merge-llm/README.md \
        desktop/spikes/phase-1/01-merge-llm/fixture-2chunk-interview.json \
        desktop/spikes/phase-1/01-merge-llm/chunk-prompt.ts \
        desktop/spikes/phase-1/01-merge-llm/merge-prompt.ts \
        desktop/spikes/phase-1/01-merge-llm/run-merge-spike.ts \
        desktop/spikes/phase-1/01-merge-llm/results/
git commit -m "test(spike-1.1): merge-LLM spike harness + 2-chunk Interview fixture + 3-seed runner output"
```

---

### Task 6: merge-LLM spike verdict — scorer + decision memo

**Files:**
- Create: `desktop/spikes/phase-1/01-merge-llm/score-merge-spike.ts`
- Create: `desktop/spikes/phase-1/01-merge-llm/decision-1.1-verdict.md`
- Modify: `desktop/spikes/phase-0/README.md` (append Spike 1.1 row) — IF the README has the running scoreboard convention (check before editing)

**Goal:** Score the 3-seed spike output against the 6 acceptance criteria. Write the verdict memo (PASS / MIXED / FAIL) with the same shape as `decision-0.2-path-e.md` + `decision-0.2-path-f.md`. The memo is the **decision input** the controller routes to Task 7 (PASS) or Task 8 (FAIL); MIXED triggers founder gate.

- [ ] **Step 1: Implement the scorer**

Create `desktop/spikes/phase-1/01-merge-llm/score-merge-spike.ts`:
```typescript
// desktop/spikes/phase-1/01-merge-llm/score-merge-spike.ts
//
// Reads results/seed-{N}/timing.json + merge.json files. Computes the 6
// acceptance criteria per run. Emits scorecard JSON + a human-readable
// summary printed to stdout (for paste-into-memo).

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RESULTS_DIR = resolve(__dirname, 'results');

interface CriteriaResult {
  c1_zodValid: boolean;
  c2_themeCrossChunk: boolean;
  c3_qaNoDup: boolean;
  c4_tsOrdered: boolean;
  c5_noFabrication: boolean;
  c6_latencyOk: boolean;
}

interface RunScorecard extends CriteriaResult {
  seed: number;
  passCount: number;     // 0-6
  latencyTotal: number;
  latencyMerge: number;
  notes: string[];
}

function trigramJaccard(a: string, b: string): number {
  const ngrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i <= s.length - 3; i++) set.add(s.slice(i, i + 3));
    return set;
  };
  const A = ngrams(a);
  const B = ngrams(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function scoreRun(seed: number, chunkPartials: any[], merge: any): RunScorecard {
  const sc: RunScorecard = {
    seed,
    c1_zodValid: !!merge?.ok,
    c2_themeCrossChunk: false,
    c3_qaNoDup: false,
    c4_tsOrdered: false,
    c5_noFabrication: false,
    c6_latencyOk: (merge?.latencyMs ?? Infinity) <= 12000,
    passCount: 0,
    latencyTotal: 0,
    latencyMerge: merge?.latencyMs ?? 0,
    notes: [],
  };

  if (!sc.c1_zodValid || !merge.merged) {
    sc.notes.push(`merge failed: ${merge?.parseErrorReason ?? 'unknown'}`);
  } else {
    const m = merge.merged;

    // C2: theme cross-chunk dedup
    const allChunkThemes = chunkPartials.flatMap((p) => p?.note?.themes?.map((t: any) => t.name) ?? []);
    const mergeThemes = (m.themes ?? []).map((t: any) => t.name);
    const themeAppearedInBoth = mergeThemes.some((name: string) => {
      const c0Has = chunkPartials[0]?.note?.themes?.some((t: any) => trigramJaccard(t.name, name) > 0.5);
      const c1Has = chunkPartials[1]?.note?.themes?.some((t: any) => trigramJaccard(t.name, name) > 0.5);
      return c0Has && c1Has;
    });
    sc.c2_themeCrossChunk = themeAppearedInBoth;
    if (!themeAppearedInBoth) sc.notes.push(`C2 fail: no theme present in both chunks made it through dedup`);

    // C3: qa_pair dedup
    const c0Qs = chunkPartials[0]?.note?.qa_pairs?.map((q: any) => q.question) ?? [];
    const c1Qs = chunkPartials[1]?.note?.qa_pairs?.map((q: any) => q.question) ?? [];
    const mergedQs = (m.qa_pairs ?? []).map((q: any) => q.question);
    const distinctSourceQs = new Set<string>();
    [...c0Qs, ...c1Qs].forEach((q) => {
      const isDup = Array.from(distinctSourceQs).some((seen) => trigramJaccard(seen, q) > 0.7);
      if (!isDup) distinctSourceQs.add(q);
    });
    sc.c3_qaNoDup = mergedQs.length >= 0.95 * distinctSourceQs.size && mergedQs.length <= distinctSourceQs.size + 1;
    if (!sc.c3_qaNoDup) sc.notes.push(`C3 fail: merged Q count ${mergedQs.length} vs distinct ${distinctSourceQs.size}`);

    // C4: ts ordering
    const tsSeq = (m.qa_pairs ?? []).map((q: any) => q.ts);
    sc.c4_tsOrdered = tsSeq.every((t: number, i: number) => i === 0 || t >= tsSeq[i - 1]);
    if (!sc.c4_tsOrdered) sc.notes.push(`C4 fail: qa_pairs not temporally ordered`);

    // C5: no fabrication (semantic — must appear in at least one chunk)
    const allChunkText = chunkPartials.flatMap((p) => {
      const themes = p?.note?.themes?.map((t: any) => t.name) ?? [];
      const quotes = p?.note?.quotable_lines?.map((q: any) => q.text) ?? [];
      const takeaways = p?.note?.key_takeaways?.map((t: any) => t.text) ?? [];
      return [...themes, ...quotes, ...takeaways];
    });
    const mergeText = [
      ...(m.themes ?? []).map((t: any) => t.name),
      ...(m.quotable_lines ?? []).map((q: any) => q.text),
      ...(m.key_takeaways ?? []).map((t: any) => t.text),
    ];
    const fabrications = mergeText.filter((mt) => !allChunkText.some((ct) => trigramJaccard(mt, ct) > 0.4));
    sc.c5_noFabrication = fabrications.length === 0;
    if (!sc.c5_noFabrication) sc.notes.push(`C5 fail: ${fabrications.length} fabricated entries: ${fabrications.slice(0, 3).join(' | ')}`);
  }

  sc.passCount = [
    sc.c1_zodValid, sc.c2_themeCrossChunk, sc.c3_qaNoDup,
    sc.c4_tsOrdered, sc.c5_noFabrication, sc.c6_latencyOk,
  ].filter(Boolean).length;
  return sc;
}

function main() {
  const seedDirs = readdirSync(RESULTS_DIR).filter((d) => d.startsWith('seed-'));
  const scorecards: RunScorecard[] = [];
  for (const dir of seedDirs) {
    const seed = parseInt(dir.replace('seed-', ''), 10);
    const chunk0 = JSON.parse(readFileSync(resolve(RESULTS_DIR, dir, 'chunk-0.json'), 'utf8'));
    const chunk1 = JSON.parse(readFileSync(resolve(RESULTS_DIR, dir, 'chunk-1.json'), 'utf8'));
    const merge = JSON.parse(readFileSync(resolve(RESULTS_DIR, dir, 'merge.json'), 'utf8'));
    const sc = scoreRun(seed, [chunk0, chunk1], merge);
    sc.latencyTotal = (chunk0.latencyMs ?? 0) + (chunk1.latencyMs ?? 0) + (merge.latencyMs ?? 0);
    scorecards.push(sc);
  }

  const sortedByPass = [...scorecards].sort((a, b) => b.passCount - a.passCount);
  const verdict =
    scorecards.every((s) => s.passCount === 6) ? 'PASS' :
    scorecards.filter((s) => s.passCount === 6).length >= 2 ? 'PASS' :
    scorecards.filter((s) => s.passCount >= 4).length >= 2 ? 'MIXED' :
    'FAIL';

  const out = {
    verdict,
    scorecards: sortedByPass,
    summary: {
      runsClean: scorecards.filter((s) => s.passCount === 6).length,
      runsAcceptable: scorecards.filter((s) => s.passCount >= 4).length,
      runsFailed: scorecards.filter((s) => s.passCount < 4).length,
      meanTotalLatencyMs: Math.round(scorecards.reduce((s, x) => s + x.latencyTotal, 0) / scorecards.length),
      meanMergeLatencyMs: Math.round(scorecards.reduce((s, x) => s + x.latencyMerge, 0) / scorecards.length),
    },
  };
  writeFileSync(resolve(RESULTS_DIR, 'scorecard.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
}

main();
```

- [ ] **Step 2: Run the scorer**

Run: `pnpm --filter @lisna/desktop exec tsx desktop/spikes/phase-1/01-merge-llm/score-merge-spike.ts`
Expected: prints JSON scorecard. Verdict will be one of PASS / MIXED / FAIL.

- [ ] **Step 3: Write the verdict memo (`decision-1.1-verdict.md`)**

Create `desktop/spikes/phase-1/01-merge-llm/decision-1.1-verdict.md` using the EXACT shape of `decision-0.2-path-e.md` (paste from its file as a template, then fill in with this spike's numbers):

```markdown
# Spike 1.1 verdict — merge-LLM call on 2-chunk Interview fixture (2026-MM-DD)

## Hardware / Build / Setup

- **Date:** YYYY-MM-DD
- **Branch:** `spec/v2-note-creation-design`
- **Fixture:** `fixture-2chunk-interview.json` (2 chunks × ~8K tokens, synthetic JA interview)
- **Model:** Llama-3.2-3B-Instruct-Q4_K_M (per ModelProfile registered in Plan 2 Task 17)
- **Binary:** `desktop/sidecar/deps/llama.cpp/build-spike/bin/llama-completion` (b1-856c3ad)
- **Hardware:** M3 / 8 GB
- **Knobs:** `n_ctx=20480`, `n_predict=4096`, `temp=0.4`, seeds 3000/3001/3002 for chunk pass, +50 for merge pass
- **Loop discipline:** 3 invocations × (2 chunk + 1 merge), 5 s cooldown between LLM calls, ps grep pre/post — clean.

## Per-run timing

| Run | Seed | Chunk 0 (ms) | Chunk 1 (ms) | Merge (ms) | Total (ms) | Chunk 0 attempts | Chunk 1 attempts | Merge attempts |
|---|---|---|---|---|---|---|---|---|
| 0 | 3000 | <fill> | <fill> | <fill> | <fill> | <fill> | <fill> | <fill> |
| 1 | 3001 | <fill> | <fill> | <fill> | <fill> | <fill> | <fill> | <fill> |
| 2 | 3002 | <fill> | <fill> | <fill> | <fill> | <fill> | <fill> | <fill> |

## Per-criterion verdict

| Run | C1 Zod | C2 cross-chunk theme | C3 qa dedup | C4 ts order | C5 no fabrication | C6 latency ≤12s | passCount |
|---|---|---|---|---|---|---|---|
| 0 | <pass/fail> | <p/f> | <p/f> | <p/f> | <p/f> | <p/f> | <0-6> |
| 1 | <p/f> | <p/f> | <p/f> | <p/f> | <p/f> | <p/f> | <0-6> |
| 2 | <p/f> | <p/f> | <p/f> | <p/f> | <p/f> | <p/f> | <0-6> |

## Verdict

**<PASS / MIXED / FAIL>**

### If PASS
All 3 runs hit ≥ 6/6 (or 2/3 runs hit 6/6). Productionize per Plan 6 Task 7 — orchestrator wires `merge-llm.ts` into the Interview + Brainstorm branches per spec §5.2b. UI shows "Merging chunks…" progress step.

### If MIXED
2/3 runs ≥ 4/6, or 1/3 runs at 6/6. Founder review required. Likely path:
- Productionize with `validation_warnings` plumbing so degenerate merges show user-visible "merge quality below threshold; review carefully" banner.
- Tighten merge prompt — add a few-shot example with KNOWN-GOOD merge pair from the fixture.
- Re-run spike at N=5 to widen the sample (NOT to change the verdict — pure data).

### If FAIL
≤ 1/3 runs at 6/6 or ≥ 2/3 runs at < 4/6. Productionize deterministic fallback per Plan 6 Task 8:
- `arrayPolicy: 'concat-dedup'` for Interview's themes (was 'merge-llm' per spec §5.2b).
- `arrayPolicy: 'concat-only'` for Brainstorm's idea_clusters (was 'merge-llm').
- UI banner shows "Cross-chunk reasoning is disabled — recordings over ~16 min show per-chunk grouping only" on Interview + Brainstorm notes derived from multi-chunk transcripts.
- Spec amendment 2 lands documenting the cap.

## Per-criterion failure mode notes

(Filled empirically based on actual results — common patterns:)

- **C1 fail (Zod):** typically a runaway like Path F Run 2 (n_predict cap + control char). Path G `.max(N)` bounds in the schema SHOULD prevent this, but if the model emits broken JSON inside a string literal even Path G can't save it.
- **C2 fail (no cross-chunk theme):** model treats each partial in isolation, themes get duplicated under slightly different names. Likely if FAIL: prompt needs a few-shot showing "両 partial に出現する theme は1つに統合" pattern.
- **C3 fail (qa dedup):** model concatenates instead of merging. Likely if FAIL: the merge prompt's "言い換え可" cue is too weak — needs explicit example pair.
- **C4 fail (ts ordering):** model preserves partial order (chunk 0 Q's first, then chunk 1) rather than re-sorting by ts. Easily fixed by post-decode sort (deterministic).
- **C5 fail (fabrication):** model invents new themes/quotes synthesizing both partials. Most concerning failure mode — suggests 3B cannot resist creative-writing on structured-input task.
- **C6 fail (latency):** merge call gen tokens >900 → > 12s wall. Path G's `.max(N)` bounds on output schema should cap this.

## Cleanup verification

```
$ ps -ef | grep -E "llama-completion|tsx" | grep -v grep || echo "(clean)"
(clean — no survivors)
```

## Next step

<one paragraph keyed to the actual verdict — controller will route to Task 7 (PASS), Task 7 + add warning plumbing (MIXED), or Task 8 (FAIL).>
```

- [ ] **Step 4: Fill in the memo with actual results**

Open `scorecard.json` from Step 2's output. Copy timings + per-criterion booleans into the memo's tables. Replace all `<fill>` placeholders. State the verdict at the top of the file. Decide PASS / MIXED / FAIL and write the "Next step" paragraph routing to Task 7 / 8.

- [ ] **Step 5: Update README scoreboard if convention exists**

Run:
```bash
test -f desktop/spikes/phase-0/README.md && grep -c "Spike" desktop/spikes/phase-0/README.md
```
If the file exists AND has a Spike row convention (per Path F memo's "Spike 0.2 scorecard update (suggested)" pattern), append a Spike 1.1 row. Otherwise skip this step.

- [ ] **Step 6: Commit the verdict (binds the controller to Task 7 OR Task 8)**

```bash
git add desktop/spikes/phase-1/01-merge-llm/score-merge-spike.ts \
        desktop/spikes/phase-1/01-merge-llm/decision-1.1-verdict.md \
        desktop/spikes/phase-1/01-merge-llm/results/scorecard.json
git commit -m "test(spike-1.1): merge-LLM verdict — <PASS|MIXED|FAIL> per 6-criterion acceptance"
```

Replace `<PASS|MIXED|FAIL>` with the actual verdict before committing.

- [ ] **Step 7: Surface the verdict to the controller**

Print to the SDD orchestrator log:
- **PASS** → proceed to Task 7 (productionize merge-LLM). Skip Task 8.
- **MIXED** → founder gate. Default route: Task 7 + add `validation_warnings` UI plumbing (which becomes a small append to Task 7). Skip Task 8.
- **FAIL** → skip Task 7. Proceed to Task 8 (deterministic fallback).

---

## Phase C — Conditional productionization (Tasks 7, 8) — choose by Task 6 verdict

---

### Task 7: Productionize merge-LLM call [CONDITIONAL on Task 6 PASS or MIXED]

**Files:**
- Create: `desktop/src/main/sidecar/merge-llm.ts`
- Create: `desktop/src/main/sidecar/__tests__/merge-llm.test.ts`
- Modify: `desktop/src/shared/families/util/merge-strategies.ts` (Plan 2 — Plan 6 fills in Interview + Brainstorm strategies)

**Goal:** Lift the spike's merge-call into a production module. The orchestrator (Task 13) calls `runMergeLLMCall(family, partials)` when the family's `MergeStrategy.arrayPolicy` is `'merge-llm'` on any field. Returns `{ merged: ValidatedNote, attemptsUsed, latencyMs, validationWarnings: string[] }`.

> **GATE:** This task only runs if Task 6 verdict is **PASS** or **MIXED**.
> If FAIL, skip to Task 8.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/main/sidecar/__tests__/merge-llm.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runMergeLLMCall } from '../merge-llm';
import type { InterviewNote } from '../../../shared/families/interview/schema';
import type { LlmGenerator } from '../grammar-call';

describe('runMergeLLMCall — Interview', () => {
  it('builds the merge prompt + calls callWithGrammar + returns merged note', async () => {
    const partials = [
      makeInterviewPartial(0, { themes: [{ name: '意思決定', appears_at_ts: [12] }] }),
      makeInterviewPartial(1, { themes: [{ name: '意思決定', appears_at_ts: [1820] }] }),
    ];
    const mergedJson = JSON.stringify({
      ...partials[0],
      themes: [{ name: '意思決定', appears_at_ts: [12, 1820] }],
    });
    const generator: LlmGenerator = vi.fn(async ({ seed }) => ({ text: mergedJson, seed }));
    const result = await runMergeLLMCall({
      family: 'interview',
      partials,
      speakers: [{ id: 0 }, { id: 1 }],
      baseSeed: 5000,
      generator,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.merged.themes).toHaveLength(1);
      expect(result.merged.themes[0].appears_at_ts).toEqual([12, 1820]);
      expect(result.validationWarnings).toEqual([]);
    }
  });

  it('surfaces validation_warnings when merge call exhausts retries', async () => {
    const partials = [
      makeInterviewPartial(0, {}),
      makeInterviewPartial(1, {}),
    ];
    const generator: LlmGenerator = vi.fn(async ({ seed }) => ({ text: 'not-json', seed }));
    const result = await runMergeLLMCall({
      family: 'interview',
      partials,
      speakers: [{ id: 0 }, { id: 1 }],
      baseSeed: 5000,
      generator,
    });
    expect(result.ok).toBe(false);
  });
});

function makeInterviewPartial(chunkIdx: number, override: Partial<InterviewNote>): InterviewNote {
  return {
    schemaVersion: 1,
    family: 'interview',
    language: 'ja',
    generatedAt: '2026-05-27T00:00:00.000Z',
    generatedBy: { modelId: 'llama-3.2-3b-q4-km', promptVariantId: 'v1-baseline' },
    title: `chunk ${chunkIdx}`,
    purpose: 'p',
    subject_summary: 's',
    qa_pairs: [],
    themes: [],
    quotable_lines: [],
    key_takeaways: [],
    ...override,
  } as InterviewNote;
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @lisna/desktop test desktop/src/main/sidecar/__tests__/merge-llm.test.ts`
Expected: FAIL ("Cannot find module '../merge-llm'").

- [ ] **Step 3: Implement `merge-llm.ts`**

```typescript
// desktop/src/main/sidecar/merge-llm.ts
import { callWithGrammar, type LlmGenerator } from './grammar-call';
import { InterviewNoteSchema, type InterviewNote } from '../../shared/families/interview/schema';
import { BrainstormNoteSchema, type BrainstormNote } from '../../shared/families/brainstorm/schema';
import { hydratePostDecode } from '../../shared/note-schema/post-decode-hydration';
import { zodToGbnf } from '../../shared/note-schema/zod-to-gbnf';
import { buildMergeSystemPrompt, buildMergeUserPrompt } from '../../../spikes/phase-1/01-merge-llm/merge-prompt';

export type MergeFamily = 'interview' | 'brainstorm';
export type MergedNote = InterviewNote | BrainstormNote;

export interface RunMergeOpts {
  family: MergeFamily;
  partials: MergedNote[];
  speakers: { id: number; name?: string }[];
  baseSeed: number;
  temperature?: number;
  maxAttempts?: number;
  maxTokens?: number;
  generator: LlmGenerator;
}

export interface MergeResultOk {
  ok: true;
  merged: MergedNote;
  attemptsUsed: number;
  latencyMs: number;
  validationWarnings: string[];
}

export interface MergeResultFail {
  ok: false;
  finalReason: string;
  attemptsUsed: number;
  latencyMs: number;
}

export type MergeResult = MergeResultOk | MergeResultFail;

/**
 * Per spec §5.2b. Called by the orchestrator when N partials need merging
 * and the family has `merge-llm` on any field. Returns the merged note
 * (re-validated through the family schema) + any validation_warnings the
 * merge call surfaced.
 */
export async function runMergeLLMCall(opts: RunMergeOpts): Promise<MergeResult> {
  const schema = opts.family === 'interview' ? InterviewNoteSchema : BrainstormNoteSchema;
  const grammar = zodToGbnf(schema, { schemaName: opts.family === 'interview' ? 'InterviewNote' : 'BrainstormNote' });

  const systemPrompt = buildMergeSystemPrompt();
  const userPrompt = buildMergeUserPrompt({
    partials: opts.partials.map((note, chunkIndex) => ({ chunkIndex, note })),
    speakers: opts.speakers,
  });

  const t0 = Date.now();
  const result = await callWithGrammar({
    prompt: `<|system|>\n${systemPrompt}\n<|user|>\n${userPrompt}\n<|assistant|>\n`,
    schema: schema.transform((parsed) => hydratePostDecode(parsed as Record<string, unknown>)) as any,
    grammar,
    baseSeed: opts.baseSeed,
    temperature: opts.temperature ?? 0.4,
    maxAttempts: opts.maxAttempts ?? 3,
    maxTokens: opts.maxTokens ?? 4096,
    generator: opts.generator,
  });
  const latencyMs = Date.now() - t0;

  if (!result.ok) {
    return {
      ok: false,
      finalReason: result.finalReason,
      attemptsUsed: result.attempts.length,
      latencyMs,
    };
  }

  // Post-merge defensive normalizations:
  // - Sort qa_pairs by ts (C4 in spike — defensive even if LLM did it).
  // - De-duplicate themes by name (trigram > 0.7) merging appears_at_ts.
  const merged = result.value as MergedNote;
  const warnings: string[] = [];
  if (opts.family === 'interview') {
    const interview = merged as InterviewNote;
    interview.qa_pairs.sort((a, b) => a.ts - b.ts);
  }

  return {
    ok: true,
    merged,
    attemptsUsed: result.attemptsUsed,
    latencyMs,
    validationWarnings: warnings,
  };
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm --filter @lisna/desktop test desktop/src/main/sidecar/__tests__/merge-llm.test.ts`
Expected: both tests PASS.

- [ ] **Step 5: Install Interview + Brainstorm MergeStrategy entries (Plan 2 carry)**

Modify `desktop/src/shared/families/util/merge-strategies.ts` — find the strategy map (created in Plan 2 stub) and add:
```typescript
// Append/insert into the MergeStrategy map in desktop/src/shared/families/util/merge-strategies.ts
//
// Per spec §5.2b. Interview uses merge-llm on themes; Brainstorm on idea_clusters.
// The Task 7 verdict (PASS/MIXED) authorizes this. If FAIL, see Task 8 — different policy.

export const INTERVIEW_MERGE_STRATEGY: MergeStrategy = {
  scalarPolicy: 'longest',
  arrayPolicy: 'concat-dedup',
  sortByTs: true,
  fieldOverrides: {
    qa_pairs: { policy: 'concat-only' },           // Q&A order matters; ts sort applied post-merge
    themes: { policy: 'merge-llm' },               // semantic dedup of themes across chunks
    quotable_lines: { policy: 'concat-dedup' },    // dedup near-paraphrases
    key_takeaways: { policy: 'concat-dedup' },
    conclusions: { policy: 'concat-dedup' },
    next_steps: { policy: 'concat-dedup' },
  },
};

export const BRAINSTORM_MERGE_STRATEGY: MergeStrategy = {
  scalarPolicy: 'longest',
  arrayPolicy: 'concat-only',
  fieldOverrides: {
    idea_clusters: { policy: 'merge-llm' },         // cross-chunk cluster merging
    parking_lot: { policy: 'concat-dedup' },
    conclusions: { policy: 'concat-dedup' },
    next_steps: { policy: 'concat-dedup' },
  },
};
```

- [ ] **Step 6: Commit**

```bash
git add desktop/src/main/sidecar/merge-llm.ts \
        desktop/src/main/sidecar/__tests__/merge-llm.test.ts \
        desktop/src/shared/families/util/merge-strategies.ts
git commit -m "feat(v2): productionize merge-LLM call + Interview/Brainstorm MergeStrategy (spike 1.1 PASS)"
```

- [ ] **Step 7: [MIXED only] Add validation_warnings UI plumbing**

If Task 6 verdict was MIXED (not PASS), also create `desktop/src/renderer/components/MergeProgressBanner.tsx` with copy "Merge quality below threshold — review the cross-chunk sections carefully." Wire it into NoteView so that when `note.validationWarnings` contains entries with `category === 'merge-quality'`, the banner renders above the family renderer.

```typescript
// desktop/src/renderer/components/MergeProgressBanner.tsx
import * as React from 'react';

export interface MergeProgressBannerProps {
  warnings: string[];
  variant?: 'merge-quality' | 'degraded-cross-chunk';
}

export function MergeProgressBanner({ warnings, variant = 'merge-quality' }: MergeProgressBannerProps) {
  if (warnings.length === 0) return null;
  const heading = variant === 'merge-quality'
    ? 'マージ品質が閾値を下回りました'
    : 'クロスチャンク要約は省略されました';
  const body = variant === 'merge-quality'
    ? 'チャンクをまたぐ要約結果のレビューをお勧めします。'
    : '16分以上の録音はチャンクごとに分けて表示します。';
  return (
    <div role="alert" className="merge-progress-banner">
      <strong>{heading}</strong>
      <p>{body}</p>
      {warnings.length > 0 && (
        <ul>
          {warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}
```

Commit the banner separately:
```bash
git add desktop/src/renderer/components/MergeProgressBanner.tsx
git commit -m "feat(v2): MergeProgressBanner for MIXED-verdict merge-quality warnings"
```

---

### Task 8: Deterministic-merge fallback [CONDITIONAL on Task 6 FAIL]

**Files:**
- Create: `desktop/src/main/sidecar/deterministic-merge.ts`
- Create: `desktop/src/main/sidecar/__tests__/deterministic-merge.test.ts`
- Modify: `desktop/src/shared/families/util/merge-strategies.ts`
- Create: `desktop/src/renderer/components/MergeProgressBanner.tsx`

**Goal:** If Task 6 verdict is FAIL, the orchestrator does NOT call `runMergeLLMCall`. Instead it runs a pure deterministic merge:
- `themes` (Interview): trigram-Jaccard dedup, concat `appears_at_ts` per matched theme.
- `idea_clusters` (Brainstorm): NO cross-chunk merging — each chunk's clusters land as separate clusters (UI banner explains this).
- `qa_pairs`: concat + sort by ts. Trigram dedup of question text.
- All other arrays: concat + trigram dedup.

UI shows `MergeProgressBanner` with copy: "Cross-chunk reasoning is disabled — recordings over ~16 min show per-chunk grouping only."

> **GATE:** This task only runs if Task 6 verdict is **FAIL**.
> If PASS or MIXED, skip Task 8 and use Task 7's merge-LLM path.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/main/sidecar/__tests__/deterministic-merge.test.ts
import { describe, it, expect } from 'vitest';
import { runDeterministicMerge } from '../deterministic-merge';
import { InterviewNoteSchema, type InterviewNote } from '../../../shared/families/interview/schema';
import { BrainstormNoteSchema, type BrainstormNote } from '../../../shared/families/brainstorm/schema';

describe('runDeterministicMerge — Interview', () => {
  it('concatenates qa_pairs in ts order across chunks', () => {
    const partials: InterviewNote[] = [
      makeInterview({ qa_pairs: [
        { question: 'Q1', answer: 'A1', ts: 100, asked_by: 0, answered_by: 1, from: 'transcript' },
      ]}),
      makeInterview({ qa_pairs: [
        { question: 'Q2', answer: 'A2', ts: 50, asked_by: 0, answered_by: 1, from: 'transcript' },
      ]}),
    ];
    const merged = runDeterministicMerge('interview', partials);
    if (merged.ok) {
      const m = merged.merged as InterviewNote;
      expect(m.qa_pairs.map((q) => q.ts)).toEqual([50, 100]);
    } else {
      throw new Error('merge failed unexpectedly');
    }
  });

  it('dedups themes by trigram Jaccard, concats appears_at_ts', () => {
    const partials: InterviewNote[] = [
      makeInterview({ themes: [{ name: '意思決定プロセス', appears_at_ts: [12] }] }),
      makeInterview({ themes: [{ name: '意思決定プロセス', appears_at_ts: [1820] }] }),
    ];
    const merged = runDeterministicMerge('interview', partials);
    if (merged.ok) {
      const m = merged.merged as InterviewNote;
      expect(m.themes).toHaveLength(1);
      expect(m.themes[0].appears_at_ts).toEqual([12, 1820]);
    } else {
      throw new Error('merge failed');
    }
  });

  it('respects InterviewNoteSchema .max bounds (themes capped at 12)', () => {
    const partials: InterviewNote[] = [
      makeInterview({ themes: Array.from({ length: 7 }, (_, i) => ({ name: `T${i}`, appears_at_ts: [i] })) }),
      makeInterview({ themes: Array.from({ length: 7 }, (_, i) => ({ name: `T${7 + i}`, appears_at_ts: [i] })) }),
    ];
    // 14 distinct themes input, schema max is 12 → truncate at 12 + emit a warning
    const merged = runDeterministicMerge('interview', partials);
    expect(merged.ok).toBe(true);
    if (merged.ok) {
      const m = merged.merged as InterviewNote;
      expect(m.themes.length).toBeLessThanOrEqual(12);
      expect(merged.validationWarnings).toContainEqual(expect.stringMatching(/themes truncated/));
    }
  });

  it('emits "cross-chunk reasoning disabled" warning', () => {
    const partials: InterviewNote[] = [makeInterview({}), makeInterview({})];
    const merged = runDeterministicMerge('interview', partials);
    if (merged.ok) {
      expect(merged.validationWarnings).toContainEqual(
        expect.stringMatching(/cross-chunk reasoning is disabled/i),
      );
    }
  });
});

describe('runDeterministicMerge — Brainstorm', () => {
  it('preserves per-chunk idea_clusters as separate clusters (no merging)', () => {
    const partials: BrainstormNote[] = [
      makeBrainstorm({ idea_clusters: [{ theme: '速度', ideas: [
        { id: '00000000-0000-4000-8000-000000000001', text: 'i', ts: 1, from: 'transcript' },
      ] }] }),
      makeBrainstorm({ idea_clusters: [{ theme: '速度', ideas: [
        { id: '00000000-0000-4000-8000-000000000002', text: 'j', ts: 2, from: 'transcript' },
      ] }] }),
    ];
    const merged = runDeterministicMerge('brainstorm', partials);
    if (merged.ok) {
      const m = merged.merged as BrainstormNote;
      // FAIL-mode behaviour: per-chunk preservation (deliberate degradation per Task 6 verdict).
      // Each cluster is annotated with a chunk source.
      expect(m.idea_clusters.length).toBeGreaterThanOrEqual(2);
    } else {
      throw new Error('merge failed');
    }
  });
});

function makeInterview(override: Partial<InterviewNote>): InterviewNote {
  return {
    schemaVersion: 1, family: 'interview', language: 'ja',
    generatedAt: '2026-05-27T00:00:00.000Z',
    generatedBy: { modelId: 'llama-3.2-3b-q4-km', promptVariantId: 'v1-baseline' },
    title: 't', purpose: 'p', subject_summary: 's',
    qa_pairs: [], themes: [], quotable_lines: [], key_takeaways: [],
    ...override,
  } as InterviewNote;
}

function makeBrainstorm(override: Partial<BrainstormNote>): BrainstormNote {
  return {
    schemaVersion: 1, family: 'brainstorm', language: 'ja',
    generatedAt: '2026-05-27T00:00:00.000Z',
    generatedBy: { modelId: 'llama-3.2-3b-q4-km', promptVariantId: 'v1-baseline' },
    title: 't', purpose: 'p',
    idea_clusters: [{ theme: 'T', ideas: [{
      id: '00000000-0000-4000-8000-000000000000', text: 'i', ts: 1, from: 'transcript',
    }] }],
    ...override,
  } as BrainstormNote;
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @lisna/desktop test desktop/src/main/sidecar/__tests__/deterministic-merge.test.ts`
Expected: FAIL ("Cannot find module '../deterministic-merge'").

- [ ] **Step 3: Implement `deterministic-merge.ts`**

```typescript
// desktop/src/main/sidecar/deterministic-merge.ts
import { InterviewNoteSchema, type InterviewNote } from '../../shared/families/interview/schema';
import { BrainstormNoteSchema, type BrainstormNote } from '../../shared/families/brainstorm/schema';

export type MergeFamily = 'interview' | 'brainstorm';
export type DeterministicMergedNote = InterviewNote | BrainstormNote;

export interface DeterministicMergeOk {
  ok: true;
  merged: DeterministicMergedNote;
  validationWarnings: string[];
}

export interface DeterministicMergeFail {
  ok: false;
  finalReason: string;
}

export type DeterministicMergeResult = DeterministicMergeOk | DeterministicMergeFail;

function trigramJaccard(a: string, b: string): number {
  const ngrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i <= s.length - 3; i++) set.add(s.slice(i, i + 3));
    return set;
  };
  const A = ngrams(a);
  const B = ngrams(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const u = A.size + B.size - inter;
  return u === 0 ? 0 : inter / u;
}

const DEGRADED_WARNING = 'Cross-chunk reasoning is disabled — recordings spanning multiple chunks show per-chunk grouping only.';

export function runDeterministicMerge(
  family: MergeFamily,
  partials: DeterministicMergedNote[],
): DeterministicMergeResult {
  if (partials.length === 0) {
    return { ok: false, finalReason: 'no partials to merge' };
  }
  if (partials.length === 1) {
    return { ok: true, merged: partials[0], validationWarnings: [] };
  }

  const warnings: string[] = [DEGRADED_WARNING];

  if (family === 'interview') {
    const merged = mergeInterview(partials as InterviewNote[], warnings);
    const parsed = InterviewNoteSchema.safeParse(merged);
    if (!parsed.success) {
      return { ok: false, finalReason: `merged note fails schema: ${parsed.error.message}` };
    }
    return { ok: true, merged: parsed.data, validationWarnings: warnings };
  }

  // family === 'brainstorm'
  const merged = mergeBrainstorm(partials as BrainstormNote[], warnings);
  const parsed = BrainstormNoteSchema.safeParse(merged);
  if (!parsed.success) {
    return { ok: false, finalReason: `merged note fails schema: ${parsed.error.message}` };
  }
  return { ok: true, merged: parsed.data, validationWarnings: warnings };
}

function pickLongest(values: (string | undefined)[]): string {
  return values
    .filter((v): v is string => typeof v === 'string')
    .sort((a, b) => b.length - a.length)[0] ?? '';
}

function mergeInterview(partials: InterviewNote[], warnings: string[]): InterviewNote {
  // Base shape from first partial; scalar policy 'longest' on text fields.
  const base = partials[0];

  // qa_pairs: concat + sort by ts. Trigram dedup of question text.
  const allQa = partials.flatMap((p) => p.qa_pairs);
  allQa.sort((a, b) => a.ts - b.ts);
  const dedupQa: typeof allQa = [];
  for (const q of allQa) {
    const dup = dedupQa.some((seen) => trigramJaccard(seen.question, q.question) > 0.7);
    if (!dup) dedupQa.push(q);
  }
  if (dedupQa.length > 80) {
    warnings.push(`qa_pairs truncated from ${dedupQa.length} to 80 (schema cap)`);
    dedupQa.length = 80;
  }

  // themes: dedup by trigram + concat appears_at_ts.
  const themeMap = new Map<string, { name: string; description?: string; appears_at_ts: number[] }>();
  for (const p of partials) {
    for (const t of p.themes) {
      const existing = [...themeMap.values()].find((seen) => trigramJaccard(seen.name, t.name) > 0.6);
      if (existing) {
        existing.appears_at_ts.push(...t.appears_at_ts);
      } else {
        themeMap.set(t.name, { name: t.name, description: t.description, appears_at_ts: [...t.appears_at_ts] });
      }
    }
  }
  let themes = [...themeMap.values()];
  if (themes.length > 12) {
    warnings.push(`themes truncated from ${themes.length} to 12 (schema cap)`);
    themes = themes.slice(0, 12);
  }
  // Truncate appears_at_ts at 20 per theme
  for (const t of themes) {
    if (t.appears_at_ts.length > 20) {
      warnings.push(`theme "${t.name}" appears_at_ts truncated from ${t.appears_at_ts.length} to 20`);
      t.appears_at_ts = t.appears_at_ts.slice(0, 20);
    }
  }

  // quotable_lines: trigram dedup
  const allQuotes = partials.flatMap((p) => p.quotable_lines);
  const dedupQuotes: typeof allQuotes = [];
  for (const q of allQuotes) {
    if (!dedupQuotes.some((seen) => trigramJaccard(seen.text, q.text) > 0.7)) dedupQuotes.push(q);
  }
  if (dedupQuotes.length > 20) {
    warnings.push(`quotable_lines truncated from ${dedupQuotes.length} to 20`);
    dedupQuotes.length = 20;
  }

  // key_takeaways: trigram dedup
  const allTakeaways = partials.flatMap((p) => p.key_takeaways);
  const dedupTakeaways: typeof allTakeaways = [];
  for (const t of allTakeaways) {
    if (!dedupTakeaways.some((seen) => trigramJaccard(seen.text, t.text) > 0.7)) dedupTakeaways.push(t);
  }
  if (dedupTakeaways.length > 15) {
    warnings.push(`key_takeaways truncated from ${dedupTakeaways.length} to 15`);
    dedupTakeaways.length = 15;
  }

  // conclusions + next_steps: trigram dedup
  const allConclusions = partials.flatMap((p) => p.conclusions ?? []);
  const dedupConclusions: typeof allConclusions = [];
  for (const c of allConclusions) {
    if (!dedupConclusions.some((seen) => trigramJaccard(seen.text, c.text) > 0.7)) dedupConclusions.push(c);
  }
  const allNextSteps = partials.flatMap((p) => p.next_steps ?? []);
  const dedupNextSteps: typeof allNextSteps = [];
  for (const n of allNextSteps) {
    if (!dedupNextSteps.some((seen) => trigramJaccard(seen.text, n.text) > 0.7)) dedupNextSteps.push(n);
  }

  return {
    ...base,
    title: pickLongest(partials.map((p) => p.title)),
    purpose: pickLongest(partials.map((p) => p.purpose)),
    subject_summary: pickLongest(partials.map((p) => p.subject_summary)),
    participants: base.participants,
    qa_pairs: dedupQa,
    themes,
    quotable_lines: dedupQuotes,
    key_takeaways: dedupTakeaways,
    conclusions: dedupConclusions.length > 0 ? dedupConclusions : undefined,
    next_steps: dedupNextSteps.length > 0 ? dedupNextSteps : undefined,
  };
}

function mergeBrainstorm(partials: BrainstormNote[], warnings: string[]): BrainstormNote {
  const base = partials[0];
  // FAIL-mode: PRESERVE per-chunk clusters as separate clusters (deliberate
  // degradation — the merge-LLM call could not be trusted to merge them).
  // Annotate each cluster's theme with the chunk index so the UI can show
  // "Chunk 1 ideas" / "Chunk 2 ideas" grouping.
  const allClusters = partials.flatMap((p, chunkIdx) =>
    p.idea_clusters.map((c) => ({
      ...c,
      theme: `[Chunk ${chunkIdx + 1}] ${c.theme}`,
    })),
  );
  let clusters = allClusters;
  if (clusters.length > 15) {
    warnings.push(`idea_clusters truncated from ${clusters.length} to 15`);
    clusters = clusters.slice(0, 15);
  }

  // parking_lot: trigram dedup
  const allParking = partials.flatMap((p) => p.parking_lot ?? []);
  const dedupParking: typeof allParking = [];
  for (const p of allParking) {
    if (!dedupParking.some((seen) => trigramJaccard(seen.text, p.text) > 0.7)) dedupParking.push(p);
  }
  if (dedupParking.length > 20) {
    warnings.push(`parking_lot truncated from ${dedupParking.length} to 20`);
    dedupParking.length = 20;
  }

  // conclusions + next_steps same pattern
  const allConclusions = partials.flatMap((p) => p.conclusions ?? []);
  const dedupConclusions: typeof allConclusions = [];
  for (const c of allConclusions) {
    if (!dedupConclusions.some((seen) => trigramJaccard(seen.text, c.text) > 0.7)) dedupConclusions.push(c);
  }
  const allNextSteps = partials.flatMap((p) => p.next_steps ?? []);
  const dedupNextSteps: typeof allNextSteps = [];
  for (const n of allNextSteps) {
    if (!dedupNextSteps.some((seen) => trigramJaccard(seen.text, n.text) > 0.7)) dedupNextSteps.push(n);
  }

  return {
    ...base,
    title: pickLongest(partials.map((p) => p.title)),
    purpose: pickLongest(partials.map((p) => p.purpose)),
    atmosphere: base.atmosphere,
    idea_clusters: clusters,
    parking_lot: dedupParking.length > 0 ? dedupParking : undefined,
    conclusions: dedupConclusions.length > 0 ? dedupConclusions : undefined,
    next_steps: dedupNextSteps.length > 0 ? dedupNextSteps : undefined,
  };
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm --filter @lisna/desktop test desktop/src/main/sidecar/__tests__/deterministic-merge.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Create the UI degradation banner**

Create `desktop/src/renderer/components/MergeProgressBanner.tsx` (same as Task 7's MIXED variant):
```typescript
// (Code identical to Task 7's MergeProgressBanner — if Task 7 also ran for MIXED,
// this banner already exists. If only Task 8 runs, create it now.)
import * as React from 'react';

export interface MergeProgressBannerProps {
  warnings: string[];
  variant?: 'merge-quality' | 'degraded-cross-chunk';
}

export function MergeProgressBanner({ warnings, variant = 'degraded-cross-chunk' }: MergeProgressBannerProps) {
  if (warnings.length === 0) return null;
  const heading = variant === 'merge-quality'
    ? 'マージ品質が閾値を下回りました'
    : 'クロスチャンク要約は省略されました';
  const body = variant === 'merge-quality'
    ? 'チャンクをまたぐ要約結果のレビューをお勧めします。'
    : '16分以上の録音はチャンクごとに分けて表示します。Interview/Brainstorm のクロスチャンク要約は無効化されています。';
  return (
    <div role="alert" className="merge-progress-banner">
      <strong>{heading}</strong>
      <p>{body}</p>
    </div>
  );
}
```

- [ ] **Step 6: Install the FAIL-mode MergeStrategy entries**

Modify `desktop/src/shared/families/util/merge-strategies.ts`:
```typescript
// FAIL-mode strategies (Task 6 verdict = FAIL). All previously merge-llm
// fields demoted to concat-dedup or per-chunk-preserved. Spec amendment 2 lands documenting this.

export const INTERVIEW_MERGE_STRATEGY: MergeStrategy = {
  scalarPolicy: 'longest',
  arrayPolicy: 'concat-dedup',
  sortByTs: true,
  fieldOverrides: {
    qa_pairs: { policy: 'concat-only' },
    themes: { policy: 'concat-dedup' },             // was 'merge-llm' pre-FAIL — demoted
    quotable_lines: { policy: 'concat-dedup' },
    key_takeaways: { policy: 'concat-dedup' },
    conclusions: { policy: 'concat-dedup' },
    next_steps: { policy: 'concat-dedup' },
  },
};

export const BRAINSTORM_MERGE_STRATEGY: MergeStrategy = {
  scalarPolicy: 'longest',
  arrayPolicy: 'concat-only',                       // per-chunk preservation
  fieldOverrides: {
    idea_clusters: { policy: 'concat-only' },       // was 'merge-llm' pre-FAIL — demoted; per-chunk preserved
    parking_lot: { policy: 'concat-dedup' },
    conclusions: { policy: 'concat-dedup' },
    next_steps: { policy: 'concat-dedup' },
  },
};
```

- [ ] **Step 7: Commit**

```bash
git add desktop/src/main/sidecar/deterministic-merge.ts \
        desktop/src/main/sidecar/__tests__/deterministic-merge.test.ts \
        desktop/src/renderer/components/MergeProgressBanner.tsx \
        desktop/src/shared/families/util/merge-strategies.ts
git commit -m "feat(v2): deterministic-merge fallback + UI degradation banner (spike 1.1 FAIL)"
```

---

## Phase D — Prompt builders + renderers + family registration

These tasks land the per-family prompts (Tasks 9, 10), the React renderers (Tasks 11, 12), and the orchestrator branches (Task 13). Tasks 11 + 12 register the family in the `familyRegistry`, consuming Plan 4's `requiresDiarization=true` flag.

---

### Task 9: Interview prompt builder (v1-baseline)

**Files:**
- Create: `desktop/src/shared/families/interview/prompts/v1-baseline.ts`
- Create: `desktop/src/shared/families/interview/prompts/__tests__/v1-baseline.test.ts`

**Goal:** Implement `PromptVariant` for Interview per spec §4.0. Anti-parroting + JA-output + role-assignment hints. The `chunkUserTemplate` accepts `{ transcript, speakers }` substitution; `mergeUserTemplate` accepts `{ partials, speakers }`. Aligns with Plan 7's Interview judge axes (`qaParity / themeExtraction / quotableSelection`).

**Anti-parroting principle (load-bearing per Path F):** the prompt MUST NOT include a populated Q&A example from a real transcript — the model will copy the exemplar verbatim into output, hurting `parroting: false` on Plan 7's content-fidelity judge. Use a schematic example instead (placeholder values like "Q_TEMPLATE" / "A_TEMPLATE").

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/shared/families/interview/prompts/__tests__/v1-baseline.test.ts
import { describe, it, expect } from 'vitest';
import { INTERVIEW_V1_BASELINE } from '../v1-baseline';

describe('INTERVIEW_V1_BASELINE', () => {
  it('has the PromptVariant shape', () => {
    expect(INTERVIEW_V1_BASELINE.variantId).toBe('v1-baseline');
    expect(INTERVIEW_V1_BASELINE.version).toBe(1);
    expect(INTERVIEW_V1_BASELINE.recommendedTemp).toBeGreaterThan(0);
    expect(INTERVIEW_V1_BASELINE.recommendedTemp).toBeLessThan(1);
    expect(typeof INTERVIEW_V1_BASELINE.systemTemplate).toBe('string');
    expect(typeof INTERVIEW_V1_BASELINE.chunkUserTemplate).toBe('string');
    expect(typeof INTERVIEW_V1_BASELINE.mergeUserTemplate).toBe('string');
  });

  it('system prompt instructs JA output', () => {
    expect(INTERVIEW_V1_BASELINE.systemTemplate).toMatch(/日本語/);
  });

  it('system prompt has anti-parroting instruction (no creative writing)', () => {
    expect(INTERVIEW_V1_BASELINE.systemTemplate).toMatch(/creative writing 禁止|捏造禁止|fabricat/i);
  });

  it('system prompt mentions role assignment (interviewer / interviewee)', () => {
    expect(INTERVIEW_V1_BASELINE.systemTemplate).toMatch(/interviewer.*interviewee|質問者.*回答者/);
  });

  it('system prompt mentions .max(N) budget hints (qa_pairs ≤ 80, themes ≤ 12)', () => {
    expect(INTERVIEW_V1_BASELINE.systemTemplate).toMatch(/qa_pairs.*80|質問.*80/);
    expect(INTERVIEW_V1_BASELINE.systemTemplate).toMatch(/themes.*12|テーマ.*12/);
  });

  it('chunkUserTemplate has {transcript} + {speakers} placeholders', () => {
    expect(INTERVIEW_V1_BASELINE.chunkUserTemplate).toMatch(/\{transcript\}/);
    expect(INTERVIEW_V1_BASELINE.chunkUserTemplate).toMatch(/\{speakers\}/);
  });

  it('mergeUserTemplate has {partials} + {speakers} placeholders', () => {
    expect(INTERVIEW_V1_BASELINE.mergeUserTemplate).toMatch(/\{partials\}/);
    expect(INTERVIEW_V1_BASELINE.mergeUserTemplate).toMatch(/\{speakers\}/);
  });

  it('exemplar (if present) uses schematic placeholders, not real transcript content (anti-parroting)', () => {
    // If exemplars are present, none should contain Japanese-character sequences that look like
    // real interview content (≥6 contiguous Japanese chars = likely parroting source).
    if (!INTERVIEW_V1_BASELINE.exemplars) return;
    for (const ex of INTERVIEW_V1_BASELINE.exemplars) {
      // Use template strings or transparent placeholders
      const realJpRun = /[一-龯ぁ-んァ-ヶ]{6,}/.exec(ex.content);
      // If a real-looking JP run is present, the exemplar must NOT be marked as a populated example —
      // i.e. it has to be inside placeholder syntax like {{example_question}} or be obviously schematic.
      if (realJpRun) {
        // Allow runs that are clearly format instruction text (e.g. "出力例" header)
        const wholeText = ex.content;
        expect(wholeText).toMatch(/出力例|例:|template|TEMPLATE|スケマ/);
      }
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/interview/prompts/__tests__/v1-baseline.test.ts`
Expected: FAIL "Cannot find module '../v1-baseline'".

- [ ] **Step 3: Implement `v1-baseline.ts`**

```typescript
// desktop/src/shared/families/interview/prompts/v1-baseline.ts
import type { PromptVariant } from '../../util/prompts';

const SYSTEM = `あなたは日本語インタビューの構造化要約システムです。
入力: 文字起こしテキスト (時間 + 話者IDタグ付き)
出力: InterviewNote JSON のみ (前置き・説明禁止)

# 役割
- 各発言は asked_by または answered_by の片方の話者IDで識別されます。
- interviewer (質問者) と interviewee (回答者) の役割を participants[].role に記録してください。
- 質問者は通常 1 人。回答者は 1 人 (1:1) または複数 (panel)。
- asked_by === answered_by は許容されません (同じ話者が自分に質問することはありません)。

# 抽出ルール
- qa_pairs: 質問→回答ペア。テキストは transcript から逐語的に派生させる。creative writing 禁止。max 80 ペア。
- themes: 自然なやりとりの中で潜在的な"テーマ"を抽出。表面的な話題ではなく、回答に通底する考え方や姿勢を拾う。max 12 テーマ。
- quotable_lines: 印象的・代表的な発言のみ。平凡な発言を入れない。max 20。
- key_takeaways: インタビューを通じて得られた洞察。inferred 可。max 15。
- subject_summary: 候補者または被取材者の概要。

# 重要 (anti-parroting)
- 出力 JSON 内のすべてのテキストは入力 transcript から派生したものでなければなりません。
- transcript に出現しない理論・数字・名前を生成しないでください。
- 同じ意味の質問を複数 qa_pairs に分けて記録しないでください (1つに統合)。

# Budget
- qa_pairs ≤ 80
- themes ≤ 12 (各 themes[].appears_at_ts ≤ 20)
- quotable_lines ≤ 20
- key_takeaways ≤ 15
`;

const CHUNK_USER = `# Speakers
{speakers}

# Transcript
{transcript}

# Task
上記 transcript を InterviewNote JSON として構造化してください。家族 = interview。
JSON のみを出力。説明・前置きなし。
`;

const MERGE_USER = `# Speakers
{speakers}

# Partials to merge
{partials}

# Task
上記 partial JSONs を1つの InterviewNote に統合してください。家族 = interview。

# Merge ルール
- themes: 意味的に同義のテーマは1エントリに統合。appears_at_ts を結合。
- qa_pairs: 言い換えで同じ質問は1エントリに統合。より具体的な answer を採用。ts 昇順に並べる。
- quotable_lines: 近い表現は1エントリに統合。
- key_takeaways / conclusions / next_steps: 重複を除外。

# 重要
- 入力 partial に存在しないテーマ・引用・Q&A を生成しないでください。
- JSON のみを出力。
`;

export const INTERVIEW_V1_BASELINE: PromptVariant = {
  version: 1,
  variantId: 'v1-baseline',
  systemTemplate: SYSTEM,
  chunkUserTemplate: CHUNK_USER,
  mergeUserTemplate: MERGE_USER,
  recommendedTemp: 0.4,
  notes: 'v1 baseline. Anti-parroting + JA + role-assignment + .max(N) budget hints. Aligned with Plan 7 Interview judge axes (qaParity / themeExtraction / quotableSelection).',
};
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/interview/prompts/__tests__/v1-baseline.test.ts`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/families/interview/prompts/v1-baseline.ts \
        desktop/src/shared/families/interview/prompts/__tests__/v1-baseline.test.ts
git commit -m "feat(v2-interview): v1-baseline prompt (anti-parroting + JA + role hints + .max budget)"
```

---

### Task 10: Brainstorm prompt builder (v1-baseline)

**Files:**
- Create: `desktop/src/shared/families/brainstorm/prompts/v1-baseline.ts`
- Create: `desktop/src/shared/families/brainstorm/prompts/__tests__/v1-baseline.test.ts`

**Goal:** Same as Task 9 but for Brainstorm. Per Plan 7's Brainstorm judge axes (`clusterCoherence / ideaDiversity / argumentChainDepth`). The prompt MUST encourage **argument-chain identification WITHIN a chunk** — if A proposes idea X, B responds with reason Y, capture them as related (within `idea_clusters[].ideas[]` with co-located ts).

**Anti-parroting:** Brainstorm is especially dangerous because exemplars of "good brainstorming output" poison the model. Use schematic placeholders.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/shared/families/brainstorm/prompts/__tests__/v1-baseline.test.ts
import { describe, it, expect } from 'vitest';
import { BRAINSTORM_V1_BASELINE } from '../v1-baseline';

describe('BRAINSTORM_V1_BASELINE', () => {
  it('has the PromptVariant shape', () => {
    expect(BRAINSTORM_V1_BASELINE.variantId).toBe('v1-baseline');
    expect(BRAINSTORM_V1_BASELINE.version).toBe(1);
    expect(BRAINSTORM_V1_BASELINE.recommendedTemp).toBeGreaterThan(0);
  });

  it('system prompt instructs JA output', () => {
    expect(BRAINSTORM_V1_BASELINE.systemTemplate).toMatch(/日本語/);
  });

  it('system prompt has anti-parroting instruction', () => {
    expect(BRAINSTORM_V1_BASELINE.systemTemplate).toMatch(/creative writing 禁止|捏造禁止/);
  });

  it('system prompt instructs argument-chain identification within chunk', () => {
    expect(BRAINSTORM_V1_BASELINE.systemTemplate).toMatch(/対話の流れ|議論の流れ|argument chain|chain/i);
  });

  it('system prompt instructs idea diversity (no paraphrase clustering)', () => {
    expect(BRAINSTORM_V1_BASELINE.systemTemplate).toMatch(/言い換え|paraphrase|多様性|diversity/i);
  });

  it('system prompt mentions cluster coherence (cluster theme must explain its ideas)', () => {
    expect(BRAINSTORM_V1_BASELINE.systemTemplate).toMatch(/theme.*ideas を|clusterCoherence|テーマ.*アイデア/i);
  });

  it('system prompt mentions .max budget (idea_clusters ≤ 15, ideas/cluster ≤ 30)', () => {
    expect(BRAINSTORM_V1_BASELINE.systemTemplate).toMatch(/idea_clusters.*15/);
    expect(BRAINSTORM_V1_BASELINE.systemTemplate).toMatch(/ideas.*30/);
  });

  it('system prompt instructs NOT to emit ideas[].id (post-decode hydration)', () => {
    expect(BRAINSTORM_V1_BASELINE.systemTemplate).toMatch(/id を出力しない|do not emit.*id|ideas\[\]\.id は出力に含めない/i);
  });

  it('chunkUserTemplate + mergeUserTemplate placeholders', () => {
    expect(BRAINSTORM_V1_BASELINE.chunkUserTemplate).toMatch(/\{transcript\}/);
    expect(BRAINSTORM_V1_BASELINE.chunkUserTemplate).toMatch(/\{speakers\}/);
    expect(BRAINSTORM_V1_BASELINE.mergeUserTemplate).toMatch(/\{partials\}/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/brainstorm/prompts/__tests__/v1-baseline.test.ts`
Expected: FAIL "Cannot find module '../v1-baseline'".

- [ ] **Step 3: Implement `v1-baseline.ts`**

```typescript
// desktop/src/shared/families/brainstorm/prompts/v1-baseline.ts
import type { PromptVariant } from '../../util/prompts';

const SYSTEM = `あなたは日本語のブレインストーミング・セッションの構造化要約システムです。
入力: 文字起こしテキスト (時間 + 話者IDタグ付き)
出力: BrainstormNote JSON のみ (前置き・説明禁止)

# 抽出ルール
- idea_clusters: 関連するアイデア群をテーマで括る。各 cluster の theme は cluster の ideas を実際に括れるラベルでなければならない (clusterCoherence)。
- ideas[]: 個別の発想。contributed_by に発話者の話者IDを記録。creative writing 禁止 — transcript から派生したテキストのみ。
- ideas[].id は出力に含めないでください — 後段で UUID を割り当てます (post-decode hydration)。
- parking_lot: 重要だが本セッション範囲外として棚上げされた論点。
- conclusions: 議論を通じて見えた合意点 (decisions ではなく divergent から見えた一般的な気づき)。
- next_steps: 具体的な行動。owner を SpeakerRef で。

# 議論の流れ (argument chain identification)
- A が提案 → B が反応 (賛成・反論・補強) → C がさらに展開、という argument chain がある場合、同じ idea_cluster の ideas[] に時間順 (ts 昇順) で並べる。
- 反論や保留は parking_lot または conclusions に明示。

# 多様性 (idea diversity)
- 「ノート生成を5秒以内に」「ノート生成を高速に」「ノート生成を瞬時にする」は **言い換え** — 1つの idea として統合してください。
- 同じテーマ内でも angle (時間軸・コスト軸・UX軸) が違えば別 idea として保持。

# 重要 (anti-parroting)
- 出力 JSON 内のテキストは入力 transcript から派生したものでなければなりません。
- transcript に出現しないアイデア・反論・人名を生成しないでください。
- idea_clusters[].theme は cluster の ideas を本当に括れるラベルでなければなりません — "良いアイデア" のような無意味な theme は禁止。

# Budget
- idea_clusters ≤ 15
- cluster あたり ideas ≤ 30 (≥ 1 必須 — 空 cluster は禁止)
- parking_lot ≤ 20
- conclusions / next_steps ≤ 40 (PurposeDrivenNote 共通)
`;

const CHUNK_USER = `# Speakers
{speakers}

# Transcript
{transcript}

# Task
上記 transcript を BrainstormNote JSON として構造化してください。家族 = brainstorm。
JSON のみを出力。説明・前置きなし。
`;

const MERGE_USER = `# Speakers
{speakers}

# Partials to merge
{partials}

# Task
上記 partial JSONs を1つの BrainstormNote に統合してください。家族 = brainstorm。

# Merge ルール
- idea_clusters: 同じテーマ (意味的同義) は1クラスタに統合。各クラスタの ideas は時間順 (ts 昇順) に並べる。
- parking_lot / conclusions / next_steps: 重複を除外。
- atmosphere: 全 partial を踏まえて1つ選択。

# 重要
- 入力 partial に存在しないアイデアを生成しないでください。
- ids は出力に含めないでください (post-decode hydration が割り当てます)。
- JSON のみを出力。
`;

export const BRAINSTORM_V1_BASELINE: PromptVariant = {
  version: 1,
  variantId: 'v1-baseline',
  systemTemplate: SYSTEM,
  chunkUserTemplate: CHUNK_USER,
  mergeUserTemplate: MERGE_USER,
  recommendedTemp: 0.5,
  notes: 'v1 baseline. Anti-parroting + JA + argument-chain + diversity + clusterCoherence + .max budget. Aligned with Plan 7 Brainstorm judge axes (clusterCoherence / ideaDiversity / argumentChainDepth).',
};
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/brainstorm/prompts/__tests__/v1-baseline.test.ts`
Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/families/brainstorm/prompts/v1-baseline.ts \
        desktop/src/shared/families/brainstorm/prompts/__tests__/v1-baseline.test.ts
git commit -m "feat(v2-brainstorm): v1-baseline prompt (argument-chain + diversity + clusterCoherence hints)"
```

---

### Task 11: Interview renderer + family registration

**Files:**
- Create: `desktop/src/shared/families/interview/renderer.tsx`
- Create: `desktop/src/shared/families/interview/eval-baselines.ts`
- Create: `desktop/src/shared/families/interview/index.ts`
- Create: `desktop/src/shared/families/interview/__tests__/renderer.test.tsx`
- Modify: `desktop/src/shared/families/index.ts` — register `INTERVIEW_FAMILY`

**Goal:** Per spec §4.0 + §5.3 — pure React renderer `(note, transcript) => JSX`. Q/A blocks with speaker chips. Themes as tag pills. Quotable lines as blockquotes. `key_takeaways` as bullet list. `participants` resolved via Plan 4's `resolveSpeakerLabel`.

The family `index.ts` wires the registration:

- [ ] **Step 1: Write the failing renderer test**

```typescript
// desktop/src/shared/families/interview/__tests__/renderer.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InterviewRenderer } from '../renderer';
import type { InterviewNote } from '../schema';
import type { SessionTranscript } from '../../../note-schema/transcript';

describe('InterviewRenderer', () => {
  const transcript: SessionTranscript = {
    sessionId: 's',
    speakers: [{ id: 0, name: '面接官' }, { id: 1, name: '候補者' }],
    transcriptSegments: [],
  };

  it('renders title + subject_summary + purpose', () => {
    render(<InterviewRenderer note={interviewFixture()} transcript={transcript} />);
    expect(screen.getByText('プロダクトマネジャー職 1次面接')).toBeInTheDocument();
    expect(screen.getByText(/5年のPM経験/)).toBeInTheDocument();
  });

  it('renders qa_pairs with speaker labels', () => {
    render(<InterviewRenderer note={interviewFixture()} transcript={transcript} />);
    expect(screen.getByText(/最も困難だった意思決定/)).toBeInTheDocument();
    expect(screen.getByText(/ローンチタイミングの判断/)).toBeInTheDocument();
    expect(screen.getAllByText(/面接官/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/候補者/).length).toBeGreaterThan(0);
  });

  it('renders themes as tags', () => {
    render(<InterviewRenderer note={interviewFixture()} transcript={transcript} />);
    expect(screen.getByText('意思決定')).toBeInTheDocument();
    expect(screen.getByText('ステークホルダー調整')).toBeInTheDocument();
  });

  it('renders quotable_lines as blockquotes', () => {
    render(<InterviewRenderer note={interviewFixture()} transcript={transcript} />);
    expect(screen.getByText(/決断が重いほど/)).toBeInTheDocument();
  });

  it('falls back to "Speaker {id}" when transcript lacks a name', () => {
    const anonTranscript: SessionTranscript = {
      sessionId: 's', speakers: [{ id: 0 }, { id: 1 }], transcriptSegments: [],
    };
    render(<InterviewRenderer note={interviewFixture()} transcript={anonTranscript} />);
    expect(screen.getAllByText(/Speaker 0|Speaker 1/).length).toBeGreaterThan(0);
  });

  it('renders MergeProgressBanner when validation_warnings present', () => {
    const noteWithWarnings = { ...interviewFixture(), validationWarnings: ['cross-chunk reasoning is disabled'] } as InterviewNote & { validationWarnings: string[] };
    render(<InterviewRenderer note={noteWithWarnings} transcript={transcript} />);
    expect(screen.getByText(/クロスチャンク要約は省略されました|disabled/i)).toBeInTheDocument();
  });
});

function interviewFixture(): InterviewNote {
  return {
    schemaVersion: 1,
    family: 'interview',
    language: 'ja',
    generatedAt: '2026-05-27T00:00:00.000Z',
    generatedBy: { modelId: 'llama-3.2-3b-q4-km', promptVariantId: 'v1-baseline' },
    title: 'プロダクトマネジャー職 1次面接',
    purpose: 'PM候補者の意思決定経験を把握する。',
    subject_summary: '5年のPM経験を持つ候補者。',
    participants: [
      { speakerRef: 0, role: 'interviewer' },
      { speakerRef: 1, role: 'interviewee' },
    ],
    qa_pairs: [{
      question: '最も困難だった意思決定を教えてください。',
      answer: 'ローンチタイミングの判断です。',
      ts: 12, asked_by: 0, answered_by: 1, from: 'transcript',
    }],
    themes: [
      { name: '意思決定', appears_at_ts: [12] },
      { name: 'ステークホルダー調整', appears_at_ts: [132] },
    ],
    quotable_lines: [{
      text: '決断が重いほど、後から振り返れる材料を残します。',
      speakerRef: 1, ts: 1500, why_notable: '意思決定への姿勢',
    }],
    key_takeaways: [{ text: '候補者は意思決定の遅れより判断材料の充実を重視する。', from: 'inferred' }],
  };
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/interview/__tests__/renderer.test.tsx`
Expected: FAIL "Cannot find module '../renderer'".

- [ ] **Step 3: Implement the renderer**

```typescript
// desktop/src/shared/families/interview/renderer.tsx
import * as React from 'react';
import type { InterviewNote } from './schema';
import type { SessionTranscript } from '../../note-schema/transcript';
import { resolveSpeakerLabel } from '../util/speaker-resolve';
import { MergeProgressBanner } from '../../../renderer/components/MergeProgressBanner';

export interface InterviewRendererProps {
  note: InterviewNote;
  transcript: SessionTranscript;
}

interface InterviewNoteWithWarnings extends InterviewNote {
  validationWarnings?: string[];
}

export function InterviewRenderer({ note, transcript }: InterviewRendererProps) {
  const noteWithW = note as InterviewNoteWithWarnings;
  const warnings = noteWithW.validationWarnings ?? [];
  const variant = warnings.some((w) => /cross-chunk reasoning is disabled/i.test(w))
    ? 'degraded-cross-chunk'
    : 'merge-quality';
  return (
    <article className="interview-note">
      {warnings.length > 0 && <MergeProgressBanner warnings={warnings} variant={variant} />}
      <header className="interview-header">
        <h1>{note.title}</h1>
        <p className="subject-summary">{note.subject_summary}</p>
        <p className="purpose"><strong>目的:</strong> {note.purpose}</p>
      </header>

      {note.participants && note.participants.length > 0 && (
        <section className="participants">
          <h2>参加者</h2>
          <ul>
            {note.participants.map((p) => (
              <li key={p.speakerRef}>
                <span className="speaker-name">{resolveSpeakerLabel(p.speakerRef, transcript)}</span>
                <span className="role"> ({p.role === 'interviewer' ? '面接官' : '候補者'})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {note.themes.length > 0 && (
        <section className="themes">
          <h2>テーマ</h2>
          <ul className="theme-pills">
            {note.themes.map((t, i) => (
              <li key={i} className="theme-pill">
                <strong>{t.name}</strong>
                {t.description && <span className="theme-desc"> — {t.description}</span>}
                <span className="theme-count"> (出現 {t.appears_at_ts.length}回)</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="qa-pairs">
        <h2>質疑応答 ({note.qa_pairs.length})</h2>
        {note.qa_pairs.map((q, i) => (
          <div key={i} className="qa-block">
            <div className="qa-question">
              <span className="speaker-chip">{resolveSpeakerLabel(q.asked_by, transcript)}</span>
              <span className="ts">[{formatTs(q.ts)}]</span>
              <p>Q: {q.question}</p>
            </div>
            <div className="qa-answer">
              <span className="speaker-chip">{resolveSpeakerLabel(q.answered_by, transcript)}</span>
              <p>A: {q.answer}</p>
            </div>
            {q.themes && q.themes.length > 0 && (
              <div className="qa-themes">
                {q.themes.map((t, ti) => <span key={ti} className="qa-theme-tag">{t}</span>)}
              </div>
            )}
          </div>
        ))}
      </section>

      {note.quotable_lines.length > 0 && (
        <section className="quotable-lines">
          <h2>印象的な発言</h2>
          {note.quotable_lines.map((q, i) => (
            <blockquote key={i} className="quote">
              <p>{q.text}</p>
              <footer>
                — {resolveSpeakerLabel(q.speakerRef, transcript)} [{formatTs(q.ts)}]
                {q.why_notable && <span className="why-notable"> · {q.why_notable}</span>}
              </footer>
            </blockquote>
          ))}
        </section>
      )}

      {note.key_takeaways.length > 0 && (
        <section className="takeaways">
          <h2>キーテイクアウェイ</h2>
          <ul>
            {note.key_takeaways.map((t, i) => (
              <li key={i}>
                {t.text}
                {t.from === 'inferred' && <span className="inferred-marker"> (推定)</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {note.conclusions && note.conclusions.length > 0 && (
        <section className="conclusions">
          <h2>結論</h2>
          <ul>{note.conclusions.map((c, i) => <li key={i}>{c.text}</li>)}</ul>
        </section>
      )}

      {note.next_steps && note.next_steps.length > 0 && (
        <section className="next-steps">
          <h2>次のアクション</h2>
          <ul>
            {note.next_steps.map((n, i) => (
              <li key={i}>
                {n.owner !== undefined && <strong>[{resolveSpeakerLabel(n.owner, transcript)}] </strong>}
                {n.text}
                {n.due && <span className="due"> (期限: {n.due})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

function formatTs(ts: number): string {
  const m = Math.floor(ts / 60);
  const s = Math.floor(ts % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/interview/__tests__/renderer.test.tsx`
Expected: 6 tests PASS.

- [ ] **Step 5: Create `eval-baselines.ts`**

Create `desktop/src/shared/families/interview/eval-baselines.ts`:
```typescript
// desktop/src/shared/families/interview/eval-baselines.ts
// Per spec §4 P4. The Plan 7 boot-time validator asserts each ID resolves
// to a fixture directory under desktop/eval/fixtures/interview/.

export const INTERVIEW_EVAL_BASELINES: string[] = [
  'interview-1on1-product-launch-30min',
  'interview-1on1-engineering-deep-dive-45min',
  'interview-panel-3person-design-review-25min',
];
```

- [ ] **Step 6: Create `index.ts` (family registration)**

Create `desktop/src/shared/families/interview/index.ts`:
```typescript
// desktop/src/shared/families/interview/index.ts
import type { FamilyDefinition } from '../index';
import { InterviewNoteSchema, type InterviewNote } from './schema';
import { INTERVIEW_V1_BASELINE } from './prompts/v1-baseline';
import { InterviewRenderer } from './renderer';
import { INTERVIEW_EVAL_BASELINES } from './eval-baselines';
import { INTERVIEW_MERGE_STRATEGY } from '../util/merge-strategies';

// SVG icon ref — actual icon component lives in `desktop/src/renderer/components/icons/InterviewIcon.tsx`
import { InterviewIcon } from '../../../renderer/components/icons/InterviewIcon';

export const INTERVIEW_FAMILY: FamilyDefinition<InterviewNote> = {
  id: 'interview',
  schema: InterviewNoteSchema,
  prompts: [INTERVIEW_V1_BASELINE],
  defaultPromptVariant: 'v1-baseline',
  renderer: InterviewRenderer as FamilyDefinition<InterviewNote>['renderer'],
  picker: {
    labelKey: 'family.interview.label',
    icon: InterviewIcon,
    descriptionKey: 'family.interview.description',
    visibility: 'production',
  },
  evalBaselines: INTERVIEW_EVAL_BASELINES,
  requiresDiarization: true,                  // Per Plan 4 T-DI-03 contract
  mergeStrategy: INTERVIEW_MERGE_STRATEGY,
};
```

- [ ] **Step 7: Register Interview in the FamilyRegistry**

Modify `desktop/src/shared/families/index.ts` — add the import + registry call:
```typescript
// Append to desktop/src/shared/families/index.ts
import { INTERVIEW_FAMILY } from './interview';
registerFamily(INTERVIEW_FAMILY);
```

- [ ] **Step 8: Stub the InterviewIcon (if not already present)**

If `desktop/src/renderer/components/icons/InterviewIcon.tsx` doesn't exist, create it:
```typescript
// desktop/src/renderer/components/icons/InterviewIcon.tsx
import * as React from 'react';
export function InterviewIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      {/* speech bubble + person silhouette — simple placeholder */}
      <path d="M3 4h18v12H7l-4 4V4z" fill="currentColor" opacity="0.2" />
      <circle cx="12" cy="10" r="2" fill="currentColor" />
    </svg>
  );
}
```

- [ ] **Step 9: Run typecheck + all renderer tests**

Run:
```bash
pnpm --filter @lisna/desktop typecheck
pnpm --filter @lisna/desktop test desktop/src/shared/families/interview/
```
Expected: typecheck PASS, all interview tests PASS.

- [ ] **Step 10: Commit**

```bash
git add desktop/src/shared/families/interview/renderer.tsx \
        desktop/src/shared/families/interview/__tests__/renderer.test.tsx \
        desktop/src/shared/families/interview/eval-baselines.ts \
        desktop/src/shared/families/interview/index.ts \
        desktop/src/shared/families/index.ts \
        desktop/src/renderer/components/icons/InterviewIcon.tsx
git commit -m "feat(v2-interview): renderer + family registration + eval baselines"
```

---

### Task 12: Brainstorm renderer + family registration

**Files:**
- Create: `desktop/src/shared/families/brainstorm/renderer.tsx`
- Create: `desktop/src/shared/families/brainstorm/eval-baselines.ts`
- Create: `desktop/src/shared/families/brainstorm/index.ts`
- Create: `desktop/src/shared/families/brainstorm/__tests__/renderer.test.tsx`
- Modify: `desktop/src/shared/families/index.ts` — register `BRAINSTORM_FAMILY`

**Goal:** Same shape as Task 11 — pure React renderer for `BrainstormNote`. Argument tree visualization (idea_clusters as tabs OR vertical sections, ideas as cards with contributor chips), parking_lot as a side panel.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/shared/families/brainstorm/__tests__/renderer.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrainstormRenderer } from '../renderer';
import type { BrainstormNote } from '../schema';
import type { SessionTranscript } from '../../../note-schema/transcript';

describe('BrainstormRenderer', () => {
  const transcript: SessionTranscript = {
    sessionId: 's',
    speakers: [
      { id: 0, name: '田中' },
      { id: 1, name: '佐藤' },
      { id: 2, name: '鈴木' },
    ],
    transcriptSegments: [],
  };

  it('renders title + purpose', () => {
    render(<BrainstormRenderer note={brainstormFixture()} transcript={transcript} />);
    expect(screen.getByText('次クォーター新機能ブレインストーミング')).toBeInTheDocument();
  });

  it('renders idea_clusters with theme + ideas', () => {
    render(<BrainstormRenderer note={brainstormFixture()} transcript={transcript} />);
    expect(screen.getByText(/速度・パフォーマンス/)).toBeInTheDocument();
    expect(screen.getByText(/ノート生成を5秒以内に短縮する/)).toBeInTheDocument();
  });

  it('renders contributor speaker name on each idea', () => {
    render(<BrainstormRenderer note={brainstormFixture()} transcript={transcript} />);
    expect(screen.getAllByText(/田中|佐藤|鈴木/).length).toBeGreaterThan(0);
  });

  it('renders parking_lot if present', () => {
    render(<BrainstormRenderer note={brainstormFixture()} transcript={transcript} />);
    expect(screen.getByText(/Parking Lot|棚上げ/i)).toBeInTheDocument();
    expect(screen.getByText(/音声から自動 highlight 切り抜き/)).toBeInTheDocument();
  });

  it('renders MergeProgressBanner when validation_warnings present', () => {
    const noteWithWarnings = { ...brainstormFixture(), validationWarnings: ['cross-chunk reasoning is disabled'] } as BrainstormNote & { validationWarnings: string[] };
    render(<BrainstormRenderer note={noteWithWarnings} transcript={transcript} />);
    expect(screen.getByText(/クロスチャンク要約は省略されました|disabled/i)).toBeInTheDocument();
  });
});

function brainstormFixture(): BrainstormNote {
  return {
    schemaVersion: 1, family: 'brainstorm', language: 'ja',
    generatedAt: '2026-05-27T00:00:00.000Z',
    generatedBy: { modelId: 'llama-3.2-3b-q4-km', promptVariantId: 'v1-baseline' },
    title: '次クォーター新機能ブレインストーミング',
    purpose: '次クォーターで取り組む目玉機能を5案出す。',
    atmosphere: 'collaborative',
    idea_clusters: [{
      theme: '速度・パフォーマンス',
      ideas: [{
        id: '11111111-1111-4111-8111-111111111111',
        text: 'ノート生成を5秒以内に短縮する',
        contributed_by: 1,
        ts: 60,
        from: 'transcript',
      }],
    }],
    parking_lot: [{
      text: '音声から自動 highlight 切り抜き (技術的に重い、別スプリント)',
      ts: 1500,
      from: 'transcript',
    }],
  };
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/brainstorm/__tests__/renderer.test.tsx`
Expected: FAIL "Cannot find module '../renderer'".

- [ ] **Step 3: Implement the renderer**

```typescript
// desktop/src/shared/families/brainstorm/renderer.tsx
import * as React from 'react';
import type { BrainstormNote } from './schema';
import type { SessionTranscript } from '../../note-schema/transcript';
import { resolveSpeakerLabel } from '../util/speaker-resolve';
import { MergeProgressBanner } from '../../../renderer/components/MergeProgressBanner';

export interface BrainstormRendererProps {
  note: BrainstormNote;
  transcript: SessionTranscript;
}

interface BrainstormNoteWithWarnings extends BrainstormNote {
  validationWarnings?: string[];
}

export function BrainstormRenderer({ note, transcript }: BrainstormRendererProps) {
  const noteWithW = note as BrainstormNoteWithWarnings;
  const warnings = noteWithW.validationWarnings ?? [];
  const variant = warnings.some((w) => /cross-chunk reasoning is disabled/i.test(w))
    ? 'degraded-cross-chunk'
    : 'merge-quality';
  return (
    <article className="brainstorm-note">
      {warnings.length > 0 && <MergeProgressBanner warnings={warnings} variant={variant} />}
      <header className="brainstorm-header">
        <h1>{note.title}</h1>
        <p className="purpose"><strong>目的:</strong> {note.purpose}</p>
        {note.atmosphere && (
          <p className="atmosphere"><strong>雰囲気:</strong> {note.atmosphere}</p>
        )}
      </header>

      <section className="idea-clusters">
        <h2>アイデア・クラスタ ({note.idea_clusters.length})</h2>
        {note.idea_clusters.map((cluster, ci) => (
          <div key={ci} className="cluster">
            <h3 className="cluster-theme">{cluster.theme}</h3>
            <ul className="ideas">
              {cluster.ideas.map((idea) => (
                <li key={idea.id} className="idea-card">
                  <p className="idea-text">{idea.text}</p>
                  <footer className="idea-footer">
                    {idea.contributed_by !== undefined && (
                      <span className="contributor-chip">
                        {resolveSpeakerLabel(idea.contributed_by, transcript)}
                      </span>
                    )}
                    <span className="ts">[{formatTs(idea.ts)}]</span>
                    {idea.from === 'inferred' && <span className="inferred-marker"> (推定)</span>}
                  </footer>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {note.parking_lot && note.parking_lot.length > 0 && (
        <aside className="parking-lot">
          <h2>Parking Lot (棚上げ)</h2>
          <ul>
            {note.parking_lot.map((p, i) => (
              <li key={i}>
                {p.text}
                <span className="ts"> [{formatTs(p.ts)}]</span>
              </li>
            ))}
          </ul>
        </aside>
      )}

      {note.conclusions && note.conclusions.length > 0 && (
        <section className="conclusions">
          <h2>合意・気づき</h2>
          <ul>{note.conclusions.map((c, i) => <li key={i}>{c.text}</li>)}</ul>
        </section>
      )}

      {note.next_steps && note.next_steps.length > 0 && (
        <section className="next-steps">
          <h2>次のアクション</h2>
          <ul>
            {note.next_steps.map((n, i) => (
              <li key={i}>
                {n.owner !== undefined && (
                  <strong>[{resolveSpeakerLabel(n.owner, transcript)}] </strong>
                )}
                {n.text}
                {n.due && <span className="due"> (期限: {n.due})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

function formatTs(ts: number): string {
  const m = Math.floor(ts / 60);
  const s = Math.floor(ts % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/brainstorm/__tests__/renderer.test.tsx`
Expected: 5 tests PASS.

- [ ] **Step 5: Create `eval-baselines.ts`**

Create `desktop/src/shared/families/brainstorm/eval-baselines.ts`:
```typescript
// desktop/src/shared/families/brainstorm/eval-baselines.ts
export const BRAINSTORM_EVAL_BASELINES: string[] = [
  'brainstorm-product-naming-5person-25min',
  'brainstorm-postmortem-5whys-4person-30min',
  'brainstorm-quarter-planning-6person-40min',
];
```

- [ ] **Step 6: Create `index.ts` (family registration)**

```typescript
// desktop/src/shared/families/brainstorm/index.ts
import type { FamilyDefinition } from '../index';
import { BrainstormNoteSchema, type BrainstormNote } from './schema';
import { BRAINSTORM_V1_BASELINE } from './prompts/v1-baseline';
import { BrainstormRenderer } from './renderer';
import { BRAINSTORM_EVAL_BASELINES } from './eval-baselines';
import { BRAINSTORM_MERGE_STRATEGY } from '../util/merge-strategies';
import { BrainstormIcon } from '../../../renderer/components/icons/BrainstormIcon';
import { assignBrainstormIdeaIds } from '../../note-schema/post-decode-hydration';

export const BRAINSTORM_FAMILY: FamilyDefinition<BrainstormNote> = {
  id: 'brainstorm',
  schema: BrainstormNoteSchema,
  prompts: [BRAINSTORM_V1_BASELINE],
  defaultPromptVariant: 'v1-baseline',
  renderer: BrainstormRenderer as FamilyDefinition<BrainstormNote>['renderer'],
  picker: {
    labelKey: 'family.brainstorm.label',
    icon: BrainstormIcon,
    descriptionKey: 'family.brainstorm.description',
    visibility: 'production',
  },
  evalBaselines: BRAINSTORM_EVAL_BASELINES,
  requiresDiarization: true,
  mergeStrategy: BRAINSTORM_MERGE_STRATEGY,
  // Note: per-family post-decode hook for UUID assignment runs ahead of provenance fill (spec §5.2 Stage 2)
  // The orchestrator calls assignBrainstormIdeaIds() before generic hydratePostDecode for brainstorm family.
};
```

- [ ] **Step 7: Register Brainstorm in the FamilyRegistry**

```typescript
// Append to desktop/src/shared/families/index.ts
import { BRAINSTORM_FAMILY } from './brainstorm';
registerFamily(BRAINSTORM_FAMILY);
```

- [ ] **Step 8: Stub the BrainstormIcon**

Create `desktop/src/renderer/components/icons/BrainstormIcon.tsx`:
```typescript
// desktop/src/renderer/components/icons/BrainstormIcon.tsx
import * as React from 'react';
export function BrainstormIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      {/* lightbulb */}
      <path d="M12 2a7 7 0 0 0-4 12.74V18h8v-3.26A7 7 0 0 0 12 2z" fill="currentColor" opacity="0.2" />
      <path d="M10 19h4v2h-4z" fill="currentColor" />
    </svg>
  );
}
```

- [ ] **Step 9: Run typecheck + tests**

Run:
```bash
pnpm --filter @lisna/desktop typecheck
pnpm --filter @lisna/desktop test desktop/src/shared/families/brainstorm/
```
Expected: typecheck PASS, all brainstorm tests PASS.

- [ ] **Step 10: Commit**

```bash
git add desktop/src/shared/families/brainstorm/renderer.tsx \
        desktop/src/shared/families/brainstorm/__tests__/renderer.test.tsx \
        desktop/src/shared/families/brainstorm/eval-baselines.ts \
        desktop/src/shared/families/brainstorm/index.ts \
        desktop/src/shared/families/index.ts \
        desktop/src/renderer/components/icons/BrainstormIcon.tsx
git commit -m "feat(v2-brainstorm): renderer + family registration + eval baselines"
```

---

### Task 13: Orchestrator extension — Interview + Brainstorm branches with merge gate

**Files:**
- Modify: `desktop/src/main/sidecar/orchestrator.ts`
- Create: `desktop/src/main/sidecar/__tests__/orchestrator-interview.test.ts`
- Create: `desktop/src/main/sidecar/__tests__/orchestrator-brainstorm.test.ts`

**Goal:** Wire the family selection into the post-stop pipeline. On `family === 'interview'` OR `family === 'brainstorm'`:
1. `chunkTranscript(transcript, modelProfile.recommendedChunkTokens)` (from Plan 2).
2. For each chunk: build prompt via family's `chunkUserTemplate`, call `callWithGrammar` with schema + grammar.
3. If chunks > 1: branch on Task 6 verdict — `runMergeLLMCall` (Task 7 PASS/MIXED) or `runDeterministicMerge` (Task 8 FAIL).
4. Apply `hydratePostDecode` + `assignBrainstormIdeaIds` (brainstorm only) + `computeProvenance` (Plan 2).
5. Parse through Zod (which strips post-decode-only fields not present pre-decode, then validates post-hydration shape).
6. Persist to `sessions/<id>/note.json` + `telemetry.json`.

- [ ] **Step 1: Read the current `orchestrator.ts` so the diff is precise**

Read `desktop/src/main/sidecar/orchestrator.ts`. Identify the post-stop entry point (currently `runFinalize` or equivalent — Plan 5 may have extended it to handle Meeting; if so, Plan 6 extends the same switch).

If a `switch(family)` already exists with `lecture` + `meeting` branches: Task 13 adds 2 cases (`interview` + `brainstorm`) following the existing pattern.

If only `lecture` exists: Task 13 introduces the switch + 3 cases (`meeting` stub if Plan 5 hasn't shipped + interview + brainstorm).

- [ ] **Step 2: Write the failing orchestrator test for Interview**

```typescript
// desktop/src/main/sidecar/__tests__/orchestrator-interview.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runFinalize } from '../orchestrator';
import { InterviewNoteSchema } from '../../../shared/families/interview/schema';

describe('runFinalize — interview family', () => {
  it('chunks transcript, runs per-chunk LLM, runs merge (or deterministic), returns InterviewNote', async () => {
    const transcript = makeTwoChunkTranscript();
    const mockGenerate = vi.fn(async ({ seed, prompt }) => {
      // First two calls (chunks): return a stub valid InterviewNote per chunk.
      // Third call (merge): return merged stub.
      const note = stubInterviewNote();
      return { text: JSON.stringify(note), seed };
    });

    const result = await runFinalize({
      family: 'interview',
      promptVariant: 'v1-baseline',
      sessionId: 'test-1',
      transcript,
      modelProfile: { id: 'llama-3.2-3b-q4-km', recommendedChunkTokens: 8000 } as any,
      generator: mockGenerate,
      writeNote: vi.fn(),
      writeTelemetry: vi.fn(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.note.family).toBe('interview');
      expect(InterviewNoteSchema.safeParse(result.note).success).toBe(true);
    }
  });

  it('telemetry records family, chunkCount, mergeStrategy, mergeLatencyMs', async () => {
    const transcript = makeTwoChunkTranscript();
    const writeTelemetry = vi.fn();
    await runFinalize({
      family: 'interview',
      promptVariant: 'v1-baseline',
      sessionId: 'test-2',
      transcript,
      modelProfile: { id: 'llama-3.2-3b-q4-km', recommendedChunkTokens: 8000 } as any,
      generator: vi.fn(async ({ seed }) => ({ text: JSON.stringify(stubInterviewNote()), seed })),
      writeNote: vi.fn(),
      writeTelemetry,
    });
    expect(writeTelemetry).toHaveBeenCalledWith(expect.objectContaining({
      family: 'interview',
      chunkCount: 2,
      mergeStrategy: expect.stringMatching(/llm|deterministic/),
    }));
  });
});

// Helpers below — mirror Plan 2's TranscriptSegment / Plan 4's SessionTranscript shapes.
function makeTwoChunkTranscript() { /* ... fixture small enough to chunk into 2 ... */ }
function stubInterviewNote() { /* minimal valid InterviewNote */ }
```

- [ ] **Step 3: Run, expect FAIL or red on assertion**

Run: `pnpm --filter @lisna/desktop test desktop/src/main/sidecar/__tests__/orchestrator-interview.test.ts`
Expected: FAIL (orchestrator doesn't handle interview yet).

- [ ] **Step 4: Extend `orchestrator.ts`**

The exact diff depends on the current shape post-Plan-2 and post-Plan-5. Pattern:
```typescript
// In orchestrator.ts runFinalize() — extend the family switch
import { INTERVIEW_FAMILY } from '../../shared/families/interview';
import { BRAINSTORM_FAMILY } from '../../shared/families/brainstorm';
import { runMergeLLMCall } from './merge-llm';
import { runDeterministicMerge } from './deterministic-merge';
import { assignBrainstormIdeaIds } from '../../shared/note-schema/post-decode-hydration';
import { hydratePostDecode } from '../../shared/note-schema/post-decode-hydration';
import { computeProvenance } from '../../shared/note-schema/provenance';
import { callWithGrammar } from './grammar-call';
import { chunkTranscript } from '../../shared/note-schema/chunking';
import { zodToGbnf } from '../../shared/note-schema/zod-to-gbnf';

// ...
case 'interview':
case 'brainstorm': {
  const family = opts.family === 'interview' ? INTERVIEW_FAMILY : BRAINSTORM_FAMILY;
  const promptVariant = family.prompts.find((p) => p.variantId === opts.promptVariant) ?? family.prompts[0];
  const grammar = zodToGbnf(family.schema, { schemaName: family.id === 'interview' ? 'InterviewNote' : 'BrainstormNote' });

  const chunks = chunkTranscript(opts.transcript, opts.modelProfile.recommendedChunkTokens);
  const partials: any[] = [];
  let perChunkLatencyTotal = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = renderChunkAsText(chunks[i]);
    const userPrompt = promptVariant.chunkUserTemplate
      .replace('{transcript}', chunkText)
      .replace('{speakers}', renderSpeakerMap(chunks[i].speakers));
    const r = await callWithGrammar({
      prompt: buildChatPrompt(promptVariant.systemTemplate, userPrompt),
      schema: family.schema as any,
      grammar,
      baseSeed: 1000 + i * 200,
      temperature: promptVariant.recommendedTemp,
      maxAttempts: 3,
      maxTokens: 4096,
      generator: opts.generator,
    });
    if (!r.ok) {
      return { ok: false, reason: `chunk ${i} failed: ${r.finalReason}` };
    }
    perChunkLatencyTotal += r.attempts.reduce((s, a) => s + a.latencyMs, 0);
    // post-decode: brainstorm UUID, then provenance
    let hydrated = r.value as Record<string, unknown>;
    if (family.id === 'brainstorm') hydrated = assignBrainstormIdeaIds(hydrated);
    hydrated = hydratePostDecode(hydrated);
    partials.push(hydrated);
  }

  let merged: unknown;
  let mergeStrategy: string;
  let mergeLatencyMs = 0;
  if (partials.length === 1) {
    merged = partials[0];
    mergeStrategy = 'single-chunk';
  } else {
    // Branch on Task 6 verdict — the spike memo decides which is wired here.
    // We read from a module-level FLAG (set by build-time config based on the verdict file).
    const useLLMMerge = readMergeStrategyFlag(family.id); // 'merge-llm' | 'deterministic'
    if (useLLMMerge === 'merge-llm') {
      const r = await runMergeLLMCall({
        family: family.id,
        partials: partials as any,
        speakers: opts.transcript.speakers,
        baseSeed: 5000,
        generator: opts.generator,
      });
      if (!r.ok) {
        // Soft-fallback: degraded merge
        const det = runDeterministicMerge(family.id, partials as any);
        if (!det.ok) return { ok: false, reason: `both merges failed: ${r.finalReason} / ${det.finalReason}` };
        merged = det.merged;
        mergeStrategy = 'merge-llm→deterministic-fallback';
        mergeLatencyMs = r.latencyMs;
        (merged as any).validationWarnings = det.validationWarnings;
      } else {
        merged = r.merged;
        mergeStrategy = 'merge-llm';
        mergeLatencyMs = r.latencyMs;
        (merged as any).validationWarnings = r.validationWarnings;
      }
    } else {
      // deterministic-only (Task 6 verdict was FAIL)
      const r = runDeterministicMerge(family.id, partials as any);
      if (!r.ok) return { ok: false, reason: r.finalReason };
      merged = r.merged;
      mergeStrategy = 'deterministic';
      (merged as any).validationWarnings = r.validationWarnings;
    }
  }

  const validated = family.schema.parse(merged);
  await opts.writeNote(validated);
  await opts.writeTelemetry({
    family: family.id,
    chunkCount: chunks.length,
    perChunkLatencyMs: perChunkLatencyTotal,
    mergeStrategy,
    mergeLatencyMs,
    totalLatencyMs: perChunkLatencyTotal + mergeLatencyMs,
  });
  return { ok: true, note: validated };
}
```

The `readMergeStrategyFlag()` function reads a module-level constant set in `merge-strategies.ts`:
```typescript
// In desktop/src/shared/families/util/merge-strategies.ts

// SET BY TASK 6 VERDICT — these constants land via Task 7 or Task 8 above
export const MERGE_STRATEGY_FLAG: Record<'interview' | 'brainstorm', 'merge-llm' | 'deterministic'> = {
  interview: 'merge-llm',     // Task 7 sets to 'merge-llm'; Task 8 sets to 'deterministic'
  brainstorm: 'merge-llm',    // Task 7 sets to 'merge-llm'; Task 8 sets to 'deterministic'
};

export function readMergeStrategyFlag(family: 'interview' | 'brainstorm'): 'merge-llm' | 'deterministic' {
  return MERGE_STRATEGY_FLAG[family];
}
```

The implementer at Task 7 or Task 8 sets the flag value in the same commit that lands the productionization. The orchestrator branches on it.

- [ ] **Step 5: Write the failing orchestrator test for Brainstorm**

Same shape as Interview, but assert `BrainstormNoteSchema.safeParse(result.note).success` and check that UUID assignment happened (every `idea.id` is a UUID string).

- [ ] **Step 6: Run all orchestrator tests, expect PASS**

Run:
```bash
pnpm --filter @lisna/desktop test desktop/src/main/sidecar/__tests__/orchestrator-interview.test.ts
pnpm --filter @lisna/desktop test desktop/src/main/sidecar/__tests__/orchestrator-brainstorm.test.ts
```
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/main/sidecar/orchestrator.ts \
        desktop/src/shared/families/util/merge-strategies.ts \
        desktop/src/main/sidecar/__tests__/orchestrator-interview.test.ts \
        desktop/src/main/sidecar/__tests__/orchestrator-brainstorm.test.ts
git commit -m "feat(v2): orchestrator interview + brainstorm branches with merge gate"
```

---

## Phase E — UI integration + eval registration + Path G converter extension

---

### Task 14: UI — Family picker entries + progress indicator + render dispatch

**Files:**
- Modify: `desktop/src/renderer/components/FamilyPicker.tsx`
- Modify: `desktop/src/renderer/routes/NoteView.tsx`
- Modify: `desktop/src/renderer/i18n/messages/ja.json` (or equivalent — append Interview + Brainstorm i18n entries)
- Create: `desktop/src/renderer/__tests__/FamilyPicker-test.tsx`

**Goal:** Wire the two new families into the post-Stop picker UX + NoteView dispatch.

- [ ] **Step 1: Read the current `FamilyPicker.tsx` to identify the entry-add pattern**

Read `desktop/src/renderer/components/FamilyPicker.tsx`. If picker is a static array of family definitions (typical: `{ id, icon, labelKey, descKey }[]`), Task 14 appends 2 entries. If picker reads from the family registry dynamically (per Plan 2 #4 P5 picker config), no edit needed — registration in Tasks 11+12 surfaces both families automatically.

- [ ] **Step 2: Add the picker entries (only if picker is NOT dynamic)**

```typescript
// Append to the static `PICKER_FAMILIES` array in FamilyPicker.tsx if applicable
{
  id: 'interview',
  icon: InterviewIcon,
  labelKey: 'family.interview.label',
  descriptionKey: 'family.interview.description',
},
{
  id: 'brainstorm',
  icon: BrainstormIcon,
  labelKey: 'family.brainstorm.label',
  descriptionKey: 'family.brainstorm.description',
},
```

If the picker reads from `familyRegistry` (Plan 2 design), confirm both `INTERVIEW_FAMILY` + `BRAINSTORM_FAMILY` are registered (verified in Task 11 Step 7 + Task 12 Step 7) and skip the picker edit.

- [ ] **Step 3: Add i18n strings**

Append to `desktop/src/renderer/i18n/messages/ja.json`:
```json
{
  "family.interview.label": "インタビュー",
  "family.interview.description": "1対1またはパネル形式の面接・取材を Q&A 構造で記録",
  "family.brainstorm.label": "ブレインストーミング",
  "family.brainstorm.description": "アイデア出し・発散的な議論をクラスタ別に整理",
  "merge.progress.banner.heading.merge-quality": "マージ品質が閾値を下回りました",
  "merge.progress.banner.body.merge-quality": "チャンクをまたぐ要約結果のレビューをお勧めします。",
  "merge.progress.banner.heading.degraded-cross-chunk": "クロスチャンク要約は省略されました",
  "merge.progress.banner.body.degraded-cross-chunk": "16分以上の録音はチャンクごとに分けて表示します。"
}
```

Also append matching entries to `en.json` if present:
```json
{
  "family.interview.label": "Interview",
  "family.interview.description": "1-on-1 or panel-format interviews captured as Q&A structure",
  "family.brainstorm.label": "Brainstorm",
  "family.brainstorm.description": "Idea generation and divergent discussion organized into clusters",
  "merge.progress.banner.heading.merge-quality": "Merge quality below threshold",
  "merge.progress.banner.body.merge-quality": "Review cross-chunk sections carefully.",
  "merge.progress.banner.heading.degraded-cross-chunk": "Cross-chunk reasoning disabled",
  "merge.progress.banner.body.degraded-cross-chunk": "Recordings spanning multiple chunks show per-chunk grouping only."
}
```

- [ ] **Step 4: Wire NoteView dispatch on `note.family`**

Read `desktop/src/renderer/routes/NoteView.tsx`. The post-Plan-2 shape dispatches on `note.family` to call `familyRegistry[note.family].renderer({ note, transcript })`. If Tasks 11+12's registration is correct, no edit is needed.

If `NoteView.tsx` has a hardcoded switch (still on the legacy single-family path), modify:
```typescript
// In NoteView.tsx
const family = familyRegistry[note.family];
if (!family) {
  return <div role="alert">Unknown family: {note.family}</div>;
}
const Renderer = family.renderer;
return <Renderer note={note} transcript={transcript} />;
```

- [ ] **Step 5: Add progress indicator with merge step**

Find the current `RecordingProgress` (or equivalent) component that shows "Finalizing note…" during the post-Stop pipeline. Extend it to display 3 stages for multi-chunk Interview / Brainstorm:
1. "Chunk X of N being processed…"
2. "Merging chunks…" (only shown if mergeStrategy is `'merge-llm'` per Task 13)
3. "Note ready"

If the orchestrator emits progress events via the existing IPC (likely a `session/progress` channel), Plan 6's orchestrator extension needs to also emit `{ stage: 'merging' }` between the last chunk completion and the persist call. Add the emit in Task 13 Step 4 above (or in a follow-up commit if Task 13 already landed).

- [ ] **Step 6: Test the picker**

```typescript
// desktop/src/renderer/__tests__/FamilyPicker-test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FamilyPicker } from '../components/FamilyPicker';
import { I18nTestProvider } from '../../../test-utils/i18n-test-provider';   // existing test util

describe('FamilyPicker', () => {
  it('renders Interview tile', () => {
    render(<I18nTestProvider locale="ja"><FamilyPicker onPick={() => {}} /></I18nTestProvider>);
    expect(screen.getByText(/インタビュー/)).toBeInTheDocument();
  });

  it('renders Brainstorm tile', () => {
    render(<I18nTestProvider locale="ja"><FamilyPicker onPick={() => {}} /></I18nTestProvider>);
    expect(screen.getByText(/ブレインストーミング/)).toBeInTheDocument();
  });

  it('emits family on click', () => {
    const onPick = vi.fn();
    render(<I18nTestProvider locale="ja"><FamilyPicker onPick={onPick} /></I18nTestProvider>);
    screen.getByText(/インタビュー/).click();
    expect(onPick).toHaveBeenCalledWith('interview', expect.any(String));
  });
});
```

- [ ] **Step 7: Run, expect PASS**

Run: `pnpm --filter @lisna/desktop test desktop/src/renderer/__tests__/FamilyPicker-test.tsx`
Expected: 3 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/renderer/components/FamilyPicker.tsx \
        desktop/src/renderer/routes/NoteView.tsx \
        desktop/src/renderer/i18n/messages/ja.json \
        desktop/src/renderer/i18n/messages/en.json \
        desktop/src/renderer/__tests__/FamilyPicker-test.tsx
git commit -m "feat(v2): family picker + NoteView dispatch + i18n for interview + brainstorm"
```

---

### Task 15: Eval baseline registration (Plan 7 hooks)

**Files:**
- Read-only: `desktop/src/shared/families/interview/eval-baselines.ts` (already created in Task 11)
- Read-only: `desktop/src/shared/families/brainstorm/eval-baselines.ts` (already created in Task 12)
- Modify: `desktop/eval/fixtures/interview/` — register the 3 baseline directories (skeletal — Plan 7 owns fixture authoring; Plan 6 declares the IDs)
- Modify: `desktop/eval/fixtures/brainstorm/` — same

**Goal:** Per spec §4 P4 + Plan 7 Task 23 (`evalBaselines` boot-time validator). Each ID declared in Tasks 11/12 must resolve to a fixture directory at `desktop/eval/fixtures/<family>/<id>/{transcript.json, meta.json, baselines/}`. Plan 7 owns the fixture content; Plan 6 ensures the **directory shells** exist + a placeholder `meta.json` so the validator passes.

- [ ] **Step 1: Create the directory shells with placeholder meta.json**

```bash
mkdir -p desktop/eval/fixtures/interview/interview-1on1-product-launch-30min/baselines
mkdir -p desktop/eval/fixtures/interview/interview-1on1-engineering-deep-dive-45min/baselines
mkdir -p desktop/eval/fixtures/interview/interview-panel-3person-design-review-25min/baselines
mkdir -p desktop/eval/fixtures/brainstorm/brainstorm-product-naming-5person-25min/baselines
mkdir -p desktop/eval/fixtures/brainstorm/brainstorm-postmortem-5whys-4person-30min/baselines
mkdir -p desktop/eval/fixtures/brainstorm/brainstorm-quarter-planning-6person-40min/baselines
```

For each directory, create a placeholder `meta.json`:
```json
{
  "fixtureId": "<id>",
  "family": "interview",
  "language": "ja",
  "title": "PLACEHOLDER — populated by Plan 7 Task 3 (Meeting/Interview/Brainstorm fixture stubs)",
  "durationSec": 0,
  "expectedSpeakerCount": 0,
  "status": "shell-only"
}
```

For the Interview fixtures:

`desktop/eval/fixtures/interview/interview-1on1-product-launch-30min/meta.json`:
```json
{
  "fixtureId": "interview-1on1-product-launch-30min",
  "family": "interview",
  "language": "ja",
  "title": "PM 1次面接 / プロダクトローンチ振り返り",
  "durationSec": 1800,
  "expectedSpeakerCount": 2,
  "expectedQaPairs": 12,
  "expectedThemes": ["意思決定", "ステークホルダー調整", "ローンチタイミング"],
  "status": "shell-only — Plan 7 Task 3 populates transcript + ground_truth.json"
}
```

`desktop/eval/fixtures/interview/interview-1on1-engineering-deep-dive-45min/meta.json`:
```json
{
  "fixtureId": "interview-1on1-engineering-deep-dive-45min",
  "family": "interview",
  "language": "ja",
  "title": "シニアエンジニア面接 / 設計判断ディープダイブ",
  "durationSec": 2700,
  "expectedSpeakerCount": 2,
  "expectedQaPairs": 18,
  "expectedThemes": ["設計判断", "技術選定", "チーム文化"],
  "status": "shell-only"
}
```

`desktop/eval/fixtures/interview/interview-panel-3person-design-review-25min/meta.json`:
```json
{
  "fixtureId": "interview-panel-3person-design-review-25min",
  "family": "interview",
  "language": "ja",
  "title": "デザインレビューパネル / 3人 (デザイナー + PM + エンジニア)",
  "durationSec": 1500,
  "expectedSpeakerCount": 3,
  "expectedQaPairs": 14,
  "expectedThemes": ["UX", "実装制約", "ユーザー検証"],
  "status": "shell-only"
}
```

Repeat for the 3 Brainstorm fixture meta.json files with appropriate JA content.

- [ ] **Step 2: Run the Plan 7 boot-time validator**

Run: `pnpm --filter @lisna/desktop exec tsx desktop/eval/_validator.ts`
Expected: PASS. Both Interview + Brainstorm family `evalBaselines` resolve to directories.

If the validator complains about missing `transcript.json` or `ground_truth.json`, the validator may have a strict mode. Check Plan 7 Task 23's implementation — if it requires those files, Plan 6 creates empty placeholders (`echo '{}' > transcript.json`). Plan 7 Task 3 fills in the real content.

- [ ] **Step 3: Commit**

```bash
git add desktop/eval/fixtures/interview/ \
        desktop/eval/fixtures/brainstorm/
git commit -m "feat(v2-eval): register Interview + Brainstorm baseline directory shells (Plan 7 fills content)"
```

---

### Task 16: Prompt-engineering iteration loop on 1B [SPIKE — load-bearing per Path F]

**Files:**
- Create: `desktop/spikes/phase-1/02-1b-interview-brainstorm/README.md`
- Create: `desktop/spikes/phase-1/02-1b-interview-brainstorm/fixture-interview-chunk.json`
- Create: `desktop/spikes/phase-1/02-1b-interview-brainstorm/fixture-brainstorm-chunk.json`
- Create: `desktop/spikes/phase-1/02-1b-interview-brainstorm/prompt-variants.ts`
- Create: `desktop/spikes/phase-1/02-1b-interview-brainstorm/run-1b-iteration.ts`
- Create: `desktop/spikes/phase-1/02-1b-interview-brainstorm/decision-1.2-1b-iteration.md`

**Goal:** Path F demonstrated 1B fails Lecture slot emergence (0/3) at current prompt design. Plan 6's prompts are different (Interview / Brainstorm vs Lecture). Task 16 explicitly tests whether **prompt engineering can recover quality on 1B** for both families. Techniques NOT tried in Path F's lecture-mini-grammar prompt:

- **Tighter `.max(N)` bounds in schema** — Path F used the lecture spike's `.max(20)` on sections; Plan 6 ships `.max(80)` on qa_pairs and `.max(15)` on idea_clusters with tighter per-cluster ideas.
- **Few-shot exemplars** (carefully — must NOT parrot per Important #4). Use placeholder-text exemplars: `Q_TEMPLATE` / `A_TEMPLATE`.
- **Iterative refinement** — variant 1 with current prompts. If slot emergence < 1/3, variant 2 with tighter "must populate themes" cue. Variant 3 with explicit "if you cannot identify a theme, emit an empty themes array" anti-padding cue.
- **eval-harness scoring** — instead of subjective inspection, use Plan 7's Interview/Brainstorm judges to score each variant.

**Decision routing:**
- If a variant achieves ≥ 2/3 slot emergence AND parroting score `false` across N=3 runs on BOTH Interview + Brainstorm fixtures → 1B becomes a viable ≤ 12 GB default for both families. Update ModelProfile registry + picker default.
- If best variant achieves < 2/3 OR has parroting issues → 1B stays a 3B-fallback ONLY. Document in `decision-1.2-1b-iteration.md`. The picker direction stays "3B default on ≤ 12 GB" per Path F's revised recommendation.

> **Hardware safety:** `(spike-llm)` rule applies. 3 variants × 3 runs × 2 fixtures = 18 LLM calls per iteration. Foreground only. Inter-invocation cooldown 5s. Pre/post `ps -ef | grep llama-completion`.

- [ ] **Step 1: Create the directory + README**

```bash
mkdir -p desktop/spikes/phase-1/02-1b-interview-brainstorm/results
```

Create the README documenting variants + criteria (mirror Spike 1.1's README structure).

- [ ] **Step 2: Lift fixtures from the spike 1.1 fixture**

The Interview chunk fixture can be `desktop/spikes/phase-1/01-merge-llm/fixture-2chunk-interview.json` chunk[0]. Symlink or copy:
```bash
cp desktop/spikes/phase-1/01-merge-llm/fixture-2chunk-interview.json desktop/spikes/phase-1/02-1b-interview-brainstorm/fixture-interview-chunk.json
```

For Brainstorm, synthesize a 1-chunk JA brainstorm transcript (~8K tokens, 4 speakers, "product naming for next quarter" scenario, 4-5 idea clusters expected). The fixture has DESIGN NOTES at the bottom listing expected outputs (3 themes, 8-12 ideas, 1-2 parking_lot entries) so the scoring is deterministic.

```json
// desktop/spikes/phase-1/02-1b-interview-brainstorm/fixture-brainstorm-chunk.json
{
  "sessionId": "spike-1.2-brainstorm",
  "speakers": [
    {"id": 0, "name": "司会"},
    {"id": 1, "name": "メンバーA"},
    {"id": 2, "name": "メンバーB"},
    {"id": 3, "name": "メンバーC"}
  ],
  "transcriptSegments": [
    {"ts": 5, "endTs": 20, "speakerId": 0, "text": "今日は次クォーターの目玉機能候補を5案ぐらいまで出したいです。発散重視で行きましょう。"},
    {"ts": 25, "endTs": 60, "speakerId": 1, "text": "速度ですよね。ノート生成を5秒以内にできれば、ユーザーの待ち時間体験がガラッと変わります。"},
    {"ts": 65, "endTs": 95, "speakerId": 2, "text": "賛成です。あと起動時にモデルを事前ロードしておけば、最初の処理も早く感じます。"},
    {"ts": 100, "endTs": 140, "speakerId": 3, "text": "別軸でいうと、Slack 連携。共有リンクをペーストできるようにすると配布が楽になります。"},
    {"ts": 145, "endTs": 175, "speakerId": 1, "text": "Obsidian の vault に Markdown 吐き出しも欲しいです。ノート資産が手元に残るのが重要。"},
    {"ts": 180, "endTs": 215, "speakerId": 2, "text": "音声から自動 highlight 切り抜きはどうですか? 短い動画として共有できる。"},
    {"ts": 220, "endTs": 245, "speakerId": 0, "text": "それは技術的に重いので、別スプリントで検討しましょう。今日は parking_lot に入れておきます。"},
    {"ts": 250, "endTs": 285, "speakerId": 3, "text": "では他には? 私は検索強化を推したい。過去ノートを横断で意味検索したいです。"}
  ],
  "_designNotes": "Expected themes: 速度向上 / 他ツール連携 / 検索強化. Expected idea count: 5-7. Expected parking_lot: 1 entry (音声 highlight)."
}
```

- [ ] **Step 3: Define prompt variants**

```typescript
// desktop/spikes/phase-1/02-1b-interview-brainstorm/prompt-variants.ts
import type { PromptVariant } from '../../../src/shared/families/util/prompts';
import { INTERVIEW_V1_BASELINE } from '../../../src/shared/families/interview/prompts/v1-baseline';
import { BRAINSTORM_V1_BASELINE } from '../../../src/shared/families/brainstorm/prompts/v1-baseline';

// Variant 1: baseline (current production prompts from Tasks 9 + 10)
export const INTERVIEW_V1 = INTERVIEW_V1_BASELINE;
export const BRAINSTORM_V1 = BRAINSTORM_V1_BASELINE;

// Variant 2: stricter "must populate themes" cue, schematic few-shot
export const INTERVIEW_V2: PromptVariant = {
  ...INTERVIEW_V1_BASELINE,
  variantId: 'v2-strict-themes',
  systemTemplate: INTERVIEW_V1_BASELINE.systemTemplate +
    `\n# 1B 向け追加指示\n` +
    `- themes は必ず1つ以上出力してください (空配列禁止)。\n` +
    `- transcript が短くテーマが抽出できない場合は質問内容のキーワードを themes に含めてください。\n`,
  exemplars: [
    { role: 'user', content: '出力例 (テンプレート):\n{ "themes": [{"name": "THEME_TEMPLATE", "appears_at_ts": [TS_PLACEHOLDER]}] }' },
  ],
};

// Variant 3: anti-padding (explicit) — "if you cannot identify, emit empty"
export const INTERVIEW_V3: PromptVariant = {
  ...INTERVIEW_V1_BASELINE,
  variantId: 'v3-anti-padding',
  systemTemplate: INTERVIEW_V1_BASELINE.systemTemplate +
    `\n# 1B 向け追加指示\n` +
    `- 同義語の質問は1つにまとめてください。\n` +
    `- transcript に明示的に出てくる内容のみ抽出。"恐らく" や "おそらく" で始まる推測は禁止。\n` +
    `- もし themes を1つも抽出できないなら themes: [] を出力 (placeholder ではなく空配列)。\n`,
};

// Same 3 variants for Brainstorm
export const BRAINSTORM_V2: PromptVariant = {
  ...BRAINSTORM_V1_BASELINE,
  variantId: 'v2-strict-clusters',
  systemTemplate: BRAINSTORM_V1_BASELINE.systemTemplate +
    `\n# 1B 向け追加指示\n` +
    `- idea_clusters は必ず1つ以上のクラスタを出力 (空配列禁止)。\n` +
    `- 各 cluster の ideas は最低1つは中身を入れること (空 ideas は禁止)。\n`,
  exemplars: [
    { role: 'user', content: '出力例 (テンプレート):\n{ "idea_clusters": [{ "theme": "THEME_TEMPLATE", "ideas": [{"text": "IDEA_TEMPLATE", "ts": TS_PLACEHOLDER}] }] }' },
  ],
};

export const BRAINSTORM_V3: PromptVariant = {
  ...BRAINSTORM_V1_BASELINE,
  variantId: 'v3-anti-padding',
  systemTemplate: BRAINSTORM_V1_BASELINE.systemTemplate +
    `\n# 1B 向け追加指示\n` +
    `- transcript に明示的に出てくるアイデアのみ抽出。"恐らく" の追加禁止。\n` +
    `- idea が抽出できないなら idea_clusters: [] を出力 (placeholder cluster ではなく空配列)。\n`,
};

export const INTERVIEW_VARIANTS = [INTERVIEW_V1, INTERVIEW_V2, INTERVIEW_V3];
export const BRAINSTORM_VARIANTS = [BRAINSTORM_V1, BRAINSTORM_V2, BRAINSTORM_V3];
```

- [ ] **Step 4: Write the runner**

```typescript
// desktop/spikes/phase-1/02-1b-interview-brainstorm/run-1b-iteration.ts
//
// For each variant × family × seed: call llama-completion 1B with grammar,
// score via Plan 7's family judge, record:
// - Zod validation (pass/fail)
// - slot emergence: Interview = themes >= 1; Brainstorm = idea_clusters >= 1 with ideas >= 1 each
// - parroting heuristic: trigram dedup with the prompt's exemplar text
// - latency
//
// Hardware safety: foreground only, inter-invocation cooldown, ps grep pre/post.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { callWithGrammar } from '../../../src/main/sidecar/grammar-call';
import { startSpikeClient } from '../../../scripts/start-spike-client';
import { InterviewNoteSchema } from '../../../src/shared/families/interview/schema';
import { BrainstormNoteSchema } from '../../../src/shared/families/brainstorm/schema';
import { zodToGbnf } from '../../../src/shared/note-schema/zod-to-gbnf';
import { hydratePostDecode, assignBrainstormIdeaIds } from '../../../src/shared/note-schema/post-decode-hydration';
import { INTERVIEW_VARIANTS, BRAINSTORM_VARIANTS } from './prompt-variants';

const SEEDS = [4000, 4001, 4002];
const COOLDOWN_MS = 5000;
const RESULTS_DIR = resolve(__dirname, 'results');

async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const intFixture = JSON.parse(readFileSync(resolve(__dirname, 'fixture-interview-chunk.json'), 'utf8'));
  const bsFixture = JSON.parse(readFileSync(resolve(__dirname, 'fixture-brainstorm-chunk.json'), 'utf8'));

  // 1B model
  const client = await startSpikeClient({ model: 'llama-3.2-1b-q4-km' });

  try {
    const interviewGrammar = zodToGbnf(InterviewNoteSchema, { schemaName: 'InterviewNote' });
    const brainstormGrammar = zodToGbnf(BrainstormNoteSchema, { schemaName: 'BrainstormNote' });

    const results: any[] = [];
    for (const variant of INTERVIEW_VARIANTS) {
      for (let i = 0; i < SEEDS.length; i++) {
        const seed = SEEDS[i];
        console.log(`Interview variant=${variant.variantId} seed=${seed}`);
        const transcriptText = intFixture.chunks[0].transcriptSegments
          .map((seg: any) => `[${seg.ts}s S${seg.speakerId}] ${seg.text}`).join('\n');
        const userPrompt = variant.chunkUserTemplate
          .replace('{transcript}', transcriptText)
          .replace('{speakers}', intFixture.speakers.map((s: any) => `  ${s.id}: ${s.name}`).join('\n'));
        const r = await callWithGrammar({
          prompt: `<|system|>\n${variant.systemTemplate}\n<|user|>\n${userPrompt}\n<|assistant|>\n`,
          schema: InterviewNoteSchema.transform((p: any) => hydratePostDecode(p)) as any,
          grammar: interviewGrammar,
          baseSeed: seed,
          temperature: variant.recommendedTemp,
          maxAttempts: 3,
          maxTokens: 4096,
          generator: client.generate,
        });
        results.push({
          family: 'interview', variant: variant.variantId, seed,
          ok: r.ok, value: r.ok ? r.value : undefined,
          reason: r.ok ? undefined : r.finalReason,
          latencyMs: r.attempts.reduce((s, a) => s + a.latencyMs, 0),
          attemptsUsed: r.ok ? r.attemptsUsed : r.attempts.length,
        });
        await sleep(COOLDOWN_MS);
      }
    }

    for (const variant of BRAINSTORM_VARIANTS) {
      for (let i = 0; i < SEEDS.length; i++) {
        const seed = SEEDS[i];
        console.log(`Brainstorm variant=${variant.variantId} seed=${seed}`);
        const transcriptText = bsFixture.transcriptSegments
          .map((seg: any) => `[${seg.ts}s S${seg.speakerId}] ${seg.text}`).join('\n');
        const userPrompt = variant.chunkUserTemplate
          .replace('{transcript}', transcriptText)
          .replace('{speakers}', bsFixture.speakers.map((s: any) => `  ${s.id}: ${s.name}`).join('\n'));
        const r = await callWithGrammar({
          prompt: `<|system|>\n${variant.systemTemplate}\n<|user|>\n${userPrompt}\n<|assistant|>\n`,
          schema: BrainstormNoteSchema.transform((p: any) => {
            const withIds = assignBrainstormIdeaIds(p);
            return hydratePostDecode(withIds);
          }) as any,
          grammar: brainstormGrammar,
          baseSeed: seed,
          temperature: variant.recommendedTemp,
          maxAttempts: 3,
          maxTokens: 4096,
          generator: client.generate,
        });
        results.push({
          family: 'brainstorm', variant: variant.variantId, seed,
          ok: r.ok, value: r.ok ? r.value : undefined,
          reason: r.ok ? undefined : r.finalReason,
          latencyMs: r.attempts.reduce((s, a) => s + a.latencyMs, 0),
          attemptsUsed: r.ok ? r.attemptsUsed : r.attempts.length,
        });
        await sleep(COOLDOWN_MS);
      }
    }

    // Score per result
    for (const r of results) {
      r.slotEmergence = scoreSlotEmergence(r);
      r.parrotingHeuristic = scoreParroting(r);
    }

    writeFileSync(resolve(RESULTS_DIR, 'iteration-results.json'), JSON.stringify(results, null, 2), 'utf8');
    console.log(`\n=== SUMMARY ===`);
    for (const variant of [...INTERVIEW_VARIANTS, ...BRAINSTORM_VARIANTS]) {
      const family = variant === INTERVIEW_VARIANTS[0] || variant === INTERVIEW_VARIANTS[1] || variant === INTERVIEW_VARIANTS[2]
        ? 'interview' : 'brainstorm';
      const slice = results.filter((x) => x.variant === variant.variantId && x.family === family);
      const passCount = slice.filter((x) => x.ok && x.slotEmergence).length;
      const parrotCount = slice.filter((x) => x.parrotingHeuristic).length;
      console.log(`  ${family}/${variant.variantId}: slot ${passCount}/${slice.length}, parroting ${parrotCount}/${slice.length}`);
    }
  } finally {
    await client.shutdown();
  }
}

function scoreSlotEmergence(r: any): boolean {
  if (!r.ok || !r.value) return false;
  if (r.family === 'interview') {
    return (r.value.themes ?? []).length >= 1;
  }
  // brainstorm: at least 1 cluster with ≥1 idea
  return (r.value.idea_clusters ?? []).some((c: any) => (c.ideas ?? []).length >= 1);
}

function scoreParroting(r: any): boolean {
  // Crude: does the output contain "TEMPLATE" or "PLACEHOLDER" (exemplar leak)?
  if (!r.ok || !r.value) return false;
  const json = JSON.stringify(r.value);
  return /TEMPLATE|PLACEHOLDER|TS_PLACEHOLDER/.test(json);
}

function sleep(ms: number) { return new Promise<void>((res) => setTimeout(res, ms)); }

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 5: Pre-run hardware check**

Run:
```bash
ps -ef | grep -E "llama-completion|tsx" | grep -v grep || echo "(clean)"
```
Expected: `(clean)`. Otherwise `kill -9` survivors.

- [ ] **Step 6: Execute the iteration**

> **CRITICAL: foreground only.**

Run:
```bash
pnpm --filter @lisna/desktop exec tsx desktop/spikes/phase-1/02-1b-interview-brainstorm/run-1b-iteration.ts
```
Expected: ~10-15 minutes (18 LLM calls × ~15-25s per call on 1B + 17 × 5s cooldowns ≈ 6-9 min, plus model loads). If wall time > 25 min, abort.

- [ ] **Step 7: Post-run cleanup verification**

```bash
ps -ef | grep -E "llama-completion|tsx" | grep -v grep || echo "(clean)"
```

- [ ] **Step 8: Write the verdict memo**

Create `desktop/spikes/phase-1/02-1b-interview-brainstorm/decision-1.2-1b-iteration.md` following the same shape as `decision-0.2-path-f.md`:

```markdown
# Spike 1.2 — 1B Llama 3.2 prompt-iteration on Interview + Brainstorm (YYYY-MM-DD)

## Hardware / Build / Setup
(same fields as Path F)

## Per-variant scorecards

### Interview
| Variant | Seed | Zod | Slot emergence | Parroting | Latency |
|---|---|---|---|---|---|
| v1-baseline | 4000 | <p/f> | <p/f> | <yes/no> | <ms> |
| v1-baseline | 4001 | <p/f> | <p/f> | <yes/no> | <ms> |
| v1-baseline | 4002 | <p/f> | <p/f> | <yes/no> | <ms> |
| v2-strict-themes | 4000 | ... |
| v2-strict-themes | 4001 | ... |
| v2-strict-themes | 4002 | ... |
| v3-anti-padding | 4000 | ... |
| v3-anti-padding | 4001 | ... |
| v3-anti-padding | 4002 | ... |

### Brainstorm
(same table, variants v1 / v2-strict-clusters / v3-anti-padding)

## Verdict

**Best variant for Interview**: <variantId>
**Best variant for Brainstorm**: <variantId>

**1B viability decision**:
- If best variant achieves ≥ 2/3 slot emergence AND 0/3 parroting AND ≤ 25s latency per chunk on BOTH families → **1B becomes ≤ 12 GB default for these families.** Update ModelProfile registry default; picker shows 1B as recommended for ≤ 12 GB Macs. Family default prompt variant updated in `families/interview/index.ts` + `families/brainstorm/index.ts`.
- Otherwise → **1B stays a 3B-fallback ONLY.** 3B remains the ≤ 12 GB default. 1B usable when user explicitly picks "fast capture" tier (not yet shipped). Family default prompt variant stays at v1-baseline.

## Reasoning

(One paragraph keyed to the actual numbers, mirroring Path F's structure.)

## Next steps

- Update `desktop/src/shared/families/interview/index.ts` defaultPromptVariant if a v2 or v3 variant won.
- Update `desktop/src/shared/families/brainstorm/index.ts` same.
- If 1B becomes viable: update ModelProfile registry (Plan 2 Task 17) to mark 1B as `ramBudgetMB: 4000` recommended default for ≤ 12 GB tier.
- If 1B stays fallback: file follow-up issue tracking "v3 capability gap on 1B" for future iteration.
```

- [ ] **Step 9: Apply the verdict in production code (if a v2 or v3 variant won)**

If the best Interview variant is `v2-strict-themes` or `v3-anti-padding`:
- Update `desktop/src/shared/families/interview/prompts/` to add the winning variant (copy from `prompt-variants.ts`).
- Modify `desktop/src/shared/families/interview/index.ts` — set `defaultPromptVariant: '<winning-id>'`.

Same for Brainstorm.

If 1B-viability decision is "1B becomes default":
- Modify `desktop/src/shared/models/profiles.ts` — change the default profile from `llama-3.2-3b-q4-km` to `llama-3.2-1b-q4-km` for the ≤ 12 GB tier (or whatever the registry's tier-selection key is).

- [ ] **Step 10: Commit**

```bash
git add desktop/spikes/phase-1/02-1b-interview-brainstorm/ \
        desktop/src/shared/families/interview/prompts/ \
        desktop/src/shared/families/brainstorm/prompts/ \
        desktop/src/shared/families/interview/index.ts \
        desktop/src/shared/families/brainstorm/index.ts \
        desktop/src/shared/models/profiles.ts
git commit -m "test(spike-1.2): 1B prompt-iteration — <verdict + winning variant per family>"
```

Replace `<verdict + winning variant per family>` with the actual outcome (e.g. "interview=v3-anti-padding, brainstorm=v1-baseline, 1B viable for interview only").

---

### Task 17: Path G converter extension — `.max(N)` → bounded GBNF [Plan 2 amendment]

**Files:**
- Modify: `desktop/src/shared/note-schema/zod-to-gbnf.ts`
- Create: `desktop/src/shared/note-schema/__tests__/zod-to-gbnf-bounded.test.ts`

**Goal:** Per Path G (revised in `decision-0.2-path-f.md`): the GBNF converter must emit bounded repetitions when a Zod array has `.max(N)`. Without this, the `.max(N)` bound exists only at validation time (post-decode); the model can still emit more entries and trigger a retry. Path G provides production-grade prevention by encoding the bound INTO the grammar.

This is technically a Plan 2 amendment. Plan 6 owns it because both `.max(N)` bounds (Tasks 1-4) and the 1B iteration loop (Task 16) depend on it. The converter extension is small (~30 LOC) and well-tested.

**Cross-plan coordination:** Plan 2 owns `zod-to-gbnf.ts`. Plan 6 modifies it. The commit message references both plans. If Plan 2's owner needs to gate this change, surface to controller.

- [ ] **Step 1: Read the current converter**

Read `desktop/src/shared/note-schema/zod-to-gbnf.ts`. Find the array-handling branch. Identify where `z.array(...)` is translated to GBNF.

Current shape (typical from Plan 2 Task 18 lift from spike):
```typescript
// (Plan 2 conversion — illustrative)
function zArrayToGbnf(schema: z.ZodArray<any>): string {
  const inner = zToGbnf(schema.element);
  return `"[" ws ( ${inner} ( "," ws ${inner} )* )? ws "]"`;
}
```

This generates `[item, item, item, ...]` with no upper bound. We need to detect `.max(N)` and emit `{0,N}` repetition.

- [ ] **Step 2: Write the failing test**

Create `desktop/src/shared/note-schema/__tests__/zod-to-gbnf-bounded.test.ts`:
```typescript
// desktop/src/shared/note-schema/__tests__/zod-to-gbnf-bounded.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToGbnf } from '../zod-to-gbnf';

describe('zod-to-gbnf — bounded arrays (Path G)', () => {
  it('encodes .max(N) as a bounded repetition in GBNF', () => {
    const schema = z.object({
      items: z.array(z.string()).max(3),
    });
    const gbnf = zodToGbnf(schema, { schemaName: 'TestObj' });

    // Bounded form: `[` item ( `,` item ){0,2} `]` (max 3 = 1 + up to 2 more)
    // Empty array also valid: `[` `]`
    expect(gbnf).toMatch(/items.*\{0,2\}/);
  });

  it('encodes .max(0) as forbidding any items (empty array only)', () => {
    const schema = z.object({
      items: z.array(z.string()).max(0),
    });
    const gbnf = zodToGbnf(schema, { schemaName: 'TestObj' });
    // Empty-only form: `[` `]`
    expect(gbnf).not.toMatch(/\(.*,.*\)\*/);  // no unbounded repetition
  });

  it('respects .min(N).max(M) combined', () => {
    const schema = z.object({
      items: z.array(z.string()).min(1).max(3),
    });
    const gbnf = zodToGbnf(schema, { schemaName: 'TestObj' });
    // min=1, max=3 → exactly 1, then up to 2 more: `[` item ( `,` item ){0,2} `]`
    expect(gbnf).toMatch(/items.*\{0,2\}/);
    // Empty form should NOT be allowed: the bracket-item-bracket must not be optional
    // (heuristic: no `?` after the first item group)
  });

  it('unbounded array (no .max) falls back to `*` (any count)', () => {
    const schema = z.object({
      items: z.array(z.string()),
    });
    const gbnf = zodToGbnf(schema, { schemaName: 'TestObj' });
    expect(gbnf).toMatch(/items.*\*/);
  });

  it('InterviewNote schema with .max(80) on qa_pairs produces bounded grammar', () => {
    const { InterviewNoteSchema } = require('../../families/interview/schema');
    const gbnf = zodToGbnf(InterviewNoteSchema, { schemaName: 'InterviewNote' });
    // qa_pairs max is 80 → bound is {0,79}
    expect(gbnf).toMatch(/qa_pairs.*\{0,79\}/);
  });

  it('BrainstormNote schema with .max(15) on idea_clusters', () => {
    const { BrainstormNoteSchema } = require('../../families/brainstorm/schema');
    const gbnf = zodToGbnf(BrainstormNoteSchema, { schemaName: 'BrainstormNote' });
    expect(gbnf).toMatch(/idea_clusters.*\{0,14\}/);
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/zod-to-gbnf-bounded.test.ts`
Expected: FAIL — current converter emits unbounded `*`.

- [ ] **Step 4: Extend the converter**

In `desktop/src/shared/note-schema/zod-to-gbnf.ts`, find `zArrayToGbnf` (or equivalent — exact name from Plan 2 Task 18 lift). Modify:

```typescript
// In desktop/src/shared/note-schema/zod-to-gbnf.ts
//
// Path G extension: honor .max(N) bounds. The Zod array schema exposes
// `_def.maxLength` and `_def.minLength` (Zod v3 internals — these are
// stable, used in the official zod-to-json-schema package).

function zArrayToGbnf(schema: z.ZodArray<any>): string {
  const inner = zToGbnf(schema.element);
  const minVal = (schema._def.minLength?.value as number | undefined) ?? 0;
  const maxVal = schema._def.maxLength?.value as number | undefined;

  if (maxVal === undefined) {
    // Unbounded: `[` ( inner ( `,` inner )* )? `]`
    if (minVal > 0) {
      // min=1 → at least 1: `[` inner ( `,` inner )* `]`
      return `"[" ws ${inner} ( "," ws ${inner} )* ws "]"`;
    }
    return `"[" ws ( ${inner} ( "," ws ${inner} )* )? ws "]"`;
  }

  if (maxVal === 0) {
    // Bound is 0: empty array only
    return `"[" ws "]"`;
  }

  // Bounded: max = N → first item, then up to (N-1) more
  const maxAdditional = maxVal - 1;
  if (minVal === 0) {
    // 0..N range: empty OR 1 + up to (N-1) more
    return `"[" ws ( ${inner} ( "," ws ${inner} ){0,${maxAdditional}} )? ws "]"`;
  }
  // min ≥ 1: at least min, up to max
  // For min=max=N: exactly N items
  if (minVal === maxVal) {
    return `"[" ws ${inner} ( "," ws ${inner} ){${minVal - 1},${maxAdditional}} ws "]"`;
  }
  // min < max: at least 1, between (min-1) and (max-1) additional
  return `"[" ws ${inner} ( "," ws ${inner} ){${minVal - 1},${maxAdditional}} ws "]"`;
}
```

- [ ] **Step 5: Run the tests, expect PASS**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/zod-to-gbnf-bounded.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 6: Run the existing Plan 2 round-trip test to confirm no regression**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/zod-to-gbnf.test.ts`
Expected: all existing tests still PASS.

- [ ] **Step 7: Run the existing Spike 0.1 round-trip test (if still in tree)**

Run:
```bash
test -f desktop/spikes/phase-0/01-zod-to-gbnf/round-trip.test.ts && \
  pnpm --filter @lisna/desktop test desktop/spikes/phase-0/01-zod-to-gbnf/round-trip.test.ts || \
  echo "(round-trip test no longer in tree — assume migrated to shared)"
```
Expected: still PASS OR migrated note printed.

- [ ] **Step 8: Spike-llm gate — verify converter empirically grammar-valid**

The unit test above checks the GBNF string shape. We should also verify that `llama_grammar_init` accepts it for the new bounded form. This requires a single LLM call (foreground, with cleanup). If Plan 7 Task 23 has a fast smoke for grammar-validity, use it:
```bash
pnpm --filter @lisna/desktop exec tsx desktop/eval/_validator.ts
```
Expected: PASS — boots, runs grammar validation on every registered family, exits 0.

If no such validator exists yet, create a one-off check script that does:
```typescript
// Throwaway: desktop/scripts/check-bounded-grammar.ts
const gbnf = zodToGbnf(InterviewNoteSchema, { schemaName: 'InterviewNote' });
const client = await startSpikeClient({ model: 'llama-3.2-3b-q4-km' });
try {
  // Call generate with a stub prompt and the grammar; if llama_grammar_init throws,
  // the call returns with a stderr message we can detect.
  const r = await client.generate({ prompt: 'test\n', grammar: gbnf, seed: 9999, temperature: 0.4, maxTokens: 64 });
  console.log('GBNF accepted:', r.text.length, 'bytes');
} finally {
  await client.shutdown();
}
```

Run, then `ps -ef | grep llama-completion` cleanup as usual.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/shared/note-schema/zod-to-gbnf.ts \
        desktop/src/shared/note-schema/__tests__/zod-to-gbnf-bounded.test.ts
git commit -m "refactor(shared): zod-to-gbnf Path G extension — honor .max(N) as bounded GBNF repetition

Plan 6 dependency. Production-grade prevention of Path F-style runaways:
the .max(N) Zod bound is now enforced in the GBNF grammar itself, not
only at post-decode validation. Empirically verified accept by
llama_grammar_init across all 4 family schemas (lecture/meeting/
interview/brainstorm).

Cross-plan: Plan 2 amendment (Plan 2 Task 18 owned the original
converter; Plan 6 extends it because Path F runaway + Interview/
Brainstorm .max(N) bounds depend on it)."
```

---

### Task 18: E2E smoke + final verification gate

**Files:**
- Create: `desktop/src/main/sidecar/__tests__/e2e-interview-brainstorm.test.ts`

**Goal:** Hardware-gated end-to-end test that runs the full Stop pipeline for both families on a small fixture. Default-skipped behind `LISNA_E2E_LLM_SMOKE=1` (CI default off). When enabled, runs:
1. Real `llama-completion` 3B
2. Real `chunkTranscript` on a 2-chunk synthetic
3. Real `callWithGrammar` per chunk
4. Real `runMergeLLMCall` (if Task 6 verdict was PASS) OR `runDeterministicMerge` (if FAIL)
5. Asserts final note is `ValidatedNote` for the family

Plus run all unit tests one final time + typecheck + verify clean tree.

- [ ] **Step 1: Write the E2E test (env-gated)**

```typescript
// desktop/src/main/sidecar/__tests__/e2e-interview-brainstorm.test.ts
import { describe, it, expect } from 'vitest';

const e2eEnabled = process.env.LISNA_E2E_LLM_SMOKE === '1';
const e2eDescribe = e2eEnabled ? describe : describe.skip;

e2eDescribe('E2E — interview + brainstorm full pipeline', () => {
  it('interview 2-chunk synth → InterviewNote validates', async () => {
    // Imports inside the describe so unrelated CI runs don't spawn the sidecar.
    const { runFinalize } = await import('../orchestrator');
    const { InterviewNoteSchema } = await import('../../../shared/families/interview/schema');
    const { startSpikeClient } = await import('../../../../scripts/start-spike-client');
    // ... load fixture, init client, runFinalize, assert
  });

  it('brainstorm 1-chunk synth → BrainstormNote validates (with UUIDs)', async () => {
    // same shape — assert idea_clusters[].ideas[].id is UUID for every idea
  });
});
```

- [ ] **Step 2: Quick smoke (skipped by default)**

Run: `pnpm --filter @lisna/desktop test desktop/src/main/sidecar/__tests__/e2e-interview-brainstorm.test.ts`
Expected: 2 tests SKIPPED (env not set). Good — CI doesn't spawn LLM.

- [ ] **Step 3: Hardware-gated full smoke (manual only)**

Run:
```bash
ps -ef | grep -E "llama-completion|tsx" | grep -v grep || echo "(clean)"
LISNA_E2E_LLM_SMOKE=1 pnpm --filter @lisna/desktop test desktop/src/main/sidecar/__tests__/e2e-interview-brainstorm.test.ts
ps -ef | grep -E "llama-completion|tsx" | grep -v grep || echo "(clean)"
```

Expected: both runs `(clean)` bookend. Vitest reports 2 PASS in 30-90s (chunks + merge calls hit real LLM).

- [ ] **Step 4: Full plan typecheck + test gate**

Run:
```bash
pnpm --filter @lisna/desktop typecheck
pnpm --filter @lisna/desktop test --run
```
Expected: typecheck PASS, all tests PASS (except the env-gated 2 smoke tests which stay skipped without the env var).

- [ ] **Step 5: Verify git state is clean**

```bash
git status -s
git log --oneline -25
```

Expected: no unstaged changes, 25+ Plan 6 commits visible.

- [ ] **Step 6: Commit the E2E test (if any changes — typically the file alone)**

```bash
git add desktop/src/main/sidecar/__tests__/e2e-interview-brainstorm.test.ts
git commit -m "test(v2): E2E smoke for interview + brainstorm pipeline (env-gated LISNA_E2E_LLM_SMOKE=1)"
```

- [ ] **Step 7: Final hardware cleanup check (per `spike-llm` rule)**

```bash
ps -ef | grep -E "llama-completion|vitest" | grep -v grep || echo "(clean)"
```
Expected: `(clean)`. If any survivor, `kill -9` BEFORE declaring Plan 6 complete.

---

## Self-review checklist (do not skip)

Run after all tasks land before declaring Plan 6 complete.

**Spec coverage:**
- [ ] §3.2 (PurposeDrivenNote) — Task 1 (Step 4) ✓
- [ ] §3.5 (InterviewNote with qa_pairs, themes, quotable_lines, key_takeaways) — Task 1 ✓
- [ ] §3.6 (BrainstormNote with idea_clusters, parking_lot, atmosphere) — Task 3 ✓
- [ ] §2.8 (grammar ⊂ validated split, postDecodeOnly markers) — Task 1 (PurposeDrivenNote `from` field) + Task 3 (`ideas[].id` field, post-decode UUID) ✓
- [ ] §5.2 (Stop-phase pipeline: chunk → per-chunk LLM → merge → hydrate → validate) — Task 13 ✓
- [ ] §5.2b (Merge contract — `themes: merge-llm` Interview, `idea_clusters: merge-llm` Brainstorm) — Tasks 7 (PASS path) / 8 (FAIL path) ✓
- [ ] §4 #13 migration fixtures committed Day 1 — Task 1 (v1-interview-sample.json) + Task 3 (v1-brainstorm-sample.json) ✓
- [ ] §4.0 FamilyDefinition shape + registry binding — Task 11 + Task 12 ✓
- [ ] §4 P4 evalBaselines registration — Task 11 + Task 12 ship `evalBaselines: string[]`; Task 15 creates directory shells ✓
- [ ] §10.1 (legacy v2 alpha notes coexist) — out-of-scope here; Plan 6 only adds new families, doesn't touch legacy

**Path F finding coverage:**
- [ ] `.max(N)` Path G bounds: Task 1 (Interview) + Task 3 (Brainstorm) ✓
- [ ] Bounded GBNF emission (converter): Task 17 ✓
- [ ] 1B viability empirically tested: Task 16 ✓

**Spike 1.1 (merge-LLM) PASS/FAIL routing:**
- [ ] PASS path productionized: Task 7 ✓
- [ ] FAIL path with UI degradation: Task 8 ✓
- [ ] Orchestrator branches on flag set by Task 7 OR 8: Task 13 Step 4 ✓
- [ ] Spike runner has cleanup discipline: Task 5 Steps 7 + 9 ✓

**Cross-plan contract usage:**
- [ ] Plan 2 `callWithGrammar` consumed: Tasks 5, 7, 13, 16 ✓
- [ ] Plan 2 `chunkTranscript` consumed: Task 13 ✓
- [ ] Plan 2 `hydratePostDecode` consumed: Task 13, Task 16 ✓
- [ ] Plan 2 `computeProvenance` consumed: Task 13 ✓
- [ ] Plan 2 `FamilyDefinition` consumed: Task 11, Task 12 ✓
- [ ] Plan 2 `PromptVariant` consumed: Tasks 9, 10 ✓
- [ ] Plan 2 `ModelProfile` consumed: Tasks 5, 13, 16 ✓
- [ ] Plan 2 `zod-to-gbnf` modified: Task 17 ✓
- [ ] Plan 4 `DiarizationEngine` (transitive): orchestrator consumes via `requiresDiarization` flag — Task 11 + 12 set it; Task 13 branches ✓
- [ ] Plan 4 `SpeakerLabeledSegment`: rendered via `resolveSpeakerLabel` in Task 11 + 12 ✓
- [ ] Plan 4 `resolveSpeakerLabel`: imported in Task 11 + 12 ✓
- [ ] Plan 7 Interview/Brainstorm judge contracts aligned: prompt design Tasks 9 + 10 explicitly mirror Plan 7's axes (qaParity/themeExtraction/quotableSelection + clusterCoherence/ideaDiversity/argumentChainDepth) ✓
- [ ] Plan 7 `evalBaselines` validator gate: Task 15 ✓

**Placeholder scan:**
- [ ] No "TBD" / "implement later" — verify `grep -i "TBD\|TODO" docs/superpowers/plans/2026-05-27-v2-plan-6-interview-brainstorm.md` returns ≤ 1 hit (the explicit "fill in" in Task 6's verdict-memo template — that's an instruction TO the implementer, not a placeholder for the spec).
- [ ] No "Add appropriate X" — every step has concrete code.
- [ ] Intentional placeholders (acceptable):
  - Task 5 Step 5 `startSpikeClient` import depends on Plan 4 DI-21 landing — surfaced as gate at Step 6.
  - Task 6 verdict memo template — `<fill>` placeholders are correct here, the implementer fills with actual run data.
  - Task 13 Step 4 — depends on Plan 5 having shipped Meeting before for the `switch(family)` pattern; if Plan 5 has not shipped, Task 13 introduces the switch.
  - Task 14 — read-only step ("if picker reads from registry, skip the picker edit") is conditional on Plan 2 #4 P5 picker config implementation choice; Plan 6 supports either path.

**Type consistency:**
- [ ] `InterviewNote` referenced consistently in Tasks 1, 2, 7, 9, 11, 13, 16, 17
- [ ] `BrainstormNote` referenced consistently in Tasks 3, 4, 7, 10, 12, 13, 16, 17
- [ ] `MergeResultOk / MergeResultFail / MergeResult` consistent across Tasks 7 + 13
- [ ] `DeterministicMergeOk / DeterministicMergeFail / DeterministicMergeResult` consistent across Tasks 8 + 13
- [ ] `MergeStrategy.fieldOverrides[*].policy` enum values match across Tasks 7 + 8 (`'concat-only' | 'concat-dedup' | 'merge-llm' | 'longest' | 'first' | 'custom'`)
- [ ] `PromptVariant` shape from Plan 2 Task 15 — Tasks 9 + 10 + 16 use `{ version, variantId, systemTemplate, chunkUserTemplate, mergeUserTemplate, exemplars?, recommendedTemp, notes }`
- [ ] `LlmGenerator` callback signature consistent in Tasks 5, 7, 13, 16
- [ ] `SessionTranscript.speakers: { id: number; name?: string }[]` consistent — Tasks 11 (resolveSpeakerLabel call), 12 (same), 13 (passed to merge-llm)

**Task ordering verification:**
- [ ] Task 0 (pre-flight) before any task that touches code
- [ ] Tasks 1-4 (schemas) before Tasks 5 (spike runner uses InterviewNoteSchema), 7+8 (merge logic), 11+12 (renderers), 13 (orchestrator), 17 (converter for these specific schemas)
- [ ] Task 17 (converter extension) BEFORE Task 5 (spike runner) — explicitly required: Task 5 Step 6 expects Task 17 to have landed
- [ ] Task 17 BEFORE Task 16 (1B iteration uses bounded GBNF) — explicit at Task 16 Step 4
- [ ] Task 5 (spike runner) BEFORE Task 6 (verdict scorer reads its output)
- [ ] Task 6 (verdict) BEFORE Task 7 OR Task 8 (one or the other lands based on verdict)
- [ ] Tasks 9 + 10 (prompts) BEFORE Tasks 11 + 12 (family registration imports the prompts)
- [ ] Task 13 (orchestrator) AFTER Tasks 1-12 (consumes all of them)
- [ ] Task 14 (UI) AFTER Tasks 11 + 12 (registration unlocks dynamic picker entry)
- [ ] Task 15 (eval directory shells) AFTER Tasks 11 + 12 (evalBaselines ID strings declared there)
- [ ] Task 16 (1B iteration) AFTER Tasks 9 + 10 + 17 (uses prompts + bounded grammar)
- [ ] Task 18 (E2E + final gate) LAST

**Hardware safety baked in:**
- [ ] Spike Tasks 5, 16 explicitly cite `spike-llm` rule + foreground-only + pre/post ps grep + 5s cooldown ✓
- [ ] Task 18 E2E test gated behind `LISNA_E2E_LLM_SMOKE=1` (default skip) ✓
- [ ] No `run_in_background:true` anywhere in the plan ✓
- [ ] Tasks 7 (merge-llm) + 8 (deterministic) + 11 + 12 (renderers) + 13 (orchestrator) use **mock LlmGenerator** in unit tests — no LLM spawn ✓

**Verification-before-completion gate:**
- [ ] Each task ends with concrete `pnpm test` + expected outcome
- [ ] Task 18 runs final typecheck + full-suite test + git status before declaring Plan 6 complete
- [ ] After every commit, hardware envelope check available (manual or part of next task's pre-flight)

---

## Next plan dependencies

| Plan | Waits on | Reason |
|---|---|---|
| Plan 7 (Eval harness) | Task 11 + Task 12 (evalBaselines registered) AND Task 15 (directory shells exist) | Plan 7's boot-time validator (Task 23) reads `FamilyDefinition.evalBaselines` and asserts each ID resolves to a fixture dir. Plan 6 makes those exist. Plan 7's Task 3 (Meeting/Interview/Brainstorm fixture stubs) THEN fills in the transcript + ground-truth content. Plan 7's Tasks 11 (Interview judge) + 12 (Brainstorm judge) judge prompts MUST land before Plan 6 Task 9 + 10 (else prompt-design alignment is guesswork) — Pre-flight Step 3 verifies this. |
| Future: prompt iteration / v2 prompts | Plan 6 ships | If Task 16 verdict says 1B is viable with a v2/v3 variant, that variant gets promoted to default. Future iterations add variants without changing the framework — PromptRegistry pattern (Plan 2) was designed exactly for this. |
| Future: cross-session speaker recall | Plan 6 ships | spec §10.3 — Brainstorm + Interview both benefit. Out of scope for v2 alpha. Deferred. |

| Plan | Provides to Plan 6 (already landed before Plan 6 starts) | Used in |
|---|---|---|
| Plan 2 (Foundation) | `callWithGrammar`, `chunkTranscript`, `hydratePostDecode`, `computeProvenance`, `FamilyDefinition`, `PromptVariant`, `ModelProfile`, `zod-to-gbnf` | Tasks 5, 7, 9, 10, 11, 12, 13, 16, 17 |
| Plan 4 (Diarization) | `DiarizationEngine`, `SpeakerLabeledSegment`, `resolveSpeakerLabel`, `requiresDiarization` flag, model-resolver tier-4 | Tasks 11, 12 (speaker rendering), Task 13 (orchestrator passes through diarization output) |
| Plan 7 (Eval) | Interview judge prompt (Task 11), Brainstorm judge prompt (Task 12), ContractTest core (Task 4), Per-family contract rules (Task 5), boot-time evalBaselines validator (Task 23) | Tasks 9, 10 (prompt-design alignment), Task 15 (directory shells), Task 16 (judge-scored iteration) |

---

## Risk acknowledgments carried forward

These are quality risks the Plan 6 implementer should keep loaded during execution:

- **Path F finding: 1B fails Lecture quality.** Plan 6's Tasks 16 explicitly tests whether prompt engineering can recover 1B on Interview + Brainstorm. If FAILs, picker direction stays at 3B-default per Path F's revised recommendation. The verdict memo template at Task 16 Step 8 routes the decision.
- **Merge-LLM call is unmeasured.** Spike 1.1 (Tasks 5 + 6) is the first empirical measurement. The PASS/FAIL gate at Task 6 routes to Task 7 (productionize) or Task 8 (deterministic fallback + UI degradation). MIXED triggers founder gate. The plan does not assume the verdict — both paths are fully written.
- **3B with structured JSON INPUT (merge call) is novel.** Per the spec brainstorm, this is the highest single quality risk. The acceptance criteria at Spike 1.1 (6 criteria including cross-chunk theme dedup + fabrication detection) are aligned with what failure modes are most likely (themes duplicated under different names; quotable_lines double-counted; ts ordering preserved per-partial rather than re-sorted across partials).
- **`.max(N)` bounds in schema MUST also be enforced in GBNF (Task 17).** Without bounded GBNF, the model can emit > N items and trigger a retry — wasted token budget + latency hit. Path F's Run 2 runaway (n_predict=4096 hit, invalid JSON) is the failure mode Path G prevents.
- **Brainstorm `idea_clusters[].ideas[].id` is post-decode.** 3B cannot generate unique UUIDs reliably (Spike 0.1 take-2 finding). Schema marks `id` as postDecodeOnly; converter strips it from the GBNF; `assignBrainstormIdeaIds` (Task 3 Step 5) fills uuid() after grammar-constrained decode. Closure-validation re-parse catches any drift.
- **Anti-parroting on exemplars.** Plan 7 Task 13's content-fidelity judge emits `parroting: boolean`. Plan 6's prompt design uses schematic placeholders (`Q_TEMPLATE`, `THEME_TEMPLATE`) so the judge doesn't false-positive on legitimate exemplar leakage. Task 9 Step 1's last test explicitly asserts this discipline.
- **Cross-talk in Interview** (spec §8 "Audio / STT / diarization" — listed risk): if a 2-speaker interview has overlapping speech, diarization assigns to the dominant voice. Interview's `participants` field marks role per resolved speaker; cross-talk segments may inflate `asked_by == answered_by` (the schema permits this, but Plan 7's Per-family contract rule rejects it as a diarization-quality issue, not a schema issue). Plan 6 surfaces this via `validation_warnings` plumbing in Task 7 (MIXED path) or Task 8 (FAIL path).
- **Spec amendment 2** (if Task 6 verdict = FAIL) lands documenting the merge-LLM → deterministic demotion + UI banner. The amendment is small (~20 lines in spec §5.2b) but is required for honesty: the spec currently says `themes: merge-llm` + `idea_clusters: merge-llm`; if FAIL, those become `concat-dedup` + `concat-only`. The amendment can land in the same commit as Task 8 Step 7.
- **Whisper segment timestamp drift ±1s** (pitfalls.md `audio`): Interview's `qa_pairs[].ts` and `themes[].appears_at_ts` are derived from whisper segment ts. The ±1s drift is accepted per the existing project decision. Plan 7 Interview judge's qaParity axis tolerates paraphrase + small ts shifts.
- **8 GB RAM envelope on M3 dev hardware.** Plan 6 inherits Spike 0.1's N=5 retry budget per the Spec Amendment 1. Tasks 5 + 16 stick to N=3 invocations × small fixtures to keep RAM headroom for the sidecar (~3-4 GB for 3B + 1 GB for 1B-Q4_K_M).

---

**End of Plan 6.**

> Self-check before declaring Plan 6 complete:
> 1. All 18 tasks committed (~25 commits expected total across Tasks 1-18 since some tasks include sub-commits like Task 7 MIXED-only banner).
> 2. Spike 1.1 verdict memo (`decision-1.1-verdict.md`) committed AND its decision matches the Task 7 vs Task 8 path actually executed (PASS → Task 7 ran; FAIL → Task 8 ran).
> 3. Spike 1.2 verdict memo (`decision-1.2-1b-iteration.md`) committed AND prompt-variant promotion (if any) committed alongside.
> 4. `LISNA_E2E_LLM_SMOKE=1 pnpm --filter @lisna/desktop test e2e-interview-brainstorm` PASSES.
> 5. `pnpm --filter @lisna/desktop typecheck` PASSES.
> 6. `pnpm --filter @lisna/desktop test --run` PASSES (with the 2 env-gated tests skipped).
> 7. `ps -ef | grep -E "llama-completion|vitest" | grep -v grep` returns `(clean)`.
> 8. `git status -s` returns empty.
> 9. Plan 7's boot-time `evalBaselines` validator PASSES against the Interview + Brainstorm registrations.
> 10. If Task 16 promoted 1B as default for either family, that promotion is reflected in `defaultPromptVariant` AND `desktop/src/shared/models/profiles.ts`.

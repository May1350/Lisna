# Plan 7 (Eval Harness) Verdict — 2026-05-28

Closeout memo for `docs/superpowers/plans/2026-05-27-v2-plan-7-eval-harness.md`. Mirrors Phase 0 VERDICT pattern.

## Goal status

Plan 7 SHIPPED. Branch `feat/v2-eval-harness` carries 31 commits ahead of `origin/main`. PR is open for review when Plan 2 reaches the integration point.

## What shipped

| Layer | Files | Tests |
|---|---|---|
| Fixture format | `desktop/eval/fixtures/_schema.ts` + `_validator.ts` | `_schema.test.ts` (5), `_validator.test.ts` (3) |
| Fixtures (lecture × 3 real + meeting/interview/brainstorm × 3 stubs each) | `desktop/eval/fixtures/<family>/<slug>/` | parsed via `_validator` + schema parse smoke |
| ContractTest core + per-family rules + anti-parroting | `desktop/eval/contract/` | `contract-test.test.ts` (6), `families.test.ts` (10), `anti-parroting.test.ts` (5) |
| LLM judges (4 family prompts + base router + content-fidelity + pairwise) | `desktop/eval/judges/` | `llm-judge.test.ts` (8), `content-fidelity-judge.test.ts` (6), `pairwise-judge.test.ts` (8) |
| Metrics (retry-histogram, slot-distribution, DER skeleton) | `desktop/eval/metrics/` | each `.test.ts` (4 each) |
| Runners + pipeline stub | `desktop/eval/runners/` | `single-fixture.test.ts` (3) |
| Baseline format + store + diff | `desktop/eval/baseline/` | `format.test.ts` (3), `store.test.ts` (3), `diff.test.ts` (4) |
| Scorecard | `desktop/eval/scorecard.ts` | `scorecard.test.ts` (3) |
| CLI entries | `desktop/scripts/eval-notes.ts`, `eval-judge-swap.ts`, `score-spike-0.2.ts` | `eval-notes.test.ts` (3) |
| v0 Spike 0.2 baseline replay | `desktop/scripts/score-spike-0.2.ts` | (manual smoke verified the missing-results error path) |
| Operator README | `desktop/eval/README.md` | — |

## Empirically verified

- `pnpm exec tsc --noEmit` exit 0.
- All `desktop/eval/**.test.ts` + `desktop/scripts/eval-notes.test.ts` PASS — 82 tests (17 files).
- `desktop/src/` test suite: 373 passing (baseline preserved from Plan 3 closeout; no regressions).
- `pnpm eval:notes --family lecture --dry-run` echoes options + exits 0.
- `pnpm eval:notes --family lecture --runner stub --no-llm-judge --fixture procedural-physics-em` runs the offline end-to-end pipeline (fixture parse → stub runner → ContractTest → scorecard) without GROQ_API_KEY.
- `pnpm eval:spike-0.2` reaches the "results not found" graceful error path (script wires correctly; live execution gated on founder re-running Spike 0.2).

## Assumed (validated in Plans 2-6)

- The Stub runner's note shapes will match the real Plan 2 `ValidatedNote` shapes. Plan 2's first task that wires `runFamilySuite --runner offline-3b` discovers any mismatches; fix at that integration point.
- `FamilyDefinition.evalBaselines: string[]` registration is wired by Plan 2 — Plan 7 ships only the validator that consumes it (`desktop/eval/fixtures/_validator.ts`).
- Real founder-recorded Meeting/Interview/Brainstorm fixtures replace the synthetic stubs in Plans 5/6 follow-up. The stubs validate plumbing; quality numbers from them are not meaningful.

## Plan-spec corrections applied during implementation

These are spec/plan typos the implementer caught and fixed; record so a future plan-vs-impl auditor doesn't reopen the same questions.

- **Task 1**: Added `FixtureTranscriptSchema` tests covering `speakerId` default + empty-text rejection (load-bearing export had no test coverage in the plan's exemplar).
- **Task 4**: Plan §Step-1 test asserted `findings.length > 0` on parse failure; plan §Step-3 impl returns `findings: []`. Resolved per impl (parse error surfaced via `schemaParseError`, findings are rule-driven only). Documented inline.
- **Task 5**: Plan's `lectureNoteValid` test fixture had 3/4 transcript key_terms = 75%, below the rule's own ≥80% threshold. Added a 4th transcript key_term in section "Mid" to reach exactly 80%.
- **Task 16**: Plan §Step-2 pseudo-code put `a === 3` in its own bin AND tested `'3+': 3` for `[1,2,3,4,5]`. Resolved per tests: bins are `{1,2,3}` when no overflow, merge to `{1,2,'3+'}` when any attempt ≥4 (so '3+' absorbs 3,4,...).
- **Task 21**: `PairwiseMatch.winner: 'A' | 'B'` refers to a/b slot positions in the match, NOT player names. Plan's three-way test fixture conflated the two; rewrote with comment. Added `MIN_STRENGTH=1e-9` guard so zero-win players converge to `log(1e-9) ≈ -20.7` instead of `-Infinity`.
- **Task 24**: Plan test asserted `score > 0.5` for "single wrong speaker for all time"; greedy label-map produces exactly 0.5 (10/20 confused). Relaxed assertion to `>= 0.5` with comment.
- **CLI scripts**: Added `_isMain` guard (`fileURLToPath(import.meta.url) === process.argv[1]`) on `eval-notes.ts`, `eval-judge-swap.ts`, `score-spike-0.2.ts` so vitest import-time scans don't accidentally fire `main()` → live API calls.
- **Paths**: Plan used absolute-from-repo-root paths (`desktop/eval/fixtures`) in some runner defaults; standardized on desktop/-cwd-relative paths (`eval/fixtures`) for runner consistency. Both forms work at runtime; the cwd-relative form matches how `pnpm --filter` invokes scripts.

## Carry-forward to Plans 2-6

| Plan | Carries |
|---|---|
| Plan 2 (Foundation) | (a) Wire `FamilyDefinition.evalBaselines` → call `validateEvalBaselines()` at boot. (b) Implement `offline-3b` / `offline-1b` runners against `PipelineRunner` contract and register in `desktop/scripts/eval-notes.ts::resolveRunner`. (c) Plan 2's grammar-call wrapper must emit `attemptsUsed` so `buildRetryHistogram` has data. |
| Plan 3 (Lecture) | Use this harness as the regression gate from the first commit. Baseline = `v0-spike-0.2-lecture`. Each prompt iteration: re-run `eval:notes --family lecture --against v0-spike-0.2-lecture --baseline v1-<change>`. |
| Plan 4 (Diarization) | Replace `metrics/der.ts` skeleton with pyannote-grade impl once Spike 0.3 fixtures land. Fold DER into the Meeting/Interview/Brainstorm runners. |
| Plan 5 (Meeting) | Replace 3 synthetic Meeting stubs with real recordings. Add Meeting-specific contract rules as production data reveals failure modes. |
| Plan 6 (Interview + Brainstorm + merge-LLM spike) | Replace 6 synthetic Interview + Brainstorm stubs with real recordings. Path E diagnostic feeds Plan 6 prompt design; the harness measures the result. |

## Founder-gated next steps (PARKED — DO NOT auto-execute)

These items require founder action; queued for the next live session.

- **Run `pnpm eval:spike-0.2`** to generate the v0 Lecture baseline. Requires GROQ_API_KEY in env and Spike 0.2 result JSONs at `desktop/spikes/phase-0/02-3b-lecture-grammar/results/` (currently absent — founder re-runs Spike 0.2 first).
- **Real recordings** for Meeting/Interview/Brainstorm fixtures (Plans 5/6 unblock).
- **Spike 0.3 fixtures** for Plan 4 / DER replacement.

## Open hazards

- **Judge calibration drift**: switching `judgeModelId` between baselines changes the score scale. The diff layer surfaces this as a warning, but operator discipline (don't compare across judges, run `eval:judge-swap` first) is required.
- **Stub runner quality**: the stub's deterministic notes always pass ContractTest. If Plan 2's real runner emits malformed notes, only the LLM judge / content-fidelity layer will catch the regression. Fold a "smoke fixture with known-bad shape" into Plan 7.5 if Plan 2 + Plan 3 iteration shows real notes regressing without ContractTest catching them.
- **Cooldown × judge-swap**: 75s × N-judges × N-fixtures gets expensive fast. The judge-swap matrix CLI does not enforce cooldowns — operator must run it with `--fixture <one>` for matrix exploration.
- **plan-task 22 vs spec annotation**: Plan §"Task 18" HARDWARE-SAFETY note says "Task 22 wires the real sidecar." But plan §"Task 22" is the scorecard formatter (pure string formatting). NO Plan 7 task wires the real sidecar — the offline-3b/offline-1b runners are PipelineRunner-typed but unimplemented. Real-sidecar wiring deferred to Plan 2's SessionOrchestrator integration. Updated `eval-notes.ts::resolveRunner` throws a friendly error for non-stub runner IDs.

## Verification commands (reproducible)

```bash
cd /Users/guntak/Lisna/.claude/worktrees/eval
# typecheck
cd desktop && pnpm exec tsc --noEmit && cd ..
# eval test suite
pnpm --filter @lisna/desktop test eval/ scripts/eval-notes.test.ts
# offline smoke
pnpm --filter @lisna/desktop eval:notes --family lecture --runner stub --no-llm-judge --fixture procedural-physics-em
# dry-run smoke
pnpm --filter @lisna/desktop eval:notes --family meeting --dry-run
```

## Links

- Spec: `docs/superpowers/specs/2026-05-26-v2-structured-note-creation-design.md` section 4 #12 + section 6 + section 7
- Plan: `docs/superpowers/plans/2026-05-27-v2-plan-7-eval-harness.md`
- Phase 0 VERDICT: `desktop/spikes/phase-0/VERDICT.md`
- v1 precedent: `backend/scripts/eval-curator.ts`, `backend/scripts/lib/judge.ts`
- LLM eval skill: `~/.claude/skills/llm-eval-loop/SKILL.md`

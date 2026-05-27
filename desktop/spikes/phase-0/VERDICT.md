# Phase 0 Verdict — 2026-05-27

**Branch:** `spec/v2-note-creation-design`
**Spec:** `docs/superpowers/specs/2026-05-26-v2-structured-note-creation-design.md` (`af3af63`)
**Plan:** `docs/superpowers/plans/2026-05-26-v2-note-creation-phase-0-spikes.md` (with Amendment 1 in `9eda9b1`)
**Scorecard:** `desktop/spikes/phase-0/README.md`

## Summary

| Spike | Status | Key metric |
|---|---|---|
| 0.1 zod-to-gbnf | **PASS** at N=5 (Amendment 1 scope) | 5/5 in 5.79 min, mean 1.20 attempts (3B); 5/5 in 2.39 min, mean 1.20 attempts (1B floor) — Path 2 retry contract empirically calibrated |
| 0.2 3B Lecture grammar | **MIXED** | Zod 3/3 ✓ · slot emergence 3/3 ✓ (4/2/4 formula extras) · latency 0/3 ✗ (p50 = 90 s, p90 = 99 s — 3× over 30 s budget on M3/8GB) |
| 0.3 Diarization JA | **BLOCKED** (founder gate) | 3 JA fixtures (interview / meeting / brainstorm WAVs + hand-labeled ground-truth) not yet sourced — see Plan Task 12 |
| 0.4 Chunking | **PASS** | 5/5 edge cases · 153-min synth → 5 chunks ∈ [4, 12], all ≤ 9 600 tokens, 907/907 segments preserved |

## Decisions

### Plan 2 (Foundation) — green-lit conditionally

The HARD GATE in the original plan was a Spike 0.1 10/10 pass. After Path 2 (retry contract) landed via Plan Amendment 1, Spike 0.1 cleared at N=5. Per the amendment's expiry conditions, full N=10 verification requires either:
- **Path 2.A** — an isolated foreground rig free of background-process contention (8 GB ceiling makes this practically a `>= 16 GB` machine, OR
- **Path 2.B** — founder approval to accept the residual N=10 risk profile.

**Sub-plans 2 + 4 + 5 (Foundation / Diarization / Meeting) — green-lit for design work** because they don't depend on Spike 0.2's latency dimension being resolved first. They do depend on:
- Plan 2's grammar-constrained-call wrapper carrying a **`maxAttempts = 3`** retry budget with per-attempt fresh-seed (`baseSeed + (attempt - 1) * 100`) at constant temperature. JSON.parse / Zod.parse failure → retry. The runaway-recovery contract is model-size-invariant (1B and 3B share the same retry profile per take-5).
- Plan 2 surfacing `attemptsUsed` and `attempts[].reason` in logs for eval-loop tuning.

**Sub-plan 6 (Interview + Brainstorm + merge-LLM spike) — blocked on Spike 0.2's Path E diagnostic** before design freezes. Until we know whether the 30 s budget miss is prompt-eval dominated or grammar-sampling dominated, prompt-builder shape decisions (chunk size, exemplar inclusion, slot-trigger language) are made under uncertainty.

### Spike 0.2 — Path E next

Per `desktop/spikes/phase-0/02-3b-lecture-grammar/decision-0.2-latency.md`, the recommendation is **Path E (capture per-phase timings)** before committing to A/B/C/D from the spec §7.2 fallback ladder. Path E is a ~30-min diagnostic that disambiguates whether prompt-eval or grammar-sampling is the dominant cost:
- **Prompt-eval dominant →** Path B (smaller chunks) is high-leverage.
- **Grammar-sampling dominant →** Paths A (accept ~90 s budget) or D (tier 8 GB / 16+ GB) are the only options; C (Qwen 2.5 3B swap) is a guess until empirically measured at the same prompt.

Path E prerequisite (Important #1 from spike-0.2 reviewer): the `stderrTail.slice(-500)` in `run-spike.ts` truncates the llama-completion timing block; widen to keep the full 2 000 chars from the rig before re-running for diagnostic.

### Spike 0.3 — carried into Plan 4

Diarization sits behind a founder-only fixture-acquisition step. Without the 3 WAVs + ground-truth JSONs, the spike cannot run. **Spike 0.3 does NOT block Plan 2 sequencing** (Plan 2's Foundation work is grammar/Zod/wrapper-focused, not speaker-aware). It blocks Plan 4, which is the natural carry. If 0.3 catastrophically fails DER > 30% when it eventually runs, spec revision is needed before Plan 5 (Meeting family) since speaker-aware schemas lose meaning without diarization — but that's a future-conditional, not a current blocker.

### Spike 0.4 — green-lit, carry I-1/I-3 as spike-debt

5/5 edge cases + synth bounded. Code is ready to move into `shared/` as part of Plan 2's Foundation work. Two findings to carry:
- **I-1**: the "splits at silence > 1.5s within slack window" test asserts only `chunks.length > 1`, doesn't actually verify the silence branch was taken. A regression that breaks the silence branch entirely would still pass. Tighten with explicit boundary-ts assertion before merging into `shared/`.
- **I-3**: `findSilenceGaps` `segLastWord = ts + text.length * 0.07` is unbounded — for STT-bucket fixtures (segments ~150 chars at 10-s buckets), `segLastWord` overflows past `next_seg.ts`, marking every gap negative-duration and DEAD-disabling the silence branch on real inputs. The synth fixture (Task 17) hit this empirically: 5 chunks, 0 silence-driven splits, all hard-cuts. Root fix needs `TranscriptSegment.endTs` from Whisper (whisper.cpp exposes per-segment `t1`; currently only `t0=ts` is persisted). Interim fix: clamp `segLastWord = min(ts + text.length * 0.07, next_seg.ts)`.

## Per-spike detail

### 0.1 zod-to-gbnf

**Path narrative.** Iters 1-3 (N=10, no retry) topped out at 8/10 due to two runaway modes (failure mode A: array-runaway; failure mode B: char-escape-runaway). Take-4 (N=5 + retry + cooldown + `afterAll` cleanup) cleared 5/5 within ≤ 2 attempts at temperature 0.6 — Sample 0 (photosynthesis, seed 1000) needed one retry into the failure-mode-A runaway recovered at seed 1100. Take-5 (1B Q4_K_M floor, identical rig) cleared 5/5 with the same attempt profile, 2.42× faster wall.

**Numbers locked.** 3B: pass=5/5 (1: 4, 2: 1, 3: 0), mean 1.20 attempts, p50 22.4 s, p90 239 s, total 5.79 min. 1B: pass=5/5 (1: 4, 2: 1, 3: 0), mean 1.20 attempts, p50 17.4 s, p90 57.5 s, total 2.39 min. Test rig: `desktop/spikes/phase-0/01-zod-to-gbnf/round-trip.test.ts` (`251c1fc`).

**Capability-floor implication.** 1B satisfies the *grammar contract* identically to 3B. It does NOT yet have its quality verified (Spike 0.2 was 3B-only; 1B's slot emergence + content fidelity at this prompt has not been measured). Picker (§5.1) priority is unchanged for now — 3B remains default, 1B is the explicit "fits-low-RAM" fallback. **Promote 1B only if a follow-up Spike 0.2-1B shows comparable slot emergence + content fidelity.**

**Carry to Plan 2:** retry-loop wrapper mandate (above). N=10 latent — see "Production risk acknowledged" in `decision-0.1-fail.md`'s header for the mode-B (Maxwell iter-3) issue that hasn't been re-tested at N=5.

### 0.2 3B Lecture grammar

**Path narrative.** Three sequential runs on `procedural-physics-em` (322-bucket fixture, sliced to 166 buckets / 11.3K transcript chars / 13.4K prompt chars ≈ 8K JA tokens). Each run: `runLlamaCli` with `temperature=0.4`, `maxTokens=4096`, seed `2000 + i`. Wall-time 73.8 / 90.1 / 98.7 s, ~3× over the 30 s acceptance budget.

**Quality observations.**
- All three runs emitted coherent Japanese section titles (静電ポテンシャル, 電磁規約, …), valid `from`-hydration shape, and formula extras matching the physics-trigger expectation.
- **Content-fidelity concern (elevated from `decision-0.2-latency.md`'s parenthetical):** runs 0 and 2 emit literal `E = mc^2` in the `formula` extras' `expression` field. The model is parroting the prompt's exemplar string, not extracting the lecture's actual EM derivations (静電ポテンシャル / 電位 relations). Same failure class as the 1B "register" mode observed in Step 5 §6 smoke (memory: `v2_phase3_task35_step5_handoff_2026-05-15`). **Plan 6 prompt-design implication: do NOT include literal slot exemplars in prompts** — use shape descriptions only, or the model parrots them at the cost of grounding in transcript content.
- Slot-emergence metric currently conflates "occurrences" (extras count) with "distinct slot types". For Lecture (`formula` only triggers here) the difference is degenerate, but for Meeting (decisions / action_items / argument_chains) the two metrics diverge non-trivially. Plan 6 eval rig should record both.

**Latency hypothesis.** Spike 0.1 hit ~70 s per generation at the same temperature with a ~30-char prompt → grammar-sampling cost is ~70 s for ≤ 4 096 generated tokens. Spike 0.2's additional ~20-30 s above that is the 8K-token prompt-eval cost. Path E will confirm this split; if it does, the per-chunk budget collapses to `prompt-eval(~30 s) + grammar-sample(~70 s)` and the lever is Path B (smaller prompts) or accept-and-tier (D).

**Reviewer follow-ups (4 Important items, captured as `spike-0.2-followups` in the carry-forward below):** stderr widening (Path E prerequisite), char-per-token comment fix, slot-type vs occurrence metric, content-fidelity finding elevation.

### 0.3 Diarization JA

**Founder-gated.** 3 audio fixtures needed (see Plan Task 12 table at line 880):
- `ja-interview-2spk-30min.wav` + `.truth.json` (Q&A pattern, DER baseline)
- `ja-meeting-4spk-30min.wav` + `.truth.json` (conference room, realistic)
- `ja-brainstorm-6spk-20min.wav` + `.truth.json` (cross-talk stress)

Ground-truth labels are ~10-15 min/fixture via Audacity speaker-change markers.

Tasks 13-15 (sherpa-onnx setup + DER impl + run) can proceed in parallel **only on the day the fixtures land**; until then, Plan 4 is design-only.

### 0.4 Chunking

**Algorithm + 5 edge cases + 90-min synth bounded.** Files: `desktop/spikes/phase-0/04-chunking/{chunking.ts, chunking.test.ts, synth.test.ts, build-synth.ts, fixtures/synth-90min.json}` (commits `790ba61`, `274cd32`, `a4d6d96`).

**Empirical findings worth carrying:**
- Token estimator (JA at 0.6 t/char + ASCII at 0.25 t/char) is good enough for chunk-boundary decisions on JA-dense input. Validates against the same 0.6 tok/char ratio observed in Spike 0.2.
- Silence-snap branch is DEAD on STT-bucket fixtures (per I-3 above). Hard-cut branch dominates → 5 chunks for 907 segments / 153 min, all within budget. Synth tests pass cleanly because hard-cut is correct fallback when no silence-window candidates exist.
- The fixture extraction (`build-synth.ts`) found that plan-prescribed fixture paths were wrong (subdirectory pattern not flat-file pattern). Plan-author note: future spike plans should include "verify file paths exist as written" as a controller pre-step.

## Carry-forward items to Plan 2 (Foundation)

| # | Item | Source | Estimated effort |
|---|---|---|---|
| 1 | Grammar-constrained-call wrapper with `maxAttempts=3`, fresh-seed retry, `attemptsUsed`/`attempts[].reason` logging | Spike 0.1 take-4 + take-5 | Half day |
| 2 | Move `chunkTranscript` from `desktop/spikes/phase-0/04-chunking/chunking.ts` to `shared/` with the same exports | Spike 0.4 | 2 h |
| 3 | Carry `endTs` on `TranscriptSegment` (Whisper exposes `t1` per segment); update STT persistence layer to record it; restore silence-snap branch correctness | Spike 0.4 I-3 | 1 day (touches sidecar + DB) |
| 4 | Tighten Spike 0.4's silence-branch test with boundary-ts assertion before merging into `shared/` | Spike 0.4 I-1 | 30 min |
| 5 | Reconcile naming convention between spike (camelCase) and `shared/` wire layer (snake_case) — choose one canonical form + adapter at HTTP boundary | Spike 0.4 M-1 | 1 h |
| 6 | Extend CJK regex in `estimateTokens` to cover halfwidth katakana / fullwidth ASCII / JP punctuation / CJK Extension A | Spike 0.4 M-2 | 30 min |
| 7 | Export `estimateTokens` from `shared/` so eval-time tests use the same estimator as the impl (avoids the ~6.6% drift observed in Task 17's synth.test.ts) | Spike 0.4 review | 15 min |

## Carry-forward items to Plan 6 (Interview/Brainstorm/merge-LLM)

| # | Item | Source | Estimated effort |
|---|---|---|---|
| 1 | Path E diagnostic on Spike 0.2's `run-spike.ts` — widen stderr capture, parse llama-completion's per-phase timings | Spike 0.2 reviewer Important #1 | 30 min |
| 2 | Decide A/B/C/D from spec §7.2 ladder based on Path E result (gates Plan 6 prompt-design work) | Spike 0.2 + Path E | TBD (depends on result) |
| 3 | Prompt-design rule: NO literal slot exemplars (model parrots them — `E=mc²` content-fidelity issue) | Spike 0.2 content observation | 0 (design rule) |
| 4 | Eval metric must record `slotTypes` (distinct) + `slotsEmerged` (occurrences) separately | Spike 0.2 reviewer Important #3 | 15 min in Plan 7 |
| 5 | Spike 0.2-1B follow-up — re-run Spike 0.2 with 1B to test whether quality (slot emergence, content fidelity) degrades enough to keep 1B as fallback-only OR clears for default | Spike 0.1 take-5 | Half day (after Path E lands) |

## Carry-forward items to Plan 7 (Eval harness)

| # | Item | Source | Estimated effort |
|---|---|---|---|
| 1 | LLM-as-judge content-fidelity eval — does the output's `formula.expression` match formulas actually IN the transcript (anti-parroting) | Spike 0.2 content observation | 1 day |
| 2 | Retry-rate histogram per-call in fixture eval (mean attempts as one quality axis) | Spike 0.1 take-4/take-5 | 2 h |
| 3 | DER computation skeleton in `desktop/spikes/phase-0/03-diarization-ja/der.ts` once Spike 0.3 runs — already speced in Plan Task 14, just lifts | Plan Task 14 | (done in 0.3) |

## Latent risk acknowledgments

- **N=10 mode-B (Maxwell-style char-escape runaway) is empirically NOT verified at N=5.** Path 2.A or Path 2.B execution before alpha to confirm production traffic doesn't exhaust the retry budget on this failure shape. Currently relying on retry budget = 3 as the sole defense.
- **3B + 8 K JA prompt latency at ~90 s/chunk** is currently above the spec's 30 s/chunk target. Until Path E + remediation lands, the stop-to-note latency for a 53-min lecture on M3/8 GB is ~3-5 min (with chunking-at-end). Communicate this honestly to alpha users until a faster path lands.
- **`E = mc²` parroting** is a Lecture-family observation. Whether it generalizes to Meeting/Interview/Brainstorm — where slot exemplars are more elaborate — is unknown. Plan 6 should test this BEFORE design freezes.

## Links

- Spec: `docs/superpowers/specs/2026-05-26-v2-structured-note-creation-design.md` (`af3af63`)
- Plan: `docs/superpowers/plans/2026-05-26-v2-note-creation-phase-0-spikes.md` (Amendment 1 in `9eda9b1`)
- Scorecard: `desktop/spikes/phase-0/README.md`
- Spike 0.1 narrative: `desktop/spikes/phase-0/01-zod-to-gbnf/decision-0.1-fail.md` (despite the filename, this is the cleanest single trail for 0.1 — Original BLOCKED escalation → Resolution → take-4 PASS → take-5 1B floor)
- Spike 0.2 verdict + paths: `desktop/spikes/phase-0/02-3b-lecture-grammar/decision-0.2-latency.md`
- Spike 0.4 implementation: `desktop/spikes/phase-0/04-chunking/{chunking.ts,chunking.test.ts,synth.test.ts}`

## Status — green-light Plan 2 with caveats

Plan 2 (Foundation) is green-lit for design and implementation work, with the 7 Plan-2 carry-forward items above plumbed in from day one. Plan 6 (the family that consumes Spike 0.2's results) is **blocked on Path E** — recommend it as the next session's first item. Plan 3/4/5 can proceed in parallel without Spike 0.2 resolution.

Spike 0.3 remains founder-blocked. No work on it possible until WAV fixtures + ground-truth land.

The HARD GATE is cleared. Decision on whether to push the branch (Plan 1 Task 19) is a separate founder gate — see that task.

---

## Plan 3 (Lecture pipeline) — Tasks 8-10 + 13-16 LANDED (2026-05-27, late session)

Plan: `docs/superpowers/plans/2026-05-27-v2-plan-3-lecture-pipeline.md`. Tasks 11-12 (renderer + UI) forked to the **app-design** worktree on `design/v2-lecture-ui` per `v2_plan3_fork_decision_2026-05-27.md`.

### Tasks completed this session

| Task | Scope | Commits |
|---|---|---|
| 8 | Post-decode pipeline (5 stages per spec §5.2) + `ForwardIncompatNoteError` | `aa41821` + polish `7946137` |
| 9 | Orchestrator `finalizeLecture` (chunk → grammar-call → post-decode → merge → final parse → telemetry) | `b1009a7` + fix `5a683b6` + polish `9c3f03d` |
| 10 | `session/finalize` IPC channel (Lecture live; Meeting/Interview/Brainstorm throw `FAMILY_NOT_IMPLEMENTED:*`) + `SessionOrchestrator.exposedSegments` getter | `f36ac47` + polish `a62dca5` |
| 13 | `loadNote()` + Lecture v1 migration chain runner (while-loop, not plan's buggy for-loop) + `v1-fixture.json` + `Migration` type | `4f80bc5` (preceded by refactor `d5b5867` lifting `ForwardIncompatNoteError` to shared) + fix `d6906ff` (null shape-guard + CURRENT_SCHEMA_VERSION consolidation) |
| 14 | Spike 0.2 v0 baseline (`run-2026-05-27T03-10-32-548Z-i0.json`, 4 sections / 4 slots, formula extras stripped per Path F) registered + minimal `eval-baselines.ts` registry | `ef34d6d` |
| 15 | Hardware-gated E2E **scaffold only** — `describe.skipIf(!LISNA_LLM_INTEGRATION)` + JA 30-s fixture + `buildE2ESidecar()` throws `E2E_NOT_RUNTIME_WIRED` until production sidecar gains `generateWithGrammar` | `22f5be3` |
| 16 | Verification gate (this section) — typecheck + lecture sweep + spike regression | _this commit_ |

### Verification gate results (Task 16)

- **Typecheck:** `pnpm exec tsc --noEmit` → exit 0
- **Lecture test sweep:** 77/77 PASS across 11 files (Lecture schema/slots/prompts/core/merge + post-decode/pipeline/deterministic-merge + main/sidecar lecture-orchestrator + ipc session-finalize + load-note + eval-baselines)
- **Spike non-LLM regression:** 15/15 PASS (`zod-to-gbnf.test.ts` + `chunking.test.ts` + `synth.test.ts`)
- **Spike hardware-gated:** Spike 0.1 `round-trip.test.ts` NOT exercised in this gate (per pitfalls.md `vitest-scope` — accidental scope inclusion was killed mid-run; founder-only)
- **Task 15 E2E:** SKIPPED by design (no `LISNA_LLM_INTEGRATION` env set)

### Deferred wiring (carry-forward to a future plan or follow-up)

| Item | Where | Why deferred | First call site |
|---|---|---|---|
| `SidecarClient.generateWithGrammar` + `grammar` field on `SidecarRequest.generate` IPC envelope + C++ side | `desktop/src/main/sidecar/client.ts` + `desktop/src/shared/ipc-protocol.ts` + `desktop/sidecar/src/...` | Out of Plan 3 scope (TS-only; spike used parallel `runLlamaCli` binary harness). The dormant `as unknown as GrammarCapableSidecar` cast at `ipc.ts:170` is safe because no preload bridge exposes `session/finalize` yet. | Task 15 E2E will go live the moment this lands |
| Renderer + UI (`LectureRenderer` + `Recording → FamilyPicker → progress → NoteView` integration) | `desktop/.claude/worktrees/app-design` (sibling worktree on `design/v2-lecture-ui`) | Plan 3 Tasks 11-12 forked — frozen contracts at HEAD `9cc3edf` (Tasks 1-7); Plan 3 Phase C deliverables here are now also part of the stable contract from app-design's POV | App-design session |
| `LECTURE_ERROR_CODES` const catalog | `desktop/src/shared/note-schema/` (new file when 3rd call site lands) | TODO in `load-note.ts` documents the deferral. Today only `load-note.ts` and `session-finalize.ts` throw these — wait for the 3rd call site (renderer's error-handling code) per the codebase's "3+ call sites" abstraction rule | Future Plan |
| `ValidatedNote` discriminated union | `desktop/src/shared/note-schema/load-note.ts` return type | Today `loadNote` returns `NoteBase`. When Plans 5/6 add `MeetingNote` / `InterviewNote` / `BrainstormNote` schemas, promote to `LectureNote \| MeetingNote \| ...` so callers can `switch (note.family)` for type narrowing | Plan 5 |

### Notable plan-vs-actual deviations (applied during execution)

1. **Plan Task 8 walker** had an operator-precedence bug (`A && B && C || D || E`); corrected to `A && B && (C || D || E)` per controller pre-spec.
2. **Plan Task 8 import** referenced non-existent `FamilyDefinition` + `hydratePostDecode`; corrected to `FamilyCoreDefinition` from `@shared/families` + dropped the non-existent import.
3. **Plan Task 9 LLM call** used non-existent `runGrammarCallWithRetry`; rewrote against the real Plan 2 deliverable `callWithGrammar` (`grammar-call.ts`) with a `JSON.stringify(result.value)` bridge into `runPostDecodePipeline` (acceptable round-trip cost for chunk-sized JSON).
4. **Plan Task 9 prompts access** used `prompts[id]` and `prompt.system`; corrected to `selectPromptVariant(prompts, defaultId, opts?)` helper + `prompt.systemTemplate`.
5. **Plan Task 9 telemetry** initial impl hardcoded `totalTokensIn: 0`; spec reviewer flagged → fixed to `chunks.reduce(...estimateTokens(rendered)...)` (prompt-side is knowable; `totalTokensOut` stays 0 until sidecar plumbing).
6. **Plan Task 10 file layout** prescribed `desktop/src/main/sidecar/ipc/{index.ts, session-finalize.ts}`; existing IPC pattern centralizes in `main/ipc.ts`. Compromise: new `sidecar/ipc/session-finalize.ts` registered via closure from `main/ipc.ts::registerIpc`. Adapter `adaptToV2Transcript` plumbs legacy `TranscriptSegment` (`startSec`/`endSec`) → v2 `SessionTranscript` (`ts`/`endTs`/`speakerId: 0`/`meta.noSpeechProb?`).
7. **Plan Task 13 migration runner** used a for-loop that wouldn't advance `currentV` for multi-step chains; corrected to a `while (currentV < CURRENT)` loop with `NO_MIGRATION_FROM` + `MIGRATION_NO_PROGRESS` guards.
8. **Plan Task 13 fixture** template omitted `from: 'transcript'|'inferred'` on every leaf; added per leaf because `loadNote` calls `schema.parse()` directly (no post-decode hydration on the load path — that's only on the decode path).
9. **Plan Task 15 hardware-gated test** is scaffold-only because of the deferred `SidecarClient.generateWithGrammar` wiring noted above. `buildE2ESidecar()` throws `E2E_NOT_RUNTIME_WIRED` with a clear activation contract.

### Mid-session safety incident

During Task 16 Step 3 spike regression, the controller accidentally invoked `pnpm exec vitest run spikes/phase-0/01-zod-to-gbnf/` which picked up `round-trip.test.ts` (hardware-gated, ~16 min real-LLM, M3/8GB OOM risk). Caught + force-killed within ~2 minutes (one chunk of LLM inference completed before kill: seeds 1000, 1100, 1200 — process IDs 76018, 76401, 76423 all `kill -9`'d). `ps -ef | grep llama-completion` confirms clean post-kill state.

Lesson reinforced from `pitfalls.md (vitest-scope)`: explicit per-test-file paths for verification gates, never directory globs that might pick up hardware-gated tests. Task 16's spike regression now runs `spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.test.ts` + `spikes/phase-0/04-chunking/{chunking,synth}.test.ts` explicitly.

### Status — Plan 3 LANDED (Phase C); Phase D forked to app-design

Plan 3 Phase C (Tasks 8-10 + 13-16) is complete on this branch. Phase D (Tasks 11-12, renderer + UI) is in flight on the app-design worktree. Plan 5 (Meeting) + Plan 6 (Interview/Brainstorm) can now proceed because:
- The post-decode pipeline + orchestrator branch dispatch are pattern-stable.
- The `Migration` interface + `loadNote` runner work for any family that wires `migrations: ReadonlyArray<Migration>`.
- The `session/finalize` IPC channel already routes Meeting/Interview/Brainstorm to clear `FAMILY_NOT_IMPLEMENTED:*` throws; the renderer can wire against the channel today.

Push of `spec/v2-note-creation-design` to origin (currently at HEAD `22f5be3`, ~16 ahead) remains a founder gate.

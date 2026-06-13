# Rung-1 (D1): Lecture duration-aware section consolidation

**Loop:** long-recording-stability (≤2h). Rung-1 = D1, lecture, LLM-free, independent of D2. Branch `feat/v2-lecture-section-consolidation` off main 92b5990. **Expert-gate verdict: SOUND WITH CHANGES (Approach A judged superior to runtime-grammar-threading; changes C1-C5 folded in below).**

**Goal:** a long lecture (sections legitimately >10 — already true at ~80 min today, which currently THROWS) FINALIZES with bounded, useful sections instead of `fam.schema.parse(merged)` throwing `too_big`. Deterministic, no LLM.

## Root cause (code-confirmed)
`finalizeLecture` (orchestrator.ts:575 grammar=zodToGbnf(static schema); 634 deterministicMerge; 640 schema.parse): merge `sections: concat-only` (lecture/merge.ts:17) NEVER consolidates to the cap; `concat-dedup`/`concat-only` don't enforce `.max()` (deterministic-merge.ts:113-117). >10 merged sections → parse throws → finalize lost. (NB: ~80-min lectures already exceed 10 today → already broken; this is a FIX, not a behavior-identical change.)

## Approach A (chosen + vetted): static hard ceiling does SAFETY, consolidation does QUALITY
- **Safety = static schema ceiling.** `MAX_SECTIONS` 10→**24** (lecture/schema.ts:8). GBNF bound `{0,23}` per chunk (verified safe in zod-to-gbnf.ts:155-168 — upper bound only; emission is content-driven; 3000-tok per-chunk budget is the backstop) AND final `schema.parse` accepts ≤24. No runtime grammar threading (per-chunk runtime bounding would WORSE: force early `]` → silent generation-time content loss).
- **Quality = post-merge consolidation to a duration-aware SOFT target.** `targetCap = clamp(ceil(durationMin/8), 10, 24)`. Soft: consolidation folds toward it but STOPS early rather than fusing distant topics; the hard 24 ceiling guarantees correctness regardless.

## `consolidateLectureSections(note, targetCap)` — pure, deterministic, post-merge, pre-parse
1. ts-sorted (merge sortByTs already). While `sections.length > targetCap`:
   - find the adjacent pair with the smallest ts-gap; **C3 tiebreak:** on equal gap, fold the EARLIEST pair (lowest left index).
   - **C2 guard:** if that smallest gap > `MAX_FOLD_GAP_SEC` (300s), STOP — accept `length` as-is (≤24 hard ceiling still holds; don't fuse far-apart topics).
   - fold: keep earlier section's heading+ts; concat summaries (+ takeaway); UNION key_terms/examples/points/extras. NO transient helper keys (pure value reconstruction — `.strict()` parse must pass).
2. Per (folded) section, **dedup-fit each sub-array** to its cap (key_terms 12 / examples 10 / points 20 / extras 8):
   - **C1:** dedup using the EXPORTED `trigrams`/`jaccard` from deterministic-merge.ts (NOT `dedupArrayByTextField` — it's module-private) with an explicit typed key (`term` for key_terms, `text` for points/examples) — mirrors interview/merge.ts:1-2.
   - **C4:** if still over cap: points → keep `important:true` first then keep-order; key_terms/examples → keep-order (no salience field exists). Emit telemetry counts `{folded, truncated, deduped}` (mirror `sanitizedSlots`) so the 2h validation shows whether tail-loss actually fires or dedup absorbs it.

## SDD tasks (rung-1 = A,B,C,E; D split out)
- **A. schema ceiling** `MAX_SECTIONS` 10→24 (comment: 24=hard ceiling, duration-aware target enforced at consolidation). Update tests asserting 10. MUST land before C.
- **B. consolidation fn** new `src/shared/post-decode/consolidate-lecture-sections.ts` + test. TDD **fail-first**: 15-section note → folds to targetCap; tied-gap fixture (C3 determinism); a folded section with >12 key_terms → fit to 12; distant-only sections (all gaps >300s) → NOT folded below count, ≤24 accepted (C2); `LectureNoteSchema.strict().parse` passes on the folded note (no stray keys). Write the fold+dedup-fit as two helpers a future `consolidate-meeting-discussions` can mirror (cross-cutting flag — do NOT pre-abstract; 1 call site).
- **C. wire** in finalizeLecture: `durationMin` from `args.transcript.transcriptSegments.at(-1)?.endTs`; `targetCap`; between deterministicMerge(634) and schema.parse(640): merged → consolidate → parse. Update orchestrator/lecture tests.
- **E. validate (CONTROLLER, real-3B foreground, sampler-aligned sidecar, NEVER background):** `bookkeeping-20min` finalizes (was the repro) AND **C5 BLOCKING: a real ≥80-min (≥6-chunk) run** that actually exercises the fold across multiple seams (extend `src/integration/lecture-30min-stress.real.test.ts` — already spawns the sidecar + OOM guard + pkill afterAll). Assert: no `too_big` throw; sections ≤24; eval-instrument quality (faithfulness PASS, coverage) on the output; record cumulative RSS. 40m alone does NOT clear rung-1.
- **F. expert 2h-feasibility review of the IMPLEMENTED rung → PR (founder merges).**

## Deferred / flagged
- **Task D (per-chunk wall-time cap)** → follow-up (rung-3 robustness). Orthogonal to consolidation; existing `GENERATE_NO_PROGRESS_MS=60s` (timeouts.ts:30) is no-progress not total-wall, so D is a real addition but its wall-cap × outer-retry interaction needs its own tests. Keep rung-1 tight.
- **Cross-cutting (roadmap):** meeting `discussions`/`topic_arc` (concat-only, `.max`) + interview `qa_pairs` + brainstorm `idea_clusters` have the SAME cap-overflow finalize-loss at 2h. Covered by NEITHER D1 (lecture) NOR D2 (prose-merge n_ctx). Add a rung to the roadmap; reuse B's fold+dedup-fit shape.

## Files
lecture/schema.ts · NEW shared/post-decode/consolidate-lecture-sections.ts (+test) · shared/post-decode/deterministic-merge.ts (reuse exported trigrams/jaccard, read-only) · orchestrator.ts finalizeLecture · lecture/__tests__/merge.test.ts · integration/lecture-30min-stress.real.test.ts.

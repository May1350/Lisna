# Spike 0.2 verdict — MIXED (structural pass, latency fail)

**Date:** 2026-05-27
**Branch:** `spec/v2-note-creation-design`
**Fixture:** `procedural-physics-em.json` (源 transcript: `backend/tests/fixtures/transcripts/procedural-physics-em.json`, 322 buckets, ~53 min lecture, JA dense)
**Slice:** first 166 buckets / 11,316 transcript chars / 13,419 prompt chars → ≈ 6.8K JA tokens (0.6 tok/char). Within the spec §2.3 ~8K token chunk budget.
**Model:** `Llama-3.2-3B-Instruct-Q4_K_M.gguf`
**Binary:** `desktop/sidecar/deps/llama.cpp/build-spike/bin/llama-completion` (b1-856c3ad)
**Hardware:** M3 / 8 GB

## Acceptance per spec §7.2

> Validation passes, slot emergence > 0 (at least one slot in fixtures where triggers apply), latency < 30s per chunk on M1 8GB.

## Result

| Criterion | Threshold | Observed | Verdict |
|---|---|---|---|
| Zod validation | 3/3 PASS | 3/3 PASS | **PASS** |
| Slot emergence ≥ 1 on any | ≥ 1 of 3 | 3/3 (counts: 4, 2, 4) | **PASS (exceeds)** |
| Latency per chunk | < 30 000 ms | 73 776 / 90 097 / 98 651 ms | **FAIL** (p50 = 90 s, 3.0× over) |

**Aggregate verdict: MIXED.** Structural and quality dimensions cleared (in fact exceeded — every run hit ≥ 2 slots, no run produced a slotless lecture). The latency dimension missed by 2.5–3×.

## Per-run detail

| Run | Seed | Elapsed (ms) | Sections | SlotsEmerged | OutputBytes | Extras types per section |
|---|---|---|---|---|---|---|
| 0 | 2000 | 73 776 | 4 | 4 | 2 280 | formula × 4 (one per section) |
| 1 | 2001 | 90 097 | 2 | 2 | 2 130 | formula × 2 (one per section) |
| 2 | 2002 | 98 651 | 4 | 4 | 3 488 | formula × 4 (one per section) |

Result JSON dumps live in `results/run-2026-05-27T02-*.json` (gitignored).

## Diagnostic notes

1. **Prompt is 13 419 chars / ≈ 8.0K tokens** — at the very top of the 8K budget. The 13K char prompt slice was chosen to mirror the spec §2.3 "~8K each" chunk size assumption. Three of four costs:
   - Prompt eval (one-shot, scales linearly with prompt tokens).
   - Generation (≈ 700–1100 tokens of JSON, low-cost per-token).
   - Grammar-constrained sampling (per-token logit mask, dominant cost on 3B Metal).
2. **Grammar overhead is real.** Spike 0.1 hit ~70s per 4096-token generation budget at temp 0.6 on the same 3B model with a *trivial* English prompt (≈ 30 chars). 70 s for that is already close to the budget; loading 8K of JA tokens into the prompt pushes prompt-eval cost on top.
3. **Output is short relative to budget.** Generated 2.1–3.5 KB of JSON (≈ 700–1100 tokens of output) — nowhere near the 4096-token cap. So `-n 4096` is fine; the dominant cost is the 8K prompt eval + the grammar mask on every emitted token.
4. **Quality is genuinely good.** All three runs produced coherent Japanese section titles (静電ポテンシャル, 電磁規約, …), reasonable summaries, valid `from`-hydration shape, and formula extras (though several formulas were placeholder `E=mc^2`-shaped rather than the actual EM-derivation formulas in the lecture — content fidelity is the secondary concern). Run 1 only emitting 2 sections is the lone weak spot; runs 0 and 2 produced 4 sections, matching the lecture's natural structure.

## Why this isn't "iterate the prompt blindly"

Per controller direction: failure on slot emergence would have been a prompt-iteration candidate (per spec §7.2 fallback ladder). Failure on **latency** is not a prompt problem — the prompt is already at the target chunk size; making it shorter would reduce content not solve the model speed. The fallback ladder for latency-only failure was not pre-specified, so I'm escalating rather than iterating.

## Candidate paths (controller to decide)

A. **Accept MIXED, ship anyway with `90 s/chunk` as the production budget.** For a 53-min lecture, chunked-at-end processing per spec §2.3 with ~8K chunks would produce ~2 chunks → end-to-end ~3 min wall. A 90-min lecture → ~3 chunks → ~5 min. UX impact: stop-to-note latency goes from "tens of seconds" (spec implication) to "single-digit minutes". Within tolerable bounds for some users; not "instant" for the standard alpha pitch.

B. **Smaller chunk budget.** Re-spec §2.3 from ~8K to ~4K tokens, halving the prompt-eval portion of per-chunk cost. Trades wall-time (more chunks + final merge) against per-chunk peak. Empirical estimate from this spike: a ~4K char prompt would land ≈ 35-50 s/chunk (not in budget but closer; needs measurement). 53-min lecture: 4 chunks × ~40 s + merge × ~40 s ≈ 4 min — barely better than path A.

C. **Qwen 2.5 3B Instruct (Q4_K_M).** Spec §7.2 names this as the structural-failure fallback. Different optimization profile — Qwen 2.5 has 32K native context and may have lower per-token grammar-sampling cost (untested on our build). Requires model download + spike re-run. Risk: same architecture-class model, may show same latency profile.

D. **Tiered hardware experience.** Spec §7.2 last bullet: "8GB Mac uses Lecture-only with simpler schema; 16GB+ Mac uses 7B model". Reverse-engineer this for latency: 8GB Mac uses 3B + accept slower per-chunk; 16GB+ uses 3B with larger prompt for fewer chunks (faster end-to-end). This would push complexity into model-profile picking but preserves the core 3B-first floor.

E. **Investigate prompt eval cost specifically.** The stderr from `llama-completion` reports prompt-eval and generation timings separately. We didn't capture those (the run-spike runner only records wall-clock). A 30-min follow-up to add per-phase timings would clarify whether prompt-eval is the dominant cost (path B helps) or grammar sampling is (paths A/C/D only).

## Recommendation

Path E first (30 min, no risk) to disambiguate cost source, then choose between A/B/C/D with empirical grounding. If grammar sampling dominates: paths A or D. If prompt-eval dominates: path B is the lowest-risk fix.

## Cleanup verification

```
$ ps -ef | grep -E "llama-completion|tsx" | grep -v grep || echo "(clean)"
(clean — no survivors)
```

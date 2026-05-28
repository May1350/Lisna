# Plan — Lighten 3B without quality loss (KV-cache q8_0 + flash attention)

**Created:** 2026-05-28 · **Lane:** ai-infra · **Worktree:** `.claude/worktrees/perf+3b-kv-cache-quant` · **Branch:** `worktree-perf+3b-kv-cache-quant` (off `origin/main` `1c34854`)

## Goal & hard constraint

Reduce the 3B model's runtime memory footprint on the 8 GB Mac (the swap
pressure that corrupted/lost session `9e2d1521` on 2026-05-27) **without losing
any note quality.** Quality is non-negotiable (founder). 1B is NOT an option —
Spike 0.2 Path F showed 1B quality FAIL on lecture (slot emergence 0/3).

## Why this is possible

3B active memory ≈ **weights ~2.0 GB (fixed at Q4_K_M)** + **KV cache ~1.8–2.2 GB**
+ Metal overhead. `llama_engine.cpp` currently sets only `n_ctx=16384` and
`n_gpu_layers=999`; the **KV cache is default f16 and flash attention is unset
(AUTO)** — untouched levers. The KV half is reducible with near-zero quality cost.

## The change (3 lines, `desktop/sidecar/src/llm/llama_engine.cpp`, in `load()` after `cp.n_ctx = 16384;`)

```cpp
cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_ENABLED; // was AUTO; less KV mem + faster + enables V-cache quant
cp.type_k = GGML_TYPE_Q8_0;  // KV(K): f16 -> q8_0 (~half memory, near-lossless)
cp.type_v = GGML_TYPE_Q8_0;  // KV(V): f16 -> q8_0 (requires flash attention, enabled above)
```

Expected: KV ~1.8 GB → ~0.9 GB; ~1–1.3 GB freed → 3B drops below the 8 GB swap
threshold. `q8_0` (not q4) chosen deliberately — conservative, near-lossless.

## Quality-safety gate (the part that makes "no value loss" enforceable)

After the rebuild, run Spike 0.2 lecture ONCE and compare to the frozen baseline
`desktop/tests/fixtures/baselines/lecture/spike-0.2-v0.baseline.json`:
- slot emergence stays **3/3 (≥2 slots each)** — baseline parity
- Zod validation **3/3**
- content coherent (no new placeholder filler / truncation)
- peak RSS drops (target ~1 GB)

**If any quality dimension regresses → revert the C++ change (one file).** Ship
only on baseline parity.

## Contamination / context-integrity method (implemented)

- **Isolation:** dedicated worktree; the main checkout stays on `main`, untouched.
- **Lane discipline:** edits confined to `desktop/sidecar/` (ai-infra owned). This
  plan doc is `docs/` (spec-docs) → committed with `Cross-lane: ai-infra → spec-docs`.
- **Staged commits:** every stage commits immediately → a crash loses ≤ 1 stage.
- **Transcript safety:** `~/.claude/hooks/session-continuity.py` backs up this
  session's transcript + resume card every turn (installed 2026-05-28).
- **8 GB safety:** build with `JOBS=1`; eval **foreground only, single sample,
  `pkill -9 -f llama-completion` after** — never `run_in_background` for LLM.

## Stages

- [x] **S1** Plan doc committed — recovery anchor (`83b8492`)
- [x] **S2** q8_0 KV + flash-attn edit (`4c070fd`) — later reverted (see Verdict)
- [~] **S3** Local rebuild SKIPPED — worktree submodule empty; verified the effect via the spike CLI (env-injection) instead; compile-check deferred to `desktop-ci`
- [x] **S4** Eval (foreground, 1 sample, pkill) — q8+FA @ ctx 16384 vs f16 baseline
- [x] **S5** Decision gate → REVERT q8+FA (`b424405`) + apply n_ctx 16384→13312 (`e99864a`)
- [ ] **S6** Push branch + PR to main (founder-gated)

## Verdict (2026-05-28)

**q8_0 KV + flash attention: REJECTED** (founder bar = no quality loss).
- Memory ✓: KV cache 2240 MiB (f16 @ ~20K) → **952 MiB** (q8 @ 16K), measured.
- Quality ✗: validation FAIL — invalid JSON (control char), 0 slots (baseline 4/2/4).
- Latency ✗: **753s** vs ~90s baseline (~8×). flash-attn + quantized KV → CPU-attention
  fallback on this M3 Metal build. N=1 caveat (quality could be a stochastic runaway),
  but the 8× latency is a stable per-token property and is decisive on its own.

**n_ctx 16384 → 13312 was tried (`e99864a`) then REVERTED (`f520bc7`)** after
independent review caught a regression: the renderer-wired path is
`session/stop → orchestrator.stop() → buildJaNoteV1Prompt(ALL segments, uncapped)`
+ maxTokens 4096 (`preload/index.ts` exposes no `finalize` binding). The chunked
`finalizeLecture` path — which the 13312 rationale assumed — is built but NOT wired
to the renderer. So 13312 would cut the usable transcript from ~12.3K to ~9.2K
tokens before context overflow → truncation / `llama_decode` failure on longer
recordings = quality loss. Restored 16384.

## Net outcome: NO safe quick lever ships today

Both levers failed verification (q8+FA latency, n_ctx truncation). `llama_engine.cpp`
is now identical to `main`. The "KV is the reducible half" premise is real, but
safely realizing it requires the **chunked `finalizeLecture` path wired to the
renderer (Plan 3 Task 10)**: once each LLM call sees one ~8K chunk (not the whole
transcript), n_ctx can drop to ~13K safely AND the latent bug below is fixed.

### Latent bug surfaced (independent of this task)
At the current 16384, the live uncapped `session/stop` path overflows for any
recording whose transcript exceeds ~12.3K tokens (~20 min dense JA) → truncation
or `llama_decode` failure TODAY. The fix (chunked finalize) exists but is unwired.
Worth a separate task.

### Follow-up re-verified on current main `8228c49` (2026-05-28)
Independent re-check after #60 (Plan 5 Meeting) landed: **conclusion unchanged.**
- Renderer still calls `window.lisna.stopSession()` (`Recording.tsx:133`) → `session/stop`
  → `orchestrator.stop()` (all segments, `maxTokens 4096`); `preload/index.ts` still has no
  `finalize` binding.
- #60 ADDED `finalizeLecture` + `finalizeMeeting` (chunked) to `orchestrator.ts` but did NOT
  wire them to the renderer — `session/finalize` is dead from the UI's view.
- Lecture finalize is also not production-ready: it "fails at the first grammar call until
  the C++ side lands" (`ipc.ts:164-166`).

So the overflow risk persists and n_ctx reduction remains unsafe. A safe trim needs, in
order: (1) production grammar-constrained generation lands (C++ sidecar), (2) chunked
finalize wired to the renderer (Plan 3 Task 10), then (3) n_ctx can drop. This is
**contended feature work** (orchestrator/finalize is actively changing — #60 just landed
there); coordinate with the Plan 3 lane rather than editing it from an unrelated worktree.

## Recovery (if this session dies)

```bash
cd /Users/guntak/Lisna/.claude/worktrees/perf+3b-kv-cache-quant
git log --oneline -8          # which stages committed
# read this plan; resume at the first unchecked [ ] stage
```
Code is authoritative over any transcript. Re-verify git state before resuming.

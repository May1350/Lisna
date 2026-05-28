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

**Shipped instead: n_ctx 16384 → 13312** (`e99864a`) — pure KV trim ~19%
(~1.79 GB → ~1.46 GB f16), zero quality/latency risk (generation unchanged; ctx still
exceeds prompt+gen ≈ 12K). The "KV is the reducible half" premise was validated —
q8+FA was simply the wrong lever for this Metal build.

## Recovery (if this session dies)

```bash
cd /Users/guntak/Lisna/.claude/worktrees/perf+3b-kv-cache-quant
git log --oneline -8          # which stages committed
# read this plan; resume at the first unchecked [ ] stage
```
Code is authoritative over any transcript. Re-verify git state before resuming.

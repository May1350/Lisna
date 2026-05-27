# Path E result — per-phase timing diagnostic (2026-05-27)

Full 3-run-loop version of the per-phase timing diagnostic for Spike 0.2.
Supersedes the single-run i=0 appendix in `decision-0.2-latency.md` §Path E.

## Hardware / Build

- **Date:** 2026-05-27
- **Branch:** `spec/v2-note-creation-design`
- **Fixture:** `procedural-physics-em.json` (322 buckets, ~53 min lecture, JA dense)
- **Slice:** first 166 buckets / 11,316 transcript chars / 13,419 prompt chars → ≈ 8.9K tokens prompt
- **Model:** `Llama-3.2-3B-Instruct-Q4_K_M.gguf`
- **Binary:** `desktop/sidecar/deps/llama.cpp/build-spike/bin/llama-completion` (b1-856c3ad)
- **Hardware:** M3 / 8 GB
- **Knobs:** `n_ctx=20480`, `n_predict=4096`, `temp=0.4`, seeds 2000/2001/2002
- **Source change:** `run-spike.ts:135` stderr-tail truncation removed entirely (rig already caps at 4 KB); `llama-cli-rig.ts` rig buffer raised from 2 KB → 4 KB for headroom.

## Per-run timing breakdown

llama.cpp's own `common_perf_print` block. `load time` reports the model
load + Metal init (runs in parallel with the first forward batch and is
NOT additive to `total time`). `total time` = `prompt eval + eval +
sampling + unaccounted`.

| Run | Seed | Load (ms) | Prompt-eval (ms) | Eval (ms) | Sampling (ms) | Unacc (ms) | perf total (ms) | Wall (ms) | Prompt tokens | Gen tokens |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 2000 | 28,440 | 28,337 | 24,027 | 477 | 130 | 52,971 | 56,108 | 8,900 | 608 |
| 1 | 2001 | 31,426 | 31,409 | 25,721 | 569 | 56 | 57,755 | 59,204 | 8,900 | 678 |
| 2 | 2002 | 33,304 | 33,282 | 60,463 | 3,876 | 457 | 98,078 | 100,355 | 8,900 | 899 |

(Wall − perf total ≈ 1.4-2.3 s across all 3 runs = node spawn + stdout
drain + Zod parse; not material to the path decision.)

## Per-token throughput

| Run | Prompt eval (tok/s) | Generation (tok/s) | Per-tok eval (ms) |
|---|---|---|---|
| 0 | 314.1 | 25.3 | 39.5 |
| 1 | 283.4 | 26.4 | 37.9 |
| 2 | 267.4 | 14.9 | **67.3** |

Run 2 shows a 1.8× slowdown in per-token generation rate (67 ms/tok vs
38-40 ms/tok on runs 0/1). Possible causes: longer generation = larger
KV cache = slower attention later in the sequence; thermal throttling
between runs (this was the 3rd back-to-back run with only 5 s cooldown);
or grammar-mask cost scaling with cumulative context. Worth flagging
but does not change the verdict.

## Cost split

| Run | promptEvalPct | evalPct |
|---|---|---|
| 0 | 54.1 % | 45.9 % |
| 1 | 55.0 % | 45.0 % |
| 2 | 35.5 % | 64.5 % |

**Mean promptEvalPct: 48.2 %**
**Mean evalPct: 51.8 %**

Verdict: **MIXED** (both phases co-dominate; neither alone ≥ 65 %).

Run 2's higher evalPct is mechanical — it generated 48 % more output
tokens (899 vs 608/678) so the eval phase's share rose. The per-token
eval cost also degraded, compounding the effect. Runs 0/1 are the
better baseline for "typical" cost split → very close to 55/45.

## Path B sensitivity (halve prompt to ~4K tokens)

Mechanical projection — assumes linear prompt-eval scaling, generation
unchanged:

| Run | Current pe+ev (s) | Projected pe+ev (s) | Reduction |
|---|---|---|---|
| 0 | 52.4 | 38.2 | -27 % |
| 1 | 57.1 | 41.4 | -28 % |
| 2 | 93.7 | 77.1 | -18 % |

Path B alone gets the typical case (runs 0/1) from ~57s to ~41s. Still
above the 30 s/chunk target. The chunk count doubles for a given
lecture, so end-to-end wall time on a 53-min lecture (currently ~2 chunks
× ~60 s = ~2 min) drops only marginally to (4 chunks × ~41s = ~2.7 min) —
actually **worse** end-to-end because chunk count grew faster than per-chunk
time fell. Path B is NOT a single-step win.

## Decision

**Recommended next step: Path F (1B model swap) measured against Spike
0.2's 3-fixture acceptance, with Path G (output-token cap via
`.max(N)`) as a low-cost stack-on if 1B's slot emergence holds.**

Justification grounded in the empirical split:

- The cost is genuinely mixed (48 % prompt eval / 52 % generation). No
  knob that touches only one phase can hit 30 s/chunk alone — even
  halving prompt eval (Path B) leaves a 41-s case.
- The two cost drivers each respond to a **different** model swap.
  Prompt eval is proportional to model size at fixed prompt length;
  generation is proportional to model size × tokens emitted × grammar
  overhead. A 1B model touches BOTH at once: smaller weights → faster
  per-token in both phases.
- Spike 0.1 take-5 already established 1B is ~2.4× faster than 3B on
  generation under temp 0.4-0.6 with the same llama-completion binary.
  Applied to the typical (run 0) split: prompt eval 28 → ~12 s,
  generation 24 → ~10 s → **total ≈ 22-25 s/chunk on 1B**. Lands inside
  the spec §7.2 30 s threshold.
- Path F also leaves the 8 GB envelope clean (1B Q4_K_M ≈ 0.8 GB
  weight + smaller KV cache vs 3B's 2.2 GB at n_ctx=20K).

Plan 6 implication: Interview/Brainstorm/merge-LLM prompt design should
treat **the 1B model as the default capability floor** for the on-device
lecture path on ≤ 12 GB Macs (consistent with Spike 0.1 take-5 picker
direction). 3B becomes the 16 GB+ tier or the "Pro on-device" SKU.
Quality verification is a hard prerequisite — 1B has NOT been measured
on Spike 0.2's slot-emergence and Japanese fidelity criteria yet.

## Path F/G follow-up criteria

If Path F (1B re-spike) **passes** (validation 3/3, slot emergence ≥ 1
in at least 1 of 3, latency p90 ≤ 30 s):
- Plan 6 default model on ≤ 12 GB = 1B; 3B reserved for 16 GB+ tier.
- Spike 0.2 verdict flips to PASS conditionally on hardware.
- Path G (`.max(N)` schema bounds + lower `MAX_TOKENS`) is a stack-on
  optimization, not blocking.

If Path F **fails on quality** (slot emergence 0/3 or invalid JSON):
- Fall back to **Path A** (accept 56-100 s on 3B) + **Path G**
  (tighten output via `.max(N)` to claw back ~30 % of generation phase).
- UI gate: progress indicator showing "Processing chunk X/N" is
  non-negotiable for the 53-min lecture case (else multi-minute hang
  reads as broken).

If Path F **fails on latency** (1B still >30 s, e.g. prompt eval
dominates more than estimated):
- Path B becomes interesting again (smaller chunk + 1B = compounded
  reduction).
- Path C (Qwen 2.5 3B) re-enters consideration as last-resort same-class
  swap.

Path D (tiered hardware) only enters if 1B+G fails *and* product
decides to pay engineering cost for differentiated SKUs. Currently
de-prioritized.

## Cleanup verification

```
$ ps -ef | grep -E "llama-completion|tsx" | grep -v grep || echo "(clean)"
(clean — no survivors)
```

Pre-run, mid-loop cooldowns (5 s × 2), and post-run all clean. Hardware
envelope held — no swap thrash, no zombie processes.

## Spike 0.2 scorecard update (suggested)

Append to `desktop/spikes/phase-0/README.md` Spike 0.2 row:

```
**Path E result (2026-05-27):** 3-run timing diagnostic complete. Cost
split MIXED (mean PE 48 % / EV 52 %). Recommended forward: Path F
(1B Llama 3.2 Instruct Q4_K_M re-spike) with Path G (output-token
bound via `.max(N)`) as stack-on. Decision memo at
`decision-0.2-path-e.md`. Plan 6 should treat 1B as ≤ 12 GB default.
```

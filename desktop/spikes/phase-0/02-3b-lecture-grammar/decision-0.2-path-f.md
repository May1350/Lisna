# Path F result — 1B Llama 3.2 re-spike on Spike 0.2 (2026-05-27)

Per `decision-0.2-path-e.md` recommendation: validate the projected
22-25 s/chunk + quality holds on 1B before promoting to ≤ 12 GB default.

## Hardware / Build / Setup

- **Date:** 2026-05-27
- **Branch:** `spec/v2-note-creation-design`
- **Fixture:** `procedural-physics-em.json` (322 buckets, ~53 min lecture, JA dense)
- **Slice:** first 166 buckets / 11,316 transcript chars / 13,419 prompt chars → ≈ 8.9K tokens prompt (same as Path E)
- **Model:** `Llama-3.2-1B-Instruct-Q4_K_M.gguf` (~807 MB, mtime 2026-05-15)
- **Binary:** `desktop/sidecar/deps/llama.cpp/build-spike/bin/llama-completion` (b1-856c3ad, unchanged from Path E)
- **Hardware:** M3 / 8 GB
- **Knobs:** unchanged from Path E — `n_predict=4096`, `temp=0.4`, seeds 2000/2001/2002. (llama-completion's auto-allocated `n_ctx=105728` — KV-cache reserve sized to model headroom rather than the 20480 used on 3B.)
- **Source change:** none (rig + runner identical to Path E)
- **Loop discipline:** 3 invocations, 5 s cooldown between, `pkill` check pre/post — clean.

## Per-run timing breakdown

llama.cpp's own `common_perf_print` block. `load time` reports the model
load + Metal init (runs in parallel with the first forward batch and is
NOT additive to `total time`). `total time` = `prompt eval + eval +
sampling + unaccounted`.

| Run | Seed | Load (ms) | Prompt-eval (ms) | Eval (ms) | Sampling (ms) | Wall (ms) | Prompt tokens | Gen tokens |
|---|---|---|---|---|---|---|---|---|
| 0 | 2000 | 11,915 | 11,569 | 6,706 | 183 | 21,382 | 8,900 | 460 |
| 1 | 2001 | 9,985 | 9,960 | 2,913 | 144 | 14,289 | 8,900 | 204 |
| 2 | 2002 | 10,363 | 10,340 | 66,430 | 1,183 | 80,022 | 8,900 | **4,095** (n_predict cap hit) |

(Wall − perf total ≈ 1.5-2.7 s across all 3 runs = node spawn + stdout
drain + Zod parse; not material.)

Mean wall: **38,564 ms** (vs 3B's 71,889 ms → **1.86× faster** including
runaway, **3.23× faster** on the well-behaved runs 0/1 mean 17,836 ms).

## Per-token throughput

| Run | Prompt eval (tok/s) | Generation (tok/s) | Per-tok gen (ms) |
|---|---|---|---|
| 0 | 769.3 | 68.6 | 14.58 |
| 1 | 893.5 | 70.0 | 14.28 |
| 2 | 860.7 | 61.6 | 16.22 |

Per-token gen on 1B = **14-16 ms/tok** vs 3B's **38-67 ms/tok**.
Empirical 2.4-4.6× per-token speedup matches the Spike 0.1 take-5
projection (~2.4× at temp 0.4-0.6) and even exceeds it on the typical
runs. Prompt eval on 1B is **~770-890 tok/s** vs 3B's 267-314 tok/s — a
**2.5-3.3× per-token PE speedup**. Path E's projection (PE 28 → ~12 s,
gen 24 → ~10 s, total ~22-25 s) was directionally right but conservative
on the typical cases.

## Cost split

| Run | promptEvalPct | evalPct |
|---|---|---|
| 0 | 62.7 % | 36.3 % |
| 1 | 76.5 % | 22.4 % |
| 2 | 13.3 % | 85.2 % |

**Mean promptEvalPct (all 3): 50.8 %**
**Mean evalPct (all 3): 48.0 %**
**Mean promptEvalPct (runs 0-1): 69.6 %**
**Mean evalPct (runs 0-1): 29.4 %**

On the typical cases (runs 0-1) the cost flips PE-dominated. Once the
model emits its short outline, generation is fast and prompt processing
takes the majority of wall time. Run 2 (the runaway) inverts this — when
the model fails to terminate, eval time scales with the n_predict cap
and dominates entirely.

## Quality results

| Run | Validation | sections | slotsEmerged | extras types | content fidelity |
|---|---|---|---|---|---|
| 0 | PASS | 9 | **0** | (none) | placeholder filler |
| 1 | PASS | 4 | **0** | (none) | grounded but truncated |
| 2 | FAIL | 0 | 0 | (none) | runaway → JSON parse fail |

**Slot emergence: 0/3.** None of the 3 runs emitted any `extras` slot
(formula / example / term / figure / citation). Spec § 7.2 acceptance
requires ≥ 1 of 3 with `slotsEmerged ≥ 1` — **1B misses this floor.**

### Per-sample inspection

**Run 0** (placeholder filler, garbled UTF-8 in heading "文�"):

```
title: "電磁規約入の第4項"
sections:
  - heading: "時間", summary: "時間は電磁規約入の第4項の第1項"
  - heading: "演示", summary: "演示は電磁規約入の第4項の第2項"
  - heading: "式",   summary: "式は電磁規約入の第4項の第3項"
  ... (9 sections, all "第N項" filler)
  - heading: "文�", summary: "文�は電磁規約入の第4項の第8項"
```

Model invented a section-numbering structure and filled summaries with
literal `第N項` placeholders. No physics content actually extracted from
the lecture. Garbled UTF-8 codepoint in section 8 — model emitted partial
multi-byte sequence (likely tokenizer artifact; grammar passes it since
it's bytes-not-codepoints).

**Run 1** (grounded but truncated):

```
title: "静電ポテンシャル"
sections:
  - heading: "OからPに至る経路", summary: "OからPに至る経路によら"      ← clause cut mid-word
  - heading: "電荷の計算",         summary: "電荷の計算"                  ← summary == heading
  - heading: "点電荷のy計算",      summary: "点電荷のy計算"                ← summary == heading
  - heading: "静電ポテンシャル",   summary: "静電ポテンシャル"             ← summary == heading
```

Headings ARE grounded in the lecture (these terms appear in the
transcript). But `summary` fields are 1-line truncations or duplicates
of the heading. The model emitted minimum-viable strings to satisfy the
grammar's `string` production then terminated. No `tldr`. No
`key_terms`. No `extras`.

**Run 2** (runaway → invalid JSON):

```
gen_tok: 4095 (hit n_predict cap)
output_bytes: 12,812
failureReason: "Bad control character in string literal in JSON at position 9054 (line 459 column 36)"
```

Model emitted a literal control character (likely `\n`, `\t`, or a
binary byte) inside a JSON string without escaping. The GBNF grammar
for `string` allows `[^"\\]` which technically includes ASCII control
chars — JSON spec disallows them inside strings. Grammar accepted; the
parser rejected. Combined with hitting the n_predict cap, this is the
1B-equivalent of Spike 0.1 take-3's runaway, but the GBNF prevented the
fully unconstrained explosion — it just dragged on until the cap.

The "extra reds" comparison to 3B's `E=mc² / E=mc^2` parroting:
1B did NOT parrot E=mc². It emitted NOTHING in the formula slot.
This is "less wrong" only in a literal sense — at least 3B was trying
to populate the slot (and getting it wrong); 1B doesn't even attempt.

## Decision

Per Spike 0.2 acceptance (spec § 7.2):

- **Validation passes:** 2/3 (target ≥ 1 ✓)
- **Slot emergence ≥ 1:** **0/3** (target ≥ 1 ✗)
- **Latency p90 ≤ 30 s:** 2/3 inside (Run 0 21s, Run 1 14s, Run 2 80s outlier)

**Path F verdict: PASS on latency, FAIL on quality.**

Reasoning:

- The Path E latency projection (22-25 s/chunk) was correct — runs 0-1
  land below 25 s, and the per-token speedups match the Spike 0.1
  take-5 prediction. The 30 s spec budget is comfortably hit on
  well-behaved runs.
- **But the quality floor is gone.** 3B parroted `E=mc²` (1 formula
  slot, wrong content). 1B emits zero slots — and worse, emits
  placeholder filler ("第N項" pattern in Run 0) or trivial heading-only
  summaries (Run 1). The model is operating at "satisfy the GBNF and
  exit" rather than "extract structure from the transcript."
- **Run 2 runaway is a tail risk.** 1/3 invocations hit n_predict=4096
  cap and emitted invalid JSON. This is the same runaway pattern
  observed on Spike 0.1 take-3 (1B + temp 0.6 → 6588-char loop). At
  temp 0.4 + grammar the symptom is suppressed (grammar prevents the
  loop from being literal repetition) but n_predict still tops out and
  the output becomes unparseable.
- **8 GB envelope held cleanly:** KV cache MTL0 buffer 3304 MiB,
  model 762 MiB, compute 317 MiB → total Metal RSS ~4.4 GB. No swap
  thrash, post-run RAM clean. So the hardware case for 1B (≤ 12 GB
  default) is sound; only the quality case fails.

**Plan 6 recommendation:** 1B as default for ≤ 12 GB Macs is **NOT
viable** at current prompt design. The current Lecture spike prompt
allows the model to emit zero `extras` and pass the grammar — which is
fine for a permissive schema test but fails the user-facing acceptance
("the note has formulas in it for a formula-heavy lecture").

## Plan 6 / Picker implications

Three options surface from this result, in order of engineering cost:

1. **Re-tune the prompt for 1B's capability floor.** The current prompt
   was designed against 3B's capability. 1B needs (a) explicit
   examples of populated `extras` slots in the few-shot, (b) stronger
   "always emit at least one `tldr`, one `key_term`, one `extras` per
   section" language, (c) maybe a shorter prompt to keep more context
   budget for output. Risk: this is exactly what Spike 0.2 was
   supposed to prove — without re-running with a re-tuned prompt we
   don't know if 1B can hit slot emergence at all.
2. **Tighten the GBNF.** Require `extras` non-empty for formula-heavy
   lectures (impossible to do schema-level without a discriminator).
   Or use `.max(N)` bounds as Path G — but bounds don't force
   minimum, they only cap maximum. Not a fit for this failure mode.
3. **Accept that 1B is below the lecture-note capability floor.** Use
   1B for shorter / lower-stakes note kinds (Brainstorm? Diary?
   Interview?) and reserve 3B for Lecture on ≤ 12 GB. Picker
   experience suffers — would force a "this lecture is too complex
   for your hardware tier" UX.

The honest interpretation: **1B + lecture-mini + current prompt is at
the boundary of capability.** The model can produce structurally valid
JSON 2/3 times but populates it with placeholder content. Plan 6's
prompt design becomes load-bearing — it has to lift 1B's content
quality up to the bar, not just constrain its output shape.

**Picker default recommendation revision:**
- ≤ 12 GB: **STILL recommend 3B** for the lecture path, accepting the
  56-100 s wall time, gated on Path G + UI progress indicator (per
  Path E follow-up criteria).
- 1B becomes the "fast capture / quick gist" tier only, not the
  primary lecture tier.
- 16 GB+: 3B remains the default (no change).

This contradicts Spike 0.1 take-5's directional recommendation. Spike
0.1 measured generation rate, not content quality. The 2.4× generation
speedup is real but doesn't transfer to user-visible value when the
content the model emits is filler.

## Path G stack-on (revised)

Path G (`.max(N)` schema bounds + lower `MAX_TOKENS`) was framed in
Path E as a stack-on if Path F passes latency. **Path F passes
latency but not quality**, so Path G's optimization target (claw back
generation time) is less urgent on 3B than it appeared, since 3B's
prompt-eval phase is now the bigger cost.

Path G is still worth a 30-min implementation as a tail-risk mitigation
for runaway (the Run 2 failure mode would have been caught by a lower
n_predict + max bound on `sections` array). But it doesn't change the
1B-vs-3B decision.

## Recommended next steps

1. **Memo lands; founder gate.** This memo is the data the founder
   needs to overrule (or confirm) the Spike 0.1 take-5 picker
   direction. The directional question is no longer "is 1B fast
   enough" (yes) but "is the prompt-engineering investment to lift
   1B's content quality cheaper than accepting 3B's latency."
2. **If the founder picks 1B-with-better-prompt:** open Plan 6 with
   "first task: re-spike 0.2 on 1B with prompt v2 designed for
   capability floor, must hit ≥ 1/3 slot emergence."
3. **If the founder picks 3B-as-default:** open Plan 6 with "lecture
   prompt targets 3B; Path G optimization queued for tail-risk
   suppression."
4. **Either way:** Run 2's runaway → invalid JSON failure mode is a
   real risk for production. Add Path G (bounded `n_predict` + `.max()`
   on sections array) to the curator's hard fault path, with a
   user-visible "note generation interrupted, please retry" fallback.

## Cleanup verification

```
$ ps -ef | grep -E "llama-completion|tsx" | grep -v grep || echo "(clean)"
(clean — no survivors)
```

Pre-run, mid-loop cooldowns (5 s × 2), and post-run all clean. Hardware
envelope held — peak Metal RSS ~4.4 GB, no swap thrash, no zombie
processes.

## Spike 0.2 scorecard update (suggested)

Append to `desktop/spikes/phase-0/README.md` Spike 0.2 row:

```
**Path F result (2026-05-27):** 1B Llama 3.2 Instruct Q4_K_M re-spike.
Latency PASS (mean 17.8 s on well-behaved runs, 1.86-3.23× faster than
3B). Quality FAIL: slot emergence 0/3 (target ≥ 1/3). Content is
placeholder filler or heading-duplicate summaries. Runaway tail risk
1/3 (Run 2: n_predict cap + invalid JSON). 8 GB envelope clean (peak
~4.4 GB Metal RSS). Decision memo at `decision-0.2-path-f.md`. Verdict:
1B is NOT viable as ≤ 12 GB default at current prompt design — Plan 6
prompt engineering becomes load-bearing OR 3B stays default for
lecture path.
```

# Spike 0.1 — HARD GATE verdict: **BLOCKED** (3 iterations exhausted)

Per Plan 1 Task 8 acceptance: 10/10 LLM-generated outputs must round-trip
Zod-parse cleanly. After three iterations escalating `maxTokens` and
sweeping `--temp`, the best result was **8/10**; iteration 3 with a
lower-temperature spread actually regressed to **7/10** with a new
failure mode.

**Verdict:** Spike 0.1 does NOT pass. Per the HARD GATE rule
(`docs/superpowers/plans/2026-05-26-v2-note-creation-phase-0-spikes.md`
Task 8 Step 4), Spike 0.2 is NOT green-lit. Escalate to the founder via
the controller for a scope decision (see "Recommended next steps"
below).

## Iteration log

All runs used:
- Model: `/Users/guntak/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf`
- Binary: `desktop/sidecar/deps/llama.cpp/build-spike/bin/llama-completion`
  (built fresh with `GGML_METAL=ON`, llama.cpp build `b1-856c3ad`)
- Grammar: freshly regenerated each run from `zod-to-gbnf.ts` against
  `LectureMiniSchema`
- 10 distinct prompts, deterministic per-sample seeds (`1000..1009`)

| Iter | `maxTokens` | Temp range | Pass | Failure type (samples) |
|---|---|---|---|---|
| 1 | 2048 | 0.40..0.85 | 8/10 | sample 2 (Newton, temp=0.5, seed=1002) and sample 6 (Bread, temp=0.7, seed=1006): JSON.parse "Bad control character" / "Expected ',' or ']'" at offset ~6000 = `n`-cap truncation mid-string/array |
| 2 | 4096 | 0.40..0.85 | 8/10 | same samples (2 and 6), error offsets doubled to ~11500/12500 — pure `n`-cap scaling. Model in runaway loop. |
| 3 | 4096 | 0.30..0.55 | 7/10 | sample 6 (Bread, temp=0.48): same `key_terms` runaway. sample 9 (Maxwell, temp=0.55) NEW failure: `char` level loop — model emits `\\n\\n\\n\\n…` indefinitely inside an unclosed string |

Total wall-time across 3 iterations: ~17 min sequential 3B inference.

## Root-cause analysis

**It is NOT a converter bug.** The Zod→GBNF emission is byte-for-byte
correct; the 8 (or 7) passing samples in each iteration are perfectly
shaped JSON that Zod accepts after the standard post-decode `from`
hydration. Manual inspection of the emitted grammar
(`lecture-mini.gbnf`) confirmed via llama.cpp `test-gbnf-validator` in
Task 7. The grammar's structure is what we want.

**It IS a model-behavior / grammar-permissiveness interaction.** Two
related runaway-loop modes appear with non-trivial frequency on
Llama-3.2-3B-Instruct under grammar-constrained sampling:

### Failure mode A: array-level runaway (iter 1 & 2 sample 2/6, iter 3 sample 6)

The grammar permits a `key_terms` (or `items` inside `extras`) array
with `(elem ("," elem)*)?` — unbounded length. Once the model is deep
inside such an array, picking "another item" is grammar-legal and the
model's autoregressive distribution over (`}` to close vs `,` to add
another) keeps choosing `,` indefinitely. The grammar never forces a
close until `maxTokens` ends the run, leaving the JSON syntactically
broken.

Bread iter-3 example, last ~150 chars:
```
{"term": "water","definition": "Used to hydrate the dough.","
```
— model was mid-string when n-cap hit.

Newton iter-1 example, the unconstrained items list:
```
{"expression": "F = m \times a", "label": "..."},
{"expression": "F = m \times a", "label": "..."},
{"expression": "F = m \times a", "label": "..."}, …
```
— identical entries hundreds of times.

### Failure mode B: char-level escape-sequence runaway (iter 3 sample 9, NEW)

The grammar's scalar rule is:
```
json-string ::= "\"" char* "\""
char        ::= [^"\\] | "\\" ["\\/bfnrt]
```
The `char*` allows arbitrarily many `\\` + `[bfnrt]` escapes in a row.
Maxwell iter-3 sample stopped emitting actual content and entered:
```
"E \n\\n\\n\\n\\n\\n\\n\\n\\n\\n…"
```
indefinitely. This is a string-internal loop the grammar cannot stop.

Iter-3 lowered temperatures made the *array-level* loop slightly less
likely (sample 2 Newton recovered) but made the *char-level* loop MORE
likely on the formula-heavy Maxwell sample — the model's mode at low T
is "elaborate the formula", and grammar-constrained, the only legal way
to keep elaborating inside a `\\(...)` LaTeX-like string is more escape
sequences.

## Why temperature/seed/prompt tuning cannot fix this in scope

- Iteration 2 vs 1 (same temps + bigger `n`) failed at the SAME
  samples with errors at proportionally-shifted offsets — proving the
  failure is "model keeps generating, never closes" rather than
  "occasional malformed branch".
- Iteration 3 (lower temps) regressed (7/10 vs 8/10) because moving
  along the temperature axis trades one loop mode for another — the
  failure surface isn't a single locally-optimizable dimension.
- Re-seeding individual failing samples until they pass is the
  "cherry-pick to 10/10" anti-pattern the HARD GATE explicitly forbids.

## Recommended next steps (founder decision)

These are mutually exclusive paths. None is a small follow-up; each
changes Spike 0.1 scope.

### Path 1 — bounded-array grammar emission (RECOMMENDED for spec quality)

Extend the converter to emit bounded-repetition GBNF rules for arrays
that carry a `.max(N)` Zod constraint:
- For `z.array(T).max(7)`: emit `arr ::= "[" (elem ("," elem){0,6})? "]"`
  (GBNF supports `{N,M}` repetition).
- Annotate `LectureMiniSchema` with `.max(N)` on every array
  (`key_terms.max(12)`, `extras.max(8)`, `items.max(20)`, `sections.max(10)`).

This **structurally prevents** failure mode A. It also matches the v2
spec's intent — Lecture sections should have a bounded handful of key
terms / formulas, not hundreds. The downside: it pushes scope into
Tasks 1-6 territory (Zod constructs not yet supported by the converter)
and requires re-running Spike 0.1 from scratch.

Estimated effort: 2-3 hours.
Failure mode B is NOT addressed by this; a separate `char{0,1024}`
bound would be needed for strings, which is more invasive.

### Path 2 — accept "<best of K" sampling, raise N as needed

Production code wraps each LLM call in a retry loop: on `JSON.parse`
failure or Zod failure, re-seed and retry up to e.g. 3 times. Document
this in the spec, change the Spike 0.1 acceptance to "10/10 within ≤ 3
attempts each", and re-run.

This matches what real grammar-constrained pipelines do (vLLM, Outlines,
etc. all surface a retry/repair layer). Downside: hides instability;
need to budget for extra compute in production.

Estimated effort: 30 min to add a `retries` parameter to the rig +
re-run.

### Path 3 — switch capability floor to a stronger model

Try Llama-3.2-7B or Mistral-7B-Instruct. Larger models hold grammar
better at the cost of more tokens/sec and more RAM. This changes the
PRD's on-device constraint envelope and intersects with the alpha-gate
model-resolver work (Step 5 §5.1) — significant scope shift.

Estimated effort: ½ day (download model, re-spike, re-eval RAM/latency).

### Path 4 — accept the failure and proceed to Spike 0.2 with a known caveat

NOT recommended: the HARD GATE exists specifically to prevent this. If
the founder explicitly agrees, document that v2 production will require
a retry layer and Spike 0.2 will measure end-to-end success rate
including the retry.

## Files to inspect

- `desktop/spikes/phase-0/01-zod-to-gbnf/round-trip.test.ts` — the
  failing test, with iteration-3 parameters as last set
- `desktop/spikes/phase-0/01-zod-to-gbnf/lecture-mini.gbnf` — current
  grammar (correct, MD5 from Task 7 unchanged)
- `desktop/spikes/phase-0/01-zod-to-gbnf/llama-cli-rig.ts` — the
  runner, includes brace-balanced JSON extraction (verified working
  for the 7-8 passing samples each iteration)
- `/tmp/repro-sample2.out` (transient) — Newton's-laws runaway-loop
  reproducer used to identify the byte-0x0A "bad control character"
  as the post-truncation trailing `\n` that follows `> EOF by user`

## Spike scorecard line (NOT updated to PASS)

| Spike | Acceptance | Result | Notes |
|---|---|---|---|
| 0.1 zod-to-gbnf | 10/10 round-trip + grammar parses + < 100ms first-call | **BLOCKED** (best 8/10 after 3 iterations; grammar parse OK; converter first-call < 100ms confirmed in Tasks 1-7) | HARD GATE — escalate per `decision-0.1-fail.md` |

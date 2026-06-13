# Fabrication culprit — falsification matrix verdict (2026-06-13 run)

Per plan `2026-06-12-v2-track2-sampler-alignment.md` Task 8 and spec section 7.
Rig: `note-quality-eval.ts` on founder dump `2026-06-11T16-14-00-372Z`
(17-min JA finance interview, 692s, 290 segments, single chunk, interview-v1,
real 3B Q4_K_M, grammar-first sidecar binary with Tasks 1-7 + the UTF-8
streaming fix applied). `appliedSampling` echo verified request-matching in
EVERY run — delivery is proven, so per spec the verdict implicates the chain
architecture, not param transport.

## P0 discovered en route: UTF-8 token streaming hang (fixed in-branch)

The first R1 attempt hung 300s with zero client-visible progress while the
engine generated at 9.4 tok/s. Root cause (timing-instrumented, then fixed):
Llama-3 byte-fallback token pieces split multi-byte JA chars across pieces;
`nlohmann::json::dump()` throws `type_error.316` on the partial sequence; the
exception killed the decode loop (leaking the sampler chain) and surfaced as
an `{"id":"-"}` error line the TS client cannot bind to the in-flight request
→ silent stall until the no-progress timeout. **This is latent in v0.1.9
production** — any chain config can sample a byte-fallback piece; it is a
plausible contributor to historical "prefill stall" reports. Fixed by
`Utf8Carry` boundary buffering + id-bound generate errors + sampler free on
unwind (`62da573`, `f678486`, 52/52 ctest). DRY per-call init cost measured
64-83ms — NOT a factor.

## The 9-cell matrix

Scores = rig metrics on the parsed (or truncation-repaired) note.
R1 = aligned (top_k 40 / top_p 0.95 / min_p 0.05 / penalty OFF / DRY 0.8).
R2 = aligned + penalty 1.1/64 ONLY. R3 = full legacy reproduction
(top_k 50 / top_p 0.9 / no min_p / penalty 1.1 / no DRY).

| seed | R1 aligned | R2 aligned+penalty | R3 legacy |
|---|---|---|---|
| 7000 | ✗ unbounded: 3500tok cap-burn (450s), 50 micro qa_pairs, truncated JSON; JA grounded content (jaRatio .89), loop .28 | ✓ **healthy**: 640tok natural EOS, complete structure (qa 2 / themes 2 / takeaways 2), jaRatio .93, loop 0, 138s | ✗ empty-slot collapse (all strings `" "`, 17 chars) |
| 8000 | ✗ near-empty: 134tok, qa 0, 41 chars | ✗ near-empty: 156tok, qa 0, 61 chars | ✗/~ 2806tok, qa hits the 80-pair grammar cap, grounded (groundingJa .84, jaRatio .88) but micro-pair degeneracy |
| 9000 | ✗ empty-slot collapse (structure filled, strings blank, 33 chars) | ✗ parse-fail: bad control char in string @1062, unrepairable | ✗ empty-slot collapse (13 chars) |

**Gate result: R1 grounding ≥ 0.9 = 0/3 → B fallback trigger (≥2/3) FIRED.**

## Attribution verdict (spec section 7 discipline)

1. **Repeat-penalty 1.1 is NOT confirmed as sole fabrication cause.** R2
   (penalty on aligned truncation) produced the single healthiest note of the
   matrix (7000) and zero EN fabrication in 3/3. Per the spec's pre-scripted
   wording: "penalty not reproduced as sole cause."
2. **EN-fabrication itself did not reproduce on these seeds** — the legacy
   chain (R3) instead reproduced the *empty-slot collapse* failure shape 2/3
   (production bug class #108). Same degeneracy family, different attractor.
3. **Every grammar-first config is seed-unstable**: 1 healthy cell out of 9,
   and the failure SHAPE varies per seed within the same config (unbounded ↔
   near-empty ↔ blank-slot). Contrast: the overnight CLI matrix
   (`common_sampler`, LAZY grammar `grammar_first=false`, penalty off) was
   grounded 0.95 on 3/3 seeds with the same model/prompt/grammar. The
   dominant uncontrolled variable is exactly the one the spec named as the
   B-fallback question: **grammar application mode** (hard mask before
   truncation vs lazy rejection-resample on full-vocab logits).
4. Secondary findings for the B configuration: (a) penalty-off needs a
   termination device — R1-7000 ran to the token cap; on the CLI the same
   config looped but terminated; (b) DRY with the upstream JSON breakers
   (`"`/`:`/`\n`) cannot see cross-pair structural repetition (R1-7000 loop
   .28) — post-decode dedup (Task 9) carries that defense regardless of
   chain; (c) tok/s varied 1.7-7.8 under ambient memory pressure — the ±10%
   gate is deferred to the post-B merge-gate run on a quiet machine.

## Decision

**Adopt fallback B now (pre-approved, no new design round-trip)**: link
llama.cpp `common` into the sidecar, map `GenOpts` →
`common_params_sampling`, sample via `common_sampler` with its default
`grammar_first=false` (lazy). Aligned values + penalty knob stay
param-driven from TS exactly as built in Tasks 1-7; the rig matrix and merge
gate re-run unchanged on the B binary (R1-B × 3 seeds). If B also fails the
gate ≥2/3, escalate per spec ("R4 fp16-KV" + founder).

---

## ADDENDUM 2026-06-13 — B FAILED. The grammar is the culprit, not the sampler.

B was implemented (common_sampler, lazy grammar, llama-common linked, 52/52
ctest green, release bundled) and the matrix + escalations RE-RAN on the same
founder dump. Every config still fabricates English or collapses:

| Config | sampler | KV | grammar | seed 7000 result |
|---|---|---|---|---|
| B | common_sampler lazy | q8_0 | yes (6425-char JSON) | clean **English fabrication** ("Interview with Tadao Maeda" / "Intel financial strategy") |
| B, DRY off | common_sampler lazy | q8_0 | yes | clean **English fabrication** (DRY ruled out) |
| R4 | common_sampler lazy | **fp16** | yes | empty-slot collapse (all strings `" "`) — KV type ruled out |
| **R5** | common_sampler | q8_0 | **NO grammar** | **GROUNDED JAPANESE** — `purpose: "会計・ファイナンスの基準"`, qa text `"おはよう、皆さんこんにちは。"` / `"私は日本の会計・ファイナンス業界…"`, all literally in the transcript |
| P1 | common_sampler | q8_0 | yes + emphatic JA-only-values system rule | empty-slot collapse (all `" "`) — a forced JA instruction under grammar does NOT rescue grounding; it only shifts English→blank. Prompt lever ruled out. |

**Single-variable isolation**: B vs R5 differ ONLY in grammar presence (same
common_sampler, same q8_0 KV, same prompt, same seed). Grammar on → English
fabrication; grammar off → grounded JA. **The GBNF JSON-schema constraint is
what flips the 3B out of Japanese-generation mode.** Mechanism: forced through
English-looking JSON scaffolding (keys `"question"/"answer"/"purpose"`,
structural `{`/`"`/`:` tokens) the model's mode collapses to English in the
string slots too; unconstrained it follows the JA prompt and grounds.

**This invalidates the plan's premise** (and the overnight isolation that
named the bespoke C++ sampler): the sampler architecture, repeat-penalty,
DRY, and KV-cache type are ALL downstream of the grammar and none of them is
the cause. The overnight "common_sampler grounds JA 0.95" was almost certainly
a NO-GRAMMAR (free-text) CLI run — the differentiator was grammar presence,
misattributed to the sampler.

**Why this isn't a universal regression**: on the SAME v0.1.9 binary (bespoke
+ q8_0 + grammar) the founder's fresh 2-chunk interview grounded JA with zero
fabrication (2026-06-13). This 17-min dump is a worst case: finance topic
(strong EN prior) + sparse/garbled far-field STT + the grammar constraint
together tip the 3B over. So the failure is input-dependent, not every-run.

**Cheap-isolation phase (founder-approved 2026-06-13) → CONCLUDED, no rescue.**
Five real-3B experiments converge: every cheap lever (sampler architecture,
DRY, KV-cache type, system-prompt JA-lock) failed; only grammar-OFF grounds.
The grammar constraint, not any tunable, is the cause.

**The real fix is OUTSIDE the sampler-alignment plan** — it's a
grammar/generation-strategy redesign. Lead candidate (R5-backed): **two-pass**
— generate free JA text (grounds reliably), then structure it into the schema
deterministically or via a second LLM pass. Alternatives: a lighter grammar
that emits less English scaffolding; a stronger model. Needs a new
brainstorming/design round-trip, not more sampler permutations. **HALTED
pending founder direction on the redesign.** Tasks 1-7 (SamplingParams plumbing, rig `--sampling` sweep +
`appliedSampling` echo, shared dedup helpers, dump logging) + the UTF-8
streaming P0 fix (8a) are sound infra that ENABLED this diagnosis and stand on
their own; Task 8b (the common_sampler swap) is built but UNCOMMITTED and
delivers no proven user-visible win — its fate is a founder call.

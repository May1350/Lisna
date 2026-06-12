# v2 Track 2 — Sidecar Sampler Alignment + Looping/ts Correctness (Design)

- **Date**: 2026-06-12
- **Status**: Design APPROVED in founder session 2026-06-12 (scope + approach A
  with pre-approved B fallback). Expert-reviewed same day (independent opus
  reviewer, APPROVE-WITH-FIXES; F1-F5 applied — grammar-mode confound
  corrected, suspects re-ranked co-equal, attribution discipline added).
- **Lane**: ai-infra (C++ sidecar + TS main path)
- **Related**:
  - Memory `v2_track2_overnight_sampler_isolation_2026-06-12` (isolation matrix)
  - PR #118 (`NOTE_LANGUAGE_MISMATCH` circuit breaker — Layer 3 here)
  - PR #119 (role-split prompts + `desktop/scripts/note-quality-eval.ts` replay rig)
  - `desktop/sidecar/src/llm/llama_engine.cpp` (bespoke chain under change)
  - PR #92 DRAFT (Path G grammar bounding — explicitly NOT this spec; see section 10)

---

## 1. Problem and evidence

Two user-visible defects in v2 note generation, which this design shows are
two ends of one knob:

**Defect 1 — fabrication (P0).** ja-session interview finalize emitted
100%-fabricated English template text (judges: F). The overnight 2026-06-12
isolation matrix — same Llama-3.2-3B Q4_K_M, same v1 prompt, same GBNF, same
seed 7000, same real founder transcript:

| Path | Prompt shape | Result |
|---|---|---|
| `llama-completion` (common_sampler) | `--jinja` + system split | grounded JA, groundingJa 0.95 — 3/3 |
| `llama-completion` (common_sampler) | RAW (no template at all) | grounded JA — pass |
| production sidecar (bespoke chain) | combined | English fabrication — 3/3 |
| production sidecar (bespoke chain) | role-split (post-#119) | English fabrication, jaRatio 0 — 3/3 |

Prompt wording and chat template are eliminated (raw CLI prompt still grounded;
role-split sidecar still fabricated). The C++ generation path is the culprit.

**What the matrix did NOT control** (found by code read in this design
session): sampler hyperparameters and chain architecture differ between the
two paths. The CLI rig (`desktop/spikes/phase-0/01-zod-to-gbnf/llama-cli-rig.ts:116-133`)
passes no sampler flags, so the known-good runs used llama.cpp `common`
defaults (`desktop/sidecar/deps/llama.cpp/common/common.h:214-243`):

| Knob | sidecar (`llama_engine.cpp:226-249`) | CLI known-good (common defaults) |
|---|---|---|
| top_k | 50 | 40 |
| top_p | 0.90 | 0.95 |
| min_p | — (absent) | 0.05 |
| repeat penalty | **1.1 over last 64, applied AFTER top_k/top_p** | **1.0 = OFF** |
| DRY sampler | — (absent) | present, disabled by default (multiplier 0.0) |
| architecture | bespoke `llama_sampler_chain` | `common_sampler` |
| grammar mode | grammar-first HARD MASK — chain samplers run on the masked set | `grammar_first=false` LAZY (default) — chain runs on full vocab; grammar validates the pick, resamples on rejection (`common/sampling.h:65`, `sampling.cpp:577-617`) |
| KV cache | q8_0 (+FA auto) | fp16 default |

**Defect 2 — looping (judges' C/C+ residual).** The grounded CLI output —
penalty OFF — repeats 3 unique qa pairs 4-5×, covering only 68s of a 692s
recording. Looping survives with the penalty off; fabrication appears with it
on.

**Co-equal prime suspects & coupling** (ranking per expert review F1/F2 —
the overnight memory itself names the masking/sampling-order difference as
the suspected mechanism; the code read adds the penalty):

1. **Repeat penalty 1.1 / last 64** — systematically down-weights recurring
   JA subword tokens inside grammar-constrained JSON (JA reuses a small set
   of byte/subword pieces far more densely than English); penalized JA
   candidates lose to English alternates and generation slides into English
   template prose.
2. **Grammar application mode** — the sidecar hard-masks invalid tokens
   BEFORE the truncation samplers; the known-good CLI ran
   `common_sampler`'s default `grammar_first=false` (lazy
   rejection-resample on full-vocab logits). The two suspects interact: on
   a masked+truncated candidate set, a penalized JA token has fewer JA
   alternates to lose to, so English survivors win far more easily than
   they would on full vocab.

With the penalty off (CLI), JA survives but nothing suppresses phrase-level
repetition — read as looping. One knob family, two failure modes; designed
together. Irony for the record: the 1.1 penalty was added 2026-05-15 to
stop a 1B infinite loop, did not stop phrase looping, and sits at the
center of the fabrication mechanism.

**Defect 3 — ts scale (cheap).** Note `ts` slots arrive as 0-1 fractions
(0.23 ≈ 23s into the recording) instead of seconds.

## 2. Goals / non-goals

**Goals**

- **G1**: The production sidecar path reproduces CLI-grade output on the
  founder dump: groundingJa ≥ 0.9 + jaRatio pass, 3/3 seeds (rig gate).
- **G2**: Looping bounded: per-slot near-duplicate rate ≤ 10% after
  generation (DRY) + guaranteed by post-decode dedup.
- **G3**: `ts` values are integer seconds within `[0, durationSec]`.
- **G4**: Sampler parameters become data, single-sourced from TS
  (`profiles.ts`), sweepable by the rig without a C++ rebuild.
- **G5**: The exact culprit variable is pinned by a falsification matrix and
  recorded as a decision doc (byproduct of G4, not a gate for shipping).
- **G6**: Decode throughput within ±10% of the #111 baseline (60s finalize
  target must not regress).

**Non-goals (deferred with forward pointers — section 10)**

- Q↔A binding quality (requires diarization; agenda item 3).
- Path G grammar bounding + 1B re-eval + RAM-adaptive selection (agenda
  item 4; PR #92 questions absorbed there).
- Far-field STT accuracy + maintenance-window stall robustness (agenda
  item 5).
- Prompt-variant work (interview-v2 stays registered non-default).

## 3. Design overview — three defense layers

```
Layer 1  generation   aligned sampler chain + DRY        (C++, section 4)
Layer 2  post-decode  deterministic dedup + ts rescale   (TS,  section 6)
Layer 3  circuit      NOTE_LANGUAGE_MISMATCH guard #118  (unchanged)
```

Approach A ("align to the proven configuration, hoist params to TS") with
pre-approved fallback B ("adopt `common_sampler` wholesale") if the rig gate
falsifies A — see section 7 trigger.

## 4. C++ chain change (`llama_engine.cpp`)

New chain (replaces `llama_engine.cpp:226-249`):

```
grammar (unchanged, grammar-first)
→ dry        (NEW, enabled)
→ top_k 40   (was 50)
→ top_p 0.95 (was 0.90)
→ min_p 0.05 (NEW)
→ temp       (per-profile, unchanged)
→ dist(seed) (unchanged)
```

- **Removed**: `llama_sampler_init_penalties(64, 1.1f, 0.0f, 0.0f)`. The
  primitive stays reachable via params (section 5) for the rig's legacy-config
  reproduction; production passes 1.0 (off).
- **DRY init**: `llama_sampler_init_dry(vocab, llama_model_n_ctx_train(model),
  multiplier, base, allowed_length, penalty_last_n, seq_breakers, n_breakers)`
  (vendored `llama.h:1394`). Production values: multiplier **0.8** (enable;
  upstream ships 0.0=off), base **1.75**, allowed_length **2**,
  penalty_last_n **-1** (scan whole context) — upstream defaults apart from
  the enable. Sequence breakers: upstream default `{"\n", ":", "\"", "*"}`
  (`common.h:243`); the `"` breaker resets matching at JSON string boundaries,
  which keeps DRY from chaining matches across separate slots.
- **Order rationale**: mirrors upstream `common_sampler` chain order
  (penalties → dry → truncation → temp → dist). Grammar stays FIRST
  (single-pass hard mask; the candidate set cannot empty). **Corrected per
  review F1**: this is NOT the same shape as the known-good CLI, which ran
  `grammar_first=false` — common_sampler's default LAZY mode (chain on
  full-vocab logits; grammar validates the pick and resamples on rejection,
  `common/sampling.h:65`, `sampling.cpp:577-617`). Grammar application mode
  is therefore a path difference that R1-R3 does NOT control; it is
  answered by the B fallback, which adopts the lazy mode wholesale.
  Retaining grammar-first keeps this change param-only and single-pass-safe.
- **min_p regime note** (review F4): in this chain min_p prunes the
  grammar-masked set, whereas the CLI's min_p pruned full vocab. Its
  individual effect is not isolated by R1 — acceptable: the goal is
  matching CLI output quality, not per-knob attribution.
- **Known regression risk**: dropping the 1.1 penalty re-exposes, in theory,
  token-level runaway (the 2026-05-15 1B incident). Cover: DRY targets exactly
  that shape; `maxTokens` caps the damage; the fresh-seed retry ladder and
  Layer 3 catch garbage. Evidence: CLI runs with penalty OFF on the real
  transcript produced bounded phrase loops, no runaway. Additionally
  (review F5): the 2026-05-15 incident was co-fixed by the n_ctx 16K bump
  (`llama_engine.cpp:110`, still in place), so removing the penalty does
  not re-expose the original overflow trigger — DRY covers the phrase-loop
  residual specifically. 1B is non-default and gets re-evaluated in the
  adaptive spec.

## 5. Sampling params promoted to TS (single source of truth)

**C++** — `GenOpts` (`llama_engine.h:10`) gains, with defaults equal to the
section-4 aligned values (omission ⇒ aligned behavior, NOT legacy):

| Field | Default | Note |
|---|---|---|
| `topK` | 40 | int |
| `topP` | 0.95 | |
| `minP` | 0.05 | |
| `repeatPenalty` | 1.0 | off; rig-only knob in practice |
| `repeatLastN` | 64 | inert while penalty=1.0 |
| `dryMultiplier` | 0.8 | 0.0 disables DRY |
| `dryBase` | 1.75 | |
| `dryAllowedLength` | 2 | |
| `dryPenaltyLastN` | -1 | -1 = context size |

`json_protocol.cpp` generate handler parses each via `req.value(...)` with
shape validation in the existing `invalid_type` pattern
(`json_protocol.cpp:160`). When `repeatPenalty > 1.0`, the penalties sampler
is inserted in the upstream position (before DRY); otherwise it is omitted
entirely. The `done` event's `stats` gains an `appliedSampling` object — the
C++ side reports the values it actually parsed and used, so the rig (and the
#113 debug dump) can PROVE delivery end-to-end rather than echoing its own
input.

**TS** — `GrammarCapableSidecar.generateWithGrammar` req
(`desktop/src/main/sidecar/grammar-call.ts:430-438`) gains optional
`sampling?: SamplingParams`; `makeGrammarSidecar` forwards it into the
`generate` envelope; `callWithGrammar` / `LlmGenerator` thread it through.
`SamplingParams` lives next to the other shared model types.

**profiles.ts** — `ModelProfile` gains a model-level `sampling:
SamplingParams` block (per-family rows keep `temperature` only). Both
`llama-3.2-3b-q4-km` and `llama-3.2-1b-q4-km` get the aligned block
explicitly.

**Policy**: production TS always sends the full block (explicit
determinism, profile = single source of truth). The C++ defaults exist as a
safety net and serve the rig's minimal envelopes.

## 6. Post-decode additions (`desktop/src/shared/post-decode/pipeline.ts`)

**(a) Deterministic near-dup removal** over every array slot of every family
(qa_pairs, sections[].points, key_terms, ideas, quotable_lines, …):

- Normalize each item's comparison text: NFKC → lowercase ASCII → strip
  whitespace/punctuation.
- Drop exact duplicates; drop near-duplicates by char-trigram Jaccard
  ≥ 0.85 (keep first occurrence). Threshold tunable at plan stage; mirrors
  the merge-side deterministic-union convention (`domain.md (llm-merge)`).
- Runs BEFORE Zod parse, so `.min(N)` still gates: a note that dedup reduces
  below `.min(N)` enters the existing retry ladder — an all-loops note
  SHOULD retry rather than ship thin.
- Telemetry: `dedupDropped` per slot path on `GrammarAttempt`
  (`sanitizedSlots` precedent).

**(b) ts normalization**: if EVERY numeric `ts` in the note is ≤ 1.0 AND the
generation-call transcript span `durationSec > 1`, multiply each by
`durationSec`, round to integer, clamp to `[0, durationSec]`. Applied per
generation call against that call's span (chunked path: per-chunk span,
before merge offsetting). Plus ONE prompt-hint line in the v1 templates
stating ts = elapsed seconds (integer) — exact JA wording at plan stage; this
is a prompt change, so it lands with an eval fixture per `testing.md`.

**(c)** Layer 3 (#118 guard) unchanged.

## 7. Verification

**Rig extensions** (`desktop/scripts/note-quality-eval.ts`):

- Loop metric: per-slot near-dup rate + max repeat count, same normalization
  as 6(a).
- Sweep mode: accept a sampling-params JSON + label per run; echo the params
  the sidecar actually applied into the run output (delivery proof).

**Falsification matrix** (evidence byproduct; lands as
`docs/superpowers/decisions/2026-06-12-fabrication-culprit.md`):

| Run | Config | Expectation |
|---|---|---|
| R1 | aligned (new defaults) | grounded JA, low loop rate |
| R2 | aligned + repeatPenalty 1.1 / lastN 64 ONLY | if fabrication reproduces → penalty confirmed as culprit |
| R3 | full legacy (top_k 50, top_p 0.9, no min_p, penalty 1.1, no DRY) | reproduces production fabrication (sanity) |

Each × 3 seeds (7000/8000/9000) on the founder dump (transcript NEVER
committed — rig reads from `@lisna/desktop/sessions/` dumps).

**Attribution discipline** (review F2): R1 moves several knobs at once
(top_k/top_p/min_p/penalty/DRY). An R1 PASS clears the merge gate and
ships, but by itself attributes nothing. The penalty verdict comes ONLY
from R2-vs-R1; the grammar-mode/architecture verdict comes ONLY from the B
fallback if it fires. If R2 unexpectedly ALSO passes (fabrication not
reproduced), the decision doc records "penalty not reproduced as sole
cause; alignment empirically sufficient" rather than forcing attribution.

**Merge gate** (ALL must hold):

1. R1: groundingJa ≥ 0.9 AND jaRatio comfortably above the #118 mismatch
   threshold (the language guard must not fire) on 3/3 seeds.
2. Loop near-dup rate ≤ 10% per slot (post-pipeline it is 0 by
   construction; the metric gates the PRE-dedup generation so DRY is shown to
   work, not just the scrubber).
3. All `ts` integer seconds within `[0, durationSec]`.
4. tok/s within ±10% of the #111 baseline on the same dump.
5. `pnpm --filter @lisna/desktop verify` green (109 sidecar tests + TS
   suites) + new unit tests: C++ param parsing (sidecar `tests/`), TS dedup +
   ts-rescale + envelope plumbing (vitest).

**B fallback trigger (pre-approved)**: if R1 fails the grounding gate on ≥2/3
seeds WITH the params-echo proving delivery, the chain architecture itself is
implicated → the same plan switches to adopting `common_sampler` (link
llama.cpp `common` into the sidecar, map GenOpts → `common_params_sampling`).
Rig gate unchanged. No new design round-trip.

**Escalation control (only if B also fails)**: add R4 with fp16 KV cache to
rule the q8_0 KV difference in/out — the one remaining uncontrolled variable
(section 1 table). Not expected to fire.

**Release gate**: founder real recording on the installed build (v0.1.9) —
interview + lecture, quiet machine, per `v2_packaged_app_validation_gate`
release gates (entitlements / Finder-launch smoke / dylib load / TCC prompt).

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| DRY damps legitimate JA recurrence (はい, ね fillers) | allowed_length 2 + `"` breaker confine it to ≥3-token sequences within a slot; rig grounding gate catches over-damping |
| 1B token-runaway re-exposure with penalty off | section 4 note: DRY + maxTokens + retry + Layer 3; 1B non-default until adaptive spec |
| TS↔C++ param schema drift | C++ parse unit tests + TS envelope unit tests; params-echo in rig output proves end-to-end delivery |
| q8_0 KV is still a path difference vs CLI | accepted consciously; R4 escalation documents the control if A and B both fail |
| Latency regression from DRY/min_p | DRY adds an O(context) history-suffix scan per token (`dryPenaltyLastN=-1`, n_ctx 16K) — upstream warns such scans can get slow; NOT asserted negligible a priori. Gate 4 (G6 ±10% tok/s) measures the net effect | 
| Dedup drops legitimately similar items (two real qa pairs with near-identical wording) | Jaccard 0.85 is conservative; threshold is a plan-stage tunable with rig evidence |

## 9. Rollout

1. SDD execution off this spec via `writing-plans` (same session).
2. Sidecar rebuild via `lisna-sidecar-rebuild` skill (MD5-verified copy).
3. Desktop version bump per `artifact-version-bump` (→ 0.1.9).
4. Packaged-app release gates per `v2_packaged_app_validation_gate`.
5. Founder release-gate recording (section 7).

## 10. Out-of-scope register (forward pointers for the remaining agenda)

| Agenda item | Lands in |
|---|---|
| 2-partial: Q↔A binding quality | diarization design session (next) — binding is structurally guesswork without speaker turns |
| 3: diarization | own spec (next design session) |
| 4: adaptive 1B/RAM + multi-chunk re-tuning + Path G + 1B re-eval | own spec; absorbs PR #92 DRAFT questions |
| 5: far-field STT + maintenance-window stall robustness | own spec |

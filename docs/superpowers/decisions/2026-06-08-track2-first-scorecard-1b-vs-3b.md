# TRACK 2 first scorecard — 1B vs 3B (smoke-ja-mini, 2026-06-08)

First quality data point after TRACK 2 Phase 0 merge (#82/#83/#84) and the
locally-rebuilt sidecar (CI binary had `@rpath` → `/Users/runner/...` →
dyld fail). All eval state under `desktop/eval/baselines/`.

> **Correction (added later same day):** the original commit framed 3B's
> contract fail as "known HANDOFF P0b — `z.unknown()` bypasses `.min(3)`."
> That is **wrong**. P0a / P0b were both already fixed in
> [PR #73](https://github.com/May1350/Lisna/pull/73) (2026-05-30, see
> `docs/HANDOFF.md` line 161). `LectureNoteSchema.sections` only has
> `.max()`, no `.min(N)`. The failing rule is a contract-test
> mode-collapse heuristic, not a schema invariant — see §"What 3B's
> contract fail actually means" below. The P0b label was carried forward
> from stale memory; root cause owned by me.

## Sidecar rebuild — PASS

```
target           lisna_sidecar
md5 (build)      0ac1cdfd1e731ad768fbeee33463df87
md5 (resources)  0ac1cdfd1e731ad768fbeee33463df87
file             Mach-O 64-bit executable arm64
size / mtime     241,808 bytes / 2026-06-08 18:41
previous md5     78984c58cedd616066f2af7344ba312e (CI build, replaced)
build params     JOBS=1, Release, M3 8 GB (per `project_metal_cold_cache_first_run`)
submodule init   `desktop/sidecar/deps/whisper.cpp` (was uninitialized)
```

## Runs

```
LISNA_LLM_MODEL_DIR=~/.lisna-test-models \
pnpm --filter @lisna/desktop eval:notes \
  --family lecture --fixture smoke-ja-mini --no-llm-judge \
  --runner offline-{3b,1b} --baseline {3b,1b}-smoke-ja-mini
```

Fixture: 4-utterance JA lecture (40 s, plumbing-only, `scenarioTags=[smoke,plumbing]`,
`expectedSlots=[]`). Per fixture meta: "NOT part of the founder-owned scored eval set."

### 3B — Llama-3.2-3B-Instruct-Q4_K_M (modelId `llama-3.2-3b-q4-km`)

| metric | value |
|---|---|
| outcome | **schema-valid; contract heuristic fired (inappropriately for this fixture)** |
| schemaParse | PASS |
| contract overall | FAIL (1 error-severity rule, see analysis below) |
| failing rule | `lecture-sections-min-3` — got 2 sections, want ≥3 |
| passing rules | `sections-have-key-terms`, `from-transcript-ratio` (100 %), `slots-emerge` (N/A), `anti-parroting` (N/A) |
| retries | 1 / 1 chunk, mean 1.0 attempt |
| slots emerged | 0 (none expected) |
| runMs | 71,069 (one chunk, single grammar-constrained decode) |
| baseline | `desktop/eval/baselines/3b-smoke-ja-mini.json` (1,940 B) |

#### What 3B's contract fail actually means

`lecture-sections-min-3` is defined in `desktop/eval/contract/families/lecture.ts:10-17`
with the comment: *"encodes the v1-plateau insight: mode-collapse looks
like a 'valid but bland' note where each section has ≤1 key_term, all
key_terms are 'inferred', no formula slot fires."*

It's a **quality heuristic** detecting mode collapse — not a schema
constraint. `LectureNoteSchema.sections` is `z.array(...).max(MAX_SECTIONS)`,
no minimum. For a 40-second 4-utterance plumbing fixture, returning 2
sections is a faithful response, not mode collapse. The eval harness
fires this rule unconditionally on every fixture — there is currently no
fixture-scope mechanism to skip it on smoke / plumbing transcripts.

So: 3B produced schema-valid, content-faithful output. The contract
"FAIL" is a harness mismatch, not a model defect.

### 1B — Llama-3.2-1B-Instruct-Q4_K_M (modelId `llama-3.2-1b-q4-km`)

| metric | value |
|---|---|
| outcome | **CHUNK_FAILED — JSON truncation, exhausted retry budget** |
| schemaParse | (never reached) |
| error | `CHUNK_FAILED:0:Unterminated string in JSON at position 5769 (line 181 column 79)` |
| retries | all 3 inner `callWithGrammar` attempts produced unterminated JSON |
| wall time | ~414 s (3 × ~80 s + setup) before throw |
| baseline | none — runner threw, save skipped |

Pattern matches `.claude/rules/pitfalls.md (llm-grammar)`: a small
grammar-constrained instruct model fed JA prose can go out-of-distribution
and stop emitting EOS, so generation runs to `maxGenTokens` and the JSON
is truncated mid-string. ~5.6 KB / 181 lines of output per attempt before
the cut. **This is a genuine 1B model-quality finding**, not a harness
artifact.

## Headline (the first scorecard datapoint)

| dimension | 3B | 1B |
|---|---|---|
| produces parseable JSON on 40 s JA plumbing fixture | ✅ | ❌ |
| passes Zod schema | ✅ | n/a |
| schema-faithful output for the input length | ✅ (2 sections from 4 utterances) | n/a |
| passes the (currently fixture-blind) mode-collapse heuristic | ❌ (heuristic mis-fires here) | n/a |
| wall time (one chunk) | 71 s | ~414 s (failed) |
| retries | 1 of 3 | 3 of 3 (exhausted) |

**Headline:** on the smallest possible JA lecture fixture, **3B produces
schema-valid, content-faithful output**; the lone contract "FAIL" is the
mode-collapse heuristic mis-firing on a fixture too short for it. **1B
cannot produce parseable JSON in this configuration** — that is a real
model-quality finding. One fixture and one prompt variant → directional,
not conclusive.

## Caveats

1. **smoke fixture is plumbing-only** (founder-set will live in
   `docs/superpowers/specs/2026-06-08-v2-track2-quality-prioritization-design.md`
   §eval-set). A scored 1B-vs-3B verdict needs the founder JA set (Task 7
   onward in `plans/2026-06-08-v2-track2-phase-0.md`).
2. **`--no-llm-judge`** — no axis scores (correctness, structure-fit,
   completeness, etc.). Today's data is contract + retry + runMs only.
3. **Cold Metal cache**: 3B ran first → may have absorbed the
   per-rebuild shader-compile cost; 1B's wall-time is *not* directly
   comparable as a latency datapoint. Latency benchmarking is downstream
   of the 1B-vs-3B model decision (per the brainstorm: latency is
   downstream of model choice, not its own track).
4. **No P0b residue.** P0a / P0b labels in
   `v2_plan_cpp_grammar_gen_gate_fail_2026-05-30.md` describe
   pre-PR-#73 state; they should not be cited as current blockers. See
   the correction note at the top of this doc.

## Follow-ups (not done in this run)

1. **STT WER measurement** still gated on a JA clip + reference (plan
   Task 7) and a real far-field mic recording for the synthetic-proxy
   calibration. STT is the founder-stated #1 user-visible quality gate.
2. **1B grammar-truncation root-cause** — chat-template embedded into
   the prompt path? `maxGenTokens` budget for 1B vs 3B? Sampler
   parameters? If 1B can be made to emit EOS reliably under grammar, a
   1B-vs-3B comparison on a real scored fixture becomes possible. If not,
   drop 1B and run 3B-only. (Spec §4b "1B guardrails" already pre-commits
   to Path G — bounded `n_predict` + `.max(N)` — and a ≤2 prompt-v2
   iteration kill criterion.)
3. **Contract-rule fixture scope** — `lecture-sections-min-3` is a
   mode-collapse heuristic that mis-fires on smoke / plumbing fixtures.
   Either tag rules with `applicableTo: ['scored']` or tag fixtures with
   `exemptFromRules: [...]`. Low-cost harness improvement; defer until
   we have the founder set so the rule actually catches mode collapse
   where it matters.
4. **Cleanup ran**: `pkill -f resources/sidecar` after both runs
   confirmed no survivors (per `(spike-llm)` pitfall).

## Lessons (recorded for future sessions)

- Memory labels age fast. `P0a/P0b` in
  `v2_plan_cpp_grammar_gen_gate_fail_2026-05-30.md` were valid for ~24 h
  before PR #73 fixed them; the labels stayed in memory anyway. Before
  citing a memory label as a current blocker, grep HANDOFF + the file
  paths the memory references (per CLAUDE.md "Before recommending from
  memory").
- This doc's first revision claimed P0b caused the 3B contract fail. An
  independent opus pre-commit reviewer ran 14 verification commands and
  APPROVED the doc — none of those commands grepped HANDOFF or the
  lecture schema for `.min(`. Verification reviewers should re-check
  the "this label still describes a real blocker" claim before
  accepting it, when the doc relies on a label sourced from memory.

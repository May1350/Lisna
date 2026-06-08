# TRACK 2 first scorecard — 1B vs 3B (smoke-ja-mini, 2026-06-08)

First quality data point after TRACK 2 Phase 0 merge (#82/#83/#84) and the
locally-rebuilt sidecar (CI binary had `@rpath` → `/Users/runner/...` →
dyld fail). All eval state under `desktop/eval/baselines/`.

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
| outcome | **schema-valid; one quality rule failed** |
| schemaParse | PASS |
| contract overall | FAIL (1 error-severity rule) |
| failing rule | `lecture-sections-min-3` — got 2 sections, want ≥3 |
| passing rules | `sections-have-key-terms`, `from-transcript-ratio` (100 %), `slots-emerge` (N/A), `anti-parroting` (N/A) |
| retries | 1 / 1 chunk, mean 1.0 attempt |
| slots emerged | 0 (none expected) |
| runMs | 71,069 (one chunk, single grammar-constrained decode) |
| baseline | `desktop/eval/baselines/3b-smoke-ja-mini.json` (1,940 B) |

The `sections-min-3` fail is the **known HANDOFF P0b** — `chunked-note.ts`
calls `callWithGrammar` with `z.unknown()`, which bypasses the `.min(3)` Zod
constraint so the sampler is never asked to retry. Surface on this fixture
is expected; not a regression.

### 1B — Llama-3.2-1B-Instruct-Q4_K_M (modelId `llama-3.2-1b-q4-km`)

| metric | value |
|---|---|
| outcome | **CHUNK_FAILED — JSON truncation, exhausted retry budget** |
| schemaParse | (never reached) |
| error | `CHUNK_FAILED:0:Unterminated string in JSON at position 5769 (line 181 column 79)` |
| retries | all 3 inner `callWithGrammar` attempts produced unterminated JSON |
| wall time | ~414 s (3 × ~80 s + setup) before throw |
| baseline | none — runner threw, save skipped |

Pattern matches `pitfalls.md (llm-grammar)`: a small grammar-constrained
instruct model fed JA prose can go out-of-distribution and stop emitting
EOS, so generation runs to `maxGenTokens` and the JSON is truncated
mid-string. ~5.6 KB / 181 lines of output per attempt before the cut.

## Headline (the first scorecard datapoint)

| dimension | 3B | 1B |
|---|---|---|
| produces parseable JSON on 40 s JA plumbing fixture | ✅ | ❌ |
| passes Zod schema | ✅ | n/a |
| passes lecture quality contract | ❌ (sections.length=2<3, P0b) | n/a |
| wall time (one chunk) | 71 s | ~414 s (failed) |
| retries | 1 of 3 | 3 of 3 (exhausted) |

**Headline:** on the smallest possible JA lecture fixture, **1B cannot
clear schema gating**, while **3B clears schema** and is blocked only on
the Zod-min-N propagation P0b (independent of model choice). This is one
fixture and one prompt variant — directional, not conclusive.

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

## Follow-ups (not done in this run)

1. **STT WER measurement** still gated on a JA clip + reference (plan
   Task 7) and a real far-field mic recording for the synthetic-proxy
   calibration. STT is the founder-stated #1 user-visible quality gate.
2. **HANDOFF P0b** (Zod `.min(N)` propagation through `z.unknown()`):
   needs a separate spike before the founder-set runs are meaningful.
   Otherwise both models will fail `sections-min-3` on short fixtures
   regardless of true model quality.
3. **1B grammar-truncation root-cause** — chat-template wiring,
   `maxGenTokens` budget, sampler params for 1B. If 1B can be made to
   emit EOS reliably under grammar, a 1B-vs-3B comparison on a real
   scored fixture becomes possible. If not, drop 1B and run 3B-only.
4. **Cleanup ran**: `pkill -f resources/sidecar` after both runs
   confirmed no survivors (per `(spike-llm)` pitfall).

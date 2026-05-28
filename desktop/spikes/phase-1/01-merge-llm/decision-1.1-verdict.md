# Spike 1.1 verdict — merge-LLM call on 2-chunk Interview fixture (2026-05-28)

## Status: **BLOCKED — merge untested** (NOT PASS/MIXED/FAIL)

The merge-LLM call **never executed**: per-chunk extraction failed before the
merge stage could run, and the 8 GB machine could not sustain a clean re-run.
The 6 acceptance criteria are therefore **inconclusive** (they score the merged
note, which does not exist). This is a real spike outcome — the spike surfaced
two production blockers that must be fixed *before* the merge question can be
answered.

Do **NOT** route to Plan 6 Task 7 (productionize) or Task 8 (deterministic
fallback) yet — neither is justified without merge data. Route = **fix
preconditions, then re-run** (see Next step).

## Hardware / Build / Setup

- **Date:** 2026-05-28
- **Branch:** `feat/v2-interview-brainstorm`
- **Fixture:** `fixture-2chunk-interview.json` (2 chunks, synthetic JA interview)
- **Model:** Llama-3.2-3B-Instruct-Q4_K_M (`~/.lisna-test-models/...gguf`, 2.0 GB)
- **Binary:** `desktop/sidecar/deps/llama.cpp/build-spike/bin/llama-completion` (main checkout; gitignored, absent from worktree → `SPIKE_LLAMA_BIN`)
- **Hardware:** M3 / 8 GB. Free RAM observed swinging 514 → 1079 → 83 MB during the session; ~2.4 GB persistently compressed.
- **Knobs:** `temp=0.4`, `n_predict=4096`, seeds 3000(+50 merge). Per-seed foreground process; 5 s cooldown between calls; `ps`+`kill -9` reap between runs. Raw prompt (no GGUF chat template — conservative lower bound).
- **Runs executed:** seed 3000 only (canary). Seeds 3001/3002 NOT run (RAM-gated). A grammar-patched re-canary aborted pre-launch (free RAM 83 MB < 350 MB guard).

## What ran (seed 3000 canary, UNPATCHED grammar)

| Phase | Result | Latency | Attempts | Detail |
|---|---|---|---|---|
| Chunk 0 | **PASS** | 37.9 s | 1 | Valid InterviewNote: 4 qa_pairs, 2 themes, 1 quotable_line, 2 key_takeaways. Hydrate→`InterviewNoteSchema.parse` OK. |
| Chunk 1 | **FAIL** | 386.4 s | 3/3 | `Bad control character in string literal in JSON at position 6672 (line 112 column 4394)` on all 3 fresh seeds. |
| Merge | **SKIPPED** | — | — | One chunk failed → merge not attempted. |

Takeaways: (a) 3B CAN produce a valid grammar-constrained InterviewNote chunk
(chunk 0). (b) On longer output it emits a raw control char inside a JSON string
→ invalid JSON, deterministically (3/3). (c) Latency on this 8 GB machine is
load-dependent and severe under pressure (chunk 1 thrashed at ~128 s/attempt vs
chunk 0's 38 s) — but note the per-call cold-load caveat (see README): the spike
reloads the model each call, so these numbers overstate production latency.

## FINDINGS (both production-blocking, both empirically confirmed)

### F1 — GBNF `char` rule permits raw control characters (ALL families)

`desktop/src/shared/note-schema/zod-to-gbnf.ts` `scalarRules()` emits
`char ::= [^"\\] | "\\" ["\\/bfnrt]`. `[^"\\]` includes 0x00–0x1F, so the
grammar **allows** an unescaped control char inside a JSON string; strict
`JSON.parse` then rejects the output. This is NOT interview-specific — the same
converter drives lecture / meeting / brainstorm, so production note generation
has a latent intermittent invalid-JSON failure on longer chunks.

- **Evidence:** seed 3000 chunk 1, 3/3 "bad control character in string literal".
- **Fix (applied spike-locally, verified-valid, empirically UNRUN):** post-process
  the grammar to the official llama.cpp `json.gbnf` char class
  `[^"\\\x7F\x00-\x1F] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F]{4})` (see
  `run-merge-spike.ts`). Grammar regenerated 6215 → 6284 B; `char` line confirmed
  rewritten.
- **Production action:** amend `scalarRules()` in `zod-to-gbnf.ts` + add a
  regression test (a schema whose string field, under the old rule, admits a raw
  newline). **Plan 2 amendment; ai-infra lane.** Prerequisite for the merge
  re-run AND for production note reliability generally.

### F2 — `runPostDecodePipeline` cannot fill `qa_pairs[].from` (Interview)

`post-decode/pipeline.ts` Stage 3 fills `from` only on leaves with
`text`/`term`/`expression`. `InterviewNoteSchema.qa_pairs[]` use
`question`/`answer` (no such key) yet **require** `from` → stock pipeline throws
`qa_pairs.0.from:invalid_type` → cannot produce a valid InterviewNote.

- **Evidence:** confirmed via no-LLM probe this session (stock pipeline threw;
  spike-local Interview-aware hydrator parsed clean).
- **Production action:** **Plan 6 Task 13** must extend the production provenance
  fill (add a `question`/`answer` discriminator, or a family-specific
  `inferProvenance` hook) before wiring `finalizeInterview`. The spike's local
  hydrator is the reference behavior.

## Per-criterion verdict

| Run | C1 Zod | C2 cross-chunk theme | C3 qa dedup | C4 ts order | C5 no fabrication | C6 latency | passCount |
|---|---|---|---|---|---|---|---|
| 3000 | — | — | — | — | — | — | n/a (merge never ran) |
| 3001 | not run | | | | | | |
| 3002 | not run | | | | | | |

## Next step (route)

The merge-LLM PASS/MIXED/FAIL decision is **deferred**, gated on:

1. **F1 grammar fix** lands (spike already carries a verified patch; production
   fix is a Plan 2 amendment). Without it ~half the chunks fail extraction.
2. **A stable RAM window** — an 8 GB machine under normal app load cannot host a
   2 GB-model 3B run reliably (free RAM collapsed to 83 MB mid-session). Need most
   apps closed / a clean-boot window with free RAM comfortably > ~1.5 GB for the
   ~6–7 min, 3-seed run.

Then re-run (the harness is ready — grammar patch in place):

```bash
BIN=/Users/guntak/Lisna/desktop/sidecar/deps/llama.cpp/build-spike/bin/llama-completion
MODEL=/Users/guntak/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf
for SEED in 3000 3001 3002; do
  SPIKE_SEED=$SEED SPIKE_LLAMA_BIN="$BIN" SPIKE_LLM_MODEL_PATH="$MODEL" \
    pnpm --filter @lisna/desktop exec tsx spikes/phase-1/01-merge-llm/run-merge-spike.ts
  ps -ef | grep llama-completion | grep -v grep | awk '{print $2}' | xargs -r kill -9
  sleep 8
done
pnpm --filter @lisna/desktop exec tsx spikes/phase-1/01-merge-llm/score-merge-spike.ts
```

Then fill the tables above from `results/scorecard.json`, set the real verdict,
and route: PASS/MIXED → Task 7; FAIL → Task 8.

## Cleanup verification

```
$ ps -ef | grep -E "llama-completion|tsx" | grep -v grep || echo "(clean)"
(clean — no survivors; verified after the canary)
```

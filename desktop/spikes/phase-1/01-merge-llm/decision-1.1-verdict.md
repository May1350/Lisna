# Spike 1.1 verdict — merge-LLM call on 2-chunk Interview fixture (2026-05-29)

## Status: **MIXED**

The merge-LLM call runs end-to-end on all 3 seeds and produces schema-valid,
non-fabricated, temporally-ordered InterviewNotes with cross-chunk theme dedup.
It is **MIXED**, not PASS, on one real axis: the LLM merge does **not reliably
union all `qa_pairs`** — worst case (seed 3002) it dropped an entire chunk's
four turns.

**Route: MIXED → Plan 6 Task 7 (productionize)**, carrying one must-fix
(qa_pair union completeness) + the F2 provenance prerequisite (Task 13).

> This supersedes the 2026-05-28 **BLOCKED** verdict. That verdict and its two
> "production-blocking" findings were caused by **two test-harness defects**, not
> by the model or grammar — see "Diagnosis correction" below.

## Hardware / Build / Setup

- **Date:** 2026-05-29
- **Branch:** `feat/v2-interview-brainstorm`
- **Fixture:** `fixture-2chunk-interview.json` (2 chunks, synthetic JA interview; chunk0 = 4 qa_pairs, chunk1 = 4 qa_pairs)
- **Model:** Llama-3.2-3B-Instruct-Q4_K_M (`~/.lisna-test-models/...gguf`, 2.0 GB)
- **Binary:** `desktop/sidecar/deps/llama.cpp/build-spike/bin/llama-completion` (newer llama.cpp build — has `--jinja`/`--chat-template llama3`; main checkout, gitignored → `SPIKE_LLAMA_BIN`)
- **Prompt mode:** **chat-templated via `--jinja`** — the model's embedded Llama-3.2 template (systemTemplate → `-sys`, userPrompt → `-p`), mirroring the production sidecar. (Changed 2026-05-29 from raw-prompt; see Diagnosis correction.)
- **Knobs:** `temp=0.4`, `n_predict=4096`, seeds 3000 / 3001 / 3002 (+50 merge offset), `maxAttempts=3` fresh-seed retry. Per-seed foreground process; `ps`+`kill -9` reap + 5 s cooldown between calls.
- **Machine:** M3 / 8 GB, quiet (no 2 GB+ contender). Per-seed wall-clock 137–277 s; no survivors after any run.

## Results (3 seeds, templated)

| Seed | Chunk 0 | Chunk 1 | Merge | Total | qa union (c0+c1 → merged) |
|---|---|---|---|---|---|
| 3000 | PASS (34 s, 1 att) | PASS (47 s, 1 att) | PASS (79 s, 1 att) | 170 s | 4 + 4 → **8** (perfect) |
| 3001 | PASS (38 s, 1 att) | PASS (28 s, 1 att) | PASS (60 s, 1 att) | 137 s | 4 + 4 → 7 (−1) |
| 3002 | PASS (35 s, 1 att) | PASS (183 s, **2 att**) | PASS (49 s, 1 att) | 277 s | 4 + 4 → **4** (chunk-1 turns dropped) |

All chunks and all merges produced schema-valid InterviewNotes. Seed 3002's
chunk-1 needed one retry; the fresh-seed retry contract recovered it on attempt 2.

## Per-criterion verdict (from `results/scorecard.json`)

| Run | C1 Zod | C2 cross-chunk theme | C3 qa union | C4 ts order | C5 no fabrication | C6 latency ≤12 s | passCount |
|---|---|---|---|---|---|---|---|
| 3000 | pass | pass | pass (8/8) | pass | pass | FAIL (79 s) | 5/6 |
| 3001 | pass | pass | FAIL (7/8) | pass | pass | FAIL (60 s) | 4/6 |
| 3002 | pass | pass | FAIL (4/8) | pass | pass | FAIL (49 s) | 4/6 |

Scorer verdict: **MIXED** (0 clean / 3 acceptable / 0 failed).

### Reading the criteria
- **C6 (latency ≤ 12 s) — discount; spike artifact.** Each LLM call cold-loads
  the 2 GB model (~30–40 s) because the spike spawns a fresh `llama-completion`
  per call (harness deviation #3). Production amortizes **one** load across
  chunk0 + chunk1 + merge, so the production-relevant number is merge
  *generation* time, not load. C6's 12 s budget cannot be met by a
  cold-load-per-call spike and does **not** indicate a production latency fail.
- **C3 (qa union completeness) — the real MIXED driver.** The LLM merge does not
  reliably carry every `qa_pair`: 8/8 (3000), 7/8 (3001), **4/8 (3002 — dropped
  chunk-1's four turns entirely, returned only chunk-0's)**. Worst case loses
  half the interview.
- **C1 / C2 / C4 / C5 — solid (3/3 each).** Valid JSON, cross-chunk theme dedup
  (not concatenation), temporal ordering preserved, zero fabrication.

## Diagnosis correction (supersedes the 2026-05-28 BLOCKED memo)

The prior BLOCKED verdict was driven by two **test-harness defects**, not by the
model or the grammar:

1. **H6 — rig UTF-8 chunk-split decode bug (NEW; FIXED, committed `73fb679`).**
   `llama-cli-rig.ts` decoded each stdout `data` chunk with `d.toString()`,
   splitting multi-byte UTF-8 at chunk boundaries → U+FFFD (`決断` → `��断`; 8×
   in one chunk-0 alone). This corrupted every Japanese measurement. Fix: collect
   raw Buffers, decode once via `Buffer.concat`; fail-first regression test added
   (`llama-cli-rig.test.ts`). Verified on real output: chunk-0 U+FFFD 8 → 0.

2. **Truncation from the missing chat template (root cause of the chunk-1
   "failures").** The spike sent raw prompts with no template, pushing the
   instruct model out-of-distribution: it failed to emit `<|eot_id|>` and ran on
   inside a string value until `maxTokens` truncated the JSON mid-string. The
   "Bad control character in string literal at position N" was the
   `> EOF by user` epilogue newline landing in the still-open string — **not** a
   model-emitted mid-string control char. Fix: apply the model's embedded
   template via `--jinja`. With templating, chunk-1 passes in 1 attempt (2/3
   seeds) and the merge runs. The rig now also strips the epilogue before parse
   so a truncated body reports the honest "Unexpected end of JSON input."

### Effect on the prior findings
- **F1 (GBNF `char` rule permits raw control chars) — RE-CLASSIFIED: "blocking,
  confirmed" → "low-priority hardening."** Its cited evidence (chunk-1 3/3 "bad
  control character") was actually truncation (#2 above), not a grammar gap. No
  observed failure is attributable to the old `char ::= [^"\\]` rule. The
  control-char-excluding char class is reasonable defense-in-depth (kept in the
  spike), but the **spawn_task'd Plan-2 grammar amendment should be re-scoped to
  defensive hardening + regression test — do NOT gate anything on it** and do not
  present it as an active invalid-JSON P0.
- **F2 (`runPostDecodePipeline` cannot fill `qa_pairs[].from`) — STILL VALID
  (Plan 6 Task 13).** Re-confirmed: Stage-3 fills `from` only on
  text/term/expression leaves; InterviewNote `qa_pairs[]` use question/answer and
  require `from`. The spike uses a local Interview-aware hydrator as the reference
  behavior. Task 13 must extend the production provenance fill (question/answer
  discriminator or a family `inferProvenance` hook) before wiring
  `finalizeInterview`.

## Findings for Task 7 (productionize)

1. **qa_pair union reliability — MUST FIX (the MIXED driver).** The pure-LLM
   merge drops `qa_pairs` (worst case a full chunk's worth). `qa_pairs` are
   structured turns carrying `ts` / `asked_by` / `answered_by`. Recommend a
   **deterministic union** of `qa_pairs` across chunk partials (dedup by `ts` +
   question trigram), leaving the LLM to synthesize only the derived fields
   (themes, key_takeaways, subject_summary, quotable_lines). At minimum, add a
   post-merge completeness check that re-injects missing turns. A 3B model cannot
   be trusted to union turns losslessly.
2. **`participants` dropped on merge** (seed 3000): chunk-0 carried a participants
   roster; the merged note returned `participants: null`. Carry the structured
   roster deterministically too.
3. **Provenance fill (F2)** is a Task-13 prerequisite before `finalizeInterview`.
4. Otherwise quality is good: no fabrication, themes deduped across chunks,
   temporal order preserved, valid JSON every run.

## Reproduce

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

## Cleanup verification

```
$ ps -ef | grep -E "llama-completion|tsx" | grep -v grep || echo "(clean)"
(clean — no survivors; verified after each seed and the 3001/3002 loop)
```

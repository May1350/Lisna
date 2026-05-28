# Spike 1.1 — Merge-LLM call on 2-chunk Interview fixture

Per Plan 6 Phase B (Tasks 5-6) + spec §5.2b (Merge contract). The merge-LLM
call is the highest single quality risk in the v2 stack because:

1. 3B's behavior on structured JSON INPUT is empirically unmeasured. Pre-
   training distribution does not include "merge two partial JSONs into one"
   tasks at scale.
2. Path F (2026-05-27) showed 1B fails Lecture quality (slot emergence 0/3,
   placeholder filler). The merge call adds another off-distribution layer.

The spike runs the REAL landed `interview-v1` prompt
(`systemTemplate` / `chunkUserTemplate` / `mergeUserTemplate`) and mirrors
`orchestrator.ts::finalizeMeeting` so the verdict reflects the production path.

## Acceptance criteria

Run N=3 (seeds 3000 / 3001 / 3002). Per merged InterviewNote:

1. **C1 Zod validates** — `InterviewNoteSchema.parse()` succeeds on the merged output.
2. **C2 cross-chunk theme coverage** — ≥ 1 merged theme that originated in BOTH chunks (deduped across chunks, not concatenated).
3. **C3 no qa_pair duplication** — distinct merged question count ≈ distinct count across both chunks (trigram Jaccard > 0.7 dedup; merged ≤ distinct + 1).
4. **C4 temporal ordering** — merged `qa_pairs[i].ts <= qa_pairs[i+1].ts`.
5. **C5 no fabrication** — every merged theme / quotable_line / key_takeaway traces (trigram Jaccard > 0.4) to ≥ 1 chunk partial. 0 hallucinated entries.
6. **C6 latency** — merge call wall time ≤ 12 s. **CAVEAT:** the spike reloads
   the model per call (fresh subprocess), so this number INCLUDES cold model
   load; production amortizes one load across chunks+merge. A C6 fail in the
   spike does NOT by itself mean production fails C6.

Verdict: **PASS** if all 3 runs hit 6/6, OR ≥ 2/3 runs hit 6/6.
**MIXED** if ≥ 2/3 runs hit ≥ 4/6 (but not PASS). **FAIL** otherwise.

## Decision tree

- **PASS** → Plan 6 Task 7 (productionize merge-LLM call; orchestrator wires
  `finalizeInterview` / `finalizeBrainstorm` per spec §5.2b).
- **MIXED** → founder gate. Default: Task 7 + `validation_warnings` plumbing so
  degenerate merges surface a "merge quality below threshold" caveat; tighten
  the merge prompt (few-shot); optionally re-run at N=5 (data, not verdict).
- **FAIL** → Plan 6 Task 8 (deterministic fallback: interview themes
  `concat-dedup`, brainstorm idea_clusters `concat-only`; UI degradation
  banner) + spec amendment 2.

## How to run (hardware-safe — `pitfalls.md (spike-llm)`)

8 GB M3. ONE seed per process, foreground, cooldown between seeds. NEVER
`run_in_background`. Pre/post `ps -ef | grep llama-completion` cleanup.

`build-spike/bin/llama-completion` is a gitignored build artifact that lives in
the MAIN checkout, NOT this worktree — pass its absolute path via
`SPIKE_LLAMA_BIN`.

```bash
# from the worktree root
BIN=/Users/guntak/Lisna/desktop/sidecar/deps/llama.cpp/build-spike/bin/llama-completion
MODEL=/Users/guntak/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf

ps -ef | grep -E "llama-completion|vitest.*spike" | grep -v grep || echo "(clean)"   # pre-check
for SEED in 3000 3001 3002; do
  SPIKE_SEED=$SEED SPIKE_LLAMA_BIN="$BIN" SPIKE_LLM_MODEL_PATH="$MODEL" \
    pnpm --filter @lisna/desktop exec tsx desktop/spikes/phase-1/01-merge-llm/run-merge-spike.ts
  ps -ef | grep llama-completion | grep -v grep | awk '{print $2}' | xargs -r kill -9   # reap survivors
  sleep 8
done
ps -ef | grep -E "llama-completion|tsx" | grep -v grep || echo "(clean)"               # post-check

# score
pnpm --filter @lisna/desktop exec tsx desktop/spikes/phase-1/01-merge-llm/score-merge-spike.ts
```

Expected wall time: ~3-6 min total (each seed = 3 LLM calls × up to 3 attempts,
each with a cold model load on 8 GB). If a single seed exceeds ~5 min, Ctrl-C,
reap survivors, surface to controller.

## Deviations from production (load-bearing for the verdict)

1. **Provenance hydration (FINDING).** Stock `runPostDecodePipeline` Stage-3
   fills `from` only on leaves with `text` / `term` / `expression`.
   `InterviewNoteSchema.qa_pairs[]` use `question` / `answer` yet REQUIRE `from`
   — so the stock pipeline cannot produce a valid InterviewNote. The runner
   uses a local Interview-aware hydrator to isolate MODEL merge quality from
   this pipeline gap. **Task 13 must extend the production provenance fill (add
   a qa_pairs discriminator or a family-specific hook) before wiring
   `finalizeInterview`.**
2. **Raw prompt.** `runLlamaCli` sends `systemTemplate\n\nuserPrompt` raw via
   `-p` (no GGUF chat template). Production applies the Llama-3.2 template in the
   sidecar. The spike is a conservative LOWER BOUND on quality.
3. **Path G not landed.** `zodToGbnf` emits unbounded arrays (no `.max(N)`);
   Zod enforces the bounds at parse (same as production lecture/meeting today).
   Harmless on this tiny fixture.

## Files

- `fixture-2chunk-interview.json` — synthetic 60-min JA interview, 2 chunks. One
  question repeated across chunks (C3 signal); one near-paraphrase quotable line
  (C5/dedup signal); chunk-1 opener references chunk-0 (cross-chunk follow-up).
- `run-merge-spike.ts` — per-seed runner (chunk0 → chunk1 → merge).
- `score-merge-spike.ts` — 6-criterion scorer → `results/scorecard.json`.
- `results/seed-<N>/` — per-run JSON outputs.
- `decision-1.1-verdict.md` — verdict memo (Task 6).

# Qwen3-4B-Instruct-2507 promotion — design

**Date:** 2026-07-10
**Branch:** `feat/v2-note-quality-step2` (worktree `.claude/worktrees/nq-step2`, from `c6c79c5`)
**Supersedes decision in:** `memory/v2_note_quality_step2_2026models_runbook.md` §PHASE 2-PROMOTE (variant OPEN DECISION now resolved)
**Founder decision (2026-07-10):** promote Qwen3, ship the **Instruct-2507** variant, **validate before shipping**.

---

## 1. Context

STEP-2 Phase 1 (measure) is done. On the gold fixture `meeting/q3-allhands-noisy-ja`:

| model | coverage | faithfulness | verdict |
|---|---|---|---|
| Llama-3.2-3B (current default) | 7/8 | PASS | echoes fragments — the "3B reorganization ceiling" |
| **base Qwen3-4B** | 7/8 | PASS | **synthesizes** topics + aggregates decisions — breaks the ceiling; 2 narrow JA defects |
| Gemma3-4B | — | — | >10min timeout, 0 output — non-viable on 8GB |

Qwen3 is a real step up on the crux surface (`discussions[].key_points` synthesis) at equal coverage, faster, zero-retry. Founder's north star: **"무료로 퀄리티 좋은 노트"** — a free, high-quality note. This spec promotes Qwen3 to the production default LLM.

## 2. Variant decision — Instruct-2507 (not base)

The open question was which Qwen3 GGUF ships:

- **(A) base `Qwen3-4B`** — the hybrid thinking/non-thinking model. What Phase 1 validated.
- **(B) `Qwen3-4B-Instruct-2507`** — Qwen's dedicated **non-thinking** model. **CHOSEN.**

Rationale:

1. **The "GBNF pollution" fear the runbook raised for (A) is structurally moot.** The note pipeline constrains every generate call with a GBNF grammar rooted at a JSON object (`main/sidecar/orchestrator.ts` passes `grammar: opts.grammar` to the sidecar; `meeting-extract.ts` passes `extractGrammar`). The generated tokens are forced to JSON from token 0 — a `<think>` block can never appear in the decoded output regardless of variant. Phase 1 empirically confirmed base Qwen3 yields clean JSON under this constraint. So thinking-mode was never a *pollution* risk; at most it amputates the model's reasoning budget, which Phase 1 showed is not fatal.
2. **2507 is strictly the better model, not merely "safer."** Qwen *split* the original hybrid Qwen3-4B into dedicated `Instruct-2507` / `Thinking-2507` releases specifically because the combined model underperformed the dedicated ones. 2507-Instruct reports gains in instruction-following, comprehension, multilingual long-tail knowledge, and open-ended alignment — all directly relevant to JA note synthesis. It also **never emits `<think>` by construction**, so the residual variance concern for (A) disappears without a `/no_think` prompt hack.
3. **Same constraints as base.** Apache-2.0 (preserves the commercial-OK reason Qwen3 beat Qwen2.5-3B), same Qwen3 architecture → runs on the current sidecar (llama.cpp with `LLM_ARCH_QWEN3`) with **no C++ rebuild**, same 8GB profile (n_ctx 16384).
4. **Near-zero extra cost.** A reboot-gated expanded-eval run is required before shipping *either* variant anyway (7/8 on one fixture could be a fluke — runbook verification step). Choosing 2507 adds only a ~2.5 GB download; the eval run we must do regardless simply targets 2507 instead of re-confirming base.

**GGUF source:** no official `Qwen/Qwen3-4B-Instruct-2507-GGUF` exists (HF returns 401; only the safetensors repo is published). Source = **`unsloth/Qwen3-4B-Instruct-2507-GGUF`**, file `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` (~2.5 GB, Apache-2.0, verified reachable). unsloth is the de-facto community GGUF distributor.

## 3. Shape — two phases with a hard gate

The founder chose "validate then ship," so the user-facing default is **never** swapped onto an unvalidated model. Phase 1 is a gate; Phase 2 only runs if the gate passes.

### Phase 1 — Validation gate  *(reboot-gated, interactive; run by the controller, NOT an SDD subagent)*

Hardware rule (`memory` spike-llm): 8 GB M3 — one model foreground, `pkill -9 -f llama-completion` between runs, reboot if swap > 1.5 GB. `run_in_background:true` is FORBIDDEN for LLM inference (vitest/electron re-forks stack processes).

1. **Download** `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` from unsloth → `~/.lisna-test-models/`. Verify complete (no `.part`, size ≈ 2.5 GB).
2. **Wire an eval-only profile + runner** (mirrors the existing base-Qwen3 wiring):
   - `desktop/src/shared/models/profiles.ts` — add `qwen3-4b-2507-q4-km` (copy `qwen3-4b-q4-km`, change `id`/`displayName`/`filename` → `Qwen3-4B-Instruct-2507-Q4_K_M.gguf`; keep `chatTemplate: 'auto'`, `contextWindow: 16384`, `sampling: ALIGNED_SAMPLING`, `ramBudgetMB: 3300`, the same `perFamily` block).
     - ⚠️ **naming trap:** the existing `qwen3-4b-q4-km` profile's `filename` is `Qwen3-4B-Instruct-Q4_K_M.gguf`, but that file is the **base hybrid** model (renamed on download from upstream `Qwen3-4B-Q4_K_M.gguf`). The 2507 file has a *distinct* name (`…-2507-…`), so both coexist without collision. Do not point the existing profile at 2507.
   - `desktop/scripts/eval-notes.ts` — add `'offline-qwen3-2507'` to the `runnerId` union (line ~16) and `'offline-qwen3-2507': 'qwen3-4b-2507-q4-km'` to `OFFLINE_MODEL_ID` (line ~42).
   - `pnpm --filter @lisna/desktop exec tsc --noEmit` to confirm types.
   - Keep the base `qwen3-4b-q4-km` and `gemma3-4b-q4-km` profiles for now — the eval is a clean 3-way (3B baseline vs base-Qwen3 vs 2507).
3. **Reboot** (clear swap), then run the eval, one model FG, `--no-llm-judge` (deterministic scores) unless a Groq key is available:
   - `meeting/q3-allhands-noisy-ja` (gold) first.
   - Then the full meeting suite (drop `--fixture`) + `--family lecture` / `interview` / `brainstorm`.
   - `export LISNA_LLM_MODEL_DIR="$HOME/.lisna-test-models"` before each run; `pkill -9 -f llama-completion; sysctl vm.swapusage` after each.
4. **Read the `note.json` outputs** (dumped under the eval tmp dir) and record three findings:
   - **(a) Synthesis + coverage:** 2507 ≥ base-Qwen3 on `discussions[].key_points` abstraction (not echoing raw fragments), coverage ≥ 7/8 on q3 gold, **no number-trap regression** (e.g. 4,200 vs 4,400 must stay correct).
   - **(b) zh-simplified-char bleed:** count occurrences of simplified Chinese glyphs (适 應 对 应 …) in JA output. **This determines whether Phase 2 builds the CJK-normalize pass.**
   - **(c) year-hallucination:** does the fabricated-year defect (base emitted "2023年" with no year in transcript) recur?
5. **GATE:** proceed to Phase 2 **iff** 2507 ≥ base on synthesis, coverage ≥ 7/8, faithfulness clean (no fabrication / language-flip, `exit 0`). Otherwise **STOP and report** — do not touch the production default.

**Recorded output of Phase 1:** append the 3-way table + findings (a)/(b)/(c) to the runbook memory so Phase 2 and future sessions have the evidence.

### Phase 2 — Production promotion  *(SDD; only if the gate passes)*

Exact production surface (mapped from the runbook + verified against the tree):

1. **`desktop/src/shared/models/catalog.ts`** — swap `DEFAULT_LLM_MODEL`:
   - `filename: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf'`
   - `sizeBytes:` **measured** from the downloaded file (`stat -f%z`)
   - `sha256:` **measured** (`shasum -a 256`) — never guessed
   - `source.url: 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf'`
2. **`desktop/src/shared/models/profiles.ts`** — promote `qwen3-4b-2507-q4-km` (reword the "eval-only / dev-only" comment to production); **delete** the losing eval profiles `qwen3-4b-q4-km` and `gemma3-4b-q4-km` (dead code — git remembers; base Qwen3 and Gemma3 lost the eval). Remove the corresponding `offline-qwen3` / `offline-gemma3` runner entries from `eval-notes.ts` in the same commit (keep `offline-qwen3-2507`).
   - Profile selection in production is **filename-match** (`session-finalize.ts` `Object.values(modelProfiles).find(p => p.filename === basename)`), so once the 2507 file is on disk under its filename, the promoted profile is auto-selected. No selection-logic change needed.
3. **CJK-normalize post-pass — CONDITIONAL on Phase-1 finding (b).**
   - **If bleed present:** add one deterministic stage to `runPostDecodePipeline` (`desktop/src/shared/post-decode/pipeline.ts`), alongside the existing escape-literal sanitize, that walks user-visible string leaves (mirroring `fillProvenanceRecursive`'s recursive walk) and applies a **bounded** zh→JA shinjitai map (适→適, 應→応, 对→対, 应→応, …; only the glyphs actually observed in the eval, not an open-ended table). Unit test with a fixture string containing each mapped glyph. Runs on the validated note object, so it only touches structurally-valid output.
   - **If no bleed:** skip it entirely (YAGNI). Note the decision in the PR.
4. **Downloader / onboarding** (`model-detect.ts`, onboarding screen):
   - Verify the downloader/onboarding picks up the new `catalog.ts` entry (it reads `DEFAULT_LLM_MODEL`).
   - Verify `model-detect`'s sha256-vs-catalog comparison uses the **new** hash.
   - **Recompute the onboarding size string** — it was ~2.6 GB when Gemma was a candidate; now it's the single 2507 model (~2.5 GB) + STT (~574 MB). Compute from the catalog, don't eyeball.
5. **Tests:** `grep -rn "DEFAULT_LLM_MODEL\|llama-3.2-3b-q4-km\|6c1a2b41" desktop` — fix only the tests that assert the **default** is 3B (filename / hash / modelId). Tests that hardcode `modelProfiles['llama-3.2-3b-q4-km']` for non-default reasons stay valid **only if** that profile still exists — but per (2) we keep the 3B profiles (they're not the eval losers), so those tests are unaffected. Confirm which profiles each failing test needs before editing.
6. **Version bump** (`artifact-version-bump` skill — user-distributed app): bump `desktop/package.json` `version` by one patch **from whatever the branch's merge-base version is at promotion time** — do NOT hardcode. This worktree currently reads 0.1.39 (branched before the connector 0.1.40 work, which is on a separate unmerged branch); the real base version depends on merge order. Read the current value and bump `+0.0.1`.
7. **Verify (controller, before push):** local rebuild + install to `/Applications/Lisna.app`, boot smoke, then finalize a **real recording** and confirm the note ran on 2507 (check the finalize log's resolved model filename). This is the founder-facing acceptance criterion.

## 4. Non-goals

- **Year-hallucination guard.** MONITOR across the expanded eval; do NOT build a deterministic guard. A guard cannot distinguish a fabricated year from a correctly-computed relative date (来年 → 2026), so it is brittle and risks corrupting correct output (cf. the PR #88 sanitizer LaTeX false-positive pitfall). If it recurs materially, flag to founder as a separate prompt-engineering item.
- **`/no_think` prompt injection.** Moot — 2507 is non-thinking by construction, and GBNF already forbids think tokens in output.
- **Sampler / chunk-budget retuning.** 2507 inherits `ALIGNED_SAMPLING` + the 3B's per-family chunk budgets unchanged. Retuning is out of scope unless the eval surfaces a specific regression.
- **Gemma3.** Disqualified on 8 GB (Phase 1 timeout). Removed, not parked.
- **Phase 2 of STEP-2 (Claude distillation / LoRA).** Separate multi-week project; unaffected by this spec.

## 5. Risks

| Risk | Mitigation |
|---|---|
| 2507 regresses vs base on a family beyond q3 | The Phase-1 gate runs the full meeting suite + all four families before any production change. Gate STOP = no ship. |
| zh-char bleed reaches JA users | Phase-1 finding (b) → conditional deterministic CJK-normalize pass with a bounded, eval-observed glyph map. |
| Version collision with the unmerged connector 0.1.40 branch | Bump from the live merge-base version at promotion time, not a hardcoded number. |
| First cold `generate()` after a new-model install times out (~60 s) | Known Metal cold-cache behavior (`project_metal_cold_cache_first_run`); warm once before the acceptance recording. |
| sha256 drift (unsloth re-quantizes) | Measure the hash from the exact downloaded file at promotion; `model-detect` verifies download integrity against it. |

## 6. Verification summary

- **Phase 1 gate:** deterministic eval scores (coverage / faithfulness) across meeting suite + 4 families; manual `note.json` synthesis read; zh-glyph + year-hallucination audit.
- **Phase 2:** `tsc --noEmit` + `pnpm lint` + affected vitest; local rebuild + install + boot + **real-recording finalize on 2507** (founder-facing).

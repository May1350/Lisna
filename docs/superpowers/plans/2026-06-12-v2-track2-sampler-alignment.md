# Sidecar Sampler Alignment + Looping/ts Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production sidecar reproduce CLI-grade grounded JA output (kill the English-fabrication path), bound looping, fix ts scale — per spec `docs/superpowers/specs/2026-06-12-v2-track2-sampler-alignment-design.md` (Approach A, pre-approved B fallback).

**Architecture:** Rebuild the C++ sampler chain to llama.cpp-common-default parity (drop repeat-penalty, add min_p + DRY), hoist every sampler knob into a `sampling` object that flows TS `profiles.ts → orchestrator → callWithGrammar → generate envelope → C++ GenOpts`, echo the applied values back in the `done` stats (delivery proof). Post-decode gains a ts-rescale stage and a deterministic near-dup stage (shared helpers reused by the eval rig's new loop metric). The falsification matrix (R1-R3 × 3 seeds) runs on the founder dump BEFORE the prompt/post-decode tasks so attribution stays comparable to the overnight baselines.

**Tech Stack:** C++17 (llama.cpp `856c3ad`, gtest), TypeScript (Electron main + shared), vitest, the `note-quality-eval.ts` rig.

**Execution context:** Branch `feat/v2-track2-sampler-alignment` off `main` (AFTER the history-viewer plan merges — viewer executes first per founder sequencing), isolated worktree. Tasks 8 and 13 are CONTROLLER/founder tasks (real 3B inference on the dev machine — never run real-LLM legs in CI or `run_in_background`; pitfalls.md spike-llm).

**Hard rules for the implementer:** identical to the history-viewer plan header (worktree boundary, commit-before-report, eslint before every commit, no bare-directory vitest filters).

---

### Task 1: `SamplingParams` type + profile blocks

**Files:**
- Modify: `desktop/src/shared/ipc-protocol.ts` (next to `ChatMessage`, ~line 61)
- Modify: `desktop/src/shared/models/profiles.ts`
- Create: `desktop/src/shared/models/__tests__/profiles-sampling.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { modelProfiles, ALIGNED_SAMPLING } from '../profiles';

describe('model profile sampling blocks', () => {
  it('every profile carries the full aligned sampling block (spec section 5: TS always sends explicit values)', () => {
    for (const p of Object.values(modelProfiles)) {
      expect(p.sampling).toEqual(ALIGNED_SAMPLING);
    }
  });

  it('aligned values match llama.cpp common defaults + DRY enabled (spec section 4)', () => {
    expect(ALIGNED_SAMPLING).toEqual({
      topK: 40,
      topP: 0.95,
      minP: 0.05,
      repeatPenalty: 1.0,
      repeatLastN: 64,
      dryMultiplier: 0.8,
      dryBase: 1.75,
      dryAllowedLength: 2,
      dryPenaltyLastN: -1,
    });
  });
});
```

Run: `pnpm --filter @lisna/desktop exec vitest run src/shared/models/__tests__/profiles-sampling.test.ts`
Expected: FAIL — `ALIGNED_SAMPLING` not exported / `sampling` missing.

- [ ] **Step 2: Add the shared type**

In `desktop/src/shared/ipc-protocol.ts`, directly below the `ChatMessage` interface:

```ts
/**
 * Sampler knobs for `generate` — single-sourced from `profiles.ts`
 * (spec 2026-06-12-v2-track2-sampler-alignment section 5). All optional at
 * the IPC boundary; the C++ GenOpts defaults equal the ALIGNED values, so an
 * omitted field still yields aligned behavior (NOT the legacy chain).
 * `repeatPenalty` 1.0 = off (rig-only knob in practice — it reproduces the
 * legacy fabrication config in the falsification matrix).
 */
export interface SamplingParams {
  topK?: number;
  topP?: number;
  minP?: number;
  repeatPenalty?: number;
  repeatLastN?: number;
  /** 0.0 disables DRY entirely. */
  dryMultiplier?: number;
  dryBase?: number;
  dryAllowedLength?: number;
  /** -1 = scan the whole context. */
  dryPenaltyLastN?: number;
}
```

and extend the `generate` variant of `SidecarRequest` (after `seed?: number;`):

```ts
      /** Sampler knobs (spec sampler-alignment section 5). Omitted fields
       *  fall back to the C++ aligned defaults. */
      sampling?: SamplingParams;
```

- [ ] **Step 3: Add profile blocks**

In `desktop/src/shared/models/profiles.ts`:

(a) Import the type: `import type { NoteFamily } from '@shared/note-schema';` already exists — add `import type { SamplingParams } from '../ipc-protocol';`

(b) Add to the `ModelProfile` interface (after `ramBudgetMB: number;`):

```ts
  /**
   * Sampler configuration sent with EVERY generate call (spec
   * sampler-alignment section 5 — TS is the single source of truth; the C++
   * defaults are a safety net only). Aligned to llama.cpp common defaults
   * (common.h:214-243) + DRY enabled — the configuration the known-good
   * llama-completion runs used, minus their looping (DRY covers that).
   */
  sampling: Required<SamplingParams>;
```

(c) Add the exported constant above `modelProfiles`:

```ts
/**
 * llama.cpp common-default parity + DRY enabled. WHY these exact values:
 * the 2026-06-12 fabrication isolation matrix proved the CLI path
 * (common_sampler, NO sampler flags → these defaults, penalty OFF) produces
 * grounded JA where the sidecar chain (top_k 50 / top_p 0.9 / penalty 1.1
 * post-truncation) produces English fabrication. DRY (multiplier 0.8 — the
 * one deliberate deviation from "disabled" upstream default) targets the
 * phrase-looping the CLI runs still showed. See spec sections 1+4.
 */
export const ALIGNED_SAMPLING: Required<SamplingParams> = {
  topK: 40,
  topP: 0.95,
  minP: 0.05,
  repeatPenalty: 1.0,
  repeatLastN: 64,
  dryMultiplier: 0.8,
  dryBase: 1.75,
  dryAllowedLength: 2,
  dryPenaltyLastN: -1,
};
```

(d) Add `sampling: ALIGNED_SAMPLING,` to BOTH profile literals (`llama-3.2-3b-q4-km` and `llama-3.2-1b-q4-km`), after `ramBudgetMB`.

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @lisna/desktop exec vitest run src/shared/models/__tests__/profiles-sampling.test.ts`
Expected: PASS.
Run: `pnpm --filter @lisna/desktop exec tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Lint + commit**

```bash
pnpm --filter @lisna/desktop exec eslint src/shared/ipc-protocol.ts src/shared/models/profiles.ts src/shared/models/__tests__/profiles-sampling.test.ts
git add desktop/src/shared/ipc-protocol.ts desktop/src/shared/models/profiles.ts desktop/src/shared/models/__tests__/profiles-sampling.test.ts
git commit -m "feat(track2): SamplingParams type + aligned sampling blocks on model profiles"
```

---

### Task 2: C++ — GenOpts fields + testable request parser

**Files:**
- Modify: `desktop/sidecar/src/llm/llama_engine.h:10-16` (GenOpts)
- Modify: `desktop/sidecar/src/ipc/json_protocol.h` + `.cpp` (extract `gen_opts_from`)
- Modify: `desktop/sidecar/tests/test_json_protocol.cpp`

- [ ] **Step 1: Extend GenOpts**

In `llama_engine.h`, replace the `GenOpts` struct with:

```cpp
struct GenOpts {
  int maxTokens = 1024;
  float temperature = 0.4f;
  std::string grammar = "";       // GBNF source; empty = no grammar sampler (plain path)
  uint32_t seed = 0xFFFFFFFFu;    // == LLAMA_DEFAULT_SEED (random). Literal here so this
                                  // header need not include <llama.h> (see header note above).

  // Sampler knobs (spec 2026-06-12-v2-track2-sampler-alignment section 5).
  // Defaults = llama.cpp common defaults (common.h:214-243) + DRY enabled —
  // an envelope that omits `sampling` gets ALIGNED behavior, never the
  // legacy chain (top_k 50 / top_p 0.9 / penalty 1.1) that drove the
  // 2026-06-12 English-fabrication incident.
  int topK = 40;
  float topP = 0.95f;
  float minP = 0.05f;
  float repeatPenalty = 1.0f;     // 1.0 = penalties sampler OMITTED from the chain
  int repeatLastN = 64;           // inert while repeatPenalty == 1.0
  float dryMultiplier = 0.8f;     // 0.0 = DRY sampler omitted
  float dryBase = 1.75f;
  int dryAllowedLength = 2;
  int dryPenaltyLastN = -1;       // -1 = scan whole context
};
```

- [ ] **Step 2: Write the failing gtest cases**

In `desktop/sidecar/tests/test_json_protocol.cpp`, add (the file already includes `"ipc/json_protocol.h"` and `using nlohmann::json;`):

```cpp
// ─── gen_opts_from: sampling parsing (spec sampler-alignment section 5) ─────

TEST(GenOptsFrom, DefaultsAreAlignedWhenSamplingOmitted) {
  json req = {{"id", "1"}, {"type", "generate"},
              {"messages", json::array({{{"role", "user"}, {"content", "hi"}}})}};
  auto opts = lisna::ipc::gen_opts_from(req);
  EXPECT_EQ(opts.topK, 40);
  EXPECT_FLOAT_EQ(opts.topP, 0.95f);
  EXPECT_FLOAT_EQ(opts.minP, 0.05f);
  EXPECT_FLOAT_EQ(opts.repeatPenalty, 1.0f);
  EXPECT_EQ(opts.repeatLastN, 64);
  EXPECT_FLOAT_EQ(opts.dryMultiplier, 0.8f);
  EXPECT_FLOAT_EQ(opts.dryBase, 1.75f);
  EXPECT_EQ(opts.dryAllowedLength, 2);
  EXPECT_EQ(opts.dryPenaltyLastN, -1);
  EXPECT_EQ(opts.maxTokens, 1024);
  EXPECT_FLOAT_EQ(opts.temperature, 0.4f);
}

TEST(GenOptsFrom, SamplingOverridesApply) {
  json req = {{"id", "1"}, {"type", "generate"},
              {"messages", json::array({{{"role", "user"}, {"content", "hi"}}})},
              {"maxTokens", 3000}, {"temperature", 0.5},
              {"sampling", {{"topK", 50}, {"topP", 0.9}, {"minP", 0.0},
                            {"repeatPenalty", 1.1}, {"repeatLastN", 64},
                            {"dryMultiplier", 0.0}}}};
  auto opts = lisna::ipc::gen_opts_from(req);
  EXPECT_EQ(opts.topK, 50);
  EXPECT_FLOAT_EQ(opts.topP, 0.9f);
  EXPECT_FLOAT_EQ(opts.minP, 0.0f);
  EXPECT_FLOAT_EQ(opts.repeatPenalty, 1.1f);   // legacy-config reproduction (matrix R2/R3)
  EXPECT_FLOAT_EQ(opts.dryMultiplier, 0.0f);   // DRY disabled per request
  EXPECT_FLOAT_EQ(opts.dryBase, 1.75f);        // unspecified field keeps default
}

TEST(GenerateRequest, RejectsNonObjectSampling) {
  // Through the public dispatch path: shape errors surface BEFORE the
  // engine-state check, so this works with no model loaded.
  json req = {{"id", "9"}, {"type", "generate"},
              {"messages", json::array({{{"role", "user"}, {"content", "hi"}}})},
              {"sampling", "fast"}};
  auto out = json::parse(lisna::ipc::dispatch_or_error(req.dump()));
  EXPECT_EQ(out["type"], "error");
  EXPECT_EQ(out["code"], "invalid_type");
}

TEST(GenerateRequest, RejectsNonNumericSamplingField) {
  json req = {{"id", "9"}, {"type", "generate"},
              {"messages", json::array({{{"role", "user"}, {"content", "hi"}}})},
              {"sampling", {{"topK", "many"}}}};
  auto out = json::parse(lisna::ipc::dispatch_or_error(req.dump()));
  EXPECT_EQ(out["type"], "error");
  EXPECT_EQ(out["code"], "invalid_type");
}
```

NOTE: check how the existing tests in this file invoke the dispatcher — if they call a differently-named public entry (read the first existing `TEST(` block), use that same entry for the two `GenerateRequest` cases. The two `GenOptsFrom` cases call the new function directly.

- [ ] **Step 3: Implement `gen_opts_from`**

(a) In `desktop/sidecar/src/ipc/json_protocol.h`, declare (next to the existing public declarations, matching the header's namespace):

```cpp
// Build engine GenOpts from a validated `generate` request. Exposed for
// unit tests — value-level proof that sampling fields reach the struct.
// PRECONDITION: shape guards already ran (sampling is an object if present).
lisna::llm::GenOpts gen_opts_from(const nlohmann::json& req);
```

(add `#include "llm/llama_engine.h"` to the header if not already present).

(b) In `json_protocol.cpp`, add the implementation + shape guard. Insert the shape guard in the generate branch right after the existing seed guard (`json_protocol.cpp:159-160`):

```cpp
    // sampling shape guard (spec sampler-alignment section 5): object of
    // numeric fields. Validated BEFORE engine state like grammar/seed above.
    if (req.contains("sampling")) {
      if (!req["sampling"].is_object())
        return err("invalid_type", "sampling must be object");
      for (const auto& [k, v] : req["sampling"].items()) {
        if (!v.is_number())
          return err("invalid_type", "sampling." + k + " must be number");
      }
    }
```

and replace the inline GenOpts construction (`json_protocol.cpp:164-168`) with:

```cpp
    lisna::llm::GenOpts opts = gen_opts_from(req);
```

(c) Add the function definition (file scope, near the generate branch):

```cpp
lisna::llm::GenOpts gen_opts_from(const nlohmann::json& req) {
  lisna::llm::GenOpts opts;
  opts.maxTokens = req.value("maxTokens", opts.maxTokens);
  opts.temperature = req.value("temperature", opts.temperature);
  opts.grammar = req.value("grammar", std::string{});
  if (req.contains("seed")) opts.seed = req["seed"].get<uint32_t>();
  if (req.contains("sampling")) {
    const auto& s = req["sampling"];
    opts.topK = s.value("topK", opts.topK);
    opts.topP = s.value("topP", opts.topP);
    opts.minP = s.value("minP", opts.minP);
    opts.repeatPenalty = s.value("repeatPenalty", opts.repeatPenalty);
    opts.repeatLastN = s.value("repeatLastN", opts.repeatLastN);
    opts.dryMultiplier = s.value("dryMultiplier", opts.dryMultiplier);
    opts.dryBase = s.value("dryBase", opts.dryBase);
    opts.dryAllowedLength = s.value("dryAllowedLength", opts.dryAllowedLength);
    opts.dryPenaltyLastN = s.value("dryPenaltyLastN", opts.dryPenaltyLastN);
  }
  return opts;
}
```

- [ ] **Step 4: Build + run gtest**

Run: `cd desktop/sidecar && bash scripts/build.sh` (the script's test leg builds `sidecar_tests` and runs `ctest --output-on-failure` — `scripts/build.sh:14-15`).
Expected: all tests PASS including the 4 new ones. (First run after Step 2 alone should FAIL compile — that's the red step; Steps 2→4 are the TDD cycle compressed because a C++ compile error IS the failing state.)

- [ ] **Step 5: Commit**

```bash
git add desktop/sidecar/src/llm/llama_engine.h desktop/sidecar/src/ipc/json_protocol.h desktop/sidecar/src/ipc/json_protocol.cpp desktop/sidecar/tests/test_json_protocol.cpp
git commit -m "feat(sidecar): GenOpts sampling fields + gen_opts_from parser (aligned defaults)"
```

---

### Task 3: C++ — rebuild the sampler chain + appliedSampling echo

**Files:**
- Modify: `desktop/sidecar/src/llm/llama_engine.cpp:215-249` (chain)
- Modify: `desktop/sidecar/src/ipc/json_protocol.cpp` (done stats)

- [ ] **Step 1: Replace the chain block**

In `llama_engine.cpp`, replace the comment block + sampler chain construction (lines 215-249, from `// Sampler chain. Order matters...` through the `llama_sampler_chain_add(smpl, llama_sampler_init_dist(opts.seed));` line) with:

```cpp
  // Sampler chain — aligned to llama.cpp common defaults (spec
  // 2026-06-12-v2-track2-sampler-alignment section 4). Order mirrors
  // upstream common_sampler: penalties → dry → top_k → top_p → min_p →
  // temp → dist. Values arrive via GenOpts (TS profiles.ts is the single
  // source of truth; the header defaults are the aligned safety net).
  //
  // The old hardcoded chain (top_k 50 → top_p 0.9 → penalties(64, 1.1) →
  // temp → dist) is GONE: the 1.1 post-truncation repeat penalty is the
  // prime suspect for the 2026-06-12 JA→English fabrication (it
  // systematically down-weights recurring JA subword tokens inside
  // grammar-masked JSON; English alternates win). Penalties stay reachable
  // via opts.repeatPenalty > 1.0 ONLY so the eval rig can reproduce the
  // legacy config in the falsification matrix — production sends 1.0.
  //
  // DRY (sequence-repetition penalty) replaces it as the anti-loop device:
  // it penalizes only tokens that EXTEND a repeated sequence (>= allowed
  // length), so it cannot bias the language of fresh content the way a
  // token-recurrence penalty can. The `"` sequence breaker resets matching
  // at JSON string boundaries. Disabled when multiplier == 0 (rig knob).
  //
  // Grammar stays FIRST (single-pass hard mask; candidate set cannot
  // empty). NOTE: the known-good CLI ran grammar_first=false (lazy
  // rejection-resample) — grammar mode is deliberately NOT changed here;
  // it is the B-fallback variable (spec section 7).
  llama_sampler_chain_params sparams = llama_sampler_chain_default_params();
  llama_sampler* smpl = llama_sampler_chain_init(sparams);

  if (!opts.grammar.empty()) {
    llama_sampler* grmr = llama_sampler_init_grammar(impl_->vocab, opts.grammar.c_str(), "root");
    if (!grmr) {
      lisna::ipc::emit_event(nlohmann::json{
          {"type", "log"}, {"level", "error"}, {"source", "system"},
          {"message", "grammar_parse_failed — llama grammar parser rejected the GBNF"}
      }.dump());
      llama_sampler_free(smpl);
      return false;   // protocol layer emits a stream error → callWithGrammar retries → CHUNK_FAILED
    }
    llama_sampler_chain_add(smpl, grmr);
  }
  if (opts.repeatPenalty > 1.0f) {
    llama_sampler_chain_add(smpl, llama_sampler_init_penalties(
        opts.repeatLastN, opts.repeatPenalty, 0.0f, 0.0f));
  }
  if (opts.dryMultiplier > 0.0f) {
    // Upstream default breakers (common.h:243). `"` confines DRY matching
    // within one JSON string slot; `:`/`\n` break across structural tokens.
    static const char* kDryBreakers[] = {"\n", ":", "\"", "*"};
    llama_sampler_chain_add(smpl, llama_sampler_init_dry(
        impl_->vocab, llama_model_n_ctx_train(impl_->model),
        opts.dryMultiplier, opts.dryBase,
        opts.dryAllowedLength, opts.dryPenaltyLastN,
        kDryBreakers, 4));
  }
  llama_sampler_chain_add(smpl, llama_sampler_init_top_k(opts.topK));
  llama_sampler_chain_add(smpl, llama_sampler_init_top_p(opts.topP, 1));
  llama_sampler_chain_add(smpl, llama_sampler_init_min_p(opts.minP, 1));
  llama_sampler_chain_add(smpl, llama_sampler_init_temp(opts.temperature));
  llama_sampler_chain_add(smpl, llama_sampler_init_dist(opts.seed));
```

- [ ] **Step 2: appliedSampling echo in the done event**

In `json_protocol.cpp`, replace the final `return` of the generate branch (lines 185-186) with:

```cpp
    // Delivery proof (spec section 5): echo the values the chain actually
    // used so the rig + #113 dumps can verify end-to-end param transport
    // instead of trusting the request.
    return nlohmann::json{{"id", id}, {"type", "done"},
        {"stats", {{"tokensOut", tokens_out}, {"genMs", gen_ms},
                   {"appliedSampling", {
                       {"topK", opts.topK}, {"topP", opts.topP}, {"minP", opts.minP},
                       {"repeatPenalty", opts.repeatPenalty}, {"repeatLastN", opts.repeatLastN},
                       {"dryMultiplier", opts.dryMultiplier}, {"dryBase", opts.dryBase},
                       {"dryAllowedLength", opts.dryAllowedLength},
                       {"dryPenaltyLastN", opts.dryPenaltyLastN},
                       {"temperature", opts.temperature}, {"maxTokens", opts.maxTokens}}}}}}.dump();
```

- [ ] **Step 3: Build + full ctest**

Run: `cd desktop/sidecar && bash scripts/build.sh`
Expected: compiles clean; all sidecar tests PASS (the chain change has no model-less unit coverage — `gen_opts_from` tests + the rig matrix are its proof; existing tests assert nothing about the old chain values).

- [ ] **Step 4: Commit**

```bash
git add desktop/sidecar/src/llm/llama_engine.cpp desktop/sidecar/src/ipc/json_protocol.cpp
git commit -m "feat(sidecar): aligned sampler chain (penalty off, +min_p +DRY) + appliedSampling echo"
```

---

### Task 4: Sidecar rebuild + bundle verify

- [ ] **Step 1:** Run the canonical rebuild (the `lisna-sidecar-rebuild` skill flow): `cd desktop/sidecar && bash scripts/build.sh`
- [ ] **Step 2:** Verify the binary was copied to the app bundle path:

```bash
md5 desktop/sidecar/build/release/sidecar desktop/resources/sidecar
```

Expected: both hashes IDENTICAL (if `build.sh` doesn't copy, `cp desktop/sidecar/build/release/sidecar desktop/resources/sidecar` then re-verify).

- [ ] **Step 3:** Commit the binary if `desktop/resources/sidecar` is git-tracked (check `git status` — follow whatever the repo's existing pattern is; if gitignored, no commit and note it in the task report).

---

### Task 5: TS threading — envelope, generator, callWithGrammar, orchestrator

**Files:**
- Modify: `desktop/src/main/sidecar/client.ts:35` (GenerateStats)
- Modify: `desktop/src/main/sidecar/grammar-call.ts` (LlmGenerator:13-24, GrammarCallOpts:62-81, callWithGrammar:372-379, GrammarCapableSidecar:430-439, makeSidecarGenerator:446-449, makeGrammarSidecar:458-481)
- Modify: `desktop/src/main/sidecar/orchestrator.ts` (RunChunkOpts:138, runChunkWithGrammar:201-212, the 4 call sites :575/:746/:918/:1112)
- Modify: `desktop/src/main/sidecar/merge-llm.ts` (its `callWithGrammar` call — grep `callWithGrammar(` to enumerate ALL production call sites first)
- Modify: `desktop/src/main/sidecar/__tests__/grammar-call.test.ts` (or wherever `grammar-call` tests live — `find desktop/src -name "grammar-call*test*"`)

- [ ] **Step 1: Write the failing test**

Add to the grammar-call test file:

```ts
it('threads sampling through to the generator verbatim', async () => {
  const sampling = { topK: 40, topP: 0.95, minP: 0.05, repeatPenalty: 1.0,
    repeatLastN: 64, dryMultiplier: 0.8, dryBase: 1.75, dryAllowedLength: 2,
    dryPenaltyLastN: -1 };
  const generator = vi.fn(async () => ({ text: '{"a":1}', seed: 1 }));
  await callWithGrammar({
    prompt: 'p', schema: z.unknown(), grammar: 'root ::= "x"',
    baseSeed: 1, temperature: 0.4, maxAttempts: 1, maxTokens: 100,
    generator, sampling,
  });
  expect(generator).toHaveBeenCalledWith(expect.objectContaining({ sampling }));
});
```

Run: `pnpm --filter @lisna/desktop exec vitest run <grammar-call test file>`
Expected: the new test FAILS (sampling not forwarded); note any EXISTING tests that assert generator-arg shapes with exact matchers — they must keep passing (sampling is additive-optional).

- [ ] **Step 2: Implement the threading**

(a) `client.ts` — extend `GenerateStats`:

```ts
/** Sidecar-reported generation stats from the `done` stream line. */
export interface GenerateStats {
  tokensOut: number;
  genMs: number;
  /** Echo of the sampler values the C++ chain actually used (delivery
   *  proof — spec sampler-alignment section 5). Absent on older binaries. */
  appliedSampling?: Record<string, number>;
}
```

(The done-line validator at `client.ts:214-218` checks only tokensOut/genMs and casts the whole object — `appliedSampling` rides through unchanged.)

(b) `grammar-call.ts`:
- Add `import type { SamplingParams } from '@shared/ipc-protocol';`
- `LlmGenerator` opts param gains `sampling?: SamplingParams;` (after `maxTokens`).
- `LlmGenerator`/`GrammarCapableSidecar` return-type `stats` shapes gain `appliedSampling?: Record<string, number>` (lines 24 and 438; keep both inline shapes in sync).
- `GrammarCallOpts<T>` gains `sampling?: SamplingParams;`.
- `callWithGrammar`'s generator invocation (line 372-379) gains `sampling: opts.sampling,`.
- `GrammarCapableSidecar.generateWithGrammar` req gains `sampling?: SamplingParams;`.
- `makeSidecarGenerator` passes it: destructure + forward `sampling`.
- `makeGrammarSidecar.generateWithGrammar` destructures `sampling` and adds `sampling,` to the `sendStream` envelope (after `maxTokens`).

(c) `orchestrator.ts`:
- `RunChunkOpts.tuning` (line 138) becomes:

```ts
  tuning: { temperature: number; maxGenTokens: number; sampling: Required<SamplingParams> };
```

(add `import type { SamplingParams } from '@shared/ipc-protocol';`)
- `runChunkWithGrammar`'s `callWithGrammar` call gains `sampling: opts.tuning.sampling,`.
- Each of the 4 call sites (`:575/:746/:918/:1112`) constructs `tuning` from the per-family profile row — find each `tuning: {...}` construction and add `sampling: args.modelProfile.sampling` (the exact receiver variable name differs per finalize*; match the existing `temperature`/`maxGenTokens` source object).

(d) `merge-llm.ts` + any other `callWithGrammar(` production caller found by `grep -rn "callWithGrammar(" desktop/src/`: pass `sampling: <modelProfile>.sampling` the same way (merge calls have the modelProfile in scope; if one genuinely doesn't, pass nothing — C++ aligned defaults apply — and note it in the task report).

NOTE (do not change): the legacy plain-text path `this.opts.llm.generate(messages, { maxTokens: 4096, temperature: 0.4 })` (`orchestrator.ts:455`) intentionally sends no sampling — C++ aligned defaults now govern it, which IS the fix for that path too.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/`
Expected: new test PASS; ALL existing sidecar suites PASS (109+). Fix any exact-arg assertion fallout by adding the `sampling: undefined`-tolerant matcher (`expect.objectContaining`), never by weakening the new test.

- [ ] **Step 4: Typecheck + lint + commit**

```bash
pnpm --filter @lisna/desktop exec tsc --noEmit
pnpm --filter @lisna/desktop exec eslint <every file touched in this task>
git add -A desktop/src
git commit -m "feat(track2): thread SamplingParams from profiles through callWithGrammar to the generate envelope"
```

---

### Task 6: Dump logging of sampling + appliedSampling

**Files:**
- Modify: `desktop/src/main/session-debug-dump.ts` (`wrapSidecar` — `base` object :115-125, success `appendCall` :129-136)
- Modify: `desktop/src/main/__tests__/session-debug-dump.test.ts` (extend the existing wrapSidecar case)

- [ ] **Step 1: Failing test** — in the existing wrapSidecar test, have the inner mock return `stats: { tokensOut: 5, genMs: 10, appliedSampling: { topK: 40 } }` and call `generateWithGrammar` with `sampling: { topK: 40 }`; assert the appended ndjson line contains `"sampling":{"topK":40}` and `"appliedSampling":{"topK":40}`. Run the file; expect FAIL.
- [ ] **Step 2: Implement** — in `wrapSidecar`: add `sampling: req.sampling,` to `base` (after `maxTokens`), and `appliedSampling: r.stats?.appliedSampling,` to the success `appendCall` object (after `genMs`). `JSON.stringify` drops `undefined` fields, so old-shape calls serialize identically.
- [ ] **Step 3: Run** the dump test files; expect PASS. Lint + commit:

```bash
git add desktop/src/main/session-debug-dump.ts desktop/src/main/__tests__/session-debug-dump.test.ts
git commit -m "feat(track2): record sampling + appliedSampling in finalize debug dumps"
```

---

### Task 7: Rig — `--sampling` sweep knob + loop metric

**Files:**
- Modify: `desktop/scripts/note-quality-eval.ts`
- Create: `desktop/src/shared/post-decode/dedup.ts` (helpers ONLY — pipeline integration is Task 9; creating the module here lets the rig and pipeline share one normalization, spec lockstep requirement)
- Create: `desktop/src/shared/post-decode/__tests__/dedup.test.ts`

- [ ] **Step 1: Failing tests for the dedup helpers**

```ts
import { describe, it, expect } from 'vitest';
import { normalizeForDedup, trigramJaccard, nearDupRate } from '../dedup';

describe('normalizeForDedup', () => {
  it('NFKC + lowercase + strips whitespace/punctuation, keeps JA content chars', () => {
    expect(normalizeForDedup('就職活動、 ｱﾄﾞﾊﾞｲｽ!')).toBe('就職活動アドバイス');
    expect(normalizeForDedup('Hello,  World!')).toBe('helloworld');
  });
});

describe('trigramJaccard', () => {
  it('1.0 for identical, high for near-identical, low for unrelated', () => {
    expect(trigramJaccard('就職活動のアドバイス', '就職活動のアドバイス')).toBe(1);
    expect(trigramJaccard('就職活動のアドバイスです', '就職活動のアドバイスでした')).toBeGreaterThan(0.6);
    expect(trigramJaccard('就職活動のアドバイス', '財務戦略の基本方針')).toBeLessThan(0.2);
  });
  it('short strings (< 3 chars) compare by equality', () => {
    expect(trigramJaccard('はい', 'はい')).toBe(1);
    expect(trigramJaccard('はい', 'いえ')).toBe(0);
  });
});

describe('nearDupRate', () => {
  it('counts items whose normalized text near-dups an earlier item', () => {
    const texts = ['Aの説明です', 'Aの説明です', 'Aの説明ですね', '全然違う内容'];
    // item 2 exact-dups item 1; item 3 near-dups (>=0.85); item 4 unique
    expect(nearDupRate(texts, 0.85)).toBeCloseTo(2 / 4);
  });
});
```

Run: `pnpm --filter @lisna/desktop exec vitest run src/shared/post-decode/__tests__/dedup.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement `dedup.ts`**

```ts
/**
 * Deterministic near-duplicate detection shared by the post-decode pipeline
 * (Stage 3.8, Task 9) and the eval rig's loop metric (spec
 * 2026-06-12-v2-track2-sampler-alignment sections 6a + 7). One normalization,
 * one similarity — pipeline and metric MUST agree (lockstep requirement; the
 * #114 incident taught us split heuristics burn retries on healthy output).
 */

/** NFKC → lowercase → strip everything that isn't a letter/number in any
 *  script (punctuation, whitespace, symbols out; JA/latin/digits stay). */
export function normalizeForDedup(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** Char-trigram Jaccard over normalized text; <3-char strings compare exact. */
export function trigramJaccard(aRaw: string, bRaw: string): number {
  const a = normalizeForDedup(aRaw);
  const b = normalizeForDedup(bRaw);
  if (a.length < 3 || b.length < 3) return a === b ? 1 : 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Spec 6a threshold: ≥ 0.85 = duplicate (tunable; keep one constant). */
export const NEAR_DUP_THRESHOLD = 0.85;

/** Fraction of items that near-dup an EARLIER item (loop metric, spec 7). */
export function nearDupRate(texts: string[], threshold = NEAR_DUP_THRESHOLD): number {
  if (texts.length === 0) return 0;
  let dups = 0;
  for (let i = 1; i < texts.length; i++) {
    for (let j = 0; j < i; j++) {
      if (trigramJaccard(texts[i]!, texts[j]!) >= threshold) {
        dups++;
        break;
      }
    }
  }
  return dups / texts.length;
}
```

Run the test → PASS.

- [ ] **Step 3: Rig additions**

In `note-quality-eval.ts`:
(a) New arg after `MAX_TOKENS_OVERRIDE` (`:65`):

```ts
// Sweep knob (falsification matrix R1-R3): JSON object of SamplingParams.
// Empty = send nothing → C++ aligned defaults. Example:
//   --sampling '{"repeatPenalty":1.1,"repeatLastN":64}'
const SAMPLING = (() => {
  const raw = arg('sampling', '');
  return raw ? (JSON.parse(raw) as Record<string, number>) : null;
})();
```

(b) Find the MAIN generate `client.sendStream({ type: 'generate', ... })` call (`:240` — the one streaming tokens for the note; NOT the warmup `:209` / primer `:228`) and add `...(SAMPLING ? { sampling: SAMPLING } : {}),` to its envelope, and capture the done-stats via the call's existing `onDone` pattern (mirror grammar-call.ts:474) into a local `appliedSampling` variable.
(c) Loop metric: where the rig collects the parsed note's strings for scoring, add per-array-slot near-dup rates. Implement with the shared helpers:

```ts
import { nearDupRate, NEAR_DUP_THRESHOLD } from '../src/shared/post-decode/dedup';

/** Per-array near-dup rates over the parsed note (loop metric, spec 7). */
function loopMetrics(note: unknown, path = '$', out: Record<string, number> = {}): Record<string, number> {
  if (Array.isArray(note)) {
    const texts = note
      .map((item) =>
        typeof item === 'string'
          ? item
          : item && typeof item === 'object'
            ? Object.entries(item as Record<string, unknown>)
                .filter(([k, v]) => typeof v === 'string' && !['from', 'id'].includes(k))
                .map(([, v]) => v as string)
                .join(' ')
            : '',
      )
      .filter((t) => t.length > 0);
    if (texts.length >= 2) out[path] = nearDupRate(texts, NEAR_DUP_THRESHOLD);
    for (const item of note) loopMetrics(item, `${path}[]`, out);
    return out;
  }
  if (note && typeof note === 'object') {
    for (const [k, v] of Object.entries(note)) loopMetrics(v, `${path}.${k}`, out);
  }
  return out;
}
```

(d) Emit `samplingRequested: SAMPLING`, `appliedSampling`, `loopMetrics: loopMetrics(note)`, and `maxLoopRate: Math.max(0, ...Object.values(loopMetrics(note)))` into the run's output JSON next to the existing `Scores`.

- [ ] **Step 4: Verify the rig compiles**

Run: `pnpm --filter @lisna/desktop exec tsc --noEmit` (scripts are typechecked? if scripts/ is outside the tsconfig, run `pnpm --filter @lisna/desktop exec tsc --noEmit -p .` and additionally `node --experimental-strip-types --check` is NOT available — fall back to `pnpm tsx --no-cache scripts/note-quality-eval.ts --help || true` and confirm it fails only on the expected "dump not found", not a syntax/type error).

- [ ] **Step 5: Lint + commit**

```bash
pnpm --filter @lisna/desktop exec eslint desktop/scripts/note-quality-eval.ts desktop/src/shared/post-decode/dedup.ts desktop/src/shared/post-decode/__tests__/dedup.test.ts
git add desktop/scripts/note-quality-eval.ts desktop/src/shared/post-decode/dedup.ts desktop/src/shared/post-decode/__tests__/dedup.test.ts
git commit -m "feat(track2): rig sampling sweep knob + shared near-dup loop metric"
```

---

### Task 8: ⚠️ CONTROLLER TASK — falsification matrix (real 3B, founder machine)

NOT for an implementer subagent. Real LLM inference, FOREGROUND ONLY, quiet machine. Prompts/templates are still UNCHANGED at this point (Tasks 9-11 come after) — that is deliberate: clean attribution against the overnight baselines.

- [ ] **Step 1:** Run R1/R2/R3 × seeds 7000/8000/9000 on the founder dump:

```bash
cd desktop
# R1 — aligned (send nothing; C++ aligned defaults govern)
for s in 7000 8000 9000; do pnpm tsx scripts/note-quality-eval.ts --dump 2026-06-11T16-14-00-372Z --variant interview-v1 --seed $s --label R1-aligned-$s; done
# R2 — aligned + repeat penalty ONLY (the prime-suspect isolation)
for s in 7000 8000 9000; do pnpm tsx scripts/note-quality-eval.ts --dump 2026-06-11T16-14-00-372Z --variant interview-v1 --seed $s --label R2-penalty-$s --sampling '{"repeatPenalty":1.1,"repeatLastN":64}'; done
# R3 — full legacy chain reproduction (sanity: must reproduce fabrication)
for s in 7000 8000 9000; do pnpm tsx scripts/note-quality-eval.ts --dump 2026-06-11T16-14-00-372Z --variant interview-v1 --seed $s --label R3-legacy-$s --sampling '{"topK":50,"topP":0.9,"minP":0.0,"repeatPenalty":1.1,"repeatLastN":64,"dryMultiplier":0.0}'; done
```

- [ ] **Step 2:** Evaluate against spec section 7: R1 grounding ≥ 0.9 + jaRatio above guard on 3/3; verify `appliedSampling` echo in each output matches the request. tok/s vs #111 baseline ±10%.
- [ ] **Step 3:** Write `docs/superpowers/decisions/2026-06-12-fabrication-culprit.md` with the result table + the attribution-discipline verdict (R2-vs-R1 = penalty verdict; if R1 fails ≥2/3 → trigger B fallback per spec, STOP this plan and escalate to the controller session).
- [ ] **Step 4:** `git add docs/superpowers/decisions/2026-06-12-fabrication-culprit.md && git commit -m "docs(track2): fabrication culprit falsification matrix results"`

---

### Task 9: Post-decode — ts rescale + near-dup stages

**Files:**
- Modify: `desktop/src/shared/post-decode/pipeline.ts`
- Modify: `desktop/src/shared/post-decode/__tests__/pipeline.test.ts`

- [ ] **Step 1: Failing tests**

Add to the pipeline test file (reuse its existing family/transcript fixtures — read the file first; the cases below show the assertions to express in that harness):

```ts
describe('Stage 3.6 — ts rescale (spec 6b)', () => {
  it('rescales 0-1 fraction ts to integer seconds when ALL ts ≤ 1 and span > 1', () => {
    // transcript span: last segment endTs = 600
    // note JSON with sections[0].ts = 0.23 and a key_term ts = 0.5
    // → after pipeline: ts = 138, key_term ts = 300 (round(0.23*600)=138)
    // assert via the validated output's ts fields
  });
  it('does NOT rescale when any ts > 1 (already seconds)', () => {
    // note with ts = 42 and ts = 0.5 → untouched (mixed = trust the model)
  });
  it('clamps rescaled ts into [0, span]', () => {
    // ts = 1.0 with span 600 → 600 (not 601 from rounding)
  });
});

describe('Stage 3.8 — near-dup removal (spec 6a)', () => {
  it('drops exact and near-duplicate array items, keeping first occurrence', () => {
    // points: ['Aの説明です', 'Aの説明です', 'Aの説明ですね', '別の内容'] → 2 items
  });
  it('runs BEFORE Zod so .min(N) still gates an all-loops note', () => {
    // sections[0].points all near-identical + schema requires .min(1) on
    // sections → dedup leaves 1 point (fine), but craft a case where a
    // .min(N>1) array drops below N → expect ZodError to propagate
  });
});
```

Write these as REAL tests against the actual fixtures in the existing file (the lecture family fixture used by current Stage 2.5/3 cases). Run → FAIL.

- [ ] **Step 2: Implement the stages**

In `pipeline.ts`, insert between Stage 3 and Stage 4:

```ts
  // Stage 3.6 — ts rescale (spec sampler-alignment 6b). Judges 2026-06-12:
  // the 3B emits ts as 0-1 fractions of the recording (0.23 ≈ 23s into a
  // 100s span) despite the prompt saying "seconds". Deterministic repair:
  // when EVERY ts-like number in the note is ≤ 1.0 and the call's
  // transcript span is > 1s, multiply by the span, round, clamp. Mixed
  // magnitudes = the model already used seconds — leave untouched.
  rescaleFractionalTs(parsed, transcript);

  // Stage 3.8 — deterministic near-dup removal (spec sampler-alignment 6a).
  // Layer 2 of the anti-loop defense (DRY samples are layer 1; the #118
  // guard is layer 3). BEFORE Zod so `.min(N)` still gates: an all-loops
  // note that dedups below its floor SHOULD fail into the retry ladder,
  // not ship thin.
  dropNearDuplicateItems(parsed);
```

and add at file scope:

```ts
import { trigramJaccard, NEAR_DUP_THRESHOLD } from './dedup';

const TS_KEYS = new Set(['ts', 'appears_at_ts']);

function collectTsRefs(node: unknown, out: { obj: Record<string, unknown>; key: string }[]): void {
  if (Array.isArray(node)) {
    for (const v of node) collectTsRefs(v, out);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (TS_KEYS.has(k) && typeof v === 'number') {
        out.push({ obj: node as Record<string, unknown>, key: k });
      } else {
        collectTsRefs(v, out);
      }
    }
  }
}

function rescaleFractionalTs(parsed: Record<string, unknown>, transcript: SessionTranscript): void {
  const span = transcript.transcriptSegments.at(-1)?.endTs ?? 0;
  if (span <= 1) return;
  const refs: { obj: Record<string, unknown>; key: string }[] = [];
  collectTsRefs(parsed, refs);
  if (refs.length === 0) return;
  if (!refs.every((r) => (r.obj[r.key] as number) <= 1.0)) return;
  for (const r of refs) {
    const v = r.obj[r.key] as number;
    r.obj[r.key] = Math.min(Math.round(span), Math.max(0, Math.round(v * span)));
  }
}

/** Comparison text for one array item: bare string, or all own string values
 *  excluding system keys — same exclusion set as Stage 2.5's spirit. */
function dedupComparisonText(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return Object.entries(item as Record<string, unknown>)
      .filter(([k, v]) => typeof v === 'string' && k !== 'from' && k !== 'id')
      .map(([, v]) => v as string)
      .join(' ');
  }
  return '';
}

function dropNearDuplicateItems(node: unknown): void {
  if (Array.isArray(node)) {
    const kept: unknown[] = [];
    const keptTexts: string[] = [];
    for (const item of node) {
      const text = dedupComparisonText(item);
      const isDup =
        text.length > 0 &&
        keptTexts.some((t) => trigramJaccard(text, t) >= NEAR_DUP_THRESHOLD);
      if (!isDup) {
        kept.push(item);
        keptTexts.push(text);
      }
    }
    node.length = 0;
    node.push(...kept);
    for (const item of node) dropNearDuplicateItems(item);
    return;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node)) dropNearDuplicateItems(v);
  }
}
```

Also update the pipeline's header comment (the stage list at lines 8-21) to include Stage 3.6 + 3.8 and to correct the stale "Stage 5 dedup no-op" note (Stage 5 stays a no-op; the real dedup now lives pre-Zod at 3.8 — say why: `.min(N)` gating).

- [ ] **Step 3: Run + regression check**

Run: `pnpm --filter @lisna/desktop exec vitest run src/shared/post-decode/`
Expected: new cases PASS, ALL existing pipeline cases PASS (rescale is inert on fixtures whose ts are already integers ≥ 1; dedup is inert on fixtures without near-identical items — if an existing fixture trips dedup, the fixture was asserting duplicated content; inspect carefully and report rather than silently adjusting).
Then the full orchestrator suite (pipeline is on its hot path):
`pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/`
Expected: PASS.

- [ ] **Step 4: Lint + commit**

```bash
pnpm --filter @lisna/desktop exec eslint src/shared/post-decode/pipeline.ts src/shared/post-decode/__tests__/pipeline.test.ts
git add desktop/src/shared/post-decode/
git commit -m "feat(track2): post-decode ts rescale + pre-Zod near-dup removal"
```

---

### Task 10: Prompt ts-hint line (all four v1 templates)

**Files:**
- Modify: `desktop/src/shared/families/lecture/prompts/v1.ts` (anchor: line 12 already says "ts (seconds offset, integer)")
- Modify: `desktop/src/shared/families/meeting/prompts/v1.ts`
- Modify: `desktop/src/shared/families/interview/prompts/v1.ts`
- Modify: `desktop/src/shared/families/brainstorm/prompts/v1.ts`

- [ ] **Step 1:** In each file, locate the schema-rules block where `ts` is described (grep `ts` in the template string) and add this exact line as its own bullet immediately after the existing ts mention (or, if a family's template never mentions ts, after the last schema-rule bullet):

```
- ts values are INTEGER SECONDS elapsed since the recording start (example: 605 means 10:05). NEVER emit ts as a 0-1 fraction.
```

- [ ] **Step 2:** Run each family's prompt tests: `pnpm --filter @lisna/desktop exec vitest run src/shared/families/`
Expected: PASS (prompt tests assert structure, not full text; if one snapshot-asserts the template, update the snapshot deliberately and say so in the commit body).
- [ ] **Step 3:** Lint + commit:

```bash
git add desktop/src/shared/families/*/prompts/v1.ts
git commit -m "feat(track2): explicit integer-seconds ts hint in all v1 prompts"
```

(Per `testing.md (fixtures)` this is a prompt change — the rig re-run in Task 13 is its eval; no cloud-curator baseline applies to the v2 on-device path.)

---

### Task 11: Full verify + version bump

- [ ] **Step 1:** `pnpm --filter @lisna/desktop verify` → green (build + all tests + lint).
- [ ] **Step 2:** `desktop/package.json` version `0.1.9` → `0.1.10` (assumes the history-viewer plan landed `0.1.9` first; if this plan executes against `0.1.8`, bump to the next free patch and note it).
- [ ] **Step 3:**

```bash
git add desktop/package.json
git commit -m "chore(desktop): bump version to 0.1.10 (sampler alignment)"
```

---

### Task 12: ⚠️ CONTROLLER TASK — merge-gate rig run (final state)

Re-run R1 × 3 seeds on the FINAL branch state (post prompt + post-decode changes) — this is the spec section 7 MERGE GATE:

1. grounding ≥ 0.9 + jaRatio above the #118 threshold, 3/3 seeds.
2. `maxLoopRate` pre-dedup ≤ 0.10 (DRY itself works, not just the scrubber).
3. All note ts integral within [0, durationSec].
4. tok/s within ±10% of the #111 baseline.
5. `appliedSampling` echo present and aligned in every run.

Record pass/fail per gate in the PR body. ANY grounding failure ≥ 2/3 seeds → B fallback per spec (stop, escalate).

### Task 13: ⚠️ CONTROLLER TASK — PR + release follow-ups

- [ ] Push branch, open PR `feat(track2): sampler alignment + looping/ts correctness` (spec + plan + decision doc + gate table in body).
- [ ] After merge: packaged-app release gates per `v2_packaged_app_validation_gate` memory; founder release-gate recording (interview + lecture, quiet machine, installed build).

---

## Self-review notes (writing-plans checklist)

- **Spec coverage:** section 4 chain → Tasks 2-4; section 5 param promotion + echo → Tasks 1/2/3/5/6; section 6a dedup → Tasks 7 (helpers) + 9 (pipeline); 6b ts → Tasks 9 (rescale) + 10 (prompt hint); 6c unchanged (no task needed); section 7 rig extensions + matrix + gates → Tasks 7/8/12; B-fallback trigger → Tasks 8/12 escalation clauses; section 9 rollout → Tasks 11/13.
- **Documented deviations from spec:** (1) `dedupDropped` telemetry rides the RIG output, not `GrammarAttempt` — `GrammarAttempt` is built inside `callWithGrammar`, which runs BEFORE the pipeline; threading pipeline results back into it would invert the layering. Same observability intent, honest placement. (2) Task ordering runs the falsification matrix (Task 8) BEFORE prompt/post-decode changes (Tasks 9-10) so R1-R3 attribution stays comparable to the overnight baselines; the merge gate (Task 12) re-runs on the final state.
- **Type consistency:** `SamplingParams` defined once (Task 1) and imported everywhere; `ALIGNED_SAMPLING` is the single value source; C++ `GenOpts` defaults mirror it with a comment cross-reference; `NEAR_DUP_THRESHOLD` shared by pipeline + rig.

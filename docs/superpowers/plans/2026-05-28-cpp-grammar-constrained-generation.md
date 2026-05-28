# C++ Grammar-Constrained Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make on-device grammar-constrained note generation actually run — C++ engine honors a GBNF grammar + RNG seed, a TS adapter bridges it, and an offline-3b eval runner scores real model output — proven by one real 3B run.

**Architecture:** The merged TS chain (`callWithGrammar` → `GrammarCapableSidecar` → `finalizeLecture`/`finalizeMeeting`) already exists; this fills its holes. C++ `GenOpts` gains `grammar`+`seed`; the sampler applies the grammar **grammar-first** (mask invalid tokens before the truncation samplers) and feeds the seed to `dist`; the `generate` IPC envelope carries both; a `makeGrammarSidecar` adapter implements `generateWithGrammar`; an `offline-3b` eval runner drives the real path. Grammar-first correctness is gated by a real-model run (the Spike-0.1 proof used the example binary's `common_sampler`, which the sidecar doesn't link), with `common_sampler` as the documented fallback.

**Tech Stack:** C++17 + llama.cpp (vendored `deps/llama.cpp` @ 856c3ad, core `llama` lib only), TypeScript (Electron main + Node), Vitest, GoogleTest.

**Spec:** `docs/superpowers/specs/2026-05-28-cpp-grammar-constrained-generation-design.md`

**Lane:** ai-infra (C++ + `desktop/src/main` + `desktop/src/shared`) + eval (`desktop/eval`). Worktree `.claude/worktrees/feat-cpp-grammar-gen` (branch `worktree-feat-cpp-grammar-gen`, off `origin/main` `6fa795f`). Commits touching `desktop/eval/**` get a `Cross-lane: ai-infra → eval` trailer.

**8 GB discipline (HARD):** real LLM inference is FOREGROUND ONLY, one sample at a time, `pkill -9 -f llama-completion` (and the sidecar pid) after. NEVER `run_in_background` for inference.

---

## Task 0: Worktree prep (submodules + deps)

A fresh worktree has an empty `deps/` submodule tree and no `node_modules`.

**Files:** none (environment only)

- [ ] **Step 1: Init the llama.cpp + whisper.cpp submodules**

Run (from worktree root):
```bash
git submodule update --init --recursive desktop/sidecar/deps/llama.cpp desktop/sidecar/deps/whisper.cpp
```
Expected: both checkouts populate; `ls desktop/sidecar/deps/llama.cpp/include/llama.h` exists.

- [ ] **Step 2: Install JS deps**

Run:
```bash
pnpm install --frozen-lockfile
```
Expected: completes; does not modify `pnpm-lock.yaml`. Re-wires `core.hooksPath`.

- [ ] **Step 3: Baseline green — confirm the desktop suite passes BEFORE changes**

Run:
```bash
pnpm --filter @lisna/desktop run typecheck && pnpm --filter @lisna/desktop lint
```
Expected: both exit 0. (No commit — environment task.)

---

## Task 1: C++ `GenOpts` gains `grammar` + `seed`

**Files:**
- Modify: `desktop/sidecar/src/llm/llama_engine.h:1-12` (includes + struct)
- Modify: `desktop/sidecar/src/llm/llama_engine.cpp` (static_assert near top of namespace)

- [ ] **Step 1: Add the fields to `GenOpts`**

In `desktop/sidecar/src/llm/llama_engine.h`, add `#include <cstdint>` to the include block, and extend the struct:

```cpp
struct GenOpts {
  int maxTokens = 1024;
  float temperature = 0.4f;
  std::string grammar = "";       // GBNF source; empty = no grammar sampler (plain path)
  uint32_t seed = 0xFFFFFFFFu;    // == LLAMA_DEFAULT_SEED (random). Literal here so this
                                  // header need not include <llama.h> (see header note above).
};
```

- [ ] **Step 2: Guard the seed constant in the .cpp (which DOES include `<llama.h>`)**

In `desktop/sidecar/src/llm/llama_engine.cpp`, after `namespace lisna::llm {` (around line 13), add:

```cpp
static_assert(0xFFFFFFFFu == LLAMA_DEFAULT_SEED,
              "GenOpts.seed default (llama_engine.h) must equal LLAMA_DEFAULT_SEED; "
              "llama.cpp changed the constant — update the header default.");
```

- [ ] **Step 3: Compile-check (configure + build the test target)**

Run (JOBS=1 — 8 GB):
```bash
cd desktop/sidecar && cmake -B build -DLISNA_WITH_TESTS=ON >/dev/null && cmake --build build --target sidecar_tests -j1 2>&1 | tail -5; cd -
```
Expected: build succeeds (exit 0). The static_assert holds; the struct compiles.

- [ ] **Step 4: Commit**

```bash
git add desktop/sidecar/src/llm/llama_engine.h desktop/sidecar/src/llm/llama_engine.cpp
git commit -m "feat(sidecar): GenOpts gains grammar + seed fields"
```

---

## Task 2: C++ sampler — feed seed to `dist`, grammar-first sampler, signal grammar-parse failure

`generate()` returns `void` today; change to `bool` so the protocol layer can emit a stream error when the GBNF fails to parse.

**Files:**
- Modify: `desktop/sidecar/src/llm/llama_engine.h:40-41` (declaration → `bool`)
- Modify: `desktop/sidecar/src/llm/llama_engine.cpp:148-216` (`generate` body)

- [ ] **Step 1: Change the declaration to return `bool`**

In `desktop/sidecar/src/llm/llama_engine.h`, update the comment + signature:

```cpp
  // Returns false ONLY on a setup failure the caller must surface (bad input,
  // tokenize failure, or GBNF that the grammar parser rejects). Returns true on
  // normal completion, including an early stop from a mid-stream decode error
  // (partial output already streamed via onToken).
  bool generate(const std::vector<ChatMessage>& messages, const GenOpts& opts,
                const std::function<void(const std::string&)>& onToken);
```

- [ ] **Step 2: Update the body — early-return `bool`, seed → dist, grammar-first**

In `desktop/sidecar/src/llm/llama_engine.cpp`, change the signature line to `bool LlamaEngine::generate(...)`. Replace the three early `return;` guards (input guard ~line 150, `if (n_prompt < 0) return;` ~line 173) with `return false;`. Replace the sampler-chain construction (currently lines ~187-193) with:

```cpp
  llama_sampler_chain_params sparams = llama_sampler_chain_default_params();
  llama_sampler* smpl = llama_sampler_chain_init(sparams);

  // Grammar-first: mask grammar-invalid tokens BEFORE the truncation samplers,
  // so top_k/top_p/penalties operate only on the grammar-valid set. This is the
  // safe single-pass form (the candidate set can't be emptied; grammar state
  // advances via the chain's accept). Empty grammar = plain path (no sampler).
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
  llama_sampler_chain_add(smpl, llama_sampler_init_top_k(50));
  llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.9f, 1));
  llama_sampler_chain_add(smpl, llama_sampler_init_penalties(64, 1.1f, 0.0f, 0.0f));
  llama_sampler_chain_add(smpl, llama_sampler_init_temp(opts.temperature));
  llama_sampler_chain_add(smpl, llama_sampler_init_dist(opts.seed));   // was LLAMA_DEFAULT_SEED
```

At the end of the function, after `llama_sampler_free(smpl);`, add `return true;`.

- [ ] **Step 3: Compile-check**

Run:
```bash
cd desktop/sidecar && cmake --build build --target sidecar_tests -j1 2>&1 | tail -5; cd -
```
Expected: builds (exit 0). The plain path (`grammar=""`, `seed=0xFFFFFFFF`) is behavior-identical; runtime grammar correctness is gated by Task 9.

- [ ] **Step 4: Commit**

```bash
git add desktop/sidecar/src/llm/llama_engine.h desktop/sidecar/src/llm/llama_engine.cpp
git commit -m "feat(sidecar): grammar-first sampler + seed-driven dist; generate returns bool"
```

---

## Task 3: C++ `json_protocol` — parse `grammar`/`seed`, emit stream error on grammar failure (TDD)

Type guards go in the SHAPE-validation block (before the `not_loaded` check) so they're unit-testable against an unloaded engine, matching the existing `Generate*` tests.

**Files:**
- Modify: `desktop/sidecar/src/ipc/json_protocol.cpp:118-167` (generate branch)
- Test: `desktop/sidecar/tests/test_json_protocol.cpp` (add cases near line 269)

- [ ] **Step 1: Write the failing gtests (shape guards + parsing)**

Append to `desktop/sidecar/tests/test_json_protocol.cpp` (after the last `Generate*` test, ~line 276):

```cpp
TEST(JsonProtocol, GenerateNonStringGrammarReturnsInvalidType) {
  auto r = nlohmann::json::parse(lisna::ipc::dispatch(
      R"({"id":"g1","type":"generate","messages":[{"role":"user","content":"hi"}],"grammar":123})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "invalid_type");
}

TEST(JsonProtocol, GenerateNonIntegerSeedReturnsInvalidType) {
  auto r = nlohmann::json::parse(lisna::ipc::dispatch(
      R"({"id":"g2","type":"generate","messages":[{"role":"user","content":"hi"}],"seed":"x"})"));
  EXPECT_EQ(r["type"], "error");
  EXPECT_EQ(r["code"], "invalid_type");
}
```

- [ ] **Step 2: Run — expect FAIL (guards don't exist; returns not_loaded)**

```bash
cd desktop/sidecar && cmake --build build --target sidecar_tests -j1 >/dev/null 2>&1 && ./build/sidecar_tests --gtest_filter='JsonProtocol.GenerateNonStringGrammar*:JsonProtocol.GenerateNonIntegerSeed*'; cd -
```
Expected: FAIL — both currently return `code:"not_loaded"`, not `invalid_type` (guards run after the engine-state check today).

- [ ] **Step 3: Add the guards in the shape block + parse into opts**

In `desktop/sidecar/src/ipc/json_protocol.cpp`, inside `if (type == "generate")`, AFTER the messages/prompt shape validation and BEFORE `if (!g_llm || !g_llm->loaded())` (line ~156), add:

```cpp
    // grammar/seed shape guards live here (before the engine-state check) so a
    // wrong-type field surfaces a shape error regardless of load state.
    if (req.contains("grammar") && !req["grammar"].is_string())
      return err("invalid_type", "grammar must be string");
    if (req.contains("seed") && !req["seed"].is_number_integer())
      return err("invalid_type", "seed must be integer");
```

Then, in the opts block (after `opts.temperature = ...`, line ~159), add:

```cpp
    opts.grammar = req.value("grammar", std::string{});
    if (req.contains("seed")) opts.seed = req["seed"].get<uint32_t>();
```

- [ ] **Step 4: Consume the `bool` from generate() — emit error vs done**

Replace the `g_llm->generate(...)` call + trailing `return done` (lines ~160-166) with:

```cpp
    const bool ok = g_llm->generate(msgs, opts,
                    [&](const std::string& tok) {
      emit_event(nlohmann::json{
          {"id", id}, {"type", "token"}, {"token", tok}
      }.dump());
    });
    if (!ok) return err("grammar_setup", "generation setup failed (see prior log line)");
    return nlohmann::json{{"id", id}, {"type", "done"}}.dump();
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd desktop/sidecar && cmake --build build --target sidecar_tests -j1 >/dev/null 2>&1 && ./build/sidecar_tests --gtest_filter='JsonProtocol.Generate*'; cd -
```
Expected: PASS (new guard tests + the existing `Generate*` tests still green — absent grammar/seed ⇒ unchanged).

- [ ] **Step 6: Commit**

```bash
git add desktop/sidecar/src/ipc/json_protocol.cpp desktop/sidecar/tests/test_json_protocol.cpp
git commit -m "feat(sidecar): parse grammar+seed in generate; stream-error on grammar failure"
```

---

## Task 4: TS — `generate` request type gains optional `grammar`/`seed`

**Files:**
- Modify: `desktop/src/shared/ipc-protocol.ts:72-83` (generate variant)

- [ ] **Step 1: Add the optional fields**

In `desktop/src/shared/ipc-protocol.ts`, the `generate` variant becomes:

```ts
  | {
      id: string;
      type: 'generate';
      messages: ChatMessage[];
      maxTokens?: number;
      temperature?: number;
      stop?: string[];
      /** GBNF source. Present only on the grammar-constrained path. */
      grammar?: string;
      /** RNG seed. Present only on the grammar-constrained (retry) path. */
      seed?: number;
    };
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @lisna/desktop run typecheck
```
Expected: exit 0 (additive optional fields; no caller breaks).

- [ ] **Step 3: Commit**

```bash
git add desktop/src/shared/ipc-protocol.ts
git commit -m "feat(shared): generate IPC request carries optional grammar+seed"
```

---

## Task 5: TS — `makeGrammarSidecar` adapter implementing `generateWithGrammar` (TDD)

**Files:**
- Modify: `desktop/src/main/sidecar/grammar-call.ts` (add adapter + imports)
- Test: `desktop/src/main/sidecar/__tests__/grammar-call.test.ts` (add a `/bin/cat` block)

- [ ] **Step 1: Write the failing test (drive against `/bin/cat`)**

In `desktop/src/main/sidecar/__tests__/grammar-call.test.ts`, add to the TOP
import block (eslint `import/first` — imports must not be mid-file):
`import { spawn } from 'node:child_process';`, `import { SidecarClient } from '../client';`,
and add `makeGrammarSidecar` to the existing `'../grammar-call'` import. Then
append this describe block at the end:

```ts
describe('makeGrammarSidecar.generateWithGrammar (against /bin/cat)', () => {
  it('sends grammar+seed as a single user message and accumulates tokens into {text, seed}', async () => {
    const proc = spawn('cat', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      const client = new SidecarClient(proc);
      const sidecar = makeGrammarSidecar(client);
      let sent: any = null;
      client.onRawLine((line) => {
        let obj: any;
        try { obj = JSON.parse(line); } catch { return; }
        if (obj.type !== 'generate') return;   // ignore cat's echo of our token/done lines
        sent = obj;
        proc.stdin!.write(JSON.stringify({ id: obj.id, type: 'token', token: '{"a":' }) + '\n');
        proc.stdin!.write(JSON.stringify({ id: obj.id, type: 'token', token: '1}' }) + '\n');
        proc.stdin!.write(JSON.stringify({ id: obj.id, type: 'done' }) + '\n');
      });
      const out = await sidecar.generateWithGrammar({
        prompt: 'P', grammar: 'root ::= "{"', seed: 4242, temperature: 0.4, maxTokens: 256,
      });
      expect(out).toEqual({ text: '{"a":1}', seed: 4242 });
      expect(sent.messages).toEqual([{ role: 'user', content: 'P' }]);
      expect(sent.grammar).toBe('root ::= "{"');
      expect(sent.seed).toBe(4242);
      expect(sent.maxTokens).toBe(256);
    } finally {
      proc.kill('SIGKILL');
    }
  });
});
```

- [ ] **Step 2: Run — expect FAIL (`makeGrammarSidecar` not exported)**

```bash
pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/__tests__/grammar-call.test.ts
```
Expected: FAIL — `makeGrammarSidecar is not a function` / import error.

- [ ] **Step 3: Implement the adapter**

In `desktop/src/main/sidecar/grammar-call.ts`, add imports at top:

```ts
import type { SidecarClient } from './client';
import { TIMEOUTS } from './timeouts';
```

Append at the end of the file:

```ts
/**
 * Concrete GrammarCapableSidecar backed by a SidecarClient. Wraps the combined
 * prompt as a single `user` message (so the GGUF chat template applies; avoids
 * the legacy `prompt`-field path), streams the grammar-constrained generation,
 * and accumulates tokens. Echoes the input seed (the C++ side does not return it;
 * callWithGrammar uses its own seed regardless).
 */
export function makeGrammarSidecar(client: SidecarClient): GrammarCapableSidecar {
  return {
    async generateWithGrammar({ prompt, grammar, seed, temperature, maxTokens }) {
      let text = '';
      for await (const tok of client.sendStream(
        {
          type: 'generate',
          messages: [{ role: 'user', content: prompt }],
          grammar,
          seed,
          temperature,
          maxTokens,
        },
        { timeoutMs: TIMEOUTS.GENERATE_NO_PROGRESS_MS },
      )) {
        text += tok;
      }
      return { text, seed };
    },
  };
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/__tests__/grammar-call.test.ts
```
Expected: PASS (new test + existing `callWithGrammar` tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/sidecar/grammar-call.ts desktop/src/main/sidecar/__tests__/grammar-call.test.ts
git commit -m "feat(sidecar): makeGrammarSidecar adapter implements generateWithGrammar"
```

---

## Task 6: TS — `ipc.ts` uses the adapter, drop the placeholder cast

**Files:**
- Modify: `desktop/src/main/ipc.ts:19` (import) and `:157-172` (`getCurrentSession`)

- [ ] **Step 1: Import the adapter**

In `desktop/src/main/ipc.ts`, add to the existing sidecar imports:

```ts
import { makeGrammarSidecar } from './sidecar/grammar-call';
```

- [ ] **Step 2: Replace the cast in `getCurrentSession`**

Replace the `sidecar:` line + its comment block (currently lines ~166-170) with:

```ts
        // Real grammar-capable sidecar (Task 5). NOTE: the LLM model is NOT
        // loaded on this IPC path — the renderer/finalize wiring (app-design
        // lane) must load it before invoking session/finalize, or the first
        // grammar call returns `not_loaded`. The offline-3b eval runner loads
        // the model itself, so it is the only end-to-end consumer today.
        sidecar: makeGrammarSidecar(client),
```

- [ ] **Step 3: Typecheck + run any ipc tests**

```bash
pnpm --filter @lisna/desktop run typecheck && pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/ipc/__tests__/session-finalize.test.ts
```
Expected: typecheck exit 0 (no `as unknown` remains); session-finalize tests still green (they inject a mock SessionContext, unaffected).

- [ ] **Step 4: Commit**

```bash
git add desktop/src/main/ipc.ts
git commit -m "feat(main): wire makeGrammarSidecar into session/finalize; drop placeholder cast"
```

---

## Task 7: eval — fixture → SessionTranscript adapter (TDD)

**Files:**
- Create: `desktop/eval/runners/fixture-to-transcript.ts`
- Test: `desktop/eval/runners/fixture-to-transcript.test.ts`

- [ ] **Step 1: Write the failing test**

Create `desktop/eval/runners/fixture-to-transcript.test.ts`:

```ts
import { it, expect } from 'vitest';
import { fixtureToSessionTranscript } from './fixture-to-transcript';
import type { FixtureMeta, FixtureTranscript } from '../fixtures/_schema';

const meta = { fixtureId: 'lec-1', family: 'lecture', language: 'ja', durationSec: 30,
  bucketSeconds: 10, scenarioTags: [], expectedSlots: [], sourceUrl: null } as FixtureMeta;

it('maps transcripts→transcriptSegments, derives endTs, carries speakers, synthesizes sessionId', () => {
  const ft = { bucket_seconds: 10, speakers: [{ id: 0 }],
    transcripts: [
      { ts: 0, text: 'いち', speakerId: 0 },
      { ts: 10, text: 'に', speakerId: 0 },
    ] } as FixtureTranscript;
  const st = fixtureToSessionTranscript(ft, meta);
  expect(st.sessionId).toBe('lec-1');                  // transcript.sessionId ?? meta.fixtureId
  expect(st.speakers).toEqual([{ id: 0 }]);
  expect(st.transcriptSegments[0]).toEqual({ ts: 0, endTs: 10, text: 'いち', speakerId: 0 });
  // last segment: no successor → ts + bucket_seconds
  expect(st.transcriptSegments[1]).toEqual({ ts: 10, endTs: 20, text: 'に', speakerId: 0 });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

```bash
pnpm --filter @lisna/desktop exec vitest run eval/runners/fixture-to-transcript.test.ts
```
Expected: FAIL — cannot find `./fixture-to-transcript`.

- [ ] **Step 3: Implement the adapter**

Create `desktop/eval/runners/fixture-to-transcript.ts`:

```ts
import type { FixtureMeta, FixtureTranscript } from '../fixtures/_schema';
import type { SessionTranscript } from '../../src/shared/note-schema/transcript';

/**
 * Adapt an eval FixtureTranscript to the pipeline's SessionTranscript.
 * endTs = next segment's ts, or (last) ts + bucket_seconds. sessionId is
 * synthesized from the optional transcript id, else the fixture id.
 */
export function fixtureToSessionTranscript(
  ft: FixtureTranscript,
  meta: FixtureMeta,
): SessionTranscript {
  const segs = ft.transcripts;
  return {
    sessionId: ft.sessionId ?? meta.fixtureId,
    speakers: ft.speakers,
    transcriptSegments: segs.map((s, i) => ({
      ts: s.ts,
      endTs: segs[i + 1]?.ts ?? s.ts + ft.bucket_seconds,
      text: s.text,
      speakerId: s.speakerId,
    })),
  };
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
pnpm --filter @lisna/desktop exec vitest run eval/runners/fixture-to-transcript.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit (cross-lane)**

```bash
git add desktop/eval/runners/fixture-to-transcript.ts desktop/eval/runners/fixture-to-transcript.test.ts
git commit -m "$(cat <<'EOF'
feat(eval): FixtureTranscript → SessionTranscript adapter

Cross-lane: ai-infra → eval
EOF
)"
```

---

## Task 8: eval — `offline-3b` runner + family guard (TDD for the guard) + smoke fixture + gated test

**Files:**
- Create: `desktop/eval/runners/offline-3b.ts`
- Test: `desktop/eval/runners/offline-3b.test.ts` (family-guard unit test — no model)
- Create: `desktop/eval/fixtures/lecture/smoke-ja-mini/meta.json`
- Create: `desktop/eval/fixtures/lecture/smoke-ja-mini/transcript.json`
- Create: `desktop/eval/runners/offline-3b.smoke.test.ts` (env-gated real run; executed in Task 9)

- [ ] **Step 1: Write the failing family-guard test**

Create `desktop/eval/runners/offline-3b.test.ts`:

```ts
import { it, expect } from 'vitest';
import { makeOffline3bRunner } from './offline-3b';
import type { FixtureMeta, FixtureTranscript } from '../fixtures/_schema';

const ft = { bucket_seconds: 10, speakers: [{ id: 0 }],
  transcripts: [{ ts: 0, text: 'x', speakerId: 0 }] } as FixtureTranscript;

it('throws UNSUPPORTED_FAMILY before spawning for interview/brainstorm', async () => {
  const runner = makeOffline3bRunner({ sidecarBin: '/nonexistent', llmModelPath: '/nonexistent' });
  const meta = { fixtureId: 'i1', family: 'interview', language: 'ja', durationSec: 5,
    bucketSeconds: 10, scenarioTags: [], expectedSlots: [], sourceUrl: null } as FixtureMeta;
  await expect(runner.run({ meta, transcript: ft }))
    .rejects.toThrow('UNSUPPORTED_FAMILY_FOR_OFFLINE_RUNNER:interview');
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

```bash
pnpm --filter @lisna/desktop exec vitest run eval/runners/offline-3b.test.ts
```
Expected: FAIL — cannot find `./offline-3b`.

- [ ] **Step 3: Implement the runner**

Create `desktop/eval/runners/offline-3b.ts`:

```ts
import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import type { PipelineRunner, PipelineResult } from './pipeline-stub';
import { fixtureToSessionTranscript } from './fixture-to-transcript';
import { SidecarClient } from '../../src/main/sidecar/client';
import { LlamaCppLLM } from '../../src/main/engines/llama-cpp-llm';
import { makeGrammarSidecar } from '../../src/main/sidecar/grammar-call';
import { finalizeLecture, finalizeMeeting } from '../../src/main/sidecar/orchestrator';
import type { GrammarCapableSidecar } from '../../src/main/sidecar/grammar-call';
import { modelProfiles } from '../../src/shared/models/profiles';
import '../../src/shared/families/lecture/core';
import '../../src/shared/families/meeting/core';

/** Wrap a sidecar so per-chunk attempt counts can be recovered without editing
 *  finalize: tally generateWithGrammar calls; the caller snapshots between chunk
 *  progress events. */
function countingProxy(inner: GrammarCapableSidecar): { sidecar: GrammarCapableSidecar; total: () => number } {
  let calls = 0;
  return {
    sidecar: { generateWithGrammar: (req) => { calls++; return inner.generateWithGrammar(req); } },
    total: () => calls,
  };
}

export function makeOffline3bRunner(opts: { sidecarBin: string; llmModelPath: string }): PipelineRunner {
  return {
    id: 'offline-3b',
    modelId: 'llama-3.2-3b-q4-km',
    promptVariantId: 'default',
    async run({ meta, transcript }): Promise<PipelineResult> {
      // Family guard BEFORE spawning anything (cheap, unit-testable).
      if (meta.family !== 'lecture' && meta.family !== 'meeting') {
        throw new Error(`UNSUPPORTED_FAMILY_FOR_OFFLINE_RUNNER:${meta.family}`);
      }
      const profile = Object.values(modelProfiles).find(
        (p) => p.filename === basename(opts.llmModelPath),
      );
      if (!profile) throw new Error('UNKNOWN_MODEL_PROFILE');

      const proc = spawn(opts.sidecarBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      const client = new SidecarClient(proc);
      const t0 = Date.now();
      try {
        await client.waitForReady(10_000);
        const llm = new LlamaCppLLM(client);
        await llm.loadModel(opts.llmModelPath);
        const proxy = countingProxy(makeGrammarSidecar(client));
        const st = fixtureToSessionTranscript(transcript, meta);

        // Per-chunk attempts: chunk progress fires BEFORE that chunk's call(s),
        // so snapshot the call count at each chunk start; chunk i's attempts =
        // (next chunk's start, or the final count) − chunk i's start.
        const chunkStarts: number[] = [];
        const onProgress = (e: { phase: string }) => {
          if (e.phase === 'chunk') chunkStarts.push(proxy.total());
        };

        let note: unknown;
        try {
          if (meta.family === 'lecture') {
            ({ note } = await finalizeLecture({ sessionId: st.sessionId, transcript: st,
              sidecar: proxy.sidecar, modelProfile: profile, onProgress }));
          } else {
            ({ note } = await finalizeMeeting({ sessionId: st.sessionId, transcript: st,
              sidecar: proxy.sidecar, modelProfile: profile, diarizationStatus: 'disabled', onProgress }));
          }
        } finally {
          await llm.unloadModel().catch(() => {});
        }
        const finalCount = proxy.total();
        const retryAttempts = chunkStarts.map((start, i) => (chunkStarts[i + 1] ?? finalCount) - start);
        return { note, retryAttempts, runMs: Date.now() - t0 };
      } finally {
        proc.kill('SIGKILL');
      }
    },
  };
}
```

- [ ] **Step 4: Run the guard test — expect PASS**

```bash
pnpm --filter @lisna/desktop exec vitest run eval/runners/offline-3b.test.ts
```
Expected: PASS (guard throws before spawn; `/nonexistent` never used).

- [ ] **Step 5: Create the minimal JA lecture smoke fixture**

Create `desktop/eval/fixtures/lecture/smoke-ja-mini/meta.json`:

```json
{
  "fixtureId": "smoke-ja-mini",
  "family": "lecture",
  "language": "ja",
  "durationSec": 40,
  "bucketSeconds": 10,
  "scenarioTags": ["smoke", "plumbing"],
  "expectedSlots": [],
  "sourceUrl": null,
  "notes": "Plumbing-only smoke fixture for the grammar real-run gate. NOT part of the founder-owned scored eval set."
}
```

Create `desktop/eval/fixtures/lecture/smoke-ja-mini/transcript.json`:

```json
{
  "sessionId": "smoke-ja-mini",
  "speakers": [{ "id": 0 }],
  "bucket_seconds": 10,
  "transcripts": [
    { "ts": 0,  "text": "今日は二次方程式の解の公式について説明します。", "speakerId": 0 },
    { "ts": 10, "text": "まず判別式が正のとき、実数解が二つ存在します。", "speakerId": 0 },
    { "ts": 20, "text": "判別式がゼロのときは重解になります。", "speakerId": 0 },
    { "ts": 30, "text": "最後に具体例として、エックス二乗マイナス五エックスプラス六イコールゼロを解きます。", "speakerId": 0 }
  ]
}
```

- [ ] **Step 6: Write the env-gated real-run smoke test (executed in Task 9)**

Create `desktop/eval/runners/offline-3b.smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureMetaSchema, FixtureTranscriptSchema } from '../fixtures/_schema';
import { makeOffline3bRunner } from './offline-3b';
import { LECTURE_RULES } from '../contract/families/lecture';
import { runContractTest } from '../contract/contract-test';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const llmModel = process.env.LISNA_TEST_LLM_MODEL ?? '';
const sidecarBin = resolve(__dirname, '../../resources/sidecar');
const fixtureDir = resolve(__dirname, '../fixtures/lecture/smoke-ja-mini');
const gate = llmModel && existsSync(sidecarBin) ? describe : describe.skip;

gate('offline-3b grammar real-run gate (JA lecture)', () => {
  it('produces valid JSON that parses to a schema-valid LectureNote with ≥1 section', async () => {
    const meta = FixtureMetaSchema.parse(JSON.parse(readFileSync(join(fixtureDir, 'meta.json'), 'utf8')));
    const transcript = FixtureTranscriptSchema.parse(JSON.parse(readFileSync(join(fixtureDir, 'transcript.json'), 'utf8')));
    const runner = makeOffline3bRunner({ sidecarBin, llmModelPath: llmModel });
    const { note, retryAttempts } = await runner.run({ meta, transcript });

    const ct = runContractTest({ family: 'lecture', schema: z.object({}).passthrough(),
      note: { ...(note as object), _meta: { expectedSlots: meta.expectedSlots } },
      rules: LECTURE_RULES, transcript });
    expect(ct.schemaParse, JSON.stringify(ct.schemaParseError)).toBe('PASS'); // runContractTest returns 'PASS'|'FAIL', not boolean
    expect((note as { sections?: unknown[] }).sections?.length ?? 0).toBeGreaterThanOrEqual(1);
    // Retry envelope (Spike 0.1): ≤2 attempts per chunk typical.
    for (const a of retryAttempts) expect(a).toBeLessThanOrEqual(3);
    console.log('[gate] retryAttempts/chunk:', retryAttempts);
  }, 300_000);
});
```

- [ ] **Step 7: Verify it SKIPS without env (do not run the model yet)**

```bash
pnpm --filter @lisna/desktop exec vitest run eval/runners/offline-3b.smoke.test.ts
```
Expected: 1 skipped (no `LISNA_TEST_LLM_MODEL`). Confirms gating works.

- [ ] **Step 8: Commit (cross-lane)**

```bash
git add desktop/eval/runners/offline-3b.ts desktop/eval/runners/offline-3b.test.ts desktop/eval/runners/offline-3b.smoke.test.ts desktop/eval/fixtures/lecture/smoke-ja-mini/
git commit -m "$(cat <<'EOF'
feat(eval): offline-3b runner + JA lecture smoke fixture + gated real-run test

Cross-lane: ai-infra → eval
EOF
)"
```

---

## Task 9: REAL-MODEL GATE — rebuild sidecar, run the grammar path on the real 3B

This is the Section-5 validation gate, not a formality. **Foreground only; kill the process after.**

**Files:** none (produces `desktop/resources/sidecar` rebuild + a gate result)

- [ ] **Step 1: Rebuild the sidecar with the C++ changes**

Use the canonical build (M1-safe, copies the binary to `desktop/resources/sidecar`):
```bash
# via the lisna-sidecar-rebuild skill (preferred), or directly:
cd desktop/sidecar && cmake --build build -j1 2>&1 | tail -8 && \
  cp build/lisna_sidecar ../resources/sidecar && md5 ../resources/sidecar; cd -
```
Expected: build exit 0; fresh `desktop/resources/sidecar` (md5 differs from the pre-change binary).

- [ ] **Step 2: Run the gate (FOREGROUND, real 3B)**

```bash
LISNA_TEST_LLM_MODEL="$HOME/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf" \
  pnpm --filter @lisna/desktop exec vitest run eval/runners/offline-3b.smoke.test.ts 2>&1 | tail -30
```
Expected: PASS — schema-valid `LectureNote`, ≥1 section, `retryAttempts/chunk` logged within envelope.

- [ ] **Step 3: Clean up any survivor inference processes (8 GB hygiene)**

```bash
pkill -9 -f llama-completion 2>/dev/null; pkill -9 -f lisna_sidecar 2>/dev/null; ps -ef | grep -E "llama|lisna_sidecar" | grep -v grep || echo "clean"
```
Expected: `clean`.

- [ ] **Step 4: Decision gate**
  - **PASS** → grammar-first is validated on the sidecar; proceed to Task 10.
  - **FAIL** (invalid JSON / 0 sections / retries blow the envelope / decode assert) → grammar-first diverges from the spike. **Do NOT force it.** STOP and switch to the documented fallback: link llama.cpp `common` (add `common` to `target_link_libraries` in `desktop/sidecar/CMakeLists.txt`) and replace the hand-rolled chain in `llama_engine.cpp` with `common_sampler` (`grammar_first=false` + reject-resample), then re-run this gate. Record the outcome in the spec's Section 5.

- [ ] **Step 5: Commit the rebuilt binary**

```bash
git add desktop/resources/sidecar
git commit -m "build(sidecar): rebuild with grammar+seed; real-3B grammar gate PASS"
```

---

## Task 10: Full verification + handoff

**Files:** none (verification) — fix-and-commit only if something is red.

- [ ] **Step 1: Full desktop checks**

```bash
pnpm --filter @lisna/desktop run typecheck && pnpm --filter @lisna/desktop lint && \
  pnpm --filter @lisna/desktop exec vitest run src/main/sidecar src/shared eval/runners/fixture-to-transcript.test.ts eval/runners/offline-3b.test.ts
```
Expected: typecheck 0, lint 0, all listed vitest files green. Paths are relative to the `desktop/` package (pnpm runs the command there). `src/main/sidecar` + `src/shared` are under `src/` so they're spike-test-free (`pitfalls.md (vitest-scope)` — restrict to `src/` or explicit files; never a bare repo-wide `vitest run`); the eval files are passed explicitly.

> **Scope caveat:** `typecheck` (`tsc` `include: src/**`) and `lint` (`eslint src`) cover ONLY `src/` — NOT `desktop/eval/`. So the offline-3b runner is validated by its vitest unit test (Task 8) + the Task 9 real-model gate (which exercises its finalize-call path at runtime), not by CI typecheck/lint. `makeGrammarSidecar` lives in `src/` and IS covered by both.

- [ ] **Step 2: C++ test suite green**

```bash
cd desktop/sidecar && ./build/sidecar_tests 2>&1 | tail -5; cd -
```
Expected: all gtests pass (incl. the new grammar/seed guard tests).

- [ ] **Step 3: Confirm zero overlap with PR #66 is still true (it may have merged)**

```bash
git fetch origin >/dev/null 2>&1; git --no-pager diff --stat origin/main...HEAD
```
Expected: touch-list = the C++ files, `ipc-protocol.ts`, `grammar-call.ts`, `ipc.ts`, `desktop/eval/**`, `desktop/resources/sidecar`, docs — none of PR #66's files (`orchestrator.ts`, `session-finalize.ts`, `chunked-note.ts`). If main moved under us, rebase.

- [ ] **Step 4: Update HANDOFF + tee up the renderer follow-up**

Add a HANDOFF "Now" note: P0 engine + eval-scorer landed; the renderer wiring (app-design lane, Plan 3 Tasks 11–12) + the finalize-IPC model-load step are now unblocked. Commit:

```bash
git add docs/HANDOFF.md
git commit -m "docs(handoff): grammar gen engine+scorer landed; renderer wiring unblocked"
```

- [ ] **Step 5: Push + open PR (CONFIRM with the user first — push is gated)**

Push triggers the pre-push expert-review gate; an independent reviewer must approve HEAD before the push proceeds. Do NOT push without the user's go-ahead.

---

## Notes for the executor
- **Lane discipline:** stay in this worktree; never `git checkout`/`pull`/`reset` a shared branch. `desktop/eval/**` commits carry `Cross-lane: ai-infra → eval`.
- **8 GB:** Tasks 9 is the only real-inference step — foreground, single sample, kill after. Tasks 1–8 are compile/unit only.
- **C++ build cost:** first `cmake -B build` is a cold build (~minutes with `-j1`); subsequent `--build` is incremental. `-j1` is the 8 GB-safe parallelism.
- **If the gate (Task 9) fails:** the `common_sampler` fallback is a real, scoped pivot — not a failure of the plan. Take it.

# Design — C++ grammar-constrained generation (engine + eval scorer)

**Created:** 2026-05-28
**Lane:** ai-infra (primary) + eval (offline runner) + spec-docs (this doc)
**Worktree:** `.claude/worktrees/feat-cpp-grammar-gen` · **Branch:** `worktree-feat-cpp-grammar-gen` (off `origin/main` `6fa795f`)
**Status:** design — pending user review before writing the implementation plan
**Backlog:** HANDOFF "Now" [P0] "Land C++ grammar-constrained generation"

---

## 1. Problem

Lisna v2 makes structured notes on-device: speech → STT → local Llama 3B → a
schema-constrained JSON note (Lecture / Meeting families). The TypeScript half of
the structured pipeline is merged (Plans 2–7) but it cannot run: the C++ sidecar
that drives the model has no way to be told to (a) constrain output to a grammar
(the GBNF "fill-in form" that forces valid, schema-shaped JSON) or (b) use a
specific RNG seed. The bridging TS method (`SidecarClient.generateWithGrammar`)
does not exist — only an interface + test mocks.

Two downstream consequences:
- `finalizeLecture` / `finalizeMeeting` (`desktop/src/main/sidecar/orchestrator.ts`)
  fail at the first grammar call.
- The eval harness (Plan 7) scores a hardcoded **stub** note
  (`desktop/eval/runners/pipeline-stub.ts`), not real model output.

**Load-bearing constraint (from the backlog):** `GenOpts` must gain `seed` AND
the seed must be fed to the sampler. The merged retry wrapper
(`callWithGrammar`, `grammar-call.ts`) retries a failed generation with a fresh
seed (`baseSeed + (attempt-1)*100`). If the seed is not actually fed to the
sampler, every retry reproduces identical output and the Spike-0.1 retry
contract silently no-ops.

## 2. Goal & scope

**Goal:** make grammar-constrained generation actually run, and prove it with a
real 3B run, so (1) `finalizeLecture`/`finalizeMeeting` work and (2) the eval
harness scores real output.

**In scope** (two pieces, decided with the user):
- **Engine** — C++ `GenOpts.seed` + `GenOpts.grammar`; the sampler honors both;
  the generate IPC envelope carries them; `generateWithGrammar` on the TS side.
- **Scorer** — an `offline-3b` eval runner that runs the real model through
  `finalizeLecture`/`finalizeMeeting`, replacing the stub for real scoring. This
  runner is also the real-model verification vehicle.

**Out of scope** (separate lanes / follow-ups, explicitly NOT in this effort):
- Renderer / app-screen wiring (preload `finalize` binding, `Recording.tsx`,
  a structured `NoteView`) — **app-design lane**, Plan 3 Tasks 11–12.
- Note persistence / real note IDs — Plan 3 Task 13.
- The `session/finalize` **IPC** path's model-load step (see Section 9) — it
  belongs with the renderer wiring above.
- Surfacing per-chunk retry counts through `finalizeLecture`'s telemetry — a
  small follow-up once the contended `orchestrator.ts` finalize functions are
  free of PR #66.

## 3. Background — what already exists (verified against `origin/main` 6fa795f)

The TS chain is built and merged; this effort fills the holes it was written
against:

- `grammar-call.ts`
  - `callWithGrammar<T>` — retry wrapper. Fresh seed per attempt, constant temp,
    catches JSON.parse + Zod failure + generator rejection, surfaces per-attempt
    `{seed, latencyMs, ok, reason}`.
  - `GrammarCapableSidecar` interface: `generateWithGrammar({prompt, grammar,
    seed, temperature, maxTokens}) => Promise<{text, seed}>`.
  - `makeSidecarGenerator(client)` binds a `GrammarCapableSidecar` to the
    wrapper's `LlmGenerator`.
- `orchestrator.ts` — `finalizeLecture`/`finalizeMeeting`: chunk transcript →
  `callWithGrammar` per chunk (grammar from `zodToGbnf(fam.schema, …)`) →
  post-decode pipeline → deterministic merge → schema-validated Note. They take
  a `GrammarCapableSidecar`. **No change needed here.**
- `ipc.ts` — `registerSessionFinalize` is wired; `getCurrentSession` resolves the
  live orchestrator + model paths + sidecar client, currently passing the raw
  client via an `as unknown as SessionContext['sidecar']` cast (placeholder until
  `generateWithGrammar` exists).
- C++ `llama_engine.cpp` `generate()` already applies the GGUF chat template
  (`format_chat_prompt`) and runs a sampler chain
  `top_k(50) → top_p(0.9,1) → penalties(64,1.1,0,0) → temp(opts.temperature) →
  dist(LLAMA_DEFAULT_SEED)`.
- C++ `json_protocol.cpp` `generate` branch accepts `messages[]` (preferred) or
  legacy `prompt`, reads `maxTokens`/`temperature`, and **ignores** any
  `grammar`/`seed`.
- `zodToGbnf` (`desktop/src/shared/note-schema/zod-to-gbnf.ts:54`) always emits
  `root ::= <Name>`, so the grammar entry symbol is literally `"root"`.
- llama.cpp is vendored at `desktop/sidecar/deps/llama.cpp` (commit `856c3ad`).
  `llama_sampler_init_grammar(vocab, grammar_str, "root")` returns NULL on parse
  failure; `llama_sampler_init_dist(uint32_t seed)`; `LLAMA_DEFAULT_SEED ==
  0xFFFFFFFF` (`llama.h:37`).

## 4. The three gaps and how they're filled

### Gap A — C++ engine: `GenOpts` + sampler (lane: ai-infra)

**`desktop/sidecar/src/llm/llama_engine.h`** — extend `GenOpts`:

```cpp
struct GenOpts {
  int maxTokens = 1024;
  float temperature = 0.4f;
  std::string grammar = "";          // GBNF; empty = no grammar sampler
  uint32_t seed = 0xFFFFFFFFu;        // == LLAMA_DEFAULT_SEED (random). Literal
                                      // avoids pulling <llama.h> into this header
                                      // (deliberate: see header's existing note).
};
```

`0xFFFFFFFFu` is asserted-equal to `LLAMA_DEFAULT_SEED` (`llama.h:37`, verified);
a `static_assert` in `llama_engine.cpp` (which *does* include `<llama.h>`) guards
against an upstream change to the constant.

**`desktop/sidecar/src/llm/llama_engine.cpp`** `generate()`:
- Feed `opts.seed` to the terminal sampler: `llama_sampler_init_dist(opts.seed)`
  instead of the hardcoded constant. The plain path passes no seed → default
  `0xFFFFFFFFu` → today's random behavior preserved exactly.
- When `opts.grammar` is non-empty, build the grammar sampler and add it **first**
  in the chain (grammar-first; see Section 5 for why and the validation gate):
  ```cpp
  llama_sampler* grmr = llama_sampler_init_grammar(impl_->vocab, opts.grammar.c_str(), "root");
  if (!grmr) { /* emit structured error event; abort this generate */ }
  llama_sampler_chain_add(smpl, grmr);   // FIRST
  // … then top_k, top_p, penalties, temp, dist(opts.seed)
  ```
  NULL means the GBNF failed to parse — surface a structured `error` (do not
  silently degrade to ungrammatical output).

### Gap B — C++ generate IPC envelope (lane: ai-infra)

**`desktop/sidecar/src/ipc/json_protocol.cpp`** `generate` branch — read two new
**optional** fields after `maxTokens`/`temperature`:

```cpp
opts.grammar = req.value("grammar", std::string{});   // absent → "" → no grammar
if (req.contains("seed")) {
  if (!req["seed"].is_number_integer()) return err("invalid_type", "seed must be integer");
  opts.seed = req["seed"].get<uint32_t>();
}                                                      // absent → struct default (random)
```

Absent fields ⇒ byte-identical to today, so the existing plain path AND PR #66's
chunked plain path are untouched.

**`desktop/src/shared/ipc-protocol.ts`** — add optional fields to the `generate`
`SidecarRequest` variant:

```ts
| { id: string; type: 'generate'; messages: ChatMessage[];
    maxTokens?: number; temperature?: number; stop?: string[];
    grammar?: string; seed?: number }
```

### Gap C — TS bridge: `generateWithGrammar` (lane: ai-infra)

A thin adapter (chosen over a method on `SidecarClient`, which documents itself
as a process-agnostic transport that should not know domain concepts). The
adapter mirrors the existing `makeSidecarGenerator` factory shape.

New `makeGrammarSidecar(client: SidecarClient): GrammarCapableSidecar`
(location: `desktop/src/main/sidecar/grammar-call.ts`, next to the interface it
satisfies):

```ts
export function makeGrammarSidecar(client: SidecarClient): GrammarCapableSidecar {
  return {
    async generateWithGrammar({ prompt, grammar, seed, temperature, maxTokens }) {
      let text = '';
      for await (const tok of client.sendStream(
        { type: 'generate',
          messages: [{ role: 'user', content: prompt }],  // single user turn → chat template applies, avoids legacy `prompt` path
          grammar, seed, temperature, maxTokens },
        { timeoutMs: TIMEOUTS.GENERATE_NO_PROGRESS_MS },
      )) text += tok;
      return { text, seed };   // C++ does not echo the seed; the wrapper uses its own seed anyway
    },
  };
}
```

**`desktop/src/main/ipc.ts`** `getCurrentSession` — replace the `as unknown`
cast with `sidecar: makeGrammarSidecar(client)`. No cast remains.

Module note: `makeGrammarSidecar` lives next to the interface in
`grammar-call.ts`, which today imports only `zod`; it gains a type import of
`SidecarClient` (`./client`) and `TIMEOUTS` (`./timeouts`). eslint (gated by
`desktop-ci`, Section 8) catches a missed import.

### Gap D (scorer) — `offline-3b` eval runner (lane: eval)

New `desktop/eval/runners/offline-3b.ts` implementing `PipelineRunner`
(`run({meta, transcript}) => {note, retryAttempts, runMs}`):
- Spawn the sidecar, `waitForReady`, **load the 3B LLM model** (the runner owns
  model load — see Section 9), build `SessionTranscript` from the eval
  `FixtureTranscript` via a small local adapter: `{ts,text,speakerId}[]` →
  `transcriptSegments[]` with `endTs` = next segment's `ts` or `ts +
  bucket_seconds`, `speakers` carried through, and a synthesized
  `sessionId = transcript.sessionId ?? meta.fixtureId` (`SessionTranscript.sessionId`
  is required; `FixtureTranscript.sessionId` is optional and `FixtureMeta` exposes
  `fixtureId`, not `sessionId`).
- Branch on `meta.family`: `'lecture'` → `finalizeLecture`, `'meeting'` →
  `finalizeMeeting`, `'interview'`/`'brainstorm'` → throw
  `UNSUPPORTED_FAMILY_FOR_OFFLINE_RUNNER:<family>` (no finalize path until Plan 6;
  the real-run gate uses a lecture fixture, so this is scope-consistent). Pass
  the sidecar as `makeGrammarSidecar(client)` wrapped in the counting proxy below.
  Unload + kill the sidecar in `finally`.
- **`retryAttempts` without editing `orchestrator.ts`:** wrap the sidecar in a
  counting proxy that tallies `generateWithGrammar` calls, delimited by
  `finalizeLecture`'s existing `onProgress({phase:'chunk', chunkIndex})` events →
  real per-chunk attempt counts. (If the proxy proves fiddly, emit `[]`
  "unknown" — never a fabricated `[1,1,…]` that would report an all-clean retry
  histogram.)
- Wire it as a selectable runner alongside `STUB_RUNNER` (CLI flag or runner id),
  so `runSingleFixture` scores real output.

## 5. Sampler approach — the one genuinely uncertain decision

The Spike-0.1 GBNF was validated by running llama.cpp's **`llama-completion`
example binary** (`desktop/spikes/phase-0/01-zod-to-gbnf/llama-cli-rig.ts`),
which links `common` and uses `common_sampler`. Our sidecar deliberately links
only core `whisper llama` (binary ≈ 234 KB; examples/tools/`common` stripped in
`desktop/sidecar/CMakeLists.txt`). So **the spike proved the grammar *text*, not
the sidecar's way of applying it.**

`common/sampling.cpp` supports two correct modes:
- **grammar-last + reject-resample** (`grammar_first=false`, the example default):
  run the chain, check if the sampled token is grammar-valid; if not, re-apply
  grammar+chain. The resample fallback is what makes grammar-last safe.
- **grammar-first** (`grammar_first=true`, `sampling.cpp:577-579`): apply grammar
  (mask invalid tokens to -inf) *before* the chain.

**Decision: grammar-first, single-pass, in the core sampler chain.** Rationale:
- It is a supported llama.cpp mode, and it is the **safe** single-pass form:
  masking first means `top_k`/`top_p`/`penalties` operate on the grammar-valid
  set, so the candidate set cannot be emptied (the `cur_p.selected == -1`
  assertion the reviewer flagged applies to grammar-*last* WITHOUT resample,
  which we will not use). At any reachable grammar state ≥1 token is valid.
- `llama_sampler_sample` calls `accept` on the selected token, and
  `llama_sampler_chain` propagates `accept` to each member
  (`src/llama-sampler.cpp`), so an in-chain grammar sampler advances its state
  correctly each step. No prompt-prefill is needed: the grammar matches the
  assistant's JSON output from its root.
- It keeps the sidecar minimal (no `common` link, no binary bloat).

**Residual risk + gate.** grammar-first is not byte-identical to the spike's
grammar-last-resample path, so the per-attempt success/quality profile is
*unproven for the sidecar*. Therefore:
- **The real-model run is a validation GATE, not a final formality.** The engine
  is not "done" until a real 3B run produces valid, schema-parseable JSON through
  the sidecar's grammar-first path (Section 8).
- **Documented fallback:** if the real run shows grammar-first diverging from the
  spike's retry profile (markedly higher parse-failure / retry rate, or degraded
  content), link llama.cpp `common` and adopt `common_sampler`
  (`grammar_first=false` + resample) for exact spike parity. This is the
  heavier-but-proven path, held in reserve.

## 6. Data flow (end-to-end, the in-scope eval path)

```
offline-3b runner
  → spawn sidecar, load 3B (runner-owned)
  → adapt FixtureTranscript → SessionTranscript
  → finalizeLecture({ transcript, sidecar: countingProxy(makeGrammarSidecar(client)), modelProfile })
      → chunkTranscript → per chunk:
          callWithGrammar({ prompt, grammar=zodToGbnf(schema), baseSeed+i, temp, maxAttempts:3 })
            → makeSidecarGenerator → generateWithGrammar({prompt, grammar, seed, …})
              → client.sendStream({type:'generate', messages:[{user:prompt}], grammar, seed, …})
                → C++ json_protocol generate: opts.grammar/opts.seed set
                  → LlamaEngine::generate: chat template → tokenize
                    → sampler chain [grammar(root) → top_k → top_p → penalties → temp → dist(seed)]
                    → stream tokens → {type:'token'}… {type:'done'}
              ← accumulate tokens → {text, seed}
            ← JSON.parse + Zod (retry with fresh seed on failure)
          → post-decode pipeline → partial
      → deterministic merge → schema-validated Note
  → contract test + LLM judge score (real output)
```

## 7. Error handling
- GBNF parse failure (`llama_sampler_init_grammar` returns NULL) → structured
  `{type:'error', code:'grammar_parse', …}` event; abort that generate. The TS
  `sendStream` surfaces it as a stream error → `callWithGrammar` records a failed
  attempt and retries (fresh seed won't fix a malformed grammar, so all attempts
  fail → `CHUNK_FAILED` — correct, loud, not silent).
- `seed` wrong type over IPC → `invalid_type` error (matches existing field
  guards in `json_protocol.cpp`).
- Truncation / runaway within the grammar (hits `maxTokens` before closing JSON)
  → invalid JSON → `callWithGrammar` retry — exactly the failure class the
  Spike-0.1 retry contract exists to absorb.
- Backward compatibility: plain path (`LlamaCppLLM.generate`) sends no
  grammar/seed → JSON omits them → C++ `req.value(...)` defaults → byte-identical.

## 8. Verification

**Fast, automatic (no model) — run in CI + locally:**
- Protocol round-trip: `generate` request with `grammar`/`seed` serializes and
  parses through the shared type; absent fields stay absent.
- `makeGrammarSidecar.generateWithGrammar`: against a fake line-buffered child
  (the pattern in `desktop/src/main/sidecar/__tests__/client.test.ts`), asserts
  it sends a single-user-message `generate` with grammar+seed, accumulates a
  multi-token stream into the right `{text, seed}`.
- (C++) `json_protocol` generate branch parses `grammar`/`seed`, rejects wrong
  `seed` type, defaults when absent (extend `desktop/sidecar/tests`).
- Existing C++ + TS suites stay green; `pnpm --filter @lisna/desktop lint` clean
  (eslint catches unused imports tsc misses — `desktop-ci` gates on it).

**Real-model gate (one run, me, local) — the Section-5 validation:**
- Rebuild the sidecar (lisna-sidecar-rebuild skill) after the C++ change.
- Run the `offline-3b` runner on one JA lecture fixture; assert: valid JSON
  parse, schema-valid `LectureNote`, ≥1 real section, retry attempts within the
  Spike-0.1 envelope (≤2 per chunk typical).
- **8 GB discipline (hard):** foreground only; `pkill -9 -f llama-completion`
  after; never `run_in_background` for inference; one sample at a time.

## 9. The model-load boundary (honest scope line)

`getCurrentSession` (`ipc.ts`) and `routeLecture`/`routeMeeting`
(`session-finalize.ts`) do **not** load the LLM (unlike `orchestrator.stop()`,
which loads at `orchestrator.ts:141`). So:
- **In scope — works end-to-end:** the `offline-3b` runner loads the model
  itself, so it exercises the full grammar path for real.
- **Out of scope — known gap:** the `session/finalize` **IPC/renderer** path
  still needs a model-load step before `generateWithGrammar` (else `not_loaded`).
  That belongs with the renderer wiring (app-design lane) and is recorded as a
  follow-up. This effort therefore makes the structured pipeline *runnable and
  proven via eval*, not yet reachable from the app's Stop button.

## 10. Coordination

- **Worktree** `feat-cpp-grammar-gen` off `origin/main`. A fresh worktree has an
  empty `deps/llama.cpp` submodule and no `node_modules` →
  `git submodule update --init --recursive desktop/sidecar/deps/llama.cpp` +
  `pnpm install --frozen-lockfile` before building/testing.
- **PR #66 (`fix+live-overflow-chunked-note`) — zero file overlap (verified).**
  #66 changes only `orchestrator.ts`'s `stop()` (plain path, `+generateChunkedNote`)
  and lifts `adaptToV2Transcript` into `@shared/note-schema`; it does NOT touch
  `finalizeLecture`/`finalizeMeeting`, the C++ files, `client.ts`, `ipc.ts`, or
  `ipc-protocol.ts`. Our two branches can land in any order.
- **Lanes:** engine = ai-infra (`desktop/sidecar/`, `desktop/src/main/`,
  `desktop/src/shared/`); runner = eval (`desktop/eval/`); this doc = spec-docs
  (`docs/`). Register this worktree in `.claude/lanes.md` (parseable block) and
  tag eval/docs commits `Cross-lane: ai-infra → eval` / `→ spec-docs`.
- **Subagents** (if SDD): stay inside this worktree path; never `git checkout` /
  `pull` / `reset` a shared branch; report BLOCKED on unexpected git state.

## 11. Acceptance criteria
1. C++ `GenOpts` carries `grammar` + `seed`; `generate()` adds the grammar
   sampler first when grammar is non-empty and feeds `seed` to `dist`; NULL
   grammar → structured error. Plain path byte-identical (existing smoke green).
2. `generate` IPC envelope (shared type + C++ parser) carries optional
   `grammar`/`seed`; absent ⇒ unchanged behavior.
3. `makeGrammarSidecar(client).generateWithGrammar` returns accumulated
   `{text, seed}`; `ipc.ts` uses it with no cast; fast unit tests green.
4. `offline-3b` runner produces a real, schema-valid Note scored by the existing
   harness, with real (or honestly-empty) per-chunk retry counts.
5. **Real-model gate passed:** one foreground 3B run yields valid JSON + a
   schema-valid `LectureNote` through the sidecar's grammar-first path, within the
   Spike-0.1 retry envelope. (If failed → adopt the `common_sampler` fallback.)
6. `pnpm --filter @lisna/desktop` typecheck + lint + scoped tests green.

## 12. Open risks
- **Grammar-first vs the spike's grammar-last-resample** (Section 5) — mitigated
  by the real-model gate + `common_sampler` fallback. This is the primary risk.
- **`zodToGbnf` output vs the vendored grammar parser** — the spike validated the
  GBNF text against this llama.cpp via the example binary, so the *grammar* is
  low-risk; only the *sampler integration* is new.
- **Eval fixture availability** — needs at least one JA lecture fixture with a
  transcript; if absent, the real-gate uses the smoke fixture
  (`desktop/.../tests/fixtures/audio/ja-30s.wav` path already used by
  full-pipeline-smoke) adapted to a `FixtureTranscript`.

## 13. Follow-ups (NOT this effort)
- Renderer/app-screen wiring (app-design lane, Plan 3 Tasks 11–12) — now
  unblocked once this lands; tee up as a ready-to-start task.
- `session/finalize` IPC-path model-load (with the renderer wiring).
- Per-chunk retry counts via `finalizeLecture` telemetry (after PR #66 frees the
  finalize functions).
- Note persistence / real note IDs (Plan 3 Task 13).

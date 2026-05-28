# Live Note Path Overflow — Lossless Plain-Text Chunking — Design Spec

**Date:** 2026-05-28
**Author:** Lisna v2 founder + Claude (Opus 4.7)
**Status:** Reviewed — round 1 "Revise" (material) + round 2 final sign-off "Approve with minor fixes"; all findings integrated (sections 3.1/3.4 wording tightened per round 2). Ready for the implementation plan.
**Branch:** `worktree-fix+live-overflow-chunked-note` (worktree `.claude/worktrees/fix+live-overflow-chunked-note`, off `origin/main` `b8afbd2`)
**Lane:** ai-infra (code under `desktop/src/main/sidecar/` + a lift into `desktop/src/shared/note-schema/`). This doc lives in the spec-docs lane → committed with a `Cross-lane: ai-infra → spec-docs` trailer.
**Scope:** the LIVE `session/stop` note path ONLY. Out of scope: the v2 structured `finalizeLecture`/`finalizeMeeting` path, grammar-constrained generation, C++ sidecar changes, renderer/preload/Note-type changes.

---

## 1. Background & Problem

### 1.1 Symptom

On the live alpha path, a long recording produces an **empty or mid-sentence-truncated note, with no error or warning**. The user believes they captured a full lecture/meeting and silently receives a partial (or blank) note.

The trigger is context overflow: the note is generated in a **single LLM pass over the entire transcript**. When the prompt exceeds roughly `n_ctx − maxGenTokens` ≈ `16384 − 4096` = ~12.3K tokens (~20 min of dense Japanese), the sidecar's decode fails and the generation loop **breaks silently** (see section 2.2).

### 1.2 Why this matters now

- v2 desktop alpha is live. A note tool that silently drops the second half of a long recording is a trust-killer, and a long lecture/meeting **cannot be re-recorded**.
- This is the highest-value **independent** fix available while the full v2 path (grammar-constrained, structured, chunked) lands behind its own prerequisites (C++ grammar generation + renderer wiring). It ships value today without touching that contended chain.

### 1.3 Class of bug — not a one-line fix

The structural weakness: **the live note path generates in one pass with no relation to `n_ctx`.** The same class recurs for any sufficiently long recording, any future model with a smaller context, and any denser language.

The project already chose the right structural answer for the v2 path: **chunk the transcript so each LLM call stays within context, losing nothing.** This spec applies that same lossless-chunking principle to the live **plain-text** path — *without* coupling it to grammar/structured output (which is what blocks the v2 path today). Chunking ≠ grammar; they are separable.

---

## 2. Evidence (file:line, verified against `b8afbd2`)

### 2.1 No input-length cap on the live path

`desktop/src/main/sidecar/orchestrator.ts:110-170` — `SessionOrchestrator.stop()`. It has an empty-transcript guard (`:118`) and unload/load/generate timeout guards, but **no length cap**: `:147` builds the prompt from **all** `this.segments` via `buildJaNoteV1Prompt`; `:152` streams `generate(messages, { maxTokens: 4096, temperature: 0.4 })`.

### 2.2 Overflow fails SILENTLY (the core hazard)

`desktop/sidecar/src/llm/llama_engine.cpp:106` sets `cp.n_ctx = 16384`. The generate loop at `:200-201`:

```cpp
while (generated < opts.maxTokens) {
  if (llama_decode(impl_->ctx, batch) != 0) break;   // <- silent: emits nothing
```

`desktop/sidecar/src/ipc/json_protocol.cpp:160-166` calls `generate()` and then **unconditionally** emits `{"type":"done"}`. So on overflow the TS `for await` over `generate()` completes **normally** with an empty or truncated `md` string — **no exception, no error code**. (Confirmed by independent review.)

> Consequence for THIS design: the plain-text path cannot detect overflow from an error — it can only observe the *symptom* (empty output). This differs from the v2 grammar path, which fails LOUD via a `CHUNK_FAILED` throw at `orchestrator.ts:262`. See section 3.2.

### 2.3 The token estimator is a heuristic (can under-count)

`desktop/src/shared/note-schema/tokens.ts:28-34` — `estimateTokens` uses **0.6 tokens/char for JA**, 0.25 for ASCII (Spike 0.4 calibration). It is an **average**; the real Llama 3.2 BPE count for a given passage varies and can exceed the estimate. **Therefore the estimator must NOT be the sole guarantor of "this chunk fits."**

### 2.4 `chunkTranscript` does not hard-guarantee chunk ≤ budget

`desktop/src/shared/note-schema/chunking.ts:59-109` — silence-aware, token-budgeted, operates on the v2 `SessionTranscript` shape. But the inner guard at `:75` (`tokens + segTokens > maxTokens && i > cursorIdx`) forces at least one segment into every chunk. **A single segment larger than the budget becomes its own over-budget chunk.** STT segments are short (~10 s) so this is low-probability, but it falsifies any unqualified "cannot overflow" claim.

### 2.5 Budget source + the inherited-constant trap

`desktop/src/shared/models/profiles.ts:22,50,67` — `contextWindow: 16384`; per-family `recommendedChunkTokens: 8000`. **The `8000` is tuned for the grammar path, which detects per-chunk failure and retries.** Inheriting it into the silent-failure plain-text path imports a budget calibrated for a fail-loud world into a fail-silent one. This design does **not** inherit `8000` as a safety bound (see 3.5).

### 2.6 The legacy→v2 adapter is not exported

`desktop/src/main/sidecar/ipc/session-finalize.ts:168` — `adaptToV2Transcript` is a file-local `function` (used by `routeLecture` + `routeMeeting`). Reusing it from a third caller requires lifting it to a shared module (see 3.3).

---

## 3. Design

### 3.1 Boundary & flow

A new **pure** helper, `desktop/src/main/sidecar/chunked-note.ts`:

```
generateChunkedNote(args: {
  segments:  TranscriptSegment[];          // legacy shape (startSec/endSec/text/noSpeechProb?)
  language:  Language;
  buildPrompt: (lang, segs) => ChatMessage[];   // = buildJaNoteV1Prompt (injected)
  generate:  (messages: ChatMessage[], opts) => AsyncIterable<string>;  // injected = this.opts.llm.generate
}): Promise<string /* merged markdown */>
```

`stop()` replaces its current `:147-152` (prompt build + generate loop) with a single call to this helper, injecting `this.opts.llm.generate` (bound to `maxTokens 4096, temperature 0.4`) and `this.opts.buildPrompt ?? defaultPrompt`. Everything else in `stop()` (model load/unload, timeouts, empty-transcript guard, the returned `Note` shape) is unchanged. Because the helper is pure and takes `generate` as a parameter, it is **unit-testable without Electron or a real model.**

**Single-pass fast path (no regression):** if `estimateTokens(builtPrompt) ≤ SINGLE_PASS_MAX_EST` (3.5), the helper does exactly one `generate` pass and **returns that raw output directly — it MUST NOT route through the section 3.4 merge** (the merge would re-emit/reorder `【】` headers and break byte-identity). This keeps the output **byte-identical to today**, preserving the `[Xs] text` transcript format that downstream eval tooling parses. Only over-threshold transcripts enter the chunked branch. (The 3.2 backstop still applies: if this single pass returns empty — overflow despite a low estimate — fall through to the chunked branch, which is strictly better than today's silent empty note.)

### 3.2 Overflow safety is REACTIVE, not estimate-dependent (load-bearing)

This is the round-1 review's must-fix. **Correctness does not depend on the token estimate being accurate.** We decouple two concerns:

- **Nice boundaries** (a perf/quality concern) → handled by the silence-aware estimate-based chunker.
- **Overflow safety** (a correctness concern) → handled by a **reactive empty-output backstop**:

> **Invariant:** a non-empty input chunk MUST yield non-empty note output. A chunk that returns **empty / whitespace-only** output is the silent-overflow signature (first `llama_decode` failed → loop broke → 0 tokens). When detected, **subsplit that chunk and retry**:
> - chunk has ≥ 2 segments → split into two halves by segment boundary, recurse on each;
> - chunk has exactly 1 segment → split that segment's `text` (by sentence `。`, else by character midpoint), recurse;
> - recursion is **depth-bounded** (cap, e.g. 6); on exhaustion, append that chunk's raw transcript text verbatim to the note output (lossless — never drop content; pure string op, no further LLM call).

This makes the fix correct **regardless** of whether the real tokenizer runs at 0.6 or 1.4 t/char, and it also backstops the single-pass path (if the optimistic single pass overflows, its empty output triggers the chunked branch). The empty-vs-nonempty test has low false-positive risk: a non-empty transcript always yields *some* note text when it fits.

### 3.3 Chunking

Reuse `chunkTranscript` (silence-aware) for the initial split. The helper holds legacy segments; `chunkTranscript` wants v2 — so:

- **Lift `adaptToV2Transcript` to `desktop/src/shared/note-schema/` (a small pure adapter)** and import it from both `session-finalize.ts` and `chunked-note.ts`. This is the 3rd call site → the architecture.md DRY threshold is met; do NOT duplicate.
- Per v2 chunk, map back to the `{ startSec, text }` shape `buildJaNoteV1Prompt` consumes (a one-line `.map`), generate, collect.

### 3.4 Merge — M1 deterministic header-grouped (+ raw-concat fallback)

`buildJaNoteV1Prompt` instructs the model to emit sections headed by `【要点】` / `【次のアクション】` / `【決定事項】` with `・` bullets (`prompts/ja-note-v1.ts`). Merge N chunk-notes:

1. **Parse:** split each chunk note into sections on lines matching `/^【.+】$/`. Any preamble lines *before* the first header (the prompt forbids preamble, so this is the rare off-format case) are attached to the **first section that appears**, in first-seen order; non-bullet prose *after* a header stays under that header. No content is dropped.
2. **Group:** concatenate the lines under each header across all chunks, in first-seen header order; emit one note with each header once.
3. **Fallback (precise trigger):** if **zero** lines match `/^【.+】$/` across **all** chunk notes (model produced no recognizable headers), skip parsing and **raw-concatenate** the chunk outputs with a thin separator. Output is never empty.

M1 is **pure string manipulation — length-independent, cannot overflow**, and the fallback makes it strictly lossless even when the model ignores the format. (M2, a final LLM merge pass, was rejected — section 6.)

### 3.5 Budget constants (PERF knobs, not correctness)

Defined in `chunked-note.ts` with a cross-reference comment to `llama_engine.cpp:106`:

- `SINGLE_PASS_MAX_EST` = `contextWindow(16384) − genReserve(4096) − SAFETY_MARGIN(~1500)` ≈ **10.8K** estimated tokens. Below this, single pass.
- `CHUNK_BUDGET_EST` = a conservative initial chunk budget ≈ `(16384 − 4096) / 2` ≈ **6000** estimated tokens — chosen to absorb up to ~2× estimator under-count *so that subsplit rarely triggers*. **This is a performance choice, not the safety guarantee** — the reactive backstop (3.2) is the guarantee.

These mirror the C++ `n_ctx`; a drift comment flags that changing `n_ctx` in the sidecar requires revisiting these.

---

## 4. What this does NOT touch (scope / contention)

- **Files changed:** `orchestrator.ts` (`stop()` internals, ~6 lines) + new `chunked-note.ts` + new `chunked-note.test.ts` + lift `adaptToV2Transcript` into `shared/note-schema/` (and update `session-finalize.ts`'s import).
- **Untouched:** renderer, preload, the shared `Note` type, grammar, C++ sidecar.
- **Contention:** the active Plan 3/5 lanes edit `finalizeLecture`/`finalizeMeeting`, **not** `stop()` — collision surface is small. Work proceeds in this isolated worktree off `origin/main`.

---

## 5. Testing

- **5.1 Unit** (`chunked-note.test.ts`, fake injected `generate`):
  - short input → exactly 1 `generate` call, output byte-identical to a direct single pass;
  - long input → N chunks → N calls; merged note preserves every chunk's bullets; headers unified once;
  - non-conforming chunk output (no `【】` headers) → raw-concat fallback, lossless;
  - **overflow simulation:** fake `generate` returns `''` when its prompt exceeds a configured size → assert the helper **subsplits and retries** → final note is complete (no lost segments).
- **5.2 Fail-first regression** (NEW test file, per testing.md regression-fixture rule): an over-budget transcript + the overflow-simulating `generate`. Assert the **old** all-at-once strategy → `''` (empirically verified to FAIL before the fix lands), the **new** helper → complete non-empty note.
- **5.3 Manual real-3B smoke:** one ~20-min+ dense-JA recording → complete note end-to-end. 8 GB discipline: foreground, single sample, `pkill -9 -f llama-completion` afterward (per pitfalls.md spike-llm).
- **5.4 Existing tests stay green:** `orchestrator.test.ts:32/276/307` (single-pass markdown + empty-transcript) are preserved by the single-pass fast path.

---

## 6. Rejected alternatives

- **Truncate-and-warn** (drop the transcript tail to fit, show a "covers first N min" notice): **rejected** — lossy, contradicts the project's lossless principle. (Was an earlier draft; withdrawn.)
- **M2: final LLM merge pass** over concatenated chunk-notes: better coherence/dedup, but re-introduces an overflow ceiling on the merge input → re-opens the bug this work exists to close. Rejected for a fix whose purpose is "any length is safe."
- **Loud `TRANSCRIPT_TOO_LONG` error** (no note): simplest and honest, but produces no note for an un-re-recordable session → violates lossless. Rejected.

---

## 7. Round-1 architecture review — findings integrated

- **Must-fix (per-chunk silent overflow / estimator under-count):** resolved by making overflow safety **reactive** (3.2) rather than trusting the estimate, and by **not inheriting the `8000` grammar-path budget** as a safety bound (3.5).
- **Must-fix (`chunkTranscript` single-oversized-segment, chunking.ts:75):** covered by the same reactive backstop (3.2) — an over-budget single-segment chunk yields empty output → within-segment subsplit.
- **Must-fix (`adaptToV2Transcript` not exported):** lift to `shared/note-schema/`, 3-call-site DRY rule (3.3).
- **Should-fix (fail-first regression in a new file, empirically fail-first):** section 5.2.
- **Should-fix (precise fallback trigger):** "zero `/^【.+】$/` matches across all chunk notes" (3.4).
- **Nice-to-have (cap chunk count; keep single-pass byte-identical):** depth + chunk-count caps (3.2/8); single-pass byte-identical (3.1).
- **Merge decision:** reviewer independently confirmed **M1**.

---

## 8. Open questions / tuning (non-blocking)

- **Estimator real-ratio measurement (perf only):** before finalizing `CHUNK_BUDGET_EST`, measure `estimateTokens` vs the sidecar's real `n_prompt` (llama_engine.cpp:166-170 already computes it) on a dense-JA fixture, to set the initial budget so subsplit is rare. Does not affect correctness (3.2 guarantees it regardless).
- **Subsplit depth cap value** (6 is a placeholder).
- **Latency UX:** chunked generation is N× slower on long recordings only. Optionally report per-chunk progress through the existing `onPhase('generating')` channel (e.g., "2/5"). Out of scope for this fix; flagged for the plan as optional.

# Per-chunk 2-pass fabrication fix — design spec (2026-06-14)

Status: **APPROVED to build** (spike-confirmed + independent expert CONFIRM-WITH-CHANGES, opus ≠author, 2026-06-14). Build on the BESPOKE sidecar; latency/sampler is a separable founder follow-up (see §10). Loop: `v2_long_recording_stability_loop_2026-06-13`.

## 1. Problem & evidence

On hard inputs (finance/technical topic + garbled far-field STT), the 3B under a GBNF JSON grammar flips to memorized **English fabrication** — grammar-valid, schema-valid, Zod-passing, so every structural gate stays green and a 100%-fabricated note ships. Single-variable isolation proved **the grammar (not the sampler) is the trigger**: grammar OFF → grounded JA; grammar ON → English (decision doc `desktop/docs/superpowers/decisions/2026-06-12-fabrication-culprit.md`, B-vs-R5, lines ~89-98 — **lives only in the `sampler-alignment` worktree; its rationale is folded here so the premise is on mainline record**). Lecture/bookkeeping content doesn't trip it (why lecture works); conversation/finance content does.

**Spike-3 proof (2026-06-14, real-3B FOREGROUND, BESPOKE sidecar md5 56918f0a, the exact dump that fabricated — `~/Library/Application Support/@lisna/desktop/sessions/2026-06-11T16-14-00-372Z/`):**

| | baseline (single-pass grammar) | per-chunk 2-pass |
|---|---|---|
| jaRatio | 0.00 (100% English) | **0.939** |
| groundingJa | ~0 (fabricated) | **0.789** |
| structure | title "Interview with Speaker X" | title "BSのバランスシートについて" (14ch), 4 split qa_pairs |
| pass-2 tokens | n/a | 1216 (clean EOS, ≪2000 cap — no run-on) |

Whole-transcript naive 2-pass (prior spikes) ran on to maxTokens → unparseable + title-blob. **The per-chunk shape fixed that** (small chunk → short grounded pass-1 prose → pass-2 has little to structure → terminates).

## 2. Design overview

Insert a 2-pass generation **inside `runChunkWithGrammar`** (`desktop/src/main/sidecar/orchestrator.ts:226-332`) — the single per-chunk seam all four `finalize*` funnel through (one insertion covers lecture/meeting/interview/brainstorm; downstream `runPostDecodePipeline` → `deterministicMerge` → consolidate/cap-fit contract is UNCHANGED).

```
chunk (~3000 tok)
  → PASS-1  free-gen (EMPTY grammar, JA-native free-prose prompt) → grounded JA prose
            [own language guard + ran-to-cap detector + pass-1-only reseed]
  → PASS-2  callWithGrammar(schema: z.unknown(), FULL grammar, expectedLanguage)
            structures pass-1 prose into the family JSON
  → runPostDecodePipeline(rawJson, fam, transcript)   (fills postDecodeOnly `from` etc. + schema.parse)
```

Layer rationale (expert finding A): not lower (`callWithGrammar` is the family-agnostic grammar primitive) and not higher (each `finalize*` would duplicate 4× — violates `architecture.md (DRY)`).

**CRITICAL harness lesson (spike):** pass-2 MUST keep `schema: z.unknown()` in `callWithGrammar` and defer the real `fam.schema.parse` to `runPostDecodePipeline`. `from: ProvenanceSchema` is `postDecodeOnly` → STRIPPED from the grammar → the LLM never emits it → a premature `fam.schema.parse` on raw grammar output throws `ZodError` on `from`. This is exactly today's flow (`orchestrator.ts:237` `schema: z.unknown()`, `:299` runPostDecodePipeline) — preserve it.

## 3. Pass-1 (free-gen, the grounding step)

- **No grammar** (`grammar: ''` / omit → the sidecar plain path `llama_engine.cpp:255 if(!opts.grammar.empty())`). Free-gen is what reliably grounds JA.
- **New JA-native free-prose prompt-variant PER family** (expert: per-family). A `PromptVariant`-shaped artifact (`families/util/prompts.ts`) whose `systemTemplate` instructs: 必ず日本語の散文 / 文字起こしにある内容だけ / 推測・新情報・英語の文禁止（固有名詞・専門用語の原語のみ可）/ JSON・記号なし, with a family-specific emphasis hint (lecture=説明された概念; interview=質疑の流れ; meeting=議論と決定; brainstorm=出たアイデア). `chunkUserTemplate` = chunk header (`パート i/N`) + rendered transcript + 「日本語で要約してください」. Reuse `renderSystemTemplate` for non-ja (`en`/`ko`) language adaptation.
- **maxTokens (finding D):** choose deliberately for DENSE chunks — **1600** (a faithful JA summary of a dense ~3000-tok chunk can need ~1500; spike's sparse chunk used 376). NOT the spike's 1000.
- **ran-to-cap detector (finding D):** if pass-1 `stats.tokensOut >= maxTokens - ε`, treat the prose as **truncated → RETRIABLE pass-1 failure**, never feed forward. (A truncated pass-1 silently structured by pass-2 is the single most important untested path; the sparse spike fixture hid it.)
- **own language guard (finding B):** run `findLanguageMismatch(prose, expectedLanguage)` on the raw pass-1 prose BEFORE pass-2. A fabricated-EN pass-1 (less likely without grammar per R5, but the finance+garbled-STT worst case is real) must trigger a **pass-1-only reseed**, not poison pass-2. `findLanguageMismatch` is already exported from `grammar-call.ts:334` — operate on the prose string (wrap as `{x: prose}` or add a string-input overload).

## 4. Pass-2 (structure, under the FULL grammar)

- `callWithGrammar({ prompt: <pass-1 prose + 構造化指示>, system: <JA-native structuring prompt>, schema: z.unknown(), grammar: <FULL family grammar, unchanged>, expectedLanguage, ... })`. Keeps ALL existing fabrication defenses: `sanitizeEscapeLiteralsInStrings`, `findEscapeLiteralInStrings`, `findLanguageMismatch`, fresh-seed retry (`grammar-call.ts:363-430`).
- Pass-2 system prompt: 入力の日本語要約だけ使う / 新情報・英訳禁止 / title は簡潔1行（要約全体を入れない）/ qa_pairs等は項目ごとに分割 / 無い数値・時刻を作らない（ts 不明なら0）/ スキーマ厳守.
- **FULL grammar only — the lighter per-chunk grammar is OUT OF SCOPE (finding E).** Spike arms A (full `{0,79}`) and B (lighter `{0,14}`) produced BYTE-IDENTICAL output: once pass-1 grounds AND condenses, the grammar bound is no longer the trigger (pass-2 input is short grounded JA → full grammar terminates cleanly). Building `tightenArrayBound`/per-family-bound tables adds surface with zero evidenced payoff; merge-time cap-fit (#127) already bounds over-union. Revisit ONLY if a real dense multi-chunk run shows micro-pair degeneracy.

## 5. Retry policy (finding C — MUST be explicit)

Today `runChunkWithGrammar` = up to `POST_DECODE_OUTER_ATTEMPTS(2) × INNER_GRAMMAR_ATTEMPTS(3) = 6` grammar gens/chunk (`orchestrator.ts:235/244/349`). A naive "retry the whole 2-pass" → worst case `2×(pass-1 + 3×pass-2)` = catastrophic 2h latency. Spec the ladder so pass-2 (cheap+reliable: spike 1216 tok, 1 attempt) is preferred:

1. **pass-1** runs with a SMALL budget: **1-2 attempts** (fresh seed). Fail = ran-to-cap OR pass-1 language-mismatch.
2. On a good pass-1 prose, **pass-2** runs the existing inner ladder (`INNER_GRAMMAR_ATTEMPTS`) against that SAME prose; on pass-2 outer-retriable failure (ZodError post-decode / ESCAPE_LITERAL / pass-2 NOTE_LANGUAGE_MISMATCH) reseed **pass-2 only** first.
3. Escalate to a fresh **pass-1** reseed only if pass-2 exhausts its budget on the current prose (bounded — e.g. ≤2 pass-1 cycles total).
4. **Bounded TOTAL generations/chunk** (target ≤ ~8: ≤2 pass-1 + ≤6 pass-2) so 2h worst-case latency is predictable. Document the cap.

Keep `CHUNK_FAILED:<i>:<reason>` semantics + telemetry (attempt-start / chunk-done) — extend events to attribute pass-1 vs pass-2 (so the finalize progress UI #122 + eval can see which pass cost what).

## 6. Timeout (expert §2 caveat)

`TIMEOUTS.GENERATE_NO_PROGRESS_MS` (60s, `timeouts.ts:30`) now applies to BOTH passes independently → 2× the cold-prefill exposures/chunk. Pass-1 is a cold big-prefill (STT just unloaded, LLM just loaded). Confirm a dense-chunk pass-1 first-token survives 60s on a loaded 8GB machine in the e2e gate; if it stalls, raise the no-progress budget (the existing supervisor respawn+reload already absorbs a one-off stall in production).

## 7. Scope

IN: `runChunkWithGrammar` 2-pass insertion; pass-1 free-prose `PromptVariant` ×4 families; pass-1 language guard + ran-to-cap; retry-ladder rework; telemetry pass attribution; unit tests; e2e gate. OUT: lighter per-chunk grammar (E); diarization (separate NEXT track — 2-pass fixes grounding+structure NOT speaker attribution); sampler swap (separable follow-up §10).

## 8. Test plan

- **Unit (deterministic, no LLM):** retry-ladder (pass-2-first reseed; pass-1 reseed only on pass-1 fail / pass-2 exhaustion; total-gen cap) via a mock `generator` returning canned pass-1/pass-2 sequences; ran-to-cap detector (pass-1 at cap → retriable, not fed forward) — **fail-first verified** (`testing.md regression-fixture`); pass-1 language-guard fires on EN prose → pass-1 reseed. Mock at the generator boundary (`testing.md network`).
- **e2e VALIDATION GATE (BLOCKING before PR merge, expert finding):** a REAL ≥8-chunk (≥30-40 min) recording through the full pass-1→pass-2→merge→consolidate path on real-3B, FOREGROUND. The 1-chunk spike + #127's SYNTHETIC unit tests do NOT jointly substitute — this is the only place merge-of-real-partials is exercised. Acceptance: finalizes (no CHUNK_FAILED), jaRatio ≥0.5, groundingJa ≥0.6, schema.parse OK, bounded gen/chunk respected, no zombie sidecar. Recorded via `feedback_recording_via_desktop_app` (launch the desktop app to capture) or an existing long real fixture.

## 9. Risks & known limitation

- **KNOWN LIMITATION (flag to founder, NOT blocking):** independent per-chunk pass-1 with no shared context → a 2h note = N stapled section-summaries unioned deterministically, NOT a globally-synthesized arc. The design's quality ceiling (vs the direction doc's "valuable" bar). Recorded in the founder decision brief.
- **Latency:** 2 passes/chunk ≈ ~25 min/2h on bespoke (§10).
- 2h structural feasibility = YES: KV cleared per `generate()` (#126) → 2 passes × N chunks = 2N independent fresh-context decodes, zero KV accumulation; each pass smaller than today's single-pass → no new OOM.

## 10. Latency / sampler (founder follow-up — does NOT change this design)

~25 min/2h on BESPOKE (~12 tok/s). The shelved ALIGNED sampler (~2×, ~7min/84-min lecture) was rejected for (i) not fixing fabrication + (ii) penalty-off run-on — **2-pass neutralizes BOTH** (free-gen grounds; per-chunk shape terminates). So aligned becomes a viable pure speed lever. Plan: build+validate on bespoke; **measure 2-pass on the aligned sidecar during the e2e gate**; present the number to the founder to adopt or defer. Surfaced in the decision brief + the wrap.

## 11. Build process

`writing-plans` → `subagent-driven-development` (worktree). Per-task two-stage review. Pre-push independent expert review (reviewer ≠ author) + ci/desktop-ci green → auto-merge (founder session grant). Final pre-merge gate = the §8 e2e + an independent 2h-feasibility expert review.

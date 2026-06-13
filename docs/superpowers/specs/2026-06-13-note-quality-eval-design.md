# Note Quality Eval — faithfulness gate + coverage on the existing harness

**Status:** design (brainstormed with founder 2026-06-13; corrected after independent fact-check review)
**Problem owner:** note-creation track (v2)
**Supersedes context:** `docs/superpowers/decisions/2026-06-12-fabrication-culprit.md`

## 1. Why this exists

Two design cycles (overnight "sampler isolation" + the 2026-06-12 sampler-alignment
plan) chased the wrong root cause for note fabrication, because changes were
tuned against proxy numbers and knobs, never against "did this make the note
better for a user." That is how you burn cycles on the wrong lever.

**What actually exists today (fact-checked 2026-06-13).** The Plan 7 eval
harness (`desktop/eval/`, PR #56) is real and *runs end-to-end*:
`pnpm --filter @lisna/desktop eval:notes --runner offline-3b --family <f>
--judge <id> [--baseline/--against]` drives an offline runner → judges →
scorecard → baseline diff.

- **Fixtures exist:** 14 authored transcripts across all 4 families; 10 carry a
  `ground-truth.json` answer key (`fixtures/<family>/<id>/{transcript,meta,
  ground-truth}.json`). Interview answer keys already hold `qaPairs`
  (`interview/pm-candidate-2spk/ground-truth.json`).
- **Runner exists** (`runners/offline.ts`): spawns the real sidecar, loads the
  real 3B, runs real finalizers — **but only for lecture + meeting**
  (`UNSUPPORTED_FAMILY_FOR_OFFLINE_RUNNER` for interview/brainstorm).
- **Judges exist:** `content-fidelity-judge.ts` (JA grounding/parroting, returns
  a 0-10 score — **Groq-only**), `llm-judge.ts` (multi-axis, **has the Anthropic
  `claude-*` path**), `pairwise-judge.ts`.
- **Coverage partly exists:** `contract/families/{interview,meeting,brainstorm}.ts`
  each have a `*-ground-truth-qa-coverage` rule (ground-truth Qs found in the
  note, normalized substring, 60% threshold).
- **Baseline + scorecard exist** (`baseline/{store,diff,format}.ts`,
  `scorecard.ts`) and gate regression (`eval-notes.ts` exits non-zero on a
  baseline regression).
- A **second real-3B path** also exists: `scripts/note-quality-eval.ts` (PR #119)
  — a dump-replay rig with mechanical metrics (`jaRatio`/`groundingJa`/
  `nearDupRate`) and, critically, a **Metal warmup + plain-no-grammar primer**
  that is the only sequence that reliably unwedges the grammar call on an 8GB
  machine.

So the instrument is built and runnable. It has simply **never been pointed at
the fabrication problem.** This spec closes that specific gap.

## 2. The real gaps (corrected)

1. **No fabrication-stress fixture.** Nothing reproduces the 2026-06-11 JA
   finance-interview → English-fabrication failure. Without it the eval can't
   catch the bug we actually have.
2. **Faithfulness is a soft 0-10 score, not a GATE.** Founder's #1 criterion is
   "any fabrication = fail." Today `content-fidelity-judge` returns a number; the
   scorecard never hard-fails on it.
3. **The faithfulness judge can't do per-claim verdicts against an answer key,
   and is Groq-only.** It scores grounding/parroting and only consumes
   `expectedFormulas` as an allowlist — not a full `facts[]` list — and a
   `claude-*` id sent to it hits Groq's endpoint and fails. The Claude path lives
   in a *different* judge (`llm-judge.ts`).
4. **Interview + brainstorm aren't wired in the offline runner** — exactly the
   families where fabrication is worst.
5. **The runner lacks the rig's warmup+primer**, so a real 3B run through it can
   wedge on an 8GB machine (`pitfalls.md spike-llm`).
6. **Answer keys lack a uniform `mustAppear`/importance flag** (`qaPairs` is
   `{q,a}` only; `expectedKeyTerms`/`themes` are bare `string[]`), so coverage
   can't be importance-weighted, and **lecture is under-keyed** (4 of 5 lecture
   fixtures have no `ground-truth.json`).

## 3. Goal & approach

A faithfulness-**gated**, coverage-**scored** eval, run against authored
fixtures whose answer key makes ground truth known by construction:

- **Faithfulness (GATE, founder's #1):** any note claim not entailed by the
  fixture's answer-key facts, or a wholesale JA→EN language flip, = **FAIL** —
  regardless of everything else.
- **Coverage (SCORED):** fraction of `mustAppear` answer-key points the note
  captured.

**Hybrid measurement (founder's choice):** cheap deterministic stage first
(jaRatio language-flip check + normalized substring grounding, reusing the rig's
`scoreNote` + `nearDupRate`), then an LLM judge for semantic per-claim verdicts.

**Build on the harness, don't rebuild.** Every component above gets *extended*,
not replaced. The work is: author the stress fixture, add the answer-key fields,
add a faithfulness *gate* judge with a Claude path, wire two families, and port
the runner's anti-wedge sequence.

**Not circular:** the on-device 3B generates the note; the answer key (authored,
fixed) defines truth; a separate strong judge (Claude/Groq-70b) checks
note-vs-fact-list. The residual risk — an author writing an *easy* fixture that
doesn't actually stress fabrication — is why §7's fail-first is load-bearing.

Non-goals (deferred): usefulness/language-polish as separate scored axes
(Phase 2); in-app fixture viewing (Phase 2 — see §6); unifying the rig and the
offline runner into one path (Phase 2 — see §6); real-recording realism without
an answer key.

## 4. Phase 1 — the payoff (one plan)

### 4a. Fabrication-stress fixture + schema answer-key fields
- Author 1 interview fixture that reproduces the finance-fabrication failure (JA
  accounting/finance interview; strong English prior; sparse utterances) + its
  answer key. Optionally a 2nd "coverage" fixture with obvious + subtle
  `mustAppear` points.
- **Schema (minimal):** add `facts: string[]` to `FixtureGroundTruthSchema` (the
  complete factual-claim set = the faithfulness answer key), and a uniform
  `mustAppear`/importance flag on coverage points (extend `qaPairs`,
  `expectedKeyTerms`). Lecture coverage keys off `expectedKeyTerms` (no qaPairs).
- **Fail-first (hard requirement, `testing.md regression-fixture`):** the new
  fixture MUST be empirically shown to FAIL faithfulness on the *current*
  pipeline before it's accepted — otherwise it doesn't catch the bug.

### 4b. Faithfulness gate judge (Claude, per-claim, facts-based)
- Resolve the judge contradiction explicitly: **add a faithfulness axis to
  `llm-judge.ts`** (it already has the Claude/Anthropic path), consuming the
  fixture's `facts[]` and returning **per-claim verdicts**
  (supported/unsupported/partial) + cited spans + an overall verdict. (Do NOT try
  to bolt Claude onto the Groq-only `content-fidelity-judge`.)
- Default judge model = **Claude** (founder's "강한 모델"); Groq 70b as cheap
  fallback via the existing `--judge` flag. Note: Claude path needs an API key.
- **Gate in the scorecard:** FAIL if any unsupported claim above a small
  tolerance, OR jaRatio below the #118 mismatch threshold (language flip). The
  deterministic jaRatio check runs first and can fail fast without a judge call.
- **Coverage:** extend the existing `*-ground-truth-qa-coverage` contract rules
  to consume `mustAppear`/importance and emit a coverage % into the scorecard
  (extend, don't rebuild).

### 4c. Wire interview + brainstorm into the offline runner
- Remove the lecture/meeting-only guard; call `finalizeInterview`
  (`orchestrator.ts:905`) / `finalizeBrainstorm` (`:1108`) — parallel signatures
  to `finalizeMeeting`, so this is small.
- **Port the rig's warmup + plain-no-grammar primer + longer cold-cache timeout
  windows** (`note-quality-eval.ts:200-235`) into the offline runner, replacing
  its optimistic flat 10s `waitForReady`. Real-LLM eval is FOREGROUND-only and
  slow; the plan states the per-run cost up front.

### 4d. Scorecard output
- Per fixture: faithfulness **PASS/FAIL** + score + the fabricated spans;
  coverage % + missing `mustAppear` points; baseline delta. Human-readable, so
  you see *why*. (Extends the existing `scorecard.ts`.)

### Judge sanity (in Phase 1)
- Validate the faithfulness judge on 2-3 obvious hand-written cases (faithful JA
  note → PASS; English-fabricated note → FAIL) so a broken judge can't silently
  pass everything.

## 5. Data flow

```
author fixture (transcript + answer key: facts[] + mustAppear points)
        │
        └─► offline runner (warmup+primer) ─► real 3B finalize ─► note
                                   │
                                   ▼
                 ├─ deterministic: jaRatio flip check + grounding (fast)  → fail fast on language flip
                 └─ LLM judge (Claude): per-claim verdicts vs facts[]      → fabricated spans
                        + coverage rules: mustAppear points captured       → coverage %
                                   │
                                   ▼
                 scorecard: faithfulness PASS/FAIL + coverage %  ──vs──  frozen baseline → delta
```

## 6. Deferred to Phase 2 (explicitly out of Phase 1)

- **In-app fixture viewing.** Convert fixtures → synthetic dumps so the F2
  history viewer (`finalizeFromDump`, `listDumps`, `session-dump-reader` — all
  exist on this branch) shows them; founder runs + eyeballs the note in-app.
  Independent UX work; not needed to start measuring.
- **Unify the rig and offline runner into one path.** The rig
  (`note-quality-eval.ts`) is dump-only + single-chunk and carries the
  hard-won anti-wedge sequence; the runner is fixture-based. Phase 1 only
  *ports the warmup+primer* into the runner. Full unification (retire the rig or
  make it a CLI shim) is risky cleanup, deferred.
- Usefulness / language-polish as separate scored axes.
- Real-recording (garbled far-field STT) realism without an answer key.

## 7. Test plan

- **Unit:** `facts[]`/`mustAppear` schema + validator; deterministic grounding +
  language-flip gate; coverage rule consuming `mustAppear`; scorecard gate
  formatting.
- **Fail-first integration (hard gate):** the finance fixture FAILS faithfulness
  on current code *before* any redesign (`testing.md regression-fixture`).
- **Judge sanity:** hand-written faithful→PASS / fabricated→FAIL.
- **Process payoff:** once Phase 1 lands, the 2-pass redesign is measured —
  "finance fixture: fabrication FAIL → PASS, coverage 0.4 → 0.9" — objectively.

## 8. Component boundaries (isolation)

| Unit | Responsibility | Depends on | Exists? |
|---|---|---|---|
| fixtures + `facts[]`/`mustAppear` | known-truth corpus | `_schema`, `_validator` | extend (corpus exists; add fields + 1 fixture) |
| offline runner (interview/brainstorm + warmup) | fixture → real-3B note, all 4 families | sidecar client, finalizers, rig's primer | extend |
| faithfulness gate judge | note vs `facts[]` → per-claim verdicts + gate | `llm-judge` Claude path | extend `llm-judge` |
| coverage scoring | `mustAppear` captured % | existing qa-coverage contract rules | extend |
| scorecard gate | PASS/FAIL + coverage + delta | baseline store | extend `scorecard.ts` |

Runner and judge never import each other (runner produces a note; judge consumes
note + answer key).

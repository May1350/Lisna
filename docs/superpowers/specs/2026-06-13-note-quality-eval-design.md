# Note Quality Eval — faithfulness gate + coverage via authored answer-key fixtures

**Status:** design (brainstormed with founder 2026-06-13)
**Problem owner:** note-creation track (v2)
**Supersedes context:** `docs/superpowers/decisions/2026-06-12-fabrication-culprit.md`

## 1. Why this exists

Two design cycles (overnight "sampler isolation" + the 2026-06-12 sampler-alignment
plan) chased the wrong root cause for note fabrication, because **there was no
trustworthy, user-perspective measure of note quality.** Changes were tuned
against proxy numbers (jaRatio, grounding substrings) and knobs (sampler, KV,
penalty), never against "did this make the note better for a user." That is how
you burn cycles on the wrong lever without feeling it.

**The compounding discovery (2026-06-13):** the Plan 7 eval harness
(`desktop/eval/`) was built and merged — fixture schema *with ground-truth
answer keys*, a JA `content-fidelity-judge`, `llm-judge`, `offline` runner,
`baseline` store+diff, `scorecard` — but:

- `desktop/eval/fixtures/{lecture,interview,meeting,brainstorm}/` are **empty
  (0 fixtures).** The harness has never been fed a single case.
- The `offline` runner **throws on interview/brainstorm**
  (`UNSUPPORTED_FAMILY_FOR_OFFLINE_RUNNER`) — only lecture+meeting are wired —
  and interview is exactly where fabrication is worst.

So we have the measuring instrument and never plugged it in. This spec
**completes and feeds it**, organized around the founder's framing: *I author
the transcript, so the ground truth is known by construction, so quality can be
judged objectively.*

## 2. Goal

A repeatable command that, for each authored fixture, runs the real on-device
note pipeline and answers two user-perspective questions against a **known
answer key**:

1. **Faithfulness (GATE):** does the note contain anything NOT in the
   transcript? Any fabricated fact/name/number, or a wholesale language flip
   (JA→EN) that paraphrases away from the source = **FAIL**, regardless of
   everything else. (Founder's #1 criterion.)
2. **Coverage (SCORED):** did the note capture the key points the transcript
   actually contains? Missing `mustAppear` points lowers the score.

Plus: the founder can **load any fixture in the app** (reusing the F2 history
viewer), run the note, and see the result — same fixtures the automated eval
scores.

Non-goals (deferred — YAGNI): usefulness/signal-to-noise and language-polish as
separate scored axes (Phase 2); real-recording realism stress with no answer
key (Phase 2); automating fixture authoring.

## 3. Core approach: authored fixtures with answer keys

A fixture = an **authored JA transcript** + a **ground-truth answer key**. Because
the controller authors the content, ground truth is known exactly:

- Anything the note asserts that is not entailed by the answer key = fabrication.
- Anything in the answer key marked `mustAppear` that the note omits = coverage gap.

This **eliminates human calibration** — the answer key *is* the ground truth.
The existing `FixtureGroundTruthSchema` already carries the right shape
(`expectedKeyTerms`, `expectedFormulas`, `qaPairs`, `decisions`/`actionItems`
with `mustAppear`, `themes`, `participantCount`); we extend it minimally where
the two axes need it (see §5a).

**Not circular:** the small on-device 3B generates the note; the answer key
(authored, fixed) defines truth; a strong judge model checks note-vs-answer-key.
Generator ≠ judge, and the judge decides against an explicit fact list, not its
own opinion of "truth."

### Fixtures are designed to stress known failure modes

At least one fixture per failure mode we already know:

- **Faithfulness under hard input** — a JA finance/accounting interview (strong
  English prior; reproduces the 2026-06-11 fabrication). Answer key lists the
  real facts; a faithful note stays JA + grounded, a fabricating note invents
  English finance boilerplate → caught.
- **Coverage** — a transcript with both obvious and subtle key points
  (`mustAppear: true`), so a note that only grabs the loud points scores low.
- **Looping** — near-duplicate utterances, to confirm the eval flags
  repetition (reuses the `nearDupRate` helper from the rig).
- Spread across families (interview, lecture, meeting, brainstorm) and lengths
  (single-chunk + a multi-chunk one).

## 4. The two axes, precisely

**Faithfulness (gate)** — hybrid (founder's choice):
- *Stage 1, deterministic (cheap):* substring/normalized-overlap check of note
  content spans against the transcript — flags blatantly ungrounded spans fast,
  and the JA-ratio guard catches a wholesale language flip cheaply.
- *Stage 2, LLM judge (semantic):* the existing `content-fidelity-judge`
  pattern, given (transcript + answer-key facts + note), returns per-claim
  verdicts (supported / unsupported / partial) + cited spans + a parroting
  flag. Catches paraphrase/translation fabrication Stage 1 misses.
- **Gate rule:** any unsupported claim above a small tolerance, OR jaRatio below
  the #118 mismatch threshold (language flip), = FAIL.

**Coverage (scored)** — deterministic-first, judge-assisted:
- For each answer-key point with `mustAppear: true`, is it present in the note?
  Deterministic match where the surface form is stable; LLM judge for semantic
  presence ("the note expresses this point in different words").
- Score = captured `mustAppear` points / total, optionally importance-weighted.

The output is a **scorecard** per fixture: faithfulness PASS/FAIL + score, the
exact fabricated spans, coverage %, the missing points, plus a baseline delta.
Human-readable, so you see *why*, not just a number.

## 5. Components (build on existing; new is marked NEW)

### 5a. Fixtures + answer-key schema — `desktop/eval/fixtures/`
- Populate the empty family dirs with authored fixtures (transcript + ground
  truth), conforming to `_schema.ts` (`FixtureMeta` + `FixtureGroundTruth` +
  `FixtureTranscript`), validated by the existing `_validator.ts`.
- **NEW (minimal schema extension):** add a `facts: string[]` (the complete
  factual claim set — the faithfulness answer key) and ensure key points carry
  a `mustAppear`/importance flag uniformly across families. Keep changes small;
  reuse existing fields wherever they already fit (`qaPairs`, `expectedKeyTerms`,
  `decisions.mustAppear`).

### 5b. Runner — `desktop/eval/runners/offline.ts`
- **Extend to interview + brainstorm** (remove the lecture/meeting-only guard;
  wire `finalizeInterview`/`finalizeBrainstorm`).
- **Reconcile with the `note-quality-eval` rig** (`desktop/scripts/`,
  Task 7 this session) — the rig already proves real-3B running end-to-end
  (sidecar spawn, warmup/primer, real finalize). Fold its proven real-3B
  invocation into the offline runner so there is **one** real-model eval path,
  not two. The rig's mechanical metrics (jaRatio, grounding, nearDupRate) become
  Stage-1 deterministic signals inside the new judge.

### 5c. Judge — `desktop/eval/judges/`
- Use the `content-fidelity-judge` pattern for faithfulness; add coverage
  scoring against the answer key. Make **faithfulness a hard gate** in the
  scorecard (today it is a 0-10 score; the gate thresholds it).
- **Judge model:** default to **Claude** (strong, founder's call) via the
  existing `--judge` flag; the harness already supports cross-vendor judge model
  ids. Note the API-key requirement; keep Groq 70b as a cheap fallback.

### 5d. App viewing — reuse F2 history viewer (PR #121)
- **NEW (small):** a fixture→synthetic-dump converter writes each fixture's
  transcript into the dump tree (`session-dump-reader` format) so it appears in
  the F2 history viewer. The founder loads it → `finalizeFromDump` → sees the
  real note in-app. A "fixture" label distinguishes synthetic from real
  recordings. No new screen.

### 5e. Baseline + regression + scorecard — `desktop/eval/{baseline,scorecard}`
- Already exists (`baseline/store.ts`, `baseline/diff.ts`, `scorecard.ts`).
  Freeze a baseline per fixture; every future change (the 2-pass redesign,
  prompts, models) re-runs the SAME fixtures and prints the delta. **This is the
  loop that ends blind tuning.**

## 6. Data flow

```
author fixture (transcript + answer key)
        │
        ├─► fixture→dump  ─►  F2 history viewer  ─►  finalizeFromDump  ─►  note (human eyeballs in app)
        │
        └─► offline runner ─► real 3B finalize ─► note
                                   │
                                   ▼
                 judge(note, transcript, answer key)
                   ├─ faithfulness gate (deterministic + LLM)  → PASS/FAIL + fabricated spans
                   └─ coverage score (mustAppear points)        → % + missing points
                                   │
                                   ▼
                 scorecard  ──vs──  frozen baseline  → delta
```

## 7. Reconciliation: two eval paths today, one after

- `desktop/eval/` (Plan 7): structured, ground-truth + judges + baselines, but
  empty + interview-unwired.
- `desktop/scripts/note-quality-eval.ts` (Task 7): real-3B running on dumps, but
  mechanical-only metrics, dump-based not fixture-based.

After this work: the Plan 7 harness is the home; the rig's real-3B invocation is
folded into the offline runner; the rig's mechanical metrics become Stage-1
signals. The standalone rig script is then either retired or kept as a thin CLI
shim over the runner — decided during implementation to avoid a second system.

## 8. Test plan

- **Unit:** answer-key schema validation; deterministic fact-match + coverage
  match; gate thresholding; fixture→dump converter; scorecard diff.
- **Fail-first integration:** the finance-interview fixture MUST be empirically
  shown to FAIL faithfulness on the current (fabricating) pipeline before any
  redesign — otherwise the fixture doesn't actually catch the bug
  (`testing.md (regression-fixture)`).
- **Judge sanity:** validate the judge on 2-3 obvious cases (a hand-written
  faithful note → PASS; a hand-written English-fabricated note → FAIL) so a
  broken judge can't silently pass everything.
- **Process gate (the payoff):** once Phase 1 lands, the 2-pass redesign is
  measured — "fabrication 3/3 → 0/3 on the finance fixture" — objectively, in
  minutes.

## 9. Deferred (Phase 2 / YAGNI)

- Usefulness (signal-to-noise) and language-polish as separate scored axes.
- Real-recording realism stress (garbled far-field STT) without an answer key
  — either a judge-only faithfulness pass or an authored "garbled" fixture
  variant.
- Authoring automation; cross-model leaderboards.

## 10. Component boundaries (isolation)

| Unit | Responsibility | Depends on |
|---|---|---|
| fixtures + answer keys (data) | the known-truth corpus | `_schema`, `_validator` |
| offline runner | fixture → real-3B note (all 4 families) | sidecar client, orchestrator finalizers |
| faithfulness+coverage judge | note vs answer key → gate + coverage | judge model (Claude/Groq), answer key |
| fixture→dump converter | make fixtures viewable in-app | `session-dump-reader` format |
| scorecard + baseline | freeze + diff over time | baseline store |

Each is independently testable; the runner and judge never import each other
(runner produces a note; judge consumes note + answer key).

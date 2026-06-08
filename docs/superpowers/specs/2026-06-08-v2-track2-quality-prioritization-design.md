# v2 TRACK 2 — Quality prioritization & measurement plan

**Date:** 2026-06-08
**Status:** REVIEWED (independent design review 2026-06-08 → SOUND; revisions folded in). Ready for `writing-plans`.
**Branch:** `docs/v2-track2-quality-spec`
**Owner:** controller session (single-controller model, see `.claude/lanes.md`)
**Supersedes for prioritization:** the open "model/perf quality" items in
`docs/HANDOFF.md` section 5 (TRACK 2 rows) + Spike 0.2 path memos.

---

## 0. One-line

User-visible note quality is gated by **far-field laptop-mic STT**, not by
the LLM. So: **measure first** to localize the loss, attack STT as the
user-visible #1, and settle the **1B-vs-3B** decision in parallel on clean
transcripts. Latency is a by-product of the model choice, not its own
research track.

---

## 1. Context & problem

The v2 on-device pipeline (Stop → STT → grammar-constrained LLM →
structured note → renderer) reaches a rendered note end-to-end for all 4
families. The 3 founder-smoke **code** bugs are fixed (#66, #79). What
remains is **quality/usability on 8 GB**, which is a model/perf decision,
not a code patch.

**Decisive founder input (2026-06-08 brainstorm):**

1. In the founder smoke, the bad-note problem was **STT first** — the
   transcription was wrong enough that the LLM-structuring quality
   **could not even be assessed**. ("1, 2 — but 2 couldn't be checked
   because of 1.")
2. The target capture scenario is **laptop microphone, on-site** (lecture
   hall / meeting room) — i.e. **far-field, noisy** audio, the hardest STT
   case. (System-audio capture would be far cleaner but is not the target
   for in-person talks; noted as a future fork, not in scope here.)

**What is already measured** (manual spikes — see references):

| Dimension | Evidence | Result |
|---|---|---|
| Decode latency (3B) | Spike 0.2 + `decision-0.2-path-e.md` | 56–100 s/chunk (p50 ~90 s) on M3/8 GB at ~8 K-token prompt; cost split ~50 % prompt-eval / ~50 % grammar-masked generation. 3.0× over the 30 s/chunk target. |
| Decode latency (1B) | `decision-0.2-path-f.md` | ~14–21 s/chunk on well-behaved runs (1.9–3.2× faster), inside the 30 s target. BUT 1/3 runaway → n_predict cap → invalid JSON. |
| LLM quality, Lecture (3B) | Spike 0.2 | **PASS** — slot emergence 3/3 (counts 4,2,4), coherent JA sections, valid shape. Weakness: placeholder formulas (`E=mc^2`-shaped, not the real EM derivations) → content-fidelity gap. |
| LLM quality, Lecture (1B) | `decision-0.2-path-f.md` | **FAIL** — slot emergence 0/3, summaries are heading-duplicates or `第N項` filler, 1 garbled-UTF-8 heading, 1 runaway. Below the lecture-note capability floor at current prompt. |
| Current model defaults | `desktop/src/shared/models/profiles.ts` | 3B = `tier:'default'` for all families; 1B = `tier:'fallback'` (≤12 GB, quality degraded, pending prompt re-eval). n_ctx=16384, maxGenTokens=3000. |

**What is NOT measured:** STT accuracy. The v2 eval harness deliberately
feeds **ground-truth transcripts** to the LLM (to isolate LLM quality), so
**kotoba-whisper accuracy on real audio is entirely uninstrumented.** This
is the gap the founder hit.

**Key enabling finding:** the offline eval runner core is **already built
and tested** (`desktop/eval/runners/offline-3b.ts` spawns the sidecar,
loads the model, runs `finalizeLecture`/`finalizeMeeting`, counts retry
attempts). It is simply **not wired into the CLI** —
`desktop/scripts/eval-notes.ts:resolveRunner` throws for `offline-3b` /
`offline-1b`, and only lecture+meeting families are supported. So a
repeatable model-vs-model measurement loop is ~one wiring task away, not a
from-scratch build.

---

## 2. Principle

- **Measure to localize loss before investing effort.** The founder smoke
  conflated STT errors and LLM errors; the first moves are cheap
  measurements that separate them.
- **Don't stall independent tracks.** LLM quality is measurable on clean
  transcripts without waiting on STT; that track runs in parallel.
- **Latency is downstream of the model choice**, plus already-scoped
  engineering mitigations — not a research track.

---

## 3. Priority decision

**Chosen: Approach A — measure-first, then STT-led with LLM in parallel.**
(Founder-approved 2026-06-08.)

Rejected alternatives:

- **B — STT-only, sequential.** Defers all LLM work until STT is fixed.
  Rejected: 1B-vs-3B is independent of STT, so deferring the (near-free)
  LLM measurement buys nothing; when STT lands you'd have made zero
  progress on the model/latency decision.
- **C — LLM-first (the original framing).** 1B-vs-3B + latency first, STT
  later. Rejected: contradicts the founder finding — polishing the LLM
  produces no user-visible improvement while the transcription it consumes
  is garbage.

---

## 4. Phase 0 — two parallel, cheap measurements (this week)

Both are independent and produce the data that orders all Phase 1 work.

### 4a. STT loss decomposition (NEW measurement harness)

**Goal:** split STT error into **model** vs **capture**, and surface any
cheap model win.

**Build:** a small WER/CER harness under `desktop/eval/stt/` that takes
`(audio, referenceTranscript)`, runs on-device STT (kotoba-whisper q5_0 via
the sidecar), and computes **CER** (primary for Japanese — no word
boundaries) and **WER** (secondary). Deterministic scorecard output,
hardware-safe disclosure (sidecar load = obey the `(spike-llm)` rule:
foreground only, `afterAll`/`ps`/`kill -9` cleanup).

**Conditions measured on the same utterance(s):**

| Condition | How | Tells us |
|---|---|---|
| **clean** | original digital clip → STT directly | model ceiling |
| **far-field (synthetic)** | clip convolved with a room impulse response + additive noise at a target SNR (no hardware) | capture-floor estimate |
| **far-field (real)** | the same utterance recorded by a laptop mic in a room | validates the synthetic proxy — **hardware-gated (founder)** |

The **clean − far-field gap** is the headline number: a large gap means
**capture dominates** (→ Phase 1 = capture pipeline); a small gap with a
high absolute CER means **the model dominates** (→ Phase 1 = model swap).

**Model sweep (on the clean clip):** kotoba-whisper v2.0 q5_0 (baseline)
vs q8_0 vs whisper-large-v3 — framed honestly, NOT as a "free win" hunt.
kotoba v2.0 is a *distillation* of large-v3 (~756 M params, ~0.8 GB, ~6×
faster) that **beats** large-v3 in-domain but **trails** it
out-of-domain — and a live on-site lecture is out-of-domain (per the
kotoba-tech card: JSUT CER 8.4 vs 7.1, CommonVoice 9.2 vs 8.5). So:
- q8_0 = quantization-ceiling probe for kotoba (note the RAM delta vs q5_0).
- large-v3 = does the small OOD-CER headroom justify ~2× weights + ~6×
  slower STT?

Measure each on **(a) CER, (b) STT latency budget** (real-time factor if
STT runs live during capture, else added post-stop wait), and **(c) peak
RAM during the STT phase**. NB: STT and the LLM are **swapped, not
co-resident** (`ipc.ts` unloads STT before loading the LLM — confirm), so
the 8 GB constraint is "largest single resident model"; large-v3's real
cost is **latency**, not co-residence.

**Deliverable:** `condition × model` CER/WER scorecard + the model-vs-
capture verdict.

**Fixture need:** 1–2 Japanese clips with reliable reference transcripts.
**Default (no founder dependency):** start with a public-domain / CC
Japanese speech clip that ships its own transcript, OR a TTS-generated clip
from a known Japanese script (reference = the script). The **real-mic
recording** of that same clip is the one founder/hardware step; the
synthetic far-field path lets us produce a directional verdict without it.

### 4b. Wire the offline eval runner + first 1B-vs-3B scorecard

**Goal:** make LLM A/B repeatable on clean transcripts and lock the model
decision in parallel.

**Build:**
- Wire `makeOffline3bRunner` into `eval-notes.ts:resolveRunner` (replace
  the throw). Resolve `sidecarBin` + `llmModelPath` from env / config.
- Add an `offline-1b` runner. CAUTION: `makeOffline3bRunner` hardcodes
  BOTH `id: 'offline-3b'` AND `modelId: 'llama-3.2-3b-q4-km'`, and the CLI
  saves baselines stamped with `runner.modelId` — a naive 1B variant would
  mislabel its baseline as 3B (silent A/B contamination: the run *works*,
  only the provenance lies). Fix: lift `id` + `modelId` to factory params
  (`makeOfflineRunner({ runnerId, modelId, sidecarBin, llmModelPath })`)
  + a unit test asserting `runner.modelId` matches the filename-resolved
  profile id.
- Lecture + meeting first (the runner's supported families). Interview /
  brainstorm only if cheap; else explicitly logged as deferred (no silent
  cap).

**Run:** 1B vs 3B on the lecture fixtures (`procedural-physics-em`,
`narrative-ukraine-russia`, `yt-jgxib-bookkeeping`) through the existing
judges — Zod validation, slot emergence, content-fidelity (anti-parroting),
per-chunk latency, retry histogram. Save baselines
(`v0-3b-lecture`, `v0-1b-lecture`).

**Deliverable:** a scorecard answering:
1. Is **3B-default confirmed** as the lecture quality floor?
2. Can a **1B-targeted prompt v2** lift slot emergence + content fidelity
   to the bar (which would win 8 GB speed)? — this is the Plan 6 Task 16
   "prompt becomes load-bearing" hypothesis, now measurable as an A/B.

**1B guardrails (pre-committed — Path F already showed 1B FAIL: 0/3 slots
+ 1/3 runaway):**
- **Path G first for the 1B runs:** apply bounded `n_predict` + `.max(N)`
  array bounds BEFORE scoring 1B, so a runaway (unparseable JSON) doesn't
  poison the A/B with unscoreable runs.
- **Kill-criterion:** ≤ 2 prompt-v2 iterations; if 1B slot emergence stays
  below the 3B floor, 1B is closed as the lecture default and reserved for
  quick-gist / lower-stakes tiers (Path F option 3). Prevents an unbounded
  prompt rabbit-hole on a model that may be structurally below the floor.

**Hardware note:** the *wiring + unit tests* are safe and run anywhere. The
*actual model runs* invoke the local Llama sidecar and are heavy on 8 GB
(`(spike-llm)` rule: foreground, sequential, `kill -9` survivors, never
`run_in_background`). The runs are gated behind founder go-ahead /
controlled foreground execution — see section 8.

---

### 4c. Composed real-pipeline gate (the actual track-exit instrument)

4a and 4b measure STT and LLM *separately* — but the founder's failure was
**error propagation** (STT errors made the LLM output unassessable).
Separate metrics can BOTH read green while the composed real pipeline still
fails (e.g. 15 % CER reads "okay" but garbles exactly the named entities
the LLM needs for slots). So Phase 0 must re-compose:

- Feed the **real-mic STT output** (4a's far-field-real condition) — a
  real, error-containing transcript — through the 4b LLM eval as a third
  baseline (`v0-3b-lecture-realstt`).
- This single composed run is the measured **track-exit gate**, replacing a
  manual vibe-check.
- It depends on 4a's real-mic recording (founder/hardware gate, section 8),
  so it lands just after 0a/0b rather than fully in parallel.

## 5. Phase 1 — routed by Phase 0 data

- **STT (user-visible #1):**
  - If 4a shows **capture dominates** (likely, given far-field mic): build
    the **STT capture pipeline** — voice-activity detection, gain/AGC,
    noise suppression, segment-confidence filtering — plus a mic-distance
    guidance UX. Audio pre-processing, not model work.
  - If **model dominates:** swap to the best model from the 4a sweep within
    the 8 GB envelope.
- **LLM (parallel):** adopt 4b's verdict. 3B stays default unless a 1B
  prompt v2 clears the bar; update `profiles.ts` tiers accordingly.
- **Latency (downstream):** falls out of the model choice. If 3B: Path A
  (accept ~60–100 s/chunk) + Path G (lower n_predict + `.max(N)` array
  bounds to claw back generation + suppress the runaway tail) + the
  backlog P2 per-attempt wall-time cap + a "Processing chunk X/N" progress
  UI so a multi-minute wait does not read as broken. Not a research item.

---

## 6. Success criteria / quality bar

- **STT:** proximate metric = CER/WER on the target (far-field) condition.
  **Acceptance is downstream:** STT clean enough that a note generated from
  the *real STT'd* transcript passes the LLM eval bar — i.e. the gate the
  founder hit clears. The concrete CER target is set **after** Phase 0
  reveals the floor (no premature number; far-field has a real ceiling).
- **LLM:** the existing spike acceptance (Zod validation, slot emergence
  ≥ 1 of 3, latency target) **plus content-fidelity** (anti-parroting —
  because 3B parrots placeholder formulas). **1B is "viable"** iff it
  matches 3B within tolerance on slot emergence + content fidelity, not
  just on speed.
- **Track exit:** measured by the 4c composed real-pipeline gate (real-mic
  STT → LLM, baseline `v0-3b-lecture-realstt`) — not a manual vibe-check.
  The founder records a real on-site talk and the generated note clears the
  LLM eval bar on the *real* (error-containing) transcript.

---

## 7. Scope / non-goals

**In scope:** STT accuracy (model + capture) measurement and fix; the
1B-vs-3B decision; latency-mitigation wiring.

**Out of scope (separate or deferred):**
- Diarization quality (speaker separation) — its own track (Plan 4). NB:
  4a's STT floor is measured on **single-speaker** audio; the multi-speaker
  far-field interaction (where STT + diarization collapse together) is
  co-owned with Plan 4 and must NOT be generalized from 4a's numbers.
- 16 GB+ / 7B tier — deferred; this track targets the 8 GB floor.
- System-audio capture path — noted as a future fork for online talks; not
  the in-person target.
- A full prompt-engineering campaign beyond the 1B-viability A/B test.

---

## 8. Risks & open questions

1. **Far-field ceiling.** Laptop-mic far-field JA may have a quality
   ceiling no model can clear. 4a's synthetic + real measurement reveals
   the ceiling early; if it is too low, the honest outcomes are (a) mic /
   placement guidance, (b) recommend an external mic, or (c) revisit
   system-audio for online talks. We surface this, not hide it.
2. **Synthetic far-field validity — it is a LOWER BOUND on real CER.** The
   room-IR + additive-noise proxy cannot reproduce the Lombard effect
   (speakers change articulation in noise) or true room-material impulse
   responses — both push *real* CER above synthetic. So the synthetic
   clean−far-field gap is optimistic and can mis-route Phase 1 ("model
   dominates" when capture actually does). The real-mic recording is
   therefore required to **calibrate the offset**, not merely spot-check —
   it is the founder/hardware gate.
3. **8 GB heavy-model runs.** Running 3B + 1B (and whisper-large-v3)
   back-to-back risks the `(spike-llm)` kernel-panic class. All real runs
   are foreground, sequential, cleaned up, and gated — never background.
   The runs are the irreducible "needs founder hardware / go-ahead" step;
   all code + plumbing + unit tests are produced without them.
4. **Fixture sourcing.** Reference-transcript JA audio: default to a
   public/TTS clip so Phase 0 is not blocked on founder content; upgrade to
   a real founder talk snippet when available.

---

## 9. References

- `desktop/spikes/phase-0/02-3b-lecture-grammar/decision-0.2-latency.md`
- `desktop/spikes/phase-0/02-3b-lecture-grammar/decision-0.2-path-e.md`
- `desktop/spikes/phase-0/02-3b-lecture-grammar/decision-0.2-path-f.md`
- `desktop/eval/README.md` (harness, judges, fixtures, runner state)
- `desktop/eval/runners/offline-3b.ts` (built runner core)
- `desktop/scripts/eval-notes.ts` (CLI; `resolveRunner` throw to replace)
- `desktop/src/shared/models/profiles.ts` (model tiers)
- `docs/HANDOFF.md` section 5 (TRACK 2 open items), section 2 (current state)
- Memory: `v2_note_pipeline_bugfix_2026-06-08`, `v2_merge_consolidation_2026-06-08`
- Skills: `llm-eval-loop`, `api-integration-pitfalls`

---

## 10. Next step

Hand Phase 0 (4a + 4b) to the `writing-plans` skill for a task-level
implementation plan. First implementable tasks: (4b) wire the offline
runner into the CLI + add `offline-1b` (pure code, TDD), and (4a) build the
STT CER/WER harness skeleton + synthetic far-field degradation (pure code,
TDD). The heavy model runs + the 4c composed real-STT→LLM gate follow,
gated per section 8.

---

## 11. Review log

- **2026-06-08 — independent design review** (opus, reviewer ≠ author,
  web-grounded). Verdict: **SOUND**, no blocking issues; factual accuracy
  verified against all cited artifacts. Folded in: model-sweep reframe
  (kotoba v2.0 is a distilled large-v3 → large-v3 is a heavier/slower OOD
  trade, not a free win; measure CER + STT latency + RAM-during-STT-phase;
  STT/LLM swapped, not co-resident) [SHOULD-FIX 1]; `offline-1b` must
  parameterize `id`+`modelId` + assert label correctness or baselines
  mislabel as 3B [SHOULD-FIX 2]; new 4c composed real-STT→LLM gate as the
  measured track-exit [NICE 4, pulled into scope]; synthetic far-field is a
  lower bound → real recording calibrates the offset [NICE 3]; 1B
  kill-criterion + Path-G-first [NICE 5]; single-speaker STT-floor caveat
  [NICE 6]. Sources: kotoba-tech HF model card; Japanese-ASR CER
  convention; far-field RIR-sim + Lombard-effect literature.

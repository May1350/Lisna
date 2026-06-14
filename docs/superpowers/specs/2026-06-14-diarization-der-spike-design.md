# Diarization DER-Measurement Spike — Design

**Status:** DRAFT v2 (brainstorming output, **independent-reviewer findings + founder decisions applied 2026-06-14**, pending founder confirmation)
**Date:** 2026-06-14
**Track:** v2 conversation-note quality → who-said-what
**Relates to:** `docs/superpowers/plans/2026-05-27-v2-plan-4-diarization.md` (the full production plan this spike de-risks), `docs/superpowers/specs/2026-05-26-v2-structured-note-creation-design.md` (§2.4/§4.11 DiarizationEngine contract — frozen in code)
**Reviewer:** independent opus speaker-diarization review, agent `a02369e9d119cac2c` (verdict SOUND-WITH-CHANGES; all MUST-FIX folded in below)

---

## 1. One-line goal

Measure the **real Diarization Error Rate (DER)** of sherpa-onnx on the founder's actual environment (far-field laptop mic, multi-speaker) **before** committing to Plan 4's multi-day C++ build — so we learn cheaply (1-2 days, not ~2 weeks) whether usable acoustic speaker separation is achievable here. **If it is not, pivot to a text-based "role inference" approach** (founder directive — see §7), which does not depend on mic quality.

This is a **measurement spike, not a feature.** It ships no speaker labels. It produces a **number + a GO / PARTIAL / PARK decision.**

## 2. Background — why spike-first, and what the reviewer found

Conversation families currently hardcode diarization `'disabled'` (`session-finalize.ts` routeFamily → `NoOpDiarization`), so every speaker collapses to `[話者0]` (`collapse-speaker-refs.ts`); the 3B then fabricates Q&A structure. Plan 4 (2026-05-27) designed the full sherpa-onnx integration (22 tasks) but Spike 0.3 — the DER measurement that justifies the build — was BLOCKED on founder fixtures and never run. The whole C++ build rests on an **unmeasured assumption.**

**Independent-reviewer reality check (cited, 2026-06-14):** far-field single-laptop-mic DER < 10% **does not exist today**, even for full server-side pipelines.

| Founder case | Closest benchmark | Best-available DER | Our realistic expectation (small ONNX model, laptop mic, auto speaker-count) |
|---|---|---|---|
| 2-4 people, small room | AMI **SDM** (single distant mic, 4 spk) | 15.6-22.7% | **~20-35%** |
| 5+ people, large classroom | **CHiME-6** (far-field, reverberant, multi-party) | 45-58% | **40%+** |
| (close mic, ref only) | AMI IHM / CALLHOME | ~7% / ~12% | needs a headset/near mic — founder doesn't have one |

So the founder's original "90%+ (DER<10%) or hide speakers" bar is, per the literature, **not reachable on a laptop mic** — small-room is the only case with any chance and even there <10% is the optimistic tail; the classroom is ~certainly "hide." The most probable spike verdict is **PARTIAL-leaning-PARK, not GO.** The spike's value is converting that near-certain answer into a cheap, environment-specific, founder-legible number before any C++ is written.

**Founder decisions (2026-06-14, this brainstorm):**
- **Environment:** laptop built-in mic only. Two cases — (a) 2-4 small room, (b) 5+ classroom. **No external mic** (portability/reality).
- **Accuracy bar:** measure with a realistic gate (DER 15%), then **decide GO vs hold from the real number** — don't pre-commit.
- **Mic-comparison arm: dropped** (laptop-only).
- **🔑 Fallback directive:** *if measured accuracy is too poor, HOLD acoustic diarization; instead infer roles ("questioner / responder" etc.) and their relationship accurately from the transcript flow / content.* → the **semantic role-inference track, §7.**

## 3. Scope

**In scope (this spike):**
- Persisting raw recording audio to disk (prerequisite to ever measuring on founder data, and to offline-at-Stop diarization — see §8).
- A measurement runner: sherpa-onnx (offline) → predicted speaker turns → DER, using **pyannote.metrics as the source-of-truth metric** + `der.ts` as a cross-check.
- A calibrated first DER number on public far-field data (AMI-SDM) reproducing the literature with our exact stack.
- A decisive DER number on the founder's real JA far-field recording, split by environment and by `num_clusters` auto vs oracle.
- A written decision memo: GO / PARTIAL / PARK + reasoning.

**Out of scope (NOT this spike):**
- Plan 4 production integration (C++ diarize engine, IPC, picker UX, model-resolver 4-slot, family wiring). Runs **only on a GO.**
- Speaker **naming** (cluster "A" → "田中さん").
- The semantic role-inference build (§7) — that's the **PARK pivot**, brainstormed separately once the spike says acoustic is out.
- STT accuracy — separate track.

## 4. Design — three stages

| Stage | What | Founder dep | Persists after spike? |
|---|---|---|---|
| **0. Audio-save hook** | Write recorded audio to disk as one per-session `.wav`. | None | **Yes** — production code (offline-at-Stop diarization + re-processing need the whole-session WAV) |
| **1. Calibrated pipeline + AMI read** | sherpa-onnx **Python API** + pre-converted ONNX models; reproduce AMI-SDM literature number with our stack (learn our penalty), validate the DER harness. | None | Runner is scratch (promotable to `scripts/eval-diarization.ts`) |
| **2. Real DER (decisive)** | Founder records 1-2 real meetings (doubles as 2-pass hands-on test). Independently author ground-truth labels. Measure true JA far-field DER, split by environment + auto/oracle speaker count. | 1-2 recordings + label review | Fixtures saved for Plan 4 regression |

### Stage 0 — audio-save hook (prerequisite)

Today audio is memory-stream-only. In `desktop/src/main/sidecar/orchestrator.ts`, `onChunk(audio, sessionOffsetSec = 0)` (line 639) passes the **`audio` `Float32Array` to `this.opts.stt.transcribe(audio)` at line 640**, then keeps only segments (`this.segments.push(...segs)`, line 646); the buffer is GC'd. The debug-dump tree (`session-debug-dump.ts`) writes text only (`transcript.json` / `llm-calls.ndjson` / `note.json` / `result.json` / `grammar-*.gbnf`) — no audio. The 3 existing founder dumps are therefore unusable for DER.

**Hook:** fire an optional `onAudioChunk?(audio, sessionOffsetSec)` side-channel **at line 640, on the raw `audio` buffer BEFORE the line 641-644 timestamp remap** (the remap touches only segment ts, not audio — but the plan must reference the line-640 buffer explicitly since execution is subagent-driven). A main-process collector concatenates chunks in offset order → one 16 kHz mono PCM `.wav` in the session dump dir on finalize. **Opt-in/gated** (privacy + disk; raw meeting audio is PII — see R7). This is the only Stage-0 code that lives on regardless of verdict, and it is **required by the offline-at-Stop production architecture** (§8).

### Stage 1 — calibrated pipeline + AMI read

- **sherpa-onnx Python API** (NOT the node binding). Reviewer Q1: the Python path (`offline-speaker-diarization.py`) is the maintainers' canonical, lowest-unknown route to a *trustworthy* number; the spike needs no Node/IPC coupling (that's a production concern). Node binding is maintained + macOS-arm64-capable but is the wrong tradeoff for a measurement.
- **Models:** use sherpa-onnx's **pre-converted, ungated ONNX releases** (segmentation: pyannote-segmentation-3.0 ONNX **and** the reverb-tuned `sherpa-onnx-reverb-diarization-v1` — directly targets our reverberant rooms; embedding: 3D-Speaker eres2net, with NeMo TitaNet / WeSpeaker as fallback-ladder candidates). Avoids the gated HuggingFace pull. Record in the memo that the **production license is MIT** (pyannote-segmentation-3.0) — clean for shipping.
- **Calibration:** run our exact stack on a handful of **AMI-SDM** files (RTTM ground truth already exists) and confirm we land near the published ~22.7%, learning our stack's penalty vs full pyannote. This makes the founder's later number interpretable. Also run sherpa's bundled 4-speaker example wav to validate harness wiring.

### Stage 2 — real DER (decisive)

- Founder records 1-2 sessions on the laptop mic (same recordings = the 2-pass hands-on test). With Stage 0 shipped, the `.wav` lands in the dump.
- **Ground truth authored INDEPENDENTLY of STT** (R11): listen + mark speaker turns in an audio editor (Audacity/ELAN label track) → `[{start, end, speaker}]`. Do NOT derive boundaries from the same Whisper segmentation the prediction is later snapped to — that cancels boundary error and flatters DER. Keep N tiny (1-2 files), spot-check.
- **Measure** with `num_clusters=-1` (realistic auto-detect) **and** `num_clusters=<oracle>` (ceiling) on each fixture — the gap isolates speaker-**count** error from embedding/confusion error (R9). Split by environment (small vs classroom). Run the reverb segmenter + at least one embedding-ladder swap if cheap.

## 5. Measurement methodology

- **Source-of-truth metric: pyannote.metrics `DiarizationErrorRate` (collar 0.25s)**, reported both with and without overlap scoring. Reuse `der.ts` (`computeDer`, 100 ms grid, greedy match) only as a cross-check, and **report it + the overlap-% alongside.** Rationale (reviewer Q4/MUST-FIX 2): `der.ts` ignores overlapped speech (its 100 ms grid keeps one speaker/slot) → biases DER **optimistically by ~the overlap fraction** exactly in the founder's high-overlap discussion case; greedy (non-Hungarian) matching + no collar make the net bias unknown — unacceptable for a threshold gate. We're already in Python (Stage 1), so pyannote.metrics is a `pip install`.
- **Measure DER on diarization's NATIVE turn boundaries** (apples-to-apples with the literature), and **separately report the extra loss from snapping turns onto STT segments** (what the product actually shows) — R10. Don't conflate them.
- **Reported:** per-fixture DER (native + STT-snap), environment-bucketed, auto-vs-oracle speaker count, overlap-%, model variant; plus peak RSS of the offline pass on a real-length file (R12) and qualitative confusion notes.

## 6. Decision criteria (end of spike)

Re-anchored to far-field reality + Plan 4's own G1 gate (reviewer MUST-FIX 3). The founder's true criterion is "wrong labels are worse than no labels," so the gate is set where labels are right often enough to help, not at academic SOTA.

| Outcome | Threshold (real environment) | Next |
|---|---|---|
| **GO** | DER ≤ **15%** | Plan 4 acoustic build, scoped to the passing environment(s) |
| **PARTIAL** | small-room ~15-25%, classroom fails | Founder's call: small-meeting-only acoustic, or pivot to §7 |
| **PARK** | DER > **25%** everywhere | Hold acoustic diarization; **pivot to the semantic role-inference track (§7)** per founder directive |

Even the GO bar (15%) is above the founder's requested 10% — i.e. "show speakers" would mean "~85% right." Founder has chosen to **decide GO vs hold from the real measured number** rather than pre-commit. Expected outcome per the literature: PARTIAL-leaning-PARK.

## 7. Semantic role-inference track (the PARK pivot — founder directive)

> *Founder 2026-06-14: "정확도가 너무 안 나오면 화자 분리는 우선 보류. 단, 자막 흐름·내용으로 질문자/응답자 등은 정확히 유추해서 관계 정도는 알 수 있도록."*

If acoustic DER lands in PARK (likely for the classroom case, plausibly for both), we do **not** ship `[話者0]`-collapse. Instead we infer **roles and relationships from the transcript text**, independent of mic quality:

- **What it produces:** role attribution (interviewer ↔ interviewee, questioner ↔ responder; meeting: facilitator / contributor) + the relationship between parties — NOT acoustic identity. "Who is voice A" stays unknown; "this is a question, this is the answer, and these are two parties in an interview" is recovered.
- **Why it can work where acoustic fails:** it reads the *content* (interrogative vs declarative turns, Japanese politeness/role registers, address terms, turn-transition patterns) — all of which survive a bad far-field mic intact. Strongest in 2-party Q&A (interview), weaker in 5+ free discussion (set expectations).
- **Existing seed:** 2-pass interview already has a `qa_pairs` question/answer discriminator (memory "F2") that text-derives `asked_by`/`answered_by`; today it's nullified because diarization is `disabled` and refs collapse. This track *promotes* that text-based inference from a side-effect to the primary signal.
- **Status:** designed-but-not-built here. It is the **PARK pivot**, brainstormed as its own spec once the spike confirms acoustic is out (or partially, if founder wants it alongside small-room acoustic). Flagged now so the spike's PARK branch has a concrete, founder-endorsed destination rather than a dead end.

## 8. Production architecture implication — offline-at-Stop (reviewer MUST-FIX 1)

sherpa-onnx diarization is **offline/batch only**: `OfflineSpeakerDiarization.process(wholeAudio)` does global clustering over the entire file. There is **no streaming/online API.** This contradicts Plan 4's `DiarizationEngine.processChunk(10s)` "runs during recording" framing. Consequences:

- **The spike must measure the offline-at-Stop path** (whole-session WAV, global clustering) — that's what production should become — not a simulated online path.
- **Production diarization should run at Stop, after STT unload, on the whole-session WAV** (which Stage 0 persists), *before/around* LLM load — **not** per-chunk during recording. This is strictly more accurate (sees all speakers before deciding) **and** simplifies the 8 GB RAM story: diarization no longer contends with STT during recording; it occupies the post-STT slot. Plan 4 §2.4 + the `processChunk` contract need revision to match. (Caveat: it now shares the memory-pressure window with the LLM phase → measure peak RSS, R12.)
- The frozen `DiarizationEngine` interface can stay; only the orchestration timing (when/how it's called) changes from per-chunk-during-record to once-at-Stop.

## 9. Risks

- **R1 — 90% likely physically unreachable here.** Expected, not a failure: the spike proves it cheaply and steers to the §7 pivot (and, separately, a mic upgrade is the biggest acoustic lever — surfaced to founder, who chose laptop-only for now).
- **R2 — Public-data inference gap.** AMI (English) informs *acoustic* difficulty (distance/reverb/overlap are language-agnostic); the founder's real JA recording is the decision-grade number. Stage 1 is calibration, Stage 2 decides.
- **R3 — Synthetic far-field ≠ real.** Demoted to optional negative-control only (clean silence misses far-field VAD false-alarm, R13). AMI-SDM is the better Stage-1 input.
- **R4 — sherpa-onnx-node** is maintained + arm64-capable, but Python is the safer spike vehicle (Q1). Not a blocker.
- **R5 — Ground-truth labeling cost/accuracy.** Keep N=1-2, label carefully, spot-check; mislabeled GT corrupts DER either way.
- **R8 — Offline-batch is an EASIER problem than online.** The spike's offline number is an upper bound on any online path — but since production should *also* go offline-at-Stop (§8), the spike measures the right thing. Stated so a GO doesn't silently assume the harder online path.
- **R9 — Speaker-count auto-detection error** is a large, distinct failure mode → measure auto vs oracle (§4 Stage 2). If count is the problem, a cheap product lever is *asking the user how many speakers*.
- **R10 — STT-snap vs native-turn DER** differ; measure native, report the snap delta.
- **R11 — Circular ground truth.** Author GT independently of STT segmentation (§4 Stage 2).
- **R12 — RSS is a GO-blocker too.** Offline-at-Stop means diar-vs-LLM memory contention on 8 GB; record peak RSS of the offline pass on a real-length file. A passing DER on an OOMing config is not a GO.
- **R13 — Far-field VAD false-alarm floor** (HVAC, fans, hallway speech) inflates real DER and is invisible in synthetic audio — another reason the real recording is the only trustworthy number.
- **R7 — Audio persistence = PII + disk.** Gate it (opt-in), document retention, keep fixtures local-only.

## 10. Hardware safety (spike-llm rule)

Real ONNX inference is CPU+Metal-bound, same risk class as Whisper STT on 8 GB. Foreground only (never `run_in_background`), `afterAll`/`try-finally` cleanup, **`pgrep -f offline-speaker-diarization` (the Python process — not just `lisna_sidecar|vitest`) + `kill -9` survivors** before/after each run, one fixture at a time.

## 11. Deliverable

A decision memo (`docs/superpowers/decisions/2026-06-14-diarization-der-spike-verdict.md`): measured DER (per environment / model / auto-vs-oracle, native + STT-snap, with pyannote.metrics + der.ts cross-check + overlap-% + peak RSS), methodology + fixtures, and the GO / PARTIAL / PARK recommendation with reasoning — and if PARK, a pointer to open the §7 role-inference spec. Plus the persisted audio-save hook (production code) and the spike runner (scratch, promotable).

## 12. Changes from v1 (reviewer + founder applied)

- Stage 1 engine: sherpa-onnx-node → **Python API**; models → **pre-converted ungated ONNX** + **reverb segmenter**; added **AMI-SDM calibration**.
- Metric: added **pyannote.metrics (collar 0.25) as source of truth**, `der.ts` demoted to cross-check; report overlap-%; **native-turn DER + STT-snap delta**.
- Stage 2: **auto vs oracle speaker count**, **independent (non-STT) ground truth**, **peak RSS**.
- Thresholds: GO **≤10%→≤15%**, PARK **>30%→>25%**.
- New **§8 offline-at-Stop** production architecture decision (sherpa-onnx is batch-only; revises Plan 4's per-chunk framing; simplifies RAM).
- **Mic-comparison arm removed** (founder: laptop-only).
- New **§7 semantic role-inference track** as the founder-directed PARK pivot.
- Risks R8-R13 added; §10 cleanup names the Python process; §2 reframed around the cited 90%-unreachable reality.

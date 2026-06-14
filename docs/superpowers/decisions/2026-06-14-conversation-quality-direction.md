# Conversation note quality — direction needed (2026-06-14)

> Prepared autonomously overnight while founder asleep. **No code committed for this — it's a decision brief.** The two items below are product-level (architecture/scope), so I'm not starting either unilaterally. Pick a direction and I'll spec → plan → build → validate via the loop.

## Where we are (good news)
**Structural 2-hour stability is DONE and on `main`** — 3 reviewer+CI-gated PRs tonight:
- **#125** — lecture section consolidation + JA-native prompt (rung-1)
- **#126** — multi-chunk engine stability: UTF-8 token-streaming fix + per-`generate()` KV-cache reset (this was the real root cause — long recordings silently stalled/emptied mid-finalize)
- **#127** — conversation cap-fit: meeting/interview/brainstorm arrays can no longer exceed schema caps

**All 4 families now finalize a 2-hour recording without crashing.** Lecture (monologue) already produces good, grounded Japanese notes end-to-end.

The remaining gap is making **conversation** (interview / meeting / brainstorm) notes actually **valuable**, not just non-crashing. Two blockers, both needing your call:

## Blocker A — Diarization (who-said-what) is OFF
- **Today:** hardcoded to NoOp → every speaker is labeled `[話者]` (one speaker). The 3B can't tell turns apart → it *fabricates* Q&A structure for interviews/meetings.
- **Architecture already exists:** a `DiarizationEngine` interface (sherpa-onnx, **on-device**, segmentation + embedding ONNX models, online clustering, <1s per 10s chunk target), the speaker-status plumbing, and the NoOp fallback are all in place (Plan 4 froze the types). Only the real sherpa-onnx engine + models are unbuilt. On-device fits the PRD ("v2 = on-device primary").
- **Effort: substantial** (~multi-day): build the sidecar sherpa-onnx diarizer, ship 2 ONNX models, fit the 8 GB RAM budget (it runs parallel with STT during recording), add a DER (accuracy) acceptance gate.
- **Key risk + question:** far-field laptop-mic multi-speaker audio is genuinely hard to diarize accurately (your earlier recordings already showed far-field STT degradation). Poor speaker separation → mislabeled turns. **→ Q1: what's the real recording setup — multiple people on a laptop mic, or a better/closer mic?** This decides whether diarization is worth the effort + accuracy risk.

## Blocker B — Fabrication (3B drifts to English/invented content on hard inputs)
- **Proven** (decision doc `2026-06-12-fabrication-culprit.md`): the GBNF JSON-schema **grammar** — not the sampler — flips the 3B out of Japanese on hard inputs (finance topic + garbled STT). Grammar OFF → grounded JA; grammar ON → English fabrication. Bookkeeping/lecture content doesn't trip it (why lecture works); finance-interview-type content does.
- **Options:**
  1. **2-pass (recommended):** generate FREE Japanese text first (grounds reliably, no grammar), then structure it into the schema — deterministically or via a 2nd small LLM pass. R5-backed (free-gen grounds). Effort: moderate–substantial (a generation-strategy change).
  2. Lighter grammar (less English scaffolding) — smaller change, uncertain payoff.
  3. Stronger model — breaks the 8 GB on-device constraint. Not recommended.

## Recommendation + the decision
- **Do 2-pass (B-1) first** — higher leverage, lower risk: it fixes fabrication for *all* hard content + every family's prose, doesn't depend on hardware accuracy, and the approach is already validated. Makes lecture-on-hard-content + meeting/brainstorm prose reliable.
- **Diarization (A) is required for real interview/meeting Q&A attribution**, but only worth the effort + far-field risk if the multi-speaker-on-laptop use-case is real (Q1).
- **Suggested sequence:** (1) answer Q1 (recording setup); (2) I build 2-pass; (3) diarization next *if* the use-case justifies it.

**→ Q2: which first — 2-pass, diarization, or something else?** Tell me Q1 + Q2 and I'll run the chosen track through the loop (spec → plan → SDD → real-3B validate → reviewer → PR).

---

## 2026-06-14 UPDATE — 2-pass (B-1) CONFIRMED on the hardest real fixture + one decision for you

You picked Q2 = 2-pass first. I de-risked it with a real-3B spike on the exact recording that produced the 100%-English fabricated note, then had an independent expert audit it. **It works:**

- **Before (today's single-pass):** that finance interview → a 100% English, fabricated note (0% Japanese).
- **After (2-pass):** a 94%-Japanese note, 79% of its content traceable to the transcript, with a concise title and properly-split Q&A. The English-fabrication is gone.

The expert signed off on building it for real (with a few engineering guardrails I've already scoped). **Structurally it handles a 2-hour recording on your 8GB Mac** — each chunk is processed in its own fresh memory, so length doesn't accumulate.

**The one product call for you (not blocking — I'm building it now on the current engine):**
- 2-pass runs the model twice per chunk, so a **2-hour** recording takes roughly **~25 min to finalize** on the current (accurate-but-slow) engine.
- There's a **~2× faster engine** I'd previously shelved because it didn't fix fabrication on its own. **2-pass removes the reasons it was shelved** — so it may now be a free speed win (~25 min → ~12-18 min for 2h) with the same quality.
- **Question:** want me to measure 2-pass on the faster engine during this build and adopt it if quality holds? Or ship on the current engine first and optimize later? (Either way the 2-pass design is the same; this only decides whether a speed upgrade rides along.)

**Honest limitation:** each chunk is summarized independently, so a 2h note reads as a series of section-summaries unioned together, not one globally-rewritten narrative. Grounded and structured — but not a single synthesized arc. Tell me if that matters for your use.

Still next after this: **diarization** (your Q1 = multi-speaker room) — required for real "who-asked-what" attribution; 2-pass fixes grounding + structure but not speaker attribution.

---
*Small unrelated follow-up: the brainstorm faithfulness-judge has a dead `conclusions` field (`faithfulness-judge.ts:97-100`) — I'll fold that fix into whichever quality track touches the eval.*

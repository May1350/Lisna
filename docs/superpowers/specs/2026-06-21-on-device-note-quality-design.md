# On-device note quality — extraction-driven meeting note (design)

**Date:** 2026-06-21
**Status:** Design — independent-reviewer APPROVED-WITH-CHANGES (2026-06-21); changes folded in below. Awaiting founder review.
**Track:** v2 on-device note generation (`desktop/`)
**Family:** MEETING first (multi-speaker). The pattern generalizes to interview/brainstorm later.

## 1. Problem

The on-device note (Llama-3.2-3B-Q4) is not a usable structured knowledge base. Measured over 4 eval iterations on a 336-segment synthetic JA meeting (`desktop/eval/fixtures/meeting/q3-allhands-noisy-ja`, with a gold answer key + a 45-point rubric): best score **20/45 (~44%)**.

Diagnosed cause (empirical, not assumed): the 3B does **local extraction** well (iter2 captured real decisions, action items, the correct adversarial date `10月14日`, proper nouns) but **cannot do global reorganization** — consolidating fragments into ~6 topics, dedup, a comprehensive executive_summary. A dedicated LLM consolidation pass (iter3) *ran successfully* and the 3B still emitted 20 fragmented topics + kept noise it was told to drop. This is a **model-capacity** limit, not a prompt/pipeline gap. Faithfulness is clean throughout (jaRatio ~0.75, no fabrication-flip).

Also surfaced: the current two-pass-per-chunk + consolidation pipeline is **over the latency budget** — iter2 = 332s (5.5 min), iter3 = 516s (8.6 min) — vs the ≤5 min finalize constraint.

## 2. Constraints (locked with founder)

- **Strictly on-device / offline.** Privacy is the product — NO cloud, not even opt-in.
- **Small model only (~2GB, e.g. Llama-3.2-3B-Q4).** 7B+ is NOT viable on the founder's machine or most users' 8GB-or-less Macs. (A larger model is off the table.)
- **finalize ≤ ~5 min.**
- **8GB RAM** (OOM/swap = kernel-panic risk — never co-resident with STT).

## 3. Principle

**LLM does LOCAL extraction only; CODE does GLOBAL assembly; LLM writes only DERIVED prose over compact, faithful inputs.** This is the generalization of a pattern already shipped and proven in the Interview/Brainstorm families (`merge-llm.ts` + the `[2026-05-29] (llm-merge)` domain rule: union enumerable fields deterministically; let the LLM synthesize only derived prose). Meeting currently violates it (per-chunk full-note + concat-merge).

## 4. Architecture

Replace finalizeMeeting's "per-chunk full MeetingNote → deterministicMerge (concat) → cap-fit → (LLM consolidation, iter3)" with:

1. **Chunk** the transcript (existing `chunkTranscript`, ~3000 tok → ~5-6 chunks).
2. **EXTRACT** — `meeting-extract.ts`. One LLM call per chunk producing a **flat typed-atom** object (small dedicated GBNF, easy for a 3B): `decisions[{text, made_by?, ts}]`, `action_items[{task, owner?, due?, ts}]`, `key_figures[{label, value, ts}]`, `open_questions[{text, ts}]`, `risks[{text, ts}]`. Prompt: "from THIS chunk only, extract decisions / action items (task+owner+due) / key figures / questions / risks." Purely local — the 3B's strength. Keep the existing chat-template + epilogue-strip path (avoid the `[2026-05-29] llm-grammar` truncation regression).
3. **ASSEMBLE** — `meeting-assemble.ts` (pure functions, unit-testable, NO LLM). Union all chunk atoms, then **field-specific dedup** (see §5), preserving owners/dues/values. **Then SYNTHESIZE topic_arc + discussions deterministically** (REQUIRED — they are non-optional schema fields): cluster atoms into topics by **anatomy: agenda/anchor detection first** (regex for transition cues 「次は」「続いて」 + proper-noun first-mentions to seed boundaries), else ts-bucket clustering; emit one discussion per cluster with its atoms as key_points. Route assembled items through `runPostDecodePipeline` so `from` provenance is set.
4. **DERIVED PROSE** — `meeting-prose.ts` (focused LLM, compact input):
   - `executive_summary`: **reduce over the per-discussion summaries** (the 6 deterministic clusters' summaries), prompt "write 2-4 sentences touching each." Local synthesis over short faithful inputs — NOT a global note pass.
   - **(EXPERIMENT, not default)** LLM topic grouping: an A/B alternative to §3's deterministic clustering. Ships ONLY if it beats the deterministic baseline on the rubric. The evidence (iter3) predicts it will not; treat as measured experiment per founder's "둘 다 시도 후 비교".
5. **Emit MeetingNote** from assembled atoms + exec_summary + deterministic topic_arc/discussions. Existing schema + renderer unchanged. Drop the iter3 LLM consolidation pass (the deterministic assembly replaces it; it was −0 structural gain / +184s).

## 5. Dedup (the highest-risk component — hardened per review)

The 3B does NOT paraphrase one decision; it **decomposes** one dense decision into several distinct low-overlap atoms. So the real risk is **over-merging distinct facts**, not under-merging paraphrases. A flat trigram pass at threshold 0.7 would wrongly collapse the adversarial number traps (MRR 4,200万 / 3,600万 / 4,000万 share "MRR/万円" trigrams). Field-specific rules:

- **key_figures:** dedup by **normalized value + label anchor** ONLY — strip 円/万/,/、 → number; two figures are duplicates only if the normalized number AND a label token both match. NEVER collapse distinct numbers. (Protects the number-fidelity the fixture exists to test.)
- **decisions / action_items:** dedup by a **content anchor** (shared proper-noun and/or shared number) AND trigram ≥ ~0.8, mirroring `unionInterviewQaPairs` (ts-window + trigram). Note the 3B emits `ts:0` unreliably, so anchor on content, not ts alone.
- Reuse `trigrams`/`jaccard` from `deterministic-merge.ts`; raise the generic threshold toward 0.8 + require an anchor (avoids the `unionParticipants` short-string over-collapse class).
- **Fail-first regression fixture** (per `testing.md [2026-05-27]`): prove the three MRR figures + the 4,200-vs-4,400 / 3,480-vs-3,800 traps survive dedup BEFORE the dedup lands.

## 6. Evaluation

Existing harness (`scripts/note-loop-run.ts` driver + `eval-notes.ts` + the q3-allhands fixture/gold/rubric). Compare: current 20/45 → **B-flat (deterministic assembly)** → **B + LLM-grouping experiment**. Per axis: dedup correctness, owner capture, exec_summary topic coverage, topic count (→ ~6), noise rejection, number-trap survival, latency (target < 5 min — B should beat iter2's 5.5 min by dropping a pass).

**Fix the coverage matcher (or the gold):** `captured 0/8` is a *matcher artifact* — the gold decisions are dense compound sentences; the model emits the same content as atomized sub-facts; exact/trigram matching scores 0 even when content IS captured. Decompose the gold decisions into atoms OR use a containment/figure-anchor matcher, so the eval scores B fairly (the current 20/45 likely understates content capture).

## 7. Honest target + the model-capacity floor

B is the right next step and worth shipping regardless: it produces a clean, deduped, faithful, well-structured note AND fixes the >5-min latency. **But B alone likely lands in the high-20s/low-30s out of 45, NOT the 38+/cloud-parity bar** — the residual gap is **model-floor artifacts code cannot fix**: encoding junk inside atom text (枯渋 / ポストモLETEム / Chinese-variant chars), owner attribution collapsed to speaker 0 (diarization disabled), and shallow prose. With a larger model off the table, the realistic paths to true cloud parity are:
- **Fine-tuning / distillation** of a small (~2GB) model specialized for this note task (long-horizon, real infra) — the eventual last-mile lever.
- **Diarization** (complementary) — restore per-speaker owners/decisions, which a KB note needs.
- Otherwise: accept "clean / fast / faithful / well-structured, with small-model prose" as the honest on-device bar.

## 8. Complementary levers (noted, not core)

- **Same-size-better model** (~2GB, commercially licensed): Phi-3.5-mini (MIT) or Qwen2.5-3B — better instruction-following; cheap swap test. Won't fix global reasoning (code does that now) but may reduce encoding junk / improve extraction. Low-risk parallel experiment.
- **Fine-tune** (§7) — long-term.
- **Diarization** (§7) — owner attribution.

## 9. Components (isolated, testable)

- `meeting-extract.ts` — per-chunk flat-atom extraction (prompt + flat GBNF + parse). Depends on: sidecar generator, chunk.
- `meeting-assemble.ts` — PURE functions: union + field-specific dedup + deterministic topic_arc/discussions synthesis. NO LLM → fully unit-testable. The load-bearing unit.
- `meeting-prose.ts` — focused exec_summary (reduce) + experimental LLM grouping.
- `finalizeMeeting` (orchestrator.ts) — rewire extract → assemble → prose; remove the iter3 consolidation pass + the per-chunk full-note path.

## 10. Phasing

- **Phase 1:** flat extraction schema + `meeting-extract.ts` + `meeting-assemble.ts` (union + hardened dedup + deterministic topic_arc/discussions) + rewire finalizeMeeting + the coverage-matcher fix + the number-trap regression fixture. Eval vs baseline.
- **Phase 2:** map-reduce exec_summary; measure.
- **Phase 3 (experiment):** LLM topic grouping A/B; ship only if it wins.
- **Out of scope (separate tracks):** fine-tuning, diarization, the same-size-model swap (parallel experiment).

## 11. Self-review notes

- No placeholders. Scoped to ONE subsystem (meeting finalize) — fits one implementation plan.
- The eval's `captured 0/8` is explicitly a matcher artifact (§6) — do not read it as a content regression.
- The honest target (§7) is deliberately below "cloud parity" — the spec must not over-promise; B is necessary, not sufficient, for the founder's full bar on a 3B.

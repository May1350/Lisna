# Diarization DER Spike — Stage 1 Calibration Read (AMI-SDM)

**Status:** Stage 1 (calibration) DONE. **Final GO/PARTIAL/PARK verdict is
PENDING the founder's real JA laptop-mic recording (Stage 2).** This note is the
running calibration scratch the eventual verdict memo
(`2026-06-14-diarization-der-spike-verdict.md`) builds on.
**Date:** 2026-06-14
**Spec:** `docs/superpowers/specs/2026-06-14-diarization-der-spike-design.md`
**Plan:** `docs/superpowers/plans/2026-06-14-diarization-der-spike.md` (Task 6)

---

## TL;DR

On public far-field benchmark audio (AMI **SDM** = single distant mic), our
sherpa-onnx stack lands **deep in PARK** (the spec's >25% "hold acoustic
diarization" band) on **both** meetings measured:

- **Oracle speaker count (best case, you tell it K): DER ~31–36%.**
- **Auto speaker count (the realistic product path): DER ~77–83%** — it
  over-detects **~90 speakers** where there are 4.

And AMI SDM is a *dedicated array microphone in a controlled meeting room*. The
founder's case is a **laptop built-in mic** (worse) in a small room, and a **5+
classroom** (much worse, CHiME-6 territory). So Stage 2's real number is very
unlikely to beat this. The spec already predicted PARTIAL-leaning-PARK; the
calibration confirms the PARK lean hard.

**This does not yet make the verdict** — Stage 2 (the founder's real recording)
is the decision-grade number and may shift the small-room case. But expectations
should be set now: acoustic speaker separation on a laptop mic is very likely a
HOLD, and the founder's text-based **role-inference** pivot (spec section 7) is
the probable destination.

---

## Setup (reproducible)

| Piece | Value |
|---|---|
| Engine | sherpa-onnx **1.13.2** (Python API), offline `OfflineSpeakerDiarization.process(wholeAudio)` |
| Segmentation | `sherpa-onnx-pyannote-segmentation-3-0/model.onnx` (MIT) |
| Embedding | `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx` (default); campplus tested as swap |
| Clustering | `FastClustering` (num_clusters auto=-1 or oracle=K; threshold for auto) |
| Metric | **pyannote.metrics 4.1 `DiarizationErrorRate`, collar 0.25s** (source of truth) + repo `der.ts` cross-check |
| Data | AMI **SDM** `*.Array1-01.wav` (16 kHz mono), test set; ground truth = pyannote/AMI-diarization-setup `only_words` RTTM (authored independently of our STT — no circularity) |
| Hardware | this Mac (8 GB class), CPU, num_threads=2 |

Scripts: `desktop/spikes/phase-0/03-diarization-ja/{run-diarization,score-der,rttm-to-truth}.py`, `der-crosscheck.mjs`, `download-models.sh`.

---

## Results — per meeting (full file)

| Meeting | Len | Mode | DER | miss | FA | confusion | det. spk (truth 4) | overlap% |
|---|---|---|---|---|---|---|---|---|
| ES2004a | 17.5m | **auto** (thr 0.5) | **0.771** | 0.130 | 0.044 | 0.596 | **95** | 15.8 |
| ES2004a | 17.5m | **oracle K=4** | **0.362** | 0.128 | 0.042 | 0.192 | 4 | 15.8 |
| IS1009a | 14.0m | **auto** (thr 0.5) | **0.834** | 0.055 | 0.060 | 0.718 | **89** | 13.6 |
| IS1009a | 14.0m | **oracle K=4** | **0.312** | 0.053 | 0.056 | 0.203 | 4 | 13.6 |

- **Auto is destroyed by speaker-count blow-up.** Both meetings detect ~90
  clusters for 4 real speakers → confusion alone is 60–72%. This is the spec's
  R9 failure mode, at full force on far-field.
- **Even oracle (perfect K) is ~31–36%** — a hard confusion+miss floor (~20%
  confusion even when forced to exactly 4 clusters). Already > PARK threshold.

## Auto threshold sweep (ES2004a, first 5 min, truth=3 spk)

| cluster-threshold | detected spk | DER |
|---|---|---|
| 0.6 | 16 | 0.521 |
| 0.7 | 13 | 0.499 |
| 0.8 | 9 | 0.396 |
| 0.9 | 9 | 0.396 (plateau) |

Higher threshold merges more, but **plateaus at 9 speakers (truth 3)** — auto
count cannot be tuned to the right answer; the far-field embeddings aren't
separable enough. Best-tuned auto (~0.40) is still worse than oracle and far
above GO/PARTIAL. **Auto-clustering is not rescuable by threshold here.**

## Model-swap matrix (ES2004a, first 5 min, oracle K=3)

| segmentation | embedding | DER | miss | FA | conf |
|---|---|---|---|---|---|
| pyannote-seg | eres2net | 0.314 | 0.118 | 0.127 | 0.069 |
| **reverb-seg** | eres2net | **1.047** | 0.056 | **0.941** | 0.051 |
| pyannote-seg | **campplus** | **0.302** | 0.119 | 0.127 | 0.057 |
| reverb-seg | campplus | 1.076 | 0.056 | 0.917 | 0.102 |

- **The reverb-tuned segmenter is UNUSABLE as-is** — 92–94% false alarm (it
  flags speech almost everywhere). The spec hoped it would help reverberant
  rooms; it destroys precision instead. Negative result — do not ship it without
  separate VAD/threshold work.
- **campplus ≈ eres2net** (marginally better confusion). No material lever.

## Resource + cross-check

- **Peak RSS ≈ 467 MB** (`/usr/bin/time -l`, IS1009a full-file oracle). Diarization
  is **NOT a memory blocker** — it fits the post-STT / pre-LLM slot on 8 GB with
  large headroom. This validates the spec section-8 **offline-at-Stop**
  architecture from the RAM side: accuracy, not memory, is the gate.
- **RTF ≈ 0.26** (CPU, 2 threads) → a 14-min file diarizes in ~3.7 min at Stop.
- **der.ts cross-check** (repo `computeDer`, greedy, no-overlap, no collar)
  tracks pyannote within ~2–2.5pp, reading slightly HIGH (no collar): example
  0.289 vs 0.274; IS1009a oracle 0.337 vs 0.312. Repo metric is sane; keep
  pyannote.metrics as source of truth.

## Calibration vs published

| Pipeline | AMI SDM DER (auto) |
|---|---|
| pyannote 3.1 full pipeline (tuned, published) | ~22.7% |
| **our stack — oracle K (ceiling)** | **31–36%** |
| **our stack — auto (realistic)** | **77–83%** |

Our **penalty**: even the oracle ceiling is +9–13pp worse than pyannote 3.1's
*auto* number (small ONNX seg/emb + untuned FastClustering vs a tuned pipeline);
our *auto* is +55–60pp worse because FastClustering speaker-counting collapses on
far-field. This is the expected "small-stack + auto-count" gap the spec wanted to
quantify. It means a real GO would need both a much better mic AND speaker-count
help (e.g. asking the user "how many speakers?", spec R9), and even then ~oracle
30%+ is the floor on this segmentation/embedding pair.

---

## What Stage 2 must still measure (does not change the lean, completes the verdict)

1. **Founder's real JA recording** on the laptop built-in mic (`LISNA_SAVE_AUDIO=1`,
   Stage 0 shipped) — small-room (2-4) and, if available, classroom (5+).
2. Independently authored ground truth (Audacity/ELAN by ear — R11), auto vs
   oracle, native-turn vs STT-snap DER, per environment.
3. If small-room real DER somehow lands ≤25% it becomes a PARTIAL conversation;
   otherwise the verdict is PARK → open the spec section-7 role-inference spec.

## Interim recommendation (subject to Stage 2)

**Lean: PARK acoustic diarization on the laptop-mic path.** Two independent
far-field meetings both fail the gate by a wide margin in the *best* case, the
auto path is catastrophic, the one "far-field" model (reverb-seg) is broken, and
the founder's mic is worse than AMI's. Surface this to the founder now so the
Stage-2 recording is framed as confirming-the-floor, not exploring-the-ceiling —
and pre-warm the **text role-inference** track (spec section 7) as the likely
destination. Hold the ~2-week Plan 4 C++ build until/unless Stage 2 small-room
contradicts this.

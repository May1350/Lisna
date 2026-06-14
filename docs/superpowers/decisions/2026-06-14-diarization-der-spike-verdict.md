# Diarization DER Spike — Task 9 Verdict (GO / PARTIAL / PARK)

> **STATUS: PENDING — Stage 2 not yet measured.** This is the Task-9 memo
> scaffold. The decision-grade number is the founder's **real JA laptop-mic
> recording**, which does not exist yet (`audio-captures/` is empty as of
> 2026-06-15). The Stage 2 tables below are placeholders; **do not read a
> verdict here until they are filled from a real recording.** Stage 1 (public
> benchmark calibration) IS done and is summarized below — it leans PARK hard,
> but per the founder's "실측 1회 후 판정" decision (2026-06-15) the verdict waits
> on the real number.

**Spec:** `docs/superpowers/specs/2026-06-14-diarization-der-spike-design.md`
**Plan:** `docs/superpowers/plans/2026-06-14-diarization-der-spike.md` (Tasks 7–9)
**Calibration read:** `docs/superpowers/decisions/2026-06-14-diarization-stage1-calibration.md`

---

## Gate (spec §6)

| Band | DER | Action |
|---|---|---|
| **GO** | ≤ 15% | Open Plan 4 acoustic build, scoped to the passing environment(s). |
| **PARTIAL** | small-room 15–25%, classroom fails | Founder call. |
| **PARK** | > 25% everywhere | Hold acoustic diarization; open the spec §7 semantic **role-inference** spec (text-based, mic-independent). |

---

## Stage 1 calibration (DONE — public AMI-SDM far-field, the apples-to-apples proxy)

Single distant mic (AMI **SDM**, one `Array1-01` channel, no beamforming) = the
same single-mic condition as the founder's laptop. Full detail + independent
review in the calibration read.

| Pipeline | AMI-SDM DER |
|---|---|
| pyannote 3.1 full pipeline (tuned, published) | ~22.7% (auto) |
| **our stack — oracle K (best case ceiling)** | **26–36%** (best embedding per room) |
| **our stack — auto (realistic product path)** | **77–83%** (over-clusters ~83–95 spk for 4) |

- Even the **oracle ceiling** (you hand it the exact speaker count — a number the
  product can't actually know) is **already past the 25% PARK threshold** on both
  meetings, with every embedding tried (zh eres2net/campplus, en TitaNet, en
  wespeaker-R34-LM). No embedding wins both rooms.
- **Auto** is catastrophic — FastClustering speaker-count blow-up on far-field.
- pyannote's 22.7% is **not borrowable** (their exact embedding scored *worse*,
  0.557, dropped into our FastClustering — it's a whole-pipeline result).
- Peak RSS **467 MB**, RTF 0.26 → diarization is **not** a memory/latency blocker;
  **accuracy is the only gate** (validates spec §8 offline-at-Stop on 8 GB).
- Independent review (opus `a669cb931057e037a`): **SURVIVES-WITH-CAVEATS.**

**Calibration lean: PARK.** The founder's laptop mic is *worse* than AMI's array,
so Stage 2 is framed as **confirming the floor**, not exploring a ceiling.

---

## Stage 2 measurement (PENDING founder recording) — FILL THIS IN

Capture metadata (fill from Task 7): people count, room, mic, language, length.

| Env | Mode | Embedding | Native DER | STT-snap DER | miss | FA | conf | det.spk (truth) | overlap% | RSS |
|---|---|---|---|---|---|---|---|---|---|---|
| small-room | oracle K | eres2net | _TODO_ | _TODO_ | | | | | | |
| small-room | oracle K | titanet | _TODO_ | | | | | | | |
| small-room | oracle K | campplus | _TODO_ | | | | | | | |
| small-room | oracle K | wespeaker | _TODO_ | | | | | | | |
| small-room | auto (0.5) | best-of-above | _TODO_ | | | | | | | |
| small-room | auto sweep (0.7/0.8) | best | _TODO_ | | | | | | | |
| classroom | oracle K | (best emb) | _TODO_ | | | | | | | |
| classroom | auto | (best emb) | _TODO_ | | | | | | | |

der.ts cross-check (one fixture): _TODO_ (expect within ~2–2.5pp, reads slightly high — no collar).

---

## Reproduce (run once `audio-captures/<ts>.wav` + a by-ear label export exist)

```bash
cd desktop/spikes/phase-0/03-diarization-ja
PY=.venv/bin/python
SEG=models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx
F=fixtures/founder-smallroom            # copy WAV here; author labels by ear (R11)

# 0. founder authored ground truth by ear in Audacity (Export Labels) → truth JSON
$PY audacity-to-truth.py --labels $F.labels.txt > $F.truth.json   # ELAN: export tab-delimited first

# 1. oracle K (N = real speaker count from Task 7 metadata), per embedding
for EMB in 3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx \
           nemo_en_titanet_large.onnx \
           3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx \
           wespeaker_en_voxceleb_resnet34_LM.onnx ; do
  $PY run-diarization.py --wav $F.wav --seg $SEG --emb models/$EMB --num-speakers <N> > /tmp/oracle.json
  echo "== oracle $EMB =="; $PY score-der.py --pred /tmp/oracle.json --truth $F.truth.json
done

# 2. auto (realistic path) + threshold sweep
for THR in 0.5 0.7 0.8 ; do
  $PY run-diarization.py --wav $F.wav --seg $SEG \
     --emb models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx \
     --num-speakers -1 --cluster-threshold $THR > /tmp/auto.json
  echo "== auto thr=$THR =="; $PY score-der.py --pred /tmp/auto.json --truth $F.truth.json
done

# 3. STT-snap delta (R10) — STT segments come from the finalize dump (PR #113)
#    Confirm the field path against the first real dump:
jq '[.transcript.segments[] | {start,end}]' <userData>/sessions/<ts>/transcript.json > /tmp/stt.json
$PY snap-to-stt.py --pred /tmp/oracle.json --stt /tmp/stt.json > /tmp/snapped.json
$PY score-der.py --pred /tmp/snapped.json --truth $F.truth.json

# 4. peak RSS (R12) + der.ts cross-check (R6)
/usr/bin/time -l $PY run-diarization.py --wav $F.wav --seg $SEG \
  --emb models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx --num-speakers <N> > /tmp/oracle.json
../../../node_modules/.bin/tsx der-crosscheck.mjs /tmp/oracle.json $F.truth.json

# SAFETY (spec §10): foreground only, kill survivors after EACH run
pgrep -f offline-speaker-diarization | xargs -r kill -9 2>/dev/null
pgrep -f run-diarization            | xargs -r kill -9 2>/dev/null; true
```

Repeat for `founder-classroom` if a 5+ session was captured.

---

## Verdict — FILL IN AFTER STAGE 2

**Recommendation:** _TODO (GO / PARTIAL / PARK)_

- **If GO/PARTIAL:** state the spec §8 production implication — Plan 4's per-chunk
  diarization framing **must change to once-at-Stop on the whole-session WAV**
  (sherpa-onnx clustering is offline/global only; the Stage 0 audio-save hook
  already persists that WAV). Scope Plan 4 to the passing environment(s).
- **If PARK (the standing lean):** hold the ~2-week Plan 4 C++ build; open the spec
  §7 **semantic role-inference** spec — infer questioner↔responder roles and
  relationships from the **transcript text** (mic-independent, the founder's
  directed pivot). Seed already in code: the 2-pass interview `qa_pairs`
  question/answer discriminator (currently nullified by `diarization='disabled'`).

---

## Methodology notes

- Metric: pyannote.metrics 4.1 `DiarizationErrorRate`, collar 0.25 s (source of
  truth) + repo `der.ts` cross-check + overlap-%.
- Ground truth authored **independently of STT** by ear (R11) — no Whisper
  boundaries (avoids circularity). `audacity-to-truth.py` converts the label
  export; `snap-to-stt.py` produces the STT-snap arm.
- Engine: sherpa-onnx 1.13.2 Python API, offline `OfflineSpeakerDiarization`
  over the whole-session WAV.

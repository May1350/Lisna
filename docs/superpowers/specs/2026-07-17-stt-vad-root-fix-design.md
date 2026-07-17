# STT VAD — root fix for the whisper non-speech hallucination class

**Status:** design (implementation not started)
**Date:** 2026-07-17
**Branch:** `feat/stt-vad` (worktree `.claude/worktrees/stt-vad`)
**Relates to:** PR #159 (`fix/stt-outro-hallucination`) = the deterministic SYMPTOM fix. This spec is the ROOT fix.

## Problem

Whisper invents plausible text over quiet / non-speech audio. Observed in a real
founder note (2026-07-16): the JA video outro 「ご覧いただきありがとうございます」 emitted
9× across a recording tail, at `noSpeechProb ≈ 0` with varied prefixes.

PR #159 catches that specific phrase family deterministically after the fact. It does
NOT stop the class — whisper can hallucinate *any* high-frequency training phrase over
non-speech, and we cannot enumerate them all. Every new hallucinated phrase = another
founder bug report + another needle. The root fix is to **never feed non-speech to
whisper**.

Founder note: the offending recording did NOT have much silence — so this fires on
BRIEF quiet gaps, not just long dead air. The fix must handle short gaps.

## Decisive findings (verified 2026-07-17 — do not re-derive)

1. **Our pinned whisper.cpp ALREADY ships Silero VAD.** Submodule
   `desktop/sidecar/deps/whisper.cpp` = commit `9386f239`, tag **v1.8.4**.
   `include/whisper.h` exposes:
   - `whisper_full_params.vad` (bool), `.vad_model_path` (const char*), `.vad_params`
   - `whisper_vad_params { threshold, min_speech_duration_ms, min_silence_duration_ms,
     max_speech_duration_s, speech_pad_ms, samples_overlap }`
   - a full `whisper_vad_*` API + `whisper_vad_default_params()`
   → **No custom VAD pipeline. No new dependency. No submodule bump.**

2. **Our sidecar drives the whisper C API directly**, so the change is at one site:
   `desktop/sidecar/src/stt/whisper_engine.cpp:57` builds
   `whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_BEAM_SEARCH)`
   and calls `whisper_full(...)` at :83. VAD = set 3 fields on `p` before :83.

3. **VAD model is pre-converted + tiny.** `whisper.cpp/models/download-vad-model.sh`
   fetches `silero-v5.1.2` / `silero-v6.2.0` as ready ggml (~1–2 MB).

4. **`.gitignore` trap:** the repo ignores `sidecar/build` etc., and `rg` silently
   returns NOTHING for `desktop/sidecar/src`. **Use `grep`, not `rg`, in the sidecar
   tree** — an `rg` miss here reads as "feature absent" and is how this fix was almost
   designed on a false premise.

5. **No audio is retained.** `session-debug-dump.ts` — "No audio." The founder's
   original hallucinating recording is NOT recoverable as a fixture. Eval must use
   synthetic/existing fixtures (we have the right ones — see Eval gate).

## Design decisions

- **Ship the VAD model BUNDLED in app resources, NOT via the downloader.** It's ~1–2 MB
  vs the 2.5 GB LLM. Bundling = no download UX, no sha256/catalog/onboarding-size
  churn, no first-run failure mode. (The downloader exists for GB-scale models; using it
  for 1 MB is pure overhead.) Path plumbed to the sidecar the same way the model dir is.
- **VAD ON by default** — but only after the eval gate below passes. Keep an explicit
  off switch (param/env) so a bad field report can be de-risked without a rebuild.
- **Keep PR #159's substring filter after VAD lands.** Belt-and-braces: VAD reduces the
  input that can trigger hallucination, it doesn't make whisper honest. Cheap to keep,
  and it's the regression net if VAD is ever disabled.
- **Tuning is empirical, not guessed.** `threshold` and `speech_pad_ms` are the two that
  decide the speech/no-speech boundary. Start at `whisper_vad_default_params()`, tune
  ONLY against the eval.

## THE risk (why this is eval-gated)

**VAD that is too aggressive deletes REAL SPEECH before transcription.** That is strictly
worse than the bug it fixes: the hallucination costs a junk pleasantry, an over-eager VAD
costs actual lecture content, silently, with no trace in the transcript. `speech_pad_ms`
(padding around detected speech) and `threshold` are the guards. Quiet speakers,
far-field mics, and soft JA sentence-final particles are the failure surface.

→ **No-content-loss is the gate. Hallucination removal is secondary.**

## Eval gate (fixtures already exist — no founder audio needed)

Harness: `desktop/scripts/eval-stt.ts`. Fixtures: `desktop/tests/fixtures/audio/`
(`generate-silence-fixtures.sh` regenerates them).

| Fixture | VAD OFF (today) | VAD ON — required |
|---|---|---|
| `ja-silence-30s.wav` | hallucinated phrase(s) | **0 segments** |
| `ja-bg-noise-30s.wav` | hallucinated phrase(s) | **0 segments** |
| `ja-30s.wav` (real speech) | full transcript | **transcript UNCHANGED vs VAD OFF** ← hard gate |
| NEW: speech + short gaps + speech | — | **no clipped words at gap boundaries** ← models the founder's actual case |

The last fixture must be added (concat real speech / 2–3 s silence / real speech via a
`generate-*.sh` sibling). The founder's report — "not much silence" — means brief gaps
are the real-world trigger, so gap-boundary clipping is the thing most likely to bite.

Gate: fixtures 1+2 → zero output; fixtures 3+4 → zero content loss. Any word lost on
3 or 4 = BLOCK, re-tune `speech_pad_ms` / `threshold`.

## Tasks (implementation)

1. Bundle silero VAD ggml into sidecar resources + build script (`download-vad-model.sh`
   or vendored); confirm it lands in `desktop/resources/`.
2. `whisper_engine.cpp` — set `p.vad`, `p.vad_model_path`, `p.vad_params`; plumb the
   model path + an on/off switch through the existing load params / IPC.
3. Add the speech+gaps fixture + generator script.
4. Extend `eval-stt.ts` to report per-fixture segment count + text diff VAD ON vs OFF.
5. Run the eval gate; tune `threshold` / `speech_pad_ms` ONLY against it. Record numbers.
6. Rebuild sidecar (`lisna-sidecar-rebuild` skill — M1-safe `-j 1`, MD5-verify the copy
   to `desktop/resources/sidecar`), rebuild `/Applications/Lisna.app`, founder smoke on a
   real recording.
7. artifact-version-bump; `/learn` the rg/.gitignore trap + the VAD tuning outcome.

## Execution constraints (hard — 8 GB machine)

- Sidecar rebuild + whisper eval are memory-heavy. Run on a CLEAN machine (reboot,
  swap < 1.5 GB). See the `spike-llm` pitfall — never background LLM/whisper work.
- Foreground only; `pkill` + zombie-scan between runs.

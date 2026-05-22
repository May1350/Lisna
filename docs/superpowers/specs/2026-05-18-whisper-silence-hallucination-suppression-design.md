# Whisper Silence Hallucination Suppression — Design Spec

**Date:** 2026-05-18
**Author:** Lisna v2 founder + Claude (Opus 4.7)
**Status:** Draft — pending critical reviewer pass
**Branch:** `fix/whisper-silence-hallucination` (worktree `whisper-silence-fix`, based off `claude/romantic-kepler-c9b85e` head `e9766c9`)
**Scope:** v2 alpha STT pipeline (`desktop/sidecar/src/stt/whisper_engine.*`, `desktop/src/renderer/audio/*`, `desktop/src/main/engines/whisper-cpp-stt.ts`)

---

## 1. Background & Problem

### 1.1 Symptom

During v2 alpha manual smoke, the founder observed that when recording starts and the user is silent (or there are silence stretches mid-recording), Whisper STT (kotoba-whisper-v2, `ggml-kotoba-whisper-v2.0-q5_0.bin`) emits short hallucinated Japanese segments stamped with `[0.0]` timestamps. Examples:

- 「はい」 (yes)
- 「ごめん」 (sorry)
- 「ご視聴ありがとうございました」 (thank you for watching — YouTube outro stereotype)
- 「ありがとうございました」 (thank you very much)

These appear in the live transcript while the user is making no sound, then disappear or accumulate as more silence chunks are processed. The user loses trust in the system because it's "hearing things that aren't there."

### 1.2 Why this matters now

- v2 alpha gate (per `v2_phase3_task35_step5_handoff_2026-05-15.md` memory) — alpha distribution is conditional on the founder being able to demo a smooth flow. Phantom transcripts during silence are a credibility blocker.
- The hallucinated phrases are not random — they are **stereotyped artifacts of Whisper's training data** (YouTube subtitle bleed-through during silent intro/outro frames). This is a known, well-documented class of Whisper failures across the community.
- Cannot ship to alpha users without a fix.

### 1.3 Class of bug

Per CLAUDE.md "Bug-fix → Structural Improvement Bundling" rule, this is **not a one-line fix**:
- Same class (whisper hallucinations) is well-documented across many Whisper deployments — likely to recur with future model swaps (3B → 1B → other size variants), other languages (KO/ZH/EN), and any silent-input scenario.
- The structural weakness: **no defense layer between raw audio and the UI transcript stream**. Whisper is invoked unconditionally on every audio chunk, and its output is forwarded unfiltered.
- Fix calls for a defense-in-depth structure, not a parameter tweak.

---

## 2. Phase 1 Evidence (file:line)

All paths relative to the worktree base; current PR #6 (head `e9766c9`).

### 2.1 Sidecar whisper parameters — defaults never tuned

`desktop/sidecar/src/stt/whisper_engine.cpp:47-54`:

```cpp
whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
p.language = impl_->lang.empty() ? "auto" : impl_->lang.c_str();
p.translate = false;
p.print_realtime = false;
p.print_progress = false;
```

Only 4 fields are explicitly set (language + 3 print/translate flags). Every other field, including:

- `no_speech_thold = 0.6f` (whisper.cpp `src/whisper.cpp:5956`)
- `logprob_thold = -1.0f` (`:5955`)
- `temperature = 0.0f` (greedy)
- `vad = false` — no built-in voice activity detection
- `single_segment = false` — full streaming segmentation

uses upstream whisper.cpp defaults.

### 2.2 The actual silence-skip semantic (whisper.cpp:7576-7577)

```cpp
const bool is_no_speech = (state->no_speech_prob > params.no_speech_thold &&
    best_decoder.sequence.avg_logprobs < params.logprob_thold);
```

A segment is dropped as silence **only if both conditions hold**:
1. `no_speech_prob > no_speech_thold` (model confident segment is non-speech)
2. `avg_logprobs < logprob_thold` (model unconfident about the decoded text)

**Critical implication for option A (raise `no_speech_thold`):** raising the threshold makes condition (1) **harder** to satisfy, so **fewer** segments get dropped — the opposite of what's wanted. Lowering would help condition (1), but stereotyped tokens like 「はい」 have very high `avg_logprobs` (-0.2 range) — condition (2) blocks the skip anyway. **Param tuning alone is insufficient for stereotyped-token hallucinations.**

### 2.3 Sidecar segment payload omits `no_speech_prob`

`desktop/sidecar/src/ipc/json_protocol.cpp:108-114`:

```cpp
for (const auto& s : segs) {
  arr.push_back({{"startSec", s.startSec},
                 {"endSec", s.endSec},
                 {"text", s.text}});
}
```

The public whisper.cpp API exposes `whisper_full_get_segment_no_speech_prob(ctx, i)` (`include/whisper.h:735`), but the sidecar never calls it. The probability is therefore **unavailable to the TS layer**, blocking any probability-based downstream filter.

**Important caveat:** `no_speech_prob` is stored per-`whisper_state` (`whisper.cpp:7633, 7678` — `state->no_speech_prob` attached to every segment in the call), so within a single `whisper_full(...)` invocation **all segments share the same value**. It's effectively per-chunk, not per-segment. This is fine for our use case (silence chunks → all segments share one high prob → all dropped) but must be reflected in the spec.

### 2.4 No pre-whisper VAD / RMS gate

`desktop/src/renderer/audio/chunker.ts:42-56` (`ChunkAccumulator.emit`) and `desktop/src/renderer/audio/orchestrator.ts` (`emitChunk`): chunks are pushed unconditionally — first chunk 2s (32k samples @ 16kHz), subsequent 10s (160k samples). There is no amplitude / RMS / energy / VAD check anywhere in the pipeline before sidecar invocation.

**Consequence:** every silence chunk triggers a full whisper inference (~few hundred ms on M1 Metal) only to produce hallucinated output. CPU waste + bad output.

### 2.5 TS adapter passes segments through unmodified

`desktop/src/main/engines/whisper-cpp-stt.ts:22-32`: the `transcribe` method calls the sidecar and returns `r.segments` directly. No post-processing, no filter.

`desktop/src/shared/types.ts:14-18` defines `TranscriptSegment` as `{startSec, endSec, text}` only — no `noSpeechProb` field exists in the type system.

### 2.6 No silence test fixture

`desktop/src/main/engines/__tests__/whisper-cpp-stt.test.ts` covers one fixture: `desktop/tests/fixtures/audio/ja-30s.wav` (real speech). There is no `silence-30s.wav` fixture, so silence regression cannot be automatically detected.

---

## 3. Goals & Non-Goals

### 3.1 Goals

1. **G1 — Silence chunks produce zero transcript segments.** A 30-second pure-silence chunk fed through the pipeline must emit 0 segments to the renderer, in 100% of runs.
2. **G2 — Stereotyped JA hallucinations are filtered.** Even if a silence chunk leaks through G1's RMS gate (e.g. low-level mic noise), the most common stereotyped phrases (「はい」「ご視聴ありがとうございました」etc.) are blocked downstream when they have hallucination markers.
3. **G3 — Future hallucinations are catchable.** A generic probability-based filter catches model outputs the blocklist doesn't know about (new language variants, new model swaps), tunable from TS without sidecar rebuild.
4. **G4 — No regression on real speech.** Existing `ja-30s.wav` fixture transcribes to the same expected text (first 5 chars match), measured by the existing integration test.
5. **G5 — Sidecar API is forward/backward compatible.** New `noSpeechProb` field is **optional** in the TS type and additive in JSON. Old sidecar binaries still work with new TS code (field absent → filter inactive). New sidecar with old TS would just ignore the extra field.

### 3.2 Non-Goals

- **NG1 — Tune `no_speech_thold` / `logprob_thold` whisper params.** Parameter tuning is deferred to a future iteration once we have a proper threshold-sweep eval harness. The 3-layer defense addresses the symptom without needing to tune whisper internals.
- **NG2 — Enable whisper.cpp built-in VAD.** Requires an additional GGML VAD model file (extra download, extra RAM footprint). Out of scope for alpha.
- **NG3 — Multi-language blocklist content.** Ship JA blocklist only. EN/KO/ZH blocklists are stubbed as empty arrays in the same structure so future expansion is a content edit, not a refactor.
- **NG4 — Background noise classification.** A real RMS gate at -50 dBFS handles silence, but does not distinguish "user typing in a quiet room" from "user speaking softly." That's a UX problem solved separately (with mic gain UI), not a STT-pipeline problem.
- **NG5 — Telemetry / observability on filter decisions.** Local-only console logging is enough for v2 alpha. Production telemetry comes later.
- **NG6 — Whisper params overhaul across language variants.** Same as NG1 — separate work, separate plan.

---

## 4. Architecture: Three-Layer Defense

```
┌──────────────────────────────────────────────────────────────────────┐
│  RENDERER                                          MAIN              │
│                                                                      │
│  Mic → Worklet → ChunkAccumulator    ┌──────────► WhisperCppSTT      │
│                       │              │            .transcribe()      │
│                       ▼              │                  │            │
│            ┌─── Layer D ─────┐       │                  ▼            │
│            │ silence-gate.ts │       │           ┌─ Sidecar IPC ─┐   │
│            │   isSilent(rms) │       │           │ {audioBase64} │   │
│            └─────┬───────────┘       │           └──────┬────────┘   │
│                  │                   │                  │            │
│         silent? ─┴── no ──► IPC ─────┘                  ▼            │
│            │                          ┌──── Sidecar: whisper.cpp ────┤
│         yes: drop                     │  + Layer F.back: expose      │
│                                       │     no_speech_prob in JSON   │
│                                       └──────────┬───────────────────┤
│                                                  │                   │
│                                                  ▼                   │
│                                       ┌─ segments[] received ───────┐│
│                                       │  Layer E+F.front:           ││
│                                       │  segment-filters.ts         ││
│                                       │  isHallucination(s)         ││
│                                       └──────────┬──────────────────┘│
│                                                  ▼                   │
│  UI ◄────────────────────────────────────  filtered segments         │
└──────────────────────────────────────────────────────────────────────┘
```

| Layer | Location | What it does | Why it can't be the only line of defense |
|-------|----------|--------------|------------------------------------------|
| **D** RMS gate | Renderer `silence-gate.ts` + orchestrator | Compute RMS of each chunk in dBFS. If below threshold (default -50 dBFS), skip IPC send entirely (no whisper inference). | Threshold too aggressive → drops real quiet speech. Threshold too lenient → mic noise above threshold still hallucinates. |
| **E** Blocklist | Main `segment-filters.ts` | Drop a segment when its text exactly matches a curated list of known hallucinations AND it shows hallucination markers (high `noSpeechProb` OR short isolated text). | Only catches *known* stereotyped phrases. New language variants or new model behaviors create new hallucinations the list doesn't cover. |
| **F.back** Sidecar prob exposure | `whisper_engine.cpp` + `json_protocol.cpp` | Read `whisper_full_get_segment_no_speech_prob` for the chunk and attach to every emitted segment as `noSpeechProb`. | Without this F.front cannot run. Without F.front the system is blind to unknown hallucinations. |
| **F.front** Probability filter | Main `segment-filters.ts` | Drop a segment when `noSpeechProb > 0.6` regardless of text. Catches unknown hallucinations. | Stereotyped tokens like 「はい」 sometimes have lower `noSpeechProb` (~0.3) because the model is "confident" — E catches what F misses. |

The layers are **complementary**, not redundant. Each catches a different failure mode the others miss.

### 4.1 Order matters (only D matters; E/F are disjoint)

1. Layer D runs in the renderer **before IPC**. A silent chunk never reaches the sidecar → no whisper inference, no CPU spent. This is the only ordering with cost implications.
2. The sidecar runs whisper and returns segments **with `noSpeechProb`** (F.back).
3. F.front and E run on the main side. **They are functionally disjoint, not cost-ordered**: F.front catches high-`noSpeechProb` segments regardless of text content; E catches blocklist-matching segments that have *any* hallucination marker (which includes lower-prob cases F.front passes). Running F.front first is a convention (broader filter first), not a correctness requirement — running E first would produce the same final segment set.

```
audio chunk → [D: RMS gate] → IPC → sidecar → segments + noSpeechProb → [F.front: prob filter] → [E: blocklist+marker] → UI
                  drop                                                       drop                       drop
```

---

## 5. Layer D — RMS Gate (Renderer)

### 5.1 File: `desktop/src/renderer/audio/silence-gate.ts` (new)

```typescript
/**
 * Compute the RMS of a Float32 PCM buffer in dBFS.
 * For digital silence (all zeros) returns -Infinity.
 * Float32 PCM samples are in the range [-1.0, 1.0]; reference = 1.0.
 */
export function rmsDbfs(samples: Float32Array): number {
  if (samples.length === 0) return -Infinity;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / samples.length);
  if (rms === 0) return -Infinity;
  return 20 * Math.log10(rms);
}

/** Default: -50 dBFS. Empirically below intelligible speech, above quiet-room mic noise. */
export const DEFAULT_SILENCE_THRESHOLD_DBFS = -50;

export function isSilent(
  samples: Float32Array,
  thresholdDbfs: number = DEFAULT_SILENCE_THRESHOLD_DBFS,
): boolean {
  return rmsDbfs(samples) < thresholdDbfs;
}
```

### 5.2 Integration: `desktop/src/renderer/audio/orchestrator.ts`

In `emitChunk` (called from ChunkAccumulator's `onChunk`), wrap the IPC send. **Counter discipline is critical** — see the actual existing implementation at `orchestrator.ts:89-104` first. The two counters have different roles:

| Counter | Role | Behavior on silent skip |
|---------|------|-------------------------|
| `samplesEmitted` | Wall-clock anchor; **drives `startMs/endMs` of every subsequent chunk** | **MUST advance** by `chunk.length` (otherwise the next real chunk reports startMs collapsed back to the silent chunk's start, breaking transcript timeline) |
| `chunkIndex` | Sequence identifier sent to main as `payload.index` | **MUST NOT advance** (main expects contiguous indices; an advanced-but-unsent index leaves a gap main may interpret as a lost chunk) |

```typescript
import { isSilent } from './silence-gate';

private emitChunk(chunk: Float32Array): void {
  const source = this.source;
  if (!source) return;

  if (isSilent(chunk)) {
    // Silent chunk: skip IPC, but advance the wall-clock counter so the next
    // real chunk's startMs reflects the silence duration. DO NOT advance
    // chunkIndex — main's payload.index sequence must stay contiguous.
    this.samplesEmitted += chunk.length;
    return;
  }

  const startSamples = this.samplesEmitted;
  this.samplesEmitted += chunk.length;
  const startMs = Math.round((startSamples / SAMPLE_RATE) * 1000);
  const endMs = Math.round((this.samplesEmitted / SAMPLE_RATE) * 1000);
  const payload: ChunkPayload = {
    index: this.chunkIndex++,
    source,
    startMs,
    endMs,
    samples: chunk,
  };
  this.sender(payload);
}
```

**ChunkAccumulator is NOT modified.** It stays a pure chunker. Silence detection is an orchestrator concern (separation of responsibilities).

**Plan task discipline:** Before editing `emitChunk`, the implementer MUST re-read the actual file (`orchestrator.ts:89-104`) — the counter semantics are not obvious from outside the file, and an integration sketch in a spec is no substitute for the live code. (Round-1 reviewer caught a counter inversion in this spec exactly because the spec sketch diverged from the real code; plan task 2 must enforce the re-read.)

### 5.3 Threshold rationale (-50 dBFS)

| Source | Approx RMS dBFS |
|--------|------------------|
| Digital silence (all zeros) | -∞ |
| Quiet-room mic noise (MacBook built-in) | -60 to -70 |
| Quiet typing / paper rustling | -45 to -55 |
| Soft speech / whisper | -35 to -45 |
| Normal speech | -25 to -10 |
| Loud speech / yelling | -10 to 0 |

**Math sanity check:** -50 dBFS = `10^(-50/20)` = `10^-2.5` ≈ **0.00316** linear amplitude (Float32 PCM range [-1, 1]). This is why the fixture in §9.3 uses `amplitude=0.003` (pink noise) — it sits just below the gate, useful for testing E+F when D is bypassed. A constant 0.001 signal has RMS = |0.001| = 10^-3, which is exactly -60 dBFS (below the -50 gate). These exact values drive the unit-test assertions in §9.1.

-50 dBFS is a conservative-quiet floor: above ambient noise on most laptops, comfortably below any intelligible speech. Tunable via constant; founder can adjust based on smoke test feedback.

### 5.4 Risk: false positive on quiet speakers

If a user speaks very softly (RMS ≈ -52 dBFS), their entire chunk could be silenced. Mitigation:
- Conservative default (-50, not -45)
- Constant is tunable
- Smoke test must include a "soft speech" sample to verify
- Long-term: per-user mic gain UI (out of scope for this fix; tracked separately)

---

## 6. Layer E — Stereotyped JA Hallucination Blocklist (Main)

### 6.1 Why a blocklist is necessary even with F

Stereotyped hallucinations like 「はい」 have a paradox: they appear during silence, but Whisper assigns them high `avg_logprobs` (model is "confident" in the token because it appears so often in training). Sometimes `noSpeechProb` for these chunks is ~0.3-0.4 — below a sane F.front threshold of 0.6. So F alone doesn't catch them.

Blocklist + signal combination catches what F misses, **without false positives on legitimate uses of 「はい」 inside dense speech** (low `noSpeechProb` in those cases).

### 6.2 File: `desktop/src/main/engines/segment-filters.ts` (new)

```typescript
import type { TranscriptSegment, Language } from '@shared/engine-interfaces';

/** Stereotyped Whisper hallucinations by language. JA is the only ship target for v2 alpha. */
export const HALLUCINATION_BLOCKLIST: Readonly<Record<Language, ReadonlySet<string>>> = {
  ja: new Set([
    'はい',
    'ご視聴ありがとうございました',
    'ありがとうございました',
    'うん',
    'ねぇ',
    'ごめん',
    'あー',
    'えー',
    'んー',
    'おー',
  ]),
  en: new Set([]),  // populate when EN model is added
  ko: new Set([]),  // populate when KO model is added
  zh: new Set([]),  // populate when ZH model is added
};

/** Default threshold for F.front prob filter. Higher than whisper's default 0.6 skip-gate, intentional. */
export const DEFAULT_NO_SPEECH_PROB_THRESHOLD = 0.6;

export interface FilterOptions {
  language: Language;
  noSpeechProbThreshold?: number;
}

export function isHallucination(
  segment: TranscriptSegment,
  opts: FilterOptions,
): boolean {
  const trimmed = segment.text.trim();

  // Drop empty / whitespace-only segments unconditionally. Whisper occasionally
  // emits these when its decoder produces only punctuation/space tokens.
  if (trimmed === '') return true;

  // Layer F.front — probability-based, language-agnostic.
  // Skip if sidecar didn't supply noSpeechProb (back-compat with older sidecar binaries).
  if (segment.noSpeechProb !== undefined) {
    const threshold = opts.noSpeechProbThreshold ?? DEFAULT_NO_SPEECH_PROB_THRESHOLD;
    if (segment.noSpeechProb > threshold) return true;
  }

  // Layer E — blocklist + hallucination marker.
  // Drop only if text matches AND has a hallucination marker (short, OR high noSpeechProb).
  // This protects legitimate 'はい' inside dense speech: short blocklist match WITHOUT
  // high noSpeechProb stays.
  // Nullish-coalesce the blocklist lookup so a future Language enum value without an
  // entry doesn't crash (treated as empty blocklist = no E filtering).
  const blocklist = HALLUCINATION_BLOCKLIST[opts.language] ?? new Set<string>();
  if (blocklist.has(trimmed)) {
    // Marker 1: noSpeechProb known to be elevated (≥0.3, below F.front threshold but suspicious)
    if (segment.noSpeechProb !== undefined && segment.noSpeechProb >= 0.3) return true;
    // Marker 2: timestamps both at 0 (whisper "I don't know where this came from" signal)
    if (segment.startSec === 0 && segment.endSec === 0) return true;
    // Marker 3: no noSpeechProb available (old sidecar) → fall back to "blocklist + short text" heuristic
    if (segment.noSpeechProb === undefined && trimmed.length <= 10) return true;
  }

  return false;
}

export function filterSegments(
  segments: readonly TranscriptSegment[],
  opts: FilterOptions,
): TranscriptSegment[] {
  return segments.filter((s) => !isHallucination(s, opts));
}
```

### 6.3 Blocklist sources

The 10 JA entries above are the **most-cited stereotyped hallucinations** from:
- whisper.cpp GitHub issue tracker (multiple JA-locale reports)
- OpenAI Whisper community forums (JA users)
- Documented in kotoba-whisper model card (kotoba-tech/kotoba-whisper-v2.0 HF page)

**This list is canonical for v2 alpha.** Tuning happens post-smoke based on observed false positives/negatives.

### 6.4 Integration: `desktop/src/main/engines/whisper-cpp-stt.ts`

The adapter needs to know the language to apply the right blocklist. The current adapter stores it implicitly via `loadModel`. We add an explicit field. Re-loading with a different language simply overwrites `this.language` — no special state-clear needed because the filter is stateless across calls (each `transcribe` reads the current `language` value).

```typescript
import { filterSegments } from './segment-filters';
import type { STTEngine, Language, TranscriptSegment } from '@shared/engine-interfaces';
import type { SidecarClient } from '../sidecar/client';

export class WhisperCppSTT implements STTEngine {
  // Track language so transcribe() can apply the language-specific blocklist (Layer E).
  // Re-load with a different language: simple reassignment, no state-clear needed
  // (filter is stateless across calls).
  private language: Language | null = null;

  constructor(private client: SidecarClient) {}

  async loadModel(path: string, language: Language): Promise<void> {
    const r = await this.client.send(
      { type: 'load', kind: 'stt', path, language },
      { timeoutMs: Infinity },
    );
    if (r.type === 'error') throw new Error(`STT load failed [${r.code}]: ${r.message}`);
    if (r.type !== 'ok') throw new Error(`STT load: unexpected response ${JSON.stringify(r)}`);
    this.language = language;
  }

  async unloadModel(): Promise<void> {
    const r = await this.client.send({ type: 'unload', kind: 'stt' }, { timeoutMs: Infinity });
    if (r.type === 'error') throw new Error(`STT unload failed [${r.code}]: ${r.message}`);
    if (r.type !== 'ok') throw new Error(`STT unload: unexpected response ${JSON.stringify(r)}`);
    this.language = null;
  }

  async transcribe(audio: Float32Array): Promise<TranscriptSegment[]> {
    const bytes = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
    const audioBase64 = Buffer.from(bytes).toString('base64');
    const r = await this.client.send(
      { type: 'transcribe', audioBase64, sampleRate: 16000 },
      { timeoutMs: 120_000 },
    );
    if (r.type === 'error') throw new Error(`STT transcribe failed [${r.code}]: ${r.message}`);
    if (r.type !== 'segments') throw new Error(`STT transcribe: unexpected response ${JSON.stringify(r)}`);
    if (this.language === null) {
      // Defensive: transcribe before loadModel shouldn't happen (sidecar already
      // returns 'not_loaded'). If it somehow does, return segments unfiltered
      // rather than throwing.
      return r.segments;
    }
    return filterSegments(r.segments, { language: this.language });
  }
}
```

---

## 7. Layer F — Sidecar `noSpeechProb` Exposure + TS Filter

F.front is already covered in §6 (lives in `segment-filters.ts`). This section covers F.back.

### 7.1 Sidecar Segment struct: `desktop/sidecar/src/stt/whisper_engine.h`

Add field:

```cpp
struct Segment {
  double startSec;
  double endSec;
  std::string text;
  double noSpeechProb;  // per whisper.cpp: per-chunk value attached to every segment
};
```

### 7.2 Sidecar populate: `desktop/sidecar/src/stt/whisper_engine.cpp`

In `transcribe(...)`, after `whisper_full(...)`. Call the per-segment getter from **inside the loop** — this is safe when `nSeg == 0` (loop body never executes, no out-of-bounds index), and whisper.cpp's implementation just returns the same `state->no_speech_prob` for every index (semantically per-chunk, but exposed per-segment for API convenience). This avoids the prior draft's UB where the prob was read at index 0 before the loop guarded the count.

```cpp
for (int i = 0; i < nSeg; ++i) {
  Segment s;
  s.startSec = whisper_full_get_segment_t0(impl_->ctx, i) / 100.0;
  s.endSec   = whisper_full_get_segment_t1(impl_->ctx, i) / 100.0;
  s.text     = whisper_full_get_segment_text(impl_->ctx, i);
  // Per whisper.cpp src/whisper.cpp:7633 the value is per-whisper_state,
  // attached identically to every segment in result_all. Reading per-i is safe
  // and clean — no separate "first segment" path needed.
  s.noSpeechProb = static_cast<double>(
    whisper_full_get_segment_no_speech_prob(impl_->ctx, i));
  out.push_back(std::move(s));
}
```

**Edge case `nSeg == 0`:** loop body never executes → no API call → safe. Output `std::vector<Segment>` stays empty.

### 7.3 Sidecar JSON: `desktop/sidecar/src/ipc/json_protocol.cpp:108-114`

```cpp
for (const auto& s : segs) {
  arr.push_back({{"startSec", s.startSec},
                 {"endSec", s.endSec},
                 {"text", s.text},
                 {"noSpeechProb", s.noSpeechProb}});
}
```

### 7.4 TS type: `desktop/src/shared/types.ts`

```typescript
export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
  /**
   * Per-chunk no-speech probability from whisper. Optional for back-compat with
   * sidecar binaries built before 2026-05-18. Same value attached to every
   * segment from one whisper_full call (this is a whisper.cpp semantic, not a
   * sidecar artifact — see whisper.cpp src/whisper.cpp:7633 — `state->no_speech_prob`).
   */
  noSpeechProb?: number;
}
```

### 7.5 SidecarClient response type

The `SidecarClient.send` response for `segments` should reflect the new optional field. If the response is typed via a discriminated union, add `noSpeechProb?: number` to the segments array element type. Implementation detail — plan task will trace the exact type location.

---

## 8. File Map

### 8.1 New files (5)

| Path | Purpose | Lines (est) |
|------|---------|-------------|
| `desktop/src/renderer/audio/silence-gate.ts` | Layer D — `rmsDbfs`, `isSilent`, threshold constant | ~30 |
| `desktop/src/renderer/audio/__tests__/silence-gate.test.ts` | Layer D unit tests | ~80 |
| `desktop/src/main/engines/segment-filters.ts` | Layers E + F.front — blocklist, prob filter, `isHallucination`, `filterSegments` | ~80 |
| `desktop/src/main/engines/__tests__/segment-filters.test.ts` | Layers E + F.front unit tests | ~150 |
| `desktop/tests/fixtures/audio/ja-silence-30s.wav` | Pure digital silence fixture | binary (~1MB) |
| `desktop/tests/fixtures/audio/ja-bg-noise-30s.wav` | Quiet pink-noise fixture (mic-noise simulation) | binary (~1MB) |
| `desktop/tests/fixtures/audio/generate-silence-fixtures.sh` | Script to regenerate both | ~20 |

### 8.2 Modified files (6)

| Path | Change | Lines touched |
|------|--------|---------------|
| `desktop/sidecar/src/stt/whisper_engine.h` | Add `double noSpeechProb` to `Segment` | +1 |
| `desktop/sidecar/src/stt/whisper_engine.cpp` | Read `whisper_full_get_segment_no_speech_prob`, assign to each Segment | +3 |
| `desktop/sidecar/src/ipc/json_protocol.cpp` | Serialize `noSpeechProb` in segment JSON | +1 |
| `desktop/src/shared/types.ts` | Add `noSpeechProb?: number` to `TranscriptSegment` + JSDoc | +6 |
| `desktop/src/renderer/audio/orchestrator.ts` | Call `isSilent` before IPC send in `emitChunk` | +6 |
| `desktop/src/main/engines/whisper-cpp-stt.ts` | Track language, apply `filterSegments` post-IPC | +10 |
| `desktop/src/main/engines/__tests__/whisper-cpp-stt.test.ts` | Add silence-fixture integration assertion | +30 |

### 8.3 Total scope

- 5 new files (~340 lines TS) + 2 new fixtures + 1 new script
- 7 modified files (~57 lines diff total)
- 1 sidecar rebuild (~5-10 min, `-j 1`)

---

## 9. Test & Eval Strategy

### 9.1 Unit tests (no model required)

**`silence-gate.test.ts`** — verify `rmsDbfs` math and `isSilent` boundary behavior. RMS of a constant-amplitude signal equals |A|, so dBFS = 20·log10(|A|) is exact (not approximate) for constant inputs — assertions use exact values:
- Empty array → `-Infinity` / `true`
- All zeros (length 1000) → `-Infinity` / `true`
- Constant 0.001 amplitude (length 1000) → exactly `-60` dBFS / `true` (below default -50)
- Constant 0.01 amplitude → exactly `-40` dBFS / `false` (above default -50)
- Constant 0.5 amplitude (loud) → ≈ `-6.0206` dBFS / `false`
- Custom threshold: 0.001 amp + threshold -70 → `false` (above the higher threshold)
- Custom threshold: 0.5 amp + threshold -3 → `true` (loud signal, but threshold above it)

**`segment-filters.test.ts`** — verify each layer in isolation:
- F.front: `{text: "foo", noSpeechProb: 0.7}` lang=ja → dropped (prob > threshold)
- F.front: `{text: "foo", noSpeechProb: 0.5}` lang=ja → kept (prob ≤ threshold)
- F.front: `{text: "foo"}` (no prob) lang=ja → kept (back-compat: no prob = no F.front)
- E: `{text: "はい", noSpeechProb: 0.4, startSec: 0, endSec: 1}` lang=ja → dropped (blocklist + prob≥0.3 marker)
- E: `{text: "はい", noSpeechProb: 0.1, startSec: 5, endSec: 6}` lang=ja → **kept** (blocklist match but no markers — protect real "yes" usage)
- E: `{text: "はい", startSec: 0, endSec: 0}` (no prob, both-zero timestamp) lang=ja → dropped (marker 2)
- E: `{text: "はい"}` (no prob, no zero-timestamp marker) lang=ja → dropped (marker 3: blocklist + ≤10 chars)
- E: `{text: "今日は学校に行きました"}` (long text, not in blocklist) lang=ja → kept
- Lang switching: same `{text: "はい"}` lang=en → kept (en blocklist is empty)
- Custom threshold: `{text: "foo", noSpeechProb: 0.5}` lang=ja with `noSpeechProbThreshold: 0.4` → dropped

### 9.2 Integration tests (model required, gated by `LISNA_TEST_STT_MODEL`)

Extend `whisper-cpp-stt.test.ts` (sidecar + model):

**Test A — silence fixture: zero segments**
- Load `ja-silence-30s.wav` (44-byte header + Int16 PCM)
- Convert to Float32, feed to `WhisperCppSTT.transcribe`
- After D (renderer-side, but here we test the main-side adapter so D is not in play; this exercises E + F)
- Assertion: `segments.length === 0`

**Test B — speech fixture: no regression (existing)**
- Existing test for `ja-30s.wav` first-5-chars assertion remains
- Verify the new filter pipeline doesn't drop the legitimate transcript

**Test C — chunker silence gate (renderer unit-flavor with mock IPC)**
- Construct a silent Float32Array (length = 10 * 16000)
- Push to `ChunkAccumulator`
- Mock `emitChunk` and assert IPC not called (renderer-side D test, no sidecar)

### 9.3 Fixture generation

`desktop/tests/fixtures/audio/generate-silence-fixtures.sh`:

```bash
#!/usr/bin/env bash
# Generate silence fixtures via ffmpeg with bit-exact PCM (no metadata).
# 16-bit signed PCM, 16kHz mono, 30s, 44-byte WAV header.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

ffmpeg -y -f lavfi -i "anullsrc=r=16000:cl=mono" \
  -t 30 -bitexact -map_metadata -1 -ac 1 -ar 16000 -acodec pcm_s16le \
  "$HERE/ja-silence-30s.wav"

ffmpeg -y -f lavfi -i "anoisesrc=color=pink:amplitude=0.003:duration=30:sample_rate=16000" \
  -t 30 -bitexact -map_metadata -1 -ac 1 -ar 16000 -acodec pcm_s16le \
  "$HERE/ja-bg-noise-30s.wav"
```

amplitude=0.003 → ~-50 dBFS, sits at the D threshold boundary. Useful for D + E + F integration.

### 9.4 Manual smoke (founder)

After all automated tests pass:

1. `pnpm dev` (Electron dev), pick kotoba-whisper-v2 from §5.1 picker
2. Start recording, **stay silent for 30 seconds** → transcript view stays empty (was: 「はい」 appearing)
3. Speak normally in JA for 30s → transcript matches what you said (regression check)
4. Speak very softly (whisper) → transcript should still capture (catches false-positive D threshold)
5. Switch between silent and speaking → no spurious segments at silent transitions
6. **Faint YouTube intro music in background** (≤ -40 dBFS at the mic) — known to trigger stereotyped JA hallucinations because Whisper's training data was heavy on YT subtitles. Verify E layer blocks them even though D passes the audio through.

### 9.5 Acceptance criteria

| Criterion | Method | Pass condition |
|-----------|--------|----------------|
| G1: zero segments on pure silence | Test A | `segments.length === 0` |
| G2: stereotyped JA hallucinations blocked | Unit tests in `segment-filters.test.ts` | All E cases pass |
| G3: probability filter works | Unit tests | F.front cases pass |
| G4: no regression on real speech | Test B | First 5 chars present |
| G5: backward compat with old sidecar | Unit test (no `noSpeechProb` in input) | Filter still works (blocklist + zero-timestamp marker) |
| Smoke: silent 30s → empty transcript | Manual | Founder confirms |
| Smoke: normal speech → expected | Manual | Founder confirms |

---

## 10. Risks, Open Questions, Mitigations

### 10.1 Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|------------|--------|------------|
| R1 | D threshold too aggressive — quiet speech silenced | M | M (UX) | -50 dBFS default conservative; founder smoke includes soft-speech sample; threshold is a constant, easy to tune |
| R2 | E blocklist drops legitimate 「はい」 | M | M | Combined with marker (`noSpeechProb ≥ 0.3` OR zero-timestamp OR short text). Inside dense speech, marker is absent → kept |
| R3 | F.front threshold drops real but uncertain speech | L | M | Default 0.6 conservative; tunable |
| R4 | Sidecar `noSpeechProb` returns 0.0 if `nSeg == 0` (no call made) | L | L | Loop skipped; no segments to attach to. Safe by construction |
| R5 | Old sidecar binary deployed with new TS → no `noSpeechProb` | L | L | F.front skipped (no prob); E falls back to "blocklist + short text" heuristic (marker 3). Still works |
| R6 | New TS deployed with old sidecar binary → unfiltered hallucinations leak | M | M | Sidecar rebuild must ship together with TS. Plan task explicitly includes `pnpm sidecar:build` + cp to resources/sidecar |
| R7 | Multi-language model swap (kotoba → other) → blocklist mismatches | M | L | Blocklist keyed by language; per-lang sets. Adding KO/ZH/EN content is content edit |
| R8 | Index gap in renderer after D skip → main-side state assumes monotonic indices | L | L | `chunkIndex` still incremented (skip is local to emitChunk); main never receives skipped index but doesn't track sequence |
| R9 | Whisper.cpp `whisper_full_get_segment_no_speech_prob` ABI change in future submodule bumps | L | L | Public WHISPER_API. Stable across recent releases. Unit test on sidecar will catch breakage |
| R10 | M1 8GB sidecar rebuild OOM (per memory, `-j 1` required) | L | M (dev blocker) | Plan task explicitly specifies `-j 1`; per `project_metal_cold_cache_first_run.md` |

### 10.2 Open questions for founder

| ID | Question | Why it matters | Recommendation |
|----|----------|----------------|----------------|
| Q1 | Threshold defaults D=-50, F=0.6, E-marker=0.3 — fine to ship and tune post-smoke, or want eval-fixture-driven tuning first? | Strict eval fixtures take +1 session | Ship defaults, tune in smoke (per CLAUDE.md "Autonomous Execution — Don't Hand Off Work I Can Do") |
| Q2 | Blocklist content (10 entries) — too narrow or too broad? Founder wants specific entries added/removed? | Subjective JA-native judgment | Founder reviews list before merge; treat as starting set |
| Q3 | Should D-skipped silent chunks still emit a "kept-alive" event to UI (so user knows recording is still running)? | UI feedback question | Out of scope here (UI shows recording timer already). Add only if smoke reveals confusion |
| Q4 | If `nSeg > 0` but all 0-text empties, do we emit at all? | Whisper edge case | **Integrated** — `isHallucination` in §6.2 now drops empty segments as the first check (`if (trimmed === '') return true;`). |
| Q5 | Should we forward noSpeechProb to UI (e.g., show segment confidence)? | Telemetry / debug | NG5 — defer |

---

## 11. Rollout / Sequencing

1. **This session:** spec → reviewer pass → plan → reviewer pass → commit + push (no code)
2. **Next session (implementer):** subagent-driven-development per `superpowers:subagent-driven-development`. ~17 tasks, each ~5-15 min. Estimated 2-3 hours total.
3. **Reviewer pass (post-implementation):** `superpowers:requesting-code-review`
4. **Founder smoke:** §9.4
5. **Tuning:** Q1 — if smoke surfaces false-positives, tune constants
6. **Merge:** PR into `claude/romantic-kepler-c9b85e` (where v2 alpha lives)

This fix does **not** require a separate version bump for the Chrome extension — sidecar/desktop only. v2 alpha is internal/founder-only and not on a public store.

### 11.1 Sidecar+TS atomicity (NON-NEGOTIABLE plan task)

Per `feedback_sidecar_resources_stale.md` (an entire prior session was burned on this), sidecar rebuild + cp to `desktop/resources/sidecar/` MUST be a single explicit plan task, not assumed to happen as a side-effect of any other task. Symptoms when this is missed: integration tests report dyld-fail-disguised-as-cold-spawn-timeout, and the diagnosis cost is ~30 minutes of staring at IPC logs. The plan's Task 9 (per §11) is the single owner of this step.

---

## 12. Why this design vs alternatives

| Alternative | Why we're not choosing it |
|-------------|---------------------------|
| **Option A (param tuning only)** — `no_speech_thold` / `logprob_thold` | Semantic flip (raising thold KEEPS more) + stereotyped tokens like 「はい」 evade the AND-gated skip because of high logprob. Insufficient on its own |
| **Option C (WebRTC VAD)** — drop-in VAD library | Heavier weight; webrtcvad-wasm or native binding adds ~200KB and an extra worklet. RMS gate is 5 lines and catches the case |
| **Whisper.cpp built-in VAD** | Requires extra GGML VAD model file (extra download, extra RAM). Disabled by default in our build (`vad = false`). NG2 |
| **Hard text-only blocklist** | Drops legitimate 「はい」 in real speech. Need marker combination (E does this) |
| **Sidecar-side filtering** | Less flexible — every threshold tweak needs a rebuild. TS-side filter is tunable without C++ rebuild |
| **Only D (skip silence)** | Doesn't catch hallucinations from low-volume noise above -50dBFS that still confuses whisper |
| **Only E + F (post-filter)** | Wastes ~few hundred ms M1 inference per silent chunk; battery + heat for nothing |

The 3-layer combination is the minimum that covers all observed failure modes without over-engineering.

---

## 13. Memory references

- `v2_phase3_task35_step5_handoff_2026-05-15.md` — alpha gate context
- `feedback_llm_chat_template_sidecar.md` — sidecar/TS responsibility split pattern (we follow it here: lookup logic in sidecar, filter logic in TS)
- `feedback_sidecar_resources_stale.md` — sidecar rebuild + cp to resources/sidecar is one step (plan task 8 enforces)
- `feedback_4stage_governance.md` — architectural reviewer + post-impl reviewer + founder smoke (this design follows it)
- `project_metal_cold_cache_first_run.md` — first-run inference latency; not directly relevant but informs why we want to skip silent chunks (every saved cold start matters on M1)
- `feedback_auto_spawn_reviewer.md` — spec reviewer auto-spawned (§14)

---

## 14. Reviewer prompt (next step)

After this spec is saved, spawn a `critical-reviewer` agent with the prompt template at `~/.claude/reviewer-prompt-template.md`, role = **architectural reviewer** (matches design spec at this stage). Focus areas:

- Defense-in-depth ordering correctness (D → IPC → sidecar → F.front → E)
- Layer E marker logic (false-positive risk on legitimate 「はい」)
- Backward compat with old sidecar (R5)
- Threshold defaults: -50 dBFS, 0.6, 0.3
- Test coverage gaps (per §9)
- Missing edge cases not in §10
- Spec internal consistency (file paths, function names, types)

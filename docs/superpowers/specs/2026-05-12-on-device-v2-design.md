# Lisna v2 — On-Device AI Stack Design

**Date:** 2026-05-12
**Status:** Draft (brainstorming output, pending implementation plan)
**Concept yardstick:** *"모든 음성을, 디바이스 안에서, 구조화된 텍스트로."* (Locked in PR #4 PRD)

This document is the output of the v2 on-device brainstorming session.
It records *what* will be built, *why* each choice was made over its
alternatives, and *what is deliberately deferred*. Implementation steps
are out of scope here — they belong in the writing-plans phase.

---

## 1. Scope and target

### Surface and OS sequence

- **Surface:** Desktop. iOS evaluated and deferred to v3 — iOS cannot
  capture other apps' audio output (Apple privacy boundary), which
  breaks PRD scenarios 2 (Zoom/Teams/Meet) and weakens 1 (LMS lecture
  on a laptop). Desktop matches the PRD's "live audio → structured
  notes" shape across all four scenarios.
- **OS order:** Mac first → Windows port ~6 months later. Mac chosen
  for the quality-bar phase because Apple Silicon presents a single
  acceleration path (Metal / unified memory), making the "is the
  on-device quality good enough?" question answerable on one
  reference platform. Windows has a fragmented acceleration matrix
  (NVIDIA CUDA, AMD, Intel/Snapdragon NPU, CPU) that multiplies the
  validation cost without changing the answer.

### Hardware and OS floor

- **CPU:** M1 chip *or any later Apple Silicon* (M1, M1 Pro, M1 Max,
  M1 Ultra, M2 family, M3 family, M4 family, M5 family). Intel Macs
  excluded — Lisna v2 ships Apple Silicon only.
- **RAM:** 16 GB unified memory minimum. 8 GB configs refused at
  install time.
- **macOS:** 14.4 minimum for full functionality (CoreAudio Tap
  requires 14.4+). macOS 13 users can still install but are restricted
  to **microphone-only mode** — system audio capture (PRD scenario 1
  / LMS browser playback) is disabled with a clear notice
  recommending macOS upgrade. The user can still run scenario 3
  (in-room lecture, mic) normally.
- **Floor rationale:** No M3+ floor because the cost (excluding
  ~55-65% of Apple Silicon installed base, mostly M1/M2 buyers from
  2020-2023) is large and the benefit (~1.5× Neural Engine speed)
  is not load-bearing for the chosen models.
- **Single quality tier** — no per-machine model variants. One model
  per language, same quality target for every supported user.
  Dynamic tiering was considered (best-quality model per machine
  spec) and rejected for v2.0 to keep QA matrix small and marketing
  message single.

### Quality target

- **Cloud-equivalent**, not cloud-exceeding. The v1 cloud baseline is
  Groq Whisper Large-v3 + OpenAI gpt-4o-mini. v2 aims to match this
  while moving the workload onto the user's Mac. Exceeding cloud
  (= larger models than current cloud uses) would require either a
  higher hardware floor or dynamic tiering — both deferred.

---

## 2. STT pipeline

### Chunking and latency

- **~10-second chunks**, matching v1's existing behaviour. First
  chunk is short (~2 s) for fast first transcript line; subsequent
  chunks revert to 10 s.
- **Accuracy is prioritised over live-caption latency.** PRD value
  is the final structured note, not the live transcript stream.
  Spending latency budget on accuracy unlocks the largest Whisper
  models, which is the right trade.

### Speaker diarisation — deferred to v2.1

v2.0 ships **single-speaker mode only**. Multi-speaker audio is
transcribed as continuous text without speaker labels.

Reason: an independent review surfaced that the `pyannote-onnx`
diarisation path is effectively abandoned upstream (pyannote 3.1
removed ONNX support over numerical-instability concerns), the
community ONNX fork is single-maintainer, Japanese diarisation is
known-weak across all open models, and MPS execution on M1 is buggy
or slow (7-25 min per 1-hour audio).

Shipping diarisation on day one would risk a feature that is *worse
than nothing* for Japanese workplace meetings — incorrect speaker
attribution misrepresents who decided what.

**v2.1 plan:** build a 50-meeting Japanese evaluation set with human
speaker labels, then bake off three candidates (Sherpa-onnx,
NVIDIA Sortformer v2, Core ML pyannote export). Ship the winner.

**v2.0 PRD scenario coverage:**
- ✅ Scenario 1 (LMS lecture) — single speaker
- ✅ Scenario 3 (in-room lecture) — single speaker
- ⏸ Scenario 2 (Zoom/Teams/Meet) — deferred to v2.1
- ⏸ Scenario 4 (meeting room) — deferred to v2.1

### Per-language model strategy

User picks their primary language during first-run setup. App
downloads only that language's STT model. No automatic
language-detection routing (rejected because workplace meetings
often code-switch between Japanese and English, and mid-meeting
model swaps degrade output).

| Language | STT model | Quantised size | Why this model |
|---|---|---|---|
| 🇯🇵 日本語 | Kotoba-Whisper v2.0 (CyberAgent) | ~0.4 GB Q4 | Japanese-distilled from Whisper Large-v3, 6.3× faster, comparable/lower CER on Japanese vs vanilla Large-v3 |
| 🇺🇸 English | Distil-Whisper Large-v3 | ~0.4 GB Q4 | English-distilled, 5-6× faster, within ~1% WER of Large-v3 |
| 🇰🇷 한국어 | Whisper Large-v3 | ~1.5 GB Q4 | Korean-fine-tuned options exist but Mac-optimised maturity is lower; safest baseline. Re-evaluate in v2.5. |
| 🇨🇳 中文 | Whisper Large-v3 | ~1.5 GB Q4 | Same reasoning as Korean. |

All four models use the **GGUF** format and run via **whisper.cpp**
with the Metal backend on Mac.

**Note on diarisation deferral:** None of the four selected Whisper
variants has built-in speaker output — Kotoba-Whisper and
Distil-Whisper share Whisper Large-v3's architecture, which produces
no speaker hints. Deferring diarisation to v2.1 therefore loses no
capability from the chosen STT models; it only delays the *added*
diarisation layer (pyannote / Sortformer / Sherpa-onnx).

### Audio capture sources

- **Microphone** — standard mic input for in-room scenarios.
- **System audio (loopback)** — captured via Electron 39+'s
  `desktopCapturer.enableLocalLoopback`, which uses Apple's
  CoreAudio Tap API. Requires macOS 14.4+ on the user's machine.
  Covers scenario 1 (LMS browser playback) without virtual audio
  drivers like BlackHole. On macOS 13 the app gracefully degrades
  to mic-only mode (see §1 OS floor).

---

## 3. Note-organizing LLM

### Model

- **Gemma 4 4B (Q4 quantised, GGUF) *if released and GGUF-available
  by v2.0 freeze*; otherwise Gemma 3 4B Q4 GGUF**. The architectural
  decisions below (multilingual, 128K context, ~2.5 GB resident, single
  LLM for all four languages) hold for either version — model choice
  is final at v2.0 freeze, not now.
- Single LLM for all four languages — multilingual capability of
  Gemma family is the deciding factor over per-language LLMs.
- Resident size: ~2.5 GB.
- Context window: 128K tokens — handles a 1-hour transcript
  (~10-20K tokens of input + ~5K of structured output) without
  splitting. Splitting was the deal-breaker for Apple Foundation
  Models (4K context).

### Runtime — llama.cpp with Metal backend

Chosen for two reasons:

1. **Time-to-first-token on long prompts.** Lisna's workload is
   prompt-heavy (20K+ token input, ~5K output). Benchmarks show
   llama.cpp's prefill outperforms MLX in this regime; MLX leads
   only in steady-state generation, which is not Lisna's bottleneck.
2. **Cross-platform foundation.** Same GGUF model file and same
   inference code carry to the Windows port unchanged. Mac vs
   Windows output divergence is structurally eliminated.

---

## 4. Memory budget

### Why time-slicing is mandatory

Realistic 16 GB M1 working set during use:

| Consumer | Resident |
|---|---|
| macOS + system services | ~5 GB |
| Chrome (10 tabs) | ~3 GB |
| Slack / Discord | ~1 GB |
| Music / other | ~0.5 GB |
| **User baseline (before Lisna)** | **~9-10 GB** |

If Lisna kept STT + LLM both resident:
- STT (worst case, KO/ZH): 1.5 GB
- LLM: 2.5 GB
- Electron shell: 0.4 GB
- **Total: ~4.4 GB** → 13-14 GB grand total → swap territory.

### Solution — time-sliced loading

```
Session start  → load STT model (~0.4-1.5 GB)
               ↓
            [...session runs 10s-chunk transcription...]
               ↓
Session end    → unload STT
               → load LLM (~2.5 GB)
               → generate structured note
               → unload LLM
```

Maximum AI-resident at any moment: ~2.5 GB. Grand total ceiling
on a typical user state: ~12.5 GB / 16 GB → safe.

This makes the **AI sidecar pattern non-optional** — STT and LLM
each need to be loaded/unloaded cleanly, with the OS able to reclaim
memory between phases.

**Important — transient overlap during unload→load transition:**
For KO/ZH users (STT 1.5 GB + LLM 2.5 GB), naive "unload STT, then
load LLM" can transiently hold ~4 GB if the OS hasn't yet reclaimed
the STT pages before llama.cpp starts mmap'ing the LLM weights. The
sidecar supervisor MUST `await unloadModel()` to **OS-confirmed
reclamation** (e.g., `madvise(MADV_DONTNEED)` + verified `mach_vm`
release) before invoking `loadModel(LLM)` — not merely a JavaScript
Promise resolution. The §9 soak test must exercise this
**KO/ZH-path 1.5→2.5 GB transition** specifically; the JA/EN path
(0.4→2.5 GB) is the easy case.

---

## 5. Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Electron 39+ App                                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Renderer (React + TypeScript)                      │  │
│  │  - Note display, settings, model picker, recording  │  │
│  │  - Reuses v1's i18n table, design tokens, UI pieces │  │
│  └─────────────────────────┬──────────────────────────┘  │
│                             │ IPC                          │
│  ┌─────────────────────────┴──────────────────────────┐  │
│  │  Main process (Node.js)                             │  │
│  │  - Audio capture: mic + CoreAudio Tap loopback      │  │
│  │  - File system, settings, OS dialogs                │  │
│  │  - Spawns + supervises AI sidecar                   │  │
│  └─────────────────────────┬──────────────────────────┘  │
│                             │ stdin/stdout JSON IPC        │
│  ┌─────────────────────────┴──────────────────────────┐  │
│  │  AI Sidecar (native C++ binary)                     │  │
│  │  - whisper.cpp (STT, Metal) — time-sliced            │  │
│  │  - llama.cpp (LLM, Metal)  — time-sliced             │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

The sidecar is a separate process. If the AI process OOMs or
crashes, the UI survives and shows a graceful retry. AI components
upgrade independently of the UI shell.

### Engine abstraction layer

```typescript
interface STTEngine {
  loadModel(path: string, language: Language): Promise<void>;
  unloadModel(): Promise<void>; // MUST await OS-confirmed reclamation (see §4)
  // One call = one ~10-second chunk (or final partial chunk on stop).
  // The caller (audio capture pipeline) is responsible for chunking;
  // the engine does not stream internally and does not own a chunk
  // clock. Returns 1..N segments per chunk.
  transcribe(audio: Float32Array): Promise<TranscriptSegment[]>;
}

interface LLMEngine {
  loadModel(path: string): Promise<void>;
  unloadModel(): Promise<void>; // MUST await OS-confirmed reclamation (see §4)
  generate(prompt: string, opts: GenOpts): AsyncIterable<string>;
}
```

v2.0 ships single implementations (`WhisperCppSTT`, `LlamaCppLLM`)
behind these interfaces.

**Honest framing of the interface's value:** the abstraction makes
code organisation cleaner and isolates AI-specific logic from the
rest of the app. It does **not** make a future swap to WhisperKit /
MLX a "drop-in replacement" — WhisperKit's API surface (built-in
VAD, word-timestamp semantics, streaming chunker, language detection
callbacks) does not cleanly map to the simple `transcribe(audio) →
segments` shape. A v3.0 migration to Apple-native runtimes is best
sized as "informed rewrite of the engine layer", not "swap behind
the same interface". The interface helps localise that rewrite —
it does not eliminate it.

---

## 6. Cloud fallback policy

**v2.0 ships with no cloud fallback. Pure on-device.**

This is a deliberate deviation from the PRD's literal wording
("cloud is retained as a fallback for first launch and for devices
below the on-device threshold"). The deviation is justified by:

1. **Concept lock alignment.** "디바이스 안에서" must hold 100% for
   the Japanese enterprise privacy message to be usable in
   compliance reviews. Any fallback weakens "your audio never leaves
   your Mac" to "your audio mostly stays on your Mac" — which
   triggers GDPR-style review processes in Japanese
   finance/medical/legal customers.
2. **v1 already covers cloud need.** v1 Chrome extension stays
   running per PRD ("validation infrastructure, not phased out").
   Users who can't wait for the model download, want unsupported
   languages, or prefer cloud, are directed to v1.
3. **No v2-specific cloud infrastructure needed.** v2.0 backend
   cost = 0. v1's existing AWS Lambda + Groq + OpenAI stack
   continues to serve its own users.
4. **Architecture simplicity.** No routing decisions, no auto-fallback
   UI, no "where was this processed?" debugging branches.

### First-run UX

- App download is small (Electron shell ~200 MB).
- After install: app starts a background download of the selected
  language's STT model (+ Gemma 4 4B LLM, shared across languages).
  User sees a "preparing on-device AI" progress indicator but can
  continue exploring the UI.
- **Download is sequenced one model at a time, STT first** so that
  partial functionality (single-shot transcription, no note polish)
  is reachable before the LLM download completes. Download pauses
  automatically if the host's available RAM drops below a safety
  threshold (other apps demanding memory), and resumes when pressure
  eases.
- If the user tries to record before download is complete: a clear
  message ("AI models still downloading — about X minutes left")
  with a "use Lisna v1 Chrome extension instead" link.
- Hardware floor (M1 / 16 GB) is checked at install time. Below-floor
  hardware is refused with a redirect to v1.

### Unsupported languages

- Setup language picker offers only JA / EN / KO / ZH.
- Recording in a language other than the selected primary will
  produce poor STT (Whisper Large-v3 still has multi-language
  capability for KO/ZH, but Kotoba-Whisper and Distil-Whisper are
  language-specific). Documented as a known limitation.
- Users needing other languages: directed to v1.

---

## 7. Build, distribution, and operations

### Electron version pinning

- **Minimum Electron 39+** required for the `enableLocalLoopback` /
  CoreAudio Tap default that makes system-audio capture work without
  hacks.
- **Verify Electron 39's macOS-runtime floor at v2.0 freeze.** Electron
  occasionally raises its minimum macOS version between major
  releases. If Electron 39's runtime floor is > macOS 14.4, either
  pin Electron to a version that still supports 14.4 *or* raise the
  app's macOS floor to match. The §1 OS floor (14.4) and this §7
  Electron pin must be kept in sync — drift here silently breaks
  loopback for low-macOS users.
- CI build gate: fails on Electron < 39.
- `electron-updater` integrated from day 1 — LM Studio precedent
  shows that being stuck on an old Electron when macOS updates can
  break the app. Track Electron stable releases.

### Code signing and notarization

- Apple Developer ID required for app *and* each bundled native
  binary (whisper.cpp, llama.cpp sidecar).
- Entitlement: `com.apple.security.cs.allow-unsigned-executable-memory`
  required for llama.cpp's JIT / memory-mapped model weights.
- `electron-builder` `extraResources` for the sidecar binary and
  model files (after download).
- **Plan ~3 days buffer** for first-time notarization debugging.
  Entitlement mismatches and signing-chain issues are common
  first-time traps.

### App startup and sidecar lifecycle

- Sidecar spawned on app startup, with stdin/stdout JSON IPC.
- Supervisor in main process detects crashes, restarts the sidecar,
  surfaces a UI message after 2 consecutive failures.
- Sidecar binary inspects host's free RAM at startup; refuses to
  load model if insufficient (clear error → user can close other
  apps and retry).

---

## 8. What this design does NOT cover

Out of scope for this spec — each item warrants its own future spec:

- **Windows port specifics.** Same models and llama.cpp/whisper.cpp,
  but Electron + CoreAudio Tap is Mac-specific; Windows needs
  `WASAPI` loopback, different code signing (Authenticode), different
  installer, different acceleration tuning. Separate spec when timing
  comes.
- **iOS expansion** (v3 territory).
- **UI/UX flows** — note display, settings layout, model picker,
  recording controls, language-switch UX. Inherit v1 design system
  where possible; specifics in a separate UI spec.
- **Billing / Stripe** — carries from v1 unchanged.
- **Diarisation engine pick for v2.1** — separate spec after the
  50-meeting Japanese eval-set bakeoff.
- **Prompt engineering for Gemma 4 4B** note structuring — separate
  prompt-design spec.
- **Telemetry / observability** — what to measure and how, given
  privacy constraints (no audio leaves device).

---

## 9. Risks acknowledged

1. **Diarisation bakeoff (v2.1) may not yield a "good enough" winner
   on Japanese.** Mitigation: 50-meeting eval set is built early in
   the v2.0 cycle, so we have data before committing v2.1 scope.
   Worst case: v2.1 ships with diarisation marked "experimental" +
   user rename UX, or v2.1 ships diarisation only for short meetings
   (≤30 min) where pyannote degrades less.
2. **WhisperKit / MLX migration in v3.0 is informed rewrite, not
   swap.** Already reframed in §5 above. No external promises about
   "easy migration" should appear in marketing.
3. **Electron version pinning is critical.** Section 7 mitigations
   are not optional.
4. **Memory time-slicing depends on clean unload.** llama.cpp and
   whisper.cpp must release model memory back to the OS reliably. To
   be validated in early implementation (build a 4-hour soak test
   that loads-records-unloads-loads-LLM-unloads-loops).
5. **First-run download wait may cause early-trial bounce.** Mitigation
   is the v1 Chrome extension as the "want it now" escape hatch.
   Measure trial-to-paid conversion vs v1 to detect regression.
6. **Japanese workplace compliance message is the v2 wedge.** If
   competitors ship similar on-device claims first, the wedge narrows.
   Track competitor positioning in JP market quarterly.
7. **50-meeting Japanese eval-set procurement is a separate
   budgeted workstream, not absorbed into engineering time.**
   Realistic shape: ~50 hours of Japanese workplace meeting audio
   (recorded with consent or purchased from a dataset vendor),
   human-labelled for speaker turns by Japanese-native annotators.
   Expected cost: weeks of annotator time + dataset licensing/consent
   admin. Owner of this workstream needs to be named before v2.0
   feature freeze, otherwise v2.1 diarisation bakeoff slips.

---

## 10. Decision provenance

| # | Decision | Alternatives considered | Reason for choice |
|---|---|---|---|
| Q1 | Scope = model + runtime picks | Just models / Full v2 architecture | Right granularity for one spec |
| Q2 | Surface = desktop | iOS / desktop + iOS / iOS primary | iOS can't capture other apps' audio; breaks 2 of 4 PRD scenarios |
| Q3 | OS order = Mac → Win | Win first / both / Mac only | Mac = single acceleration path → cheaper quality-bar validation |
| Q4 | Floor = M1 / 16 GB | M1 / 8GB ; M3+ / 16GB | M1/8GB too narrow on RAM; M3+ excludes 55-65% of Apple Silicon base |
| Q5 | Single tier (no dynamic) | Dynamic per-machine model tiers | Focus + simpler launch; tiering can come in v3+ |
| Q6 | Latency = ~10s chunks | 3s / true streaming | PRD value is the final note; chunk size doesn't affect note quality |
| Q7 | Diarisation deferred to v2.1 | Day-1 with pyannote-onnx / Sherpa-onnx | pyannote-onnx upstream abandoned; Japanese accuracy unknown |
| Q8 | Per-language model | Whisper Large multilang only / hybrid | Kotoba-Whisper materially better on Japanese, our primary market |
| Q9 | STT runtime = whisper.cpp | WhisperKit / hybrid | Cross-platform foundation; the chosen STT models (Kotoba-Whisper, Distil-Whisper) ship as GGUF, runnable on whisper.cpp without re-conversion. WhisperKit would require a Core ML conversion path for each |
| Q10 | LLM = Gemma 4 4B | Qwen 3 7B / Apple FM / per-lang split | Multilingual + 128K context + sweet-spot size; single pick = simpler |
| Q11 | LLM runtime = llama.cpp | MLX | Better TTFT on long prompts (Lisna's hot path) |
| Q12 | App shell = Electron 39+ | Tauri v2 / Wails / Native Swift / 8 others | Verified across all viable shells: only Electron scores 4-5 on every Lisna-relevant axis |
| Q13 | No cloud fallback | First-run fallback / language fallback / user toggle | Concept lock; v1 covers cloud need; zero v2 backend cost |

---

## Appendix — open threads after spec

- Validate Gemma 4 4B GGUF availability at v2.0 freeze; fallback path
  to Gemma 3 4B GGUF is identical from the architecture's view.
- Spike: Kotoba-Whisper v2.0 GGML/GGUF performance test on M1 16GB
  with a representative 1-hour Japanese meeting.
- Spike: 4-hour soak test of time-sliced STT-then-LLM loading on
  the sidecar to validate the memory budget assumption.
- Procurement: build the 50-meeting Japanese eval set during v2.0
  development cycle (audio + human speaker labels), so v2.1
  diarisation bakeoff can start immediately after v2.0 ship.


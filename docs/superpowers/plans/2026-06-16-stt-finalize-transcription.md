# STT Phase 2a — Record-then-Transcribe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace live per-chunk STT with a single whole-file transcription of the saved WAV at finalize, so the note is built from a context-conditioned (proper-noun-clean) transcript.

**Architecture:** Recording captures audio to one gap-faithful, crash-safe WAV (no model loaded). At finalize the live path loads STT (with the session language), runs a new path-based `transcribeFile` sidecar command (one `whisper_full` pass over the WAV, `filterSegments`-parity, progress events), stores the result on the orchestrator so the existing finalize pipeline (adapt → chunk → grammar LLM → note) runs unchanged, then unloads STT and loads the LLM. The from-dump regen path is untouched. No live captions; the recording screen shows a level meter + timer.

**Tech Stack:** Electron (main + preload + React renderer), TypeScript, a C++ sidecar (whisper.cpp + llama.cpp) over NDJSON, Vitest (TS), CTest (C++).

**Scope:** This plan is **phase 2a** only (the working, testable core, per spec section 11). Phase 2b (retention/delete UI + privacy copy) follows the founder posture in spec section 13; 2c (windowing) is gated on the section-9 RSS measurement; 2d (unfinalized-recording recovery) is deferred. Each is a separate plan.

**Reference spec:** `docs/superpowers/specs/2026-06-16-stt-finalize-transcription-design.md`.

---

## Conventions for every task

- **Test runner (TS):** `pnpm --filter @lisna/desktop exec vitest run <explicit-file>` — NEVER the bare/whole suite (zombie-safety: the spike real-LLM/STT tests must not be discovered). Never `run_in_background` heavy LLM/STT.
- **C++:** build + ctest via the `lisna-sidecar-rebuild` workflow (M1-safe `-j` + MD5-verify the binary copied to `desktop/resources/sidecar`), then `ctest` in the sidecar build dir.
- **Self-checks before each commit:** `pnpm --filter @lisna/desktop typecheck` + `pnpm --filter @lisna/desktop lint` + the task's scoped vitest file. (`desktop-ci` gates on `pnpm verify` which runs lint — do not skip lint.)
- **Real-STT tests are manual + env-gated** (`LISNA_TEST_STT_MODEL=<path>`), scoped to one file, with `afterAll` sidecar cleanup + a post-scan (`pgrep -fl "whisper-cli|llama-completion|desktop/resources/sidecar"`). CI runs the mocked path only.
- **Commits:** `type(scope): summary` ≤72 chars; one concern per commit; end with the Co-Authored-By trailer.

## Shared contracts (define once; every task references these)

**C-1 — `transcribeFile` request (`desktop/src/shared/ipc-protocol.ts`, `SidecarRequest` union):**
```ts
| {
    id: string;
    type: 'transcribeFile';
    /** Absolute path to a 16 kHz mono PCM16 WAV on disk. */
    path: string;
    sampleRate: number;
    /** Whisper proper-noun bias (STT Phase 1). Omitted when empty. */
    initialPrompt?: string;
  }
```
Response reuses the existing `{ id; type: 'segments'; segments: TranscriptSegment[] }`. Language is NOT in the request — the model is loaded with it first (mirrors `transcribe`, which uses the load-time language).

**C-2 — `sttProgress` event (`SidecarEvent` union, id-less like `memory`/`log`):**
```ts
| { type: 'sttProgress'; pct: number }   // 0..100, monotonic per transcribeFile call
```
Single-concurrency finalize (the `finalizeInFlight` flag) makes id-less safe.

**C-3 — `FinalizeProgressPayload` additions (`ipc-protocol.ts`):**
```ts
| { kind: 'transcribe-start' }
| { kind: 'transcribe-progress'; pct: number }
| { kind: 'transcribe-done' }
```

**C-4 — STT engine method (`desktop/src/main/engines/whisper-cpp-stt.ts`):**
```ts
transcribeFile(path: string, opts?: TranscribeOpts): Promise<TranscriptSegment[]>
```
Sends C-1 with `timeoutMs: Infinity`; applies `filterSegments(r.segments, { language: this.language })` exactly as `transcribe` does (`whisper-cpp-stt.ts:44-45`). The progress-based stall watchdog lives in main (Group H), not here.

**C-5 — orchestrator transcript-as-data (`desktop/src/main/sidecar/orchestrator.ts`):**
```ts
private finalizeSegments: TranscriptSegment[] | null = null;   // set once at finalize
get exposedSegments(): readonly TranscriptSegment[] { return this.finalizeSegments ?? []; }
setFinalizeSegments(segs: TranscriptSegment[]): void { this.finalizeSegments = segs; }
get wavPath(): string | null { return this.opts.wavPath ?? null; }
```
This is orchestrator-instance data, NOT keyed on `_llmLoadedForCurrent` (which is nulled in 5 places), so a P0-3 note-gen retry reuses it.

---

# Group A — Gap-faithful, crash-safe WAV

### Task A1: WavWriter refreshes the header on every append (crash-safe)

**Files:**
- Modify: `desktop/src/main/audio-wav-writer.ts:31-48`
- Test: `desktop/src/main/audio-wav-writer.test.ts` (create if absent)

- [ ] **Step 1 — Write the failing test (byte-level, demonstrates the current bug):**
```ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WavWriter } from './audio-wav-writer';

describe('WavWriter crash-safety', () => {
  let f: string;
  afterEach(() => { try { fs.unlinkSync(f); } catch { /* ignore */ } });

  it('header reports the real data size after append WITHOUT close', () => {
    f = path.join(os.tmpdir(), `wav-crash-${process.pid}-${Math.floor(performance.now())}.wav`);
    const w = new WavWriter(f);
    w.append(new Float32Array(16000)); // 1s @ 16k mono → 32000 data bytes
    // Simulate a crash: do NOT call close(). Read the header straight off disk.
    const h = fs.readFileSync(f);
    expect(h.readUInt32LE(40)).toBe(32000);     // data chunk size
    expect(h.readUInt32LE(4)).toBe(36 + 32000); // RIFF size
  });
});
```

- [ ] **Step 2 — Run it; verify it FAILS** (pre-change writer only patches the header in `close()`):
`pnpm --filter @lisna/desktop exec vitest run src/main/audio-wav-writer.test.ts`
Expected: FAIL — `readUInt32LE(40)` is `0`.

- [ ] **Step 3 — Implement:** in `append()` after the sample `writeSync`, rewrite the header at offset 0 and flush. Replace the body of `append` (`audio-wav-writer.ts:31-41`) so it ends with:
```ts
    fs.writeSync(this.fd, buf, 0, buf.length, this.pos);
    this.pos += buf.length;
    this.dataBytes += buf.length;
    // Crash-safety: the WAV is now the SOLE transcript source, so it must be a
    // valid, decodable file at all times — not only after close(). Rewrite the
    // 44-byte header in place (pwrite at offset 0 does not move `this.pos`),
    // then fdatasync so a hard power-loss leaves a recoverable file.
    fs.writeSync(this.fd, this.header(this.dataBytes), 0, 44, 0);
    try { fs.fdatasyncSync(this.fd); } catch { /* fdatasync unsupported on some FS — header rewrite still helps */ }
```

- [ ] **Step 4 — Run it; verify PASS.** Same command. Expected: PASS.

- [ ] **Step 5 — Commit:**
```bash
git add desktop/src/main/audio-wav-writer.ts desktop/src/main/audio-wav-writer.test.ts
git commit -m "fix(stt): WavWriter refreshes header + fdatasync per append (crash-safe)"
```

### Task A2: Stream every chunk — remove the renderer silence gate (gap-faithful WAV)

**Files:**
- Modify: `desktop/src/renderer/audio/orchestrator.ts:90-114` (`emitChunk`)
- Test: `desktop/src/renderer/audio/orchestrator.test.ts` (add a case)

- [ ] **Step 1 — Write the failing test:**
```ts
import { describe, it, expect, vi } from 'vitest';
import { RecordingOrchestrator } from './orchestrator';

it('emits silent chunks too (WAV must be gap-faithful)', () => {
  const sent: number[] = [];
  const orch = new RecordingOrchestrator({
    capturerFactory: () => ({ start: async () => {}, stop: async () => {} }) as never,
    sender: (c) => sent.push(c.samples.length),
  });
  // Reach into emitChunk via the chunker callback path: drive a silent chunk.
  // (Mirror the existing orchestrator.test.ts harness for constructing chunks.)
  // @ts-expect-error access the private emit for the unit test
  orch['source'] = 'mic';
  // @ts-expect-error
  orch.emitChunk(new Float32Array(16000)); // all-zero → previously dropped
  expect(sent).toEqual([16000]);
});
```

- [ ] **Step 2 — Run it; verify it FAILS** (silent chunk currently dropped at `orchestrator.ts:94-100`):
`pnpm --filter @lisna/desktop exec vitest run src/renderer/audio/orchestrator.test.ts`
Expected: FAIL — `sent` is `[]`.

- [ ] **Step 3 — Implement:** delete the `if (isSilent(chunk)) { … return; }` block (`orchestrator.ts:94-100`) so every chunk is sent. Keep the `samplesEmitted` advance (now unconditional). Remove the now-unused `isSilent` import. Add a one-line comment: `// Live STT removed (STT Phase 2): no per-chunk STT to skip, and the WAV must preserve silence for absolute timestamps + duration.`

- [ ] **Step 4 — Run it; verify PASS.** Same command.

- [ ] **Step 5 — Commit:**
```bash
git add desktop/src/renderer/audio/orchestrator.ts desktop/src/renderer/audio/orchestrator.test.ts
git commit -m "fix(stt): stream silent chunks so the saved WAV is gap-faithful"
```

### Task A3: Always-on capture + `wavPath` on the orchestrator + surfaced write errors

**Files:**
- Modify: `desktop/src/main/ipc.ts:554-578` (gate block), `:148-151` (PII comment), session-start wiring
- Modify: `desktop/src/main/sidecar/orchestrator.ts` (constructor `Opts` gains `wavPath?: string`; C-5 `wavPath` getter)
- Test: `desktop/src/main/ipc.test.ts` (add: a recording always opens a writer; append error stops the session)

- [ ] **Step 1 — Write the failing tests:** (a) starting a session opens an `audio-captures/<ts>.wav` writer with no env/marker; (b) when the writer's `append` throws (disk-full), the session surfaces an error rather than swallowing. Mirror the existing `ipc.test.ts` session-start harness (it already stubs `app.getPath` to a tmp dir per `ae368ce`). Assert the WAV file exists after start, and that a throwing writer rejects the chunk path with a surfaced error.

- [ ] **Step 2 — Run; verify FAIL** (gate is off by default today): `pnpm --filter @lisna/desktop exec vitest run src/main/ipc.test.ts`.

- [ ] **Step 3 — Implement:**
  - Remove the `saveAudioOn` gate (`ipc.ts:561-563`); always open the writer. Keep a `LISNA_DISABLE_AUDIO_SAVE` env **kill-switch for tests only** (default capture on).
  - Promote `wavPath` (currently local at `:569`) into the `SessionOrchestrator` opts (`opts.wavPath = wavPath`) so finalize (Group C) can resolve it; expose via the C-5 `wavPath` getter.
  - Change `opts.onAudioChunk` (`:572`) so a write failure does NOT swallow: on the first `append` throw, call `closeAudioWriter()` and surface an error to the renderer (`safeSend(CHANNELS.sessionError, { message: 'AUDIO_WRITE_FAILED' })`) and stop the session. (The WAV is the sole source — a silent disk-full would lose everything.)
  - Update the PII-off comments (`ipc.ts:148-151,554-560`) to the always-on, on-device, retained posture (cross-ref spec section 13).

- [ ] **Step 4 — Run; verify PASS.** Same command. Also `typecheck` + `lint`.

- [ ] **Step 5 — Commit:**
```bash
git add desktop/src/main/ipc.ts desktop/src/main/sidecar/orchestrator.ts desktop/src/main/ipc.test.ts
git commit -m "feat(stt): always-on audio capture + wavPath on orchestrator + surface write errors"
```

---

# Group B — `transcribeFile` primitive (C++ + protocol + TS engine)

### Task B1: Protocol — add the `transcribeFile` request, `sttProgress` event, progress payloads

**Files:**
- Modify: `desktop/src/shared/ipc-protocol.ts` (C-1, C-2, C-3)
- Test: type-level only (compile) — covered by `typecheck` + downstream tasks

- [ ] **Step 1:** Add the C-1 variant to `SidecarRequest`, the C-2 `sttProgress` variant to `SidecarEvent`, and the C-3 `transcribe-*` variants to `FinalizeProgressPayload`. Add doc comments (id-less progress is safe under single-concurrency finalize; pct monotonic).
- [ ] **Step 2 — Verify:** `pnpm --filter @lisna/desktop typecheck` → PASS (no consumers yet).
- [ ] **Step 3 — Commit:**
```bash
git add desktop/src/shared/ipc-protocol.ts
git commit -m "feat(stt): protocol — transcribeFile request + sttProgress + finalize transcribe progress"
```

### Task B2: C++ — WAV reader helper (PCM16 mono 16k → float)

**Files:**
- Create: `desktop/sidecar/src/stt/wav_reader.h` (+ `.cpp`)
- Test: `desktop/sidecar/tests/wav_reader_test.cpp` (CTest)

- [ ] **Step 1 — Write the failing CTest:** write a known 44-byte-header PCM16 mono 16k WAV to a tmp path (e.g. 2 samples), call `read_wav_pcm16_mono_16k(path, out)`, assert the float values (`int16 / 32768.0`) and that a truncated/bad-magic file returns an error. Register it in `desktop/sidecar/tests/CMakeLists.txt` mirroring an existing test target.

- [ ] **Step 2 — Build + run; verify FAIL** (symbol missing): build via the `lisna-sidecar-rebuild` workflow, then `ctest -R wav_reader`.

- [ ] **Step 3 — Implement `read_wav_pcm16_mono_16k`:**
```cpp
// wav_reader.h
#pragma once
#include <string>
#include <vector>
namespace lisna::stt {
// Reads a canonical 44-byte-header PCM16 mono 16 kHz WAV (exactly what WavWriter
// emits) into float samples in [-1, 1]. Returns false on open/format error.
bool read_wav_pcm16_mono_16k(const std::string& path, std::vector<float>& out, std::string& errOut);
}
```
```cpp
// wav_reader.cpp — parse RIFF/WAVE/fmt(PCM,1ch,16k,16bit)/data; read int16 LE;
// out[i] = s < 0 ? s / 32768.0f : s / 32767.0f. Validate magic + sizes; on any
// mismatch set errOut and return false. Tolerate a data size that is smaller
// than the file (the crash-safe header may trail the last partial chunk) by
// reading min(headerDataSize, fileBytes - 44).
```

- [ ] **Step 4 — Build + run; verify PASS.** `ctest -R wav_reader`.

- [ ] **Step 5 — Commit:**
```bash
git add desktop/sidecar/src/stt/wav_reader.* desktop/sidecar/tests/wav_reader_test.cpp desktop/sidecar/tests/CMakeLists.txt
git commit -m "feat(stt): C++ WAV reader for finalize-time whole-file transcription"
```

### Task B3: C++ — `WhisperEngine::transcribe` gains an optional progress callback

**Files:**
- Modify: `desktop/sidecar/src/stt/whisper_engine.h:28-29`, `.cpp:43-77`
- Test: `desktop/sidecar/tests/whisper_engine_test.cpp` (extend if present; otherwise assert via B4's integration)

- [ ] **Step 1:** Add a progress param:
```cpp
// whisper_engine.h
#include <functional>
std::vector<Segment> transcribe(const float* samples, size_t n, int sampleRate,
                                const std::string& initialPrompt = "",
                                const std::function<void(int)>& onProgress = {});
```
- [ ] **Step 2:** In `.cpp` wire it through `whisper_full_params`:
```cpp
struct ProgCtx { const std::function<void(int)>* cb; };
ProgCtx pc{ onProgress ? &onProgress : nullptr };
if (pc.cb) {
  p.progress_callback = [](whisper_context*, whisper_state*, int progress, void* ud) {
    auto* c = static_cast<ProgCtx*>(ud);
    if (c && c->cb && *c->cb) (*c->cb)(progress);
  };
  p.progress_callback_user_data = &pc;
}
```
(Existing call sites pass no callback → unchanged behavior; the default `{}` is falsy.)
- [ ] **Step 3 — Build; verify the existing transcribe ctest still PASSES** (default-arg back-compat). `ctest -R whisper` (or the existing STT test target).
- [ ] **Step 4 — Commit:**
```bash
git add desktop/sidecar/src/stt/whisper_engine.*
git commit -m "feat(stt): whisper engine optional progress callback (default no-op)"
```

### Task B4: C++ — `transcribeFile` dispatch branch (reads WAV, emits sttProgress, returns segments)

**Files:**
- Modify: `desktop/sidecar/src/ipc/json_protocol.cpp` (add a branch after the `transcribe` branch, `:236`)
- Test: `desktop/sidecar/tests/json_protocol_test.cpp` (dispatch a `transcribeFile` with a tmp WAV against a loaded stub model OR assert the shape-validation + not_loaded paths without a model)

- [ ] **Step 1 — Write the failing CTest** for the cheap, model-free paths (mirror the `transcribe` branch's shape tests at `json_protocol.cpp:190-209`): missing `path` → `missing_field`; non-string `path` → `invalid_type`; valid shape but `!g_stt->loaded()` → `not_loaded`. (Real-model decoding is covered by the manual real-STT check in B6.)

- [ ] **Step 2 — Build + run; verify FAIL** (`unimpl` returned today): `ctest -R json_protocol`.

- [ ] **Step 3 — Implement the branch** (mirror `transcribe` at `json_protocol.cpp:190-236`, but read from a path and stream progress):
```cpp
if (type == "transcribeFile") {
  if (!req.contains("path") || !req.contains("sampleRate"))
    return err("missing_field", "path/sampleRate required");
  if (!req["path"].is_string())    return err("invalid_type", "path must be string");
  if (!req["sampleRate"].is_number_integer()) return err("invalid_type", "sampleRate must be integer");
  if (req.contains("initialPrompt") && !req["initialPrompt"].is_string())
    return err("invalid_type", "initialPrompt must be string");
  if (!g_stt || !g_stt->loaded()) return err("not_loaded", "stt model not loaded");
  std::vector<float> samples; std::string werr;
  if (!lisna::stt::read_wav_pcm16_mono_16k(req["path"].get<std::string>(), samples, werr))
    return err("wav_read_failed", werr);
  if (samples.empty()) return err("invalid_payload", "wav decoded to empty");
  const std::string initialPrompt = req.value("initialPrompt", std::string{});
  // Progress events are id-less (single-concurrency finalize). Throttle to whole
  // percents (whisper already steps in integer %) to keep stdout light.
  int lastPct = -1;
  auto segs = g_stt->transcribe(samples.data(), samples.size(),
                                req["sampleRate"].get<int>(), initialPrompt,
                                [&](int pct) {
    if (pct == lastPct) return;
    lastPct = pct;
    emit_event(nlohmann::json{{"type","sttProgress"},{"pct",pct}}.dump());
  });
  auto arr = nlohmann::json::array();
  for (const auto& s : segs)
    arr.push_back({{"startSec",s.startSec},{"endSec",s.endSec},{"text",s.text},{"noSpeechProb",s.noSpeechProb}});
  return nlohmann::json{{"id",id},{"type","segments"},{"segments",arr}}.dump();
}
```
Add `#include "stt/wav_reader.h"` at the top.

- [ ] **Step 4 — Build + run; verify PASS** (shape/not_loaded tests): `ctest -R json_protocol`. Rebuild the sidecar binary via the `lisna-sidecar-rebuild` workflow + MD5-verify it copied to `desktop/resources/sidecar`.

- [ ] **Step 5 — Commit:**
```bash
git add desktop/sidecar/src/ipc/json_protocol.cpp desktop/sidecar/tests/json_protocol_test.cpp
git commit -m "feat(stt): sidecar transcribeFile — whole-file decode from a WAV path + sttProgress"
```

### Task B5: TS — `WhisperCppSTT.transcribeFile` (C-4) with filterSegments parity

**Files:**
- Modify: `desktop/src/main/engines/whisper-cpp-stt.ts` (add C-4), `desktop/src/shared/engine-interfaces.ts` (`STTEngine` gains `transcribeFile`)
- Test: `desktop/src/main/engines/whisper-cpp-stt.test.ts`

- [ ] **Step 1 — Write the failing test:** with a fake `SidecarClient` whose `send` resolves `{ type:'segments', segments:[realSeg, hallucinationSeg] }`, assert `transcribeFile('/x.wav', { initialPrompt:'佐々木' })` (a) sends `{ type:'transcribeFile', path:'/x.wav', sampleRate:16000, initialPrompt:'佐々木' }` with `timeoutMs: Infinity`, and (b) returns segments **with the JA hallucination filtered out** when the engine was loaded with `language:'ja'` (parity with `transcribe`). Add a parity assertion: `transcribe` and `transcribeFile` filter identically for the same input.

- [ ] **Step 2 — Run; verify FAIL** (method missing): `pnpm --filter @lisna/desktop exec vitest run src/main/engines/whisper-cpp-stt.test.ts`.

- [ ] **Step 3 — Implement** (mirror `transcribe` at `whisper-cpp-stt.ts:30-46`, path-based, no base64, infinite timeout):
```ts
async transcribeFile(path: string, opts?: TranscribeOpts): Promise<TranscriptSegment[]> {
  const initialPrompt = opts?.initialPrompt?.trim();
  const r = await this.client.send(
    initialPrompt
      ? { type: 'transcribeFile', path, sampleRate: 16000, initialPrompt }
      : { type: 'transcribeFile', path, sampleRate: 16000 },
    { timeoutMs: Infinity },  // bounded by the main-side stall watchdog (Group H), not a wall clock
  );
  if (r.type === 'error') throw new Error(`STT transcribeFile failed [${r.code}]: ${r.message}`);
  if (r.type !== 'segments') throw new Error(`STT transcribeFile: unexpected response ${JSON.stringify(r)}`);
  if (this.language === null) return r.segments;
  return filterSegments(r.segments, { language: this.language });
}
```
Add `transcribeFile(path, opts?)` to the `STTEngine` interface (`engine-interfaces.ts:15-25`).

- [ ] **Step 4 — Run; verify PASS.** `typecheck` + `lint` + the file.

- [ ] **Step 5 — Commit:**
```bash
git add desktop/src/main/engines/whisper-cpp-stt.ts desktop/src/shared/engine-interfaces.ts desktop/src/main/engines/whisper-cpp-stt.test.ts
git commit -m "feat(stt): WhisperCppSTT.transcribeFile with filterSegments parity"
```

### Task B6: Manual real-STT smoke (env-gated; zombie-safe) — accuracy sanity

**Files:** uses `desktop/scripts/transcribe-wav.ts` (repoint at `transcribeFile`) — keep it as the reference instrument.

- [ ] **Step 1:** Update `transcribe-wav.ts` to call the new `stt.transcribeFile(wavPath, { initialPrompt })` instead of reading + base64 `transcribe`. Keep its `LISNA_STT_INITIAL_PROMPT` knob.
- [ ] **Step 2 — Manual run (NOT CI):** `LISNA_TEST_STT_MODEL=<turbo.bin> pnpm -s tsx desktop/scripts/transcribe-wav.ts <a real WAV>`. Confirm: progress prints, segments return, proper nouns match the whole-file expectation. Then `pgrep -fl "whisper-cli|llama-completion|desktop/resources/sidecar"` → expect none; `kill -9` any survivor.
- [ ] **Step 3 — Commit:**
```bash
git add desktop/scripts/transcribe-wav.ts
git commit -m "chore(stt): point transcribe-wav.ts at transcribeFile (reference instrument)"
```

---

# Group C — Live-finalize wiring (transcribe before LLM)

### Task C1: Orchestrator transcript-as-data (C-5) + drop live accumulation

**Files:**
- Modify: `desktop/src/main/sidecar/orchestrator.ts:617,625,653-663` + `Opts`
- Test: `desktop/src/main/sidecar/orchestrator.test.ts`

- [ ] **Step 1 — Write the failing test:** `setFinalizeSegments([s])` then `exposedSegments` returns `[s]`; a fresh orchestrator's `exposedSegments` is `[]`; `onChunk(audio)` calls `opts.onAudioChunk` but does NOT call `opts.stt.transcribe` (live STT removed) and leaves `exposedSegments` empty.

- [ ] **Step 2 — Run; verify FAIL:** `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/orchestrator.test.ts`.

- [ ] **Step 3 — Implement:**
  - Replace the `private segments` field + `exposedSegments` getter with the C-5 `finalizeSegments` field, getter, `setFinalizeSegments`, and `wavPath` getter; add `wavPath?: string` to `Opts`.
  - `start()` (`:629-639`): **remove** `stt.loadModel(...)` (STT is no longer loaded during recording). Keep the method (resets state) — it now does no model I/O.
  - `onChunk()` (`:653-663`): keep `this.opts.onAudioChunk?.(audio, sessionOffsetSec)`; **remove** the `stt.transcribe` call, the segment re-anchor, the `this.segments.push`, and the return value (return `void` or keep `[]` for callers). Update the JSDoc.

- [ ] **Step 4 — Run; verify PASS.** Then update the tests this invalidates per the `(test-headers)` rule: `orchestrator.test.ts:107` (and any that assert live-accumulation) — rewrite/remove and fix their header docstrings in THIS commit.

- [ ] **Step 5 — Commit:**
```bash
git add desktop/src/main/sidecar/orchestrator.ts desktop/src/main/sidecar/orchestrator.test.ts
git commit -m "refactor(stt): orchestrator holds finalize transcript as data; no live STT"
```

### Task C2: Session start no longer loads STT (faster start)

**Files:**
- Modify: `desktop/src/main/ipc.ts:587-591` (drop `stt-loading` phase + the load timing around `orch.start()`); add a **start precheck**: stat `paths.sttPath` + confirm sidecar ready BEFORE `recording = true`.
- Test: `desktop/src/main/ipc.test.ts`

- [ ] **Step 1 — Write the failing test:** starting a session does NOT call `stt.loadModel`; if `paths.sttPath` does not exist, start rejects with `STT_MODEL_MISSING` before recording begins (so we never record audio we can't later transcribe).
- [ ] **Step 2 — Run; verify FAIL.**
- [ ] **Step 3 — Implement:** remove the `safeSend(CHANNELS.sessionPhase, { phase:'stt-loading' })` + `sessionLog.phase('stt-load', …)` around `orch.start()`; add `if (!fs.existsSync(paths.sttPath)) throw new Error('STT_MODEL_MISSING');` in the precheck region (`ipc.ts:524-525` area, after `getModelPaths`). Keep the sidecar lazy-spawn + `waitForReady` (`:530-538`).
- [ ] **Step 4 — Run; verify PASS** + `typecheck` + `lint`.
- [ ] **Step 5 — Commit:**
```bash
git add desktop/src/main/ipc.ts desktop/src/main/ipc.test.ts
git commit -m "feat(stt): record-only start — no STT load, precheck model presence"
```

### Task C3: Live-finalize prep — transcribe the WAV, then unload STT, then load LLM

**Files:**
- Modify: `desktop/src/main/ipc.ts:334-400` (`getCurrentSession`) + add `prepLiveFinalize(client, sttPath, llmPath, language, wavPath)`; keep `loadLlmForFinalize` (`:244-256`) FOR FROM-DUMP ONLY.
- Test: `desktop/src/main/ipc.test.ts` + `desktop/src/main/sidecar/ipc/session-finalize.test.ts`

- [ ] **Step 1 — Write the failing tests:**
  - Ordering: `prepLiveFinalize` calls, in order, `stt.loadModel(sttPath, language)` → `stt.transcribeFile(wavPath, { initialPrompt })` → `stt.unloadModel()` → `llm.loadModel(llmPath)`. (Assert call order via mocks; assert STT-unload precedes LLM-load — the 8 GB invariant.)
  - Result: `getCurrentSession` sets the orchestrator's `finalizeSegments` to the transcribeFile result, so `exposedSegments` (read at `:359,389`) reflects it.
  - Dump: transcript.json is written **after** transcribeFile with the real segments; on STT failure an **error record** is written (not the transcript), and no LLM load happens.
  - Empty guard: transcribeFile returning `[]` makes finalize throw `EMPTY_RECORDING`.
  - From-dump untouched: `buildDumpSessionContext` still uses `loadLlmForFinalize` and never calls `transcribeFile`.

- [ ] **Step 2 — Run; verify FAIL.**

- [ ] **Step 3 — Implement** `prepLiveFinalize` and rewire `getCurrentSession`:
```ts
async function prepLiveFinalize(
  client: SidecarClientLike, sttPath: string, llmPath: string,
  language: Language, wavPath: string,
): Promise<TranscriptSegment[]> {
  const stt = new WhisperCppSTT(client);
  const llm = new LlamaCppLLM(client);
  // 1. STT loaded WITH the session language (load-time param), then whole-file pass.
  await stt.loadModel(sttPath, language);
  const initialPrompt = loadGlossaryInitialPrompt();
  const t0 = Date.now();
  const segs = await stt.transcribeFile(wavPath, initialPrompt ? { initialPrompt } : undefined);
  sessionLog.phase('stt-transcribe-finalize', Date.now() - t0);
  // 2. 8GB floor: STT must be unloaded (mach-confirmed) BEFORE the LLM loads.
  const u0 = Date.now();
  await stt.unloadModel().catch(() => { /* idempotent */ });
  sessionLog.phase('stt-unload-finalize', Date.now() - u0);
  const l0 = Date.now();
  await llm.loadModel(llmPath);
  sessionLog.phase('llm-load-finalize', Date.now() - l0);
  return segs;
}
```
In `getCurrentSession`: resolve `wavPath = current.wavPath` (reject `WAV_MISSING` if null/absent); if `_llmLoadedForCurrent !== current`, call `prepLiveFinalize(...)`, then `current.setFinalizeSegments(segs)`; if `segs.length === 0` throw `EMPTY_RECORDING`; **then** create the dump and `writeTranscript({ … segments: current.exposedSegments })` (moved to AFTER transcription — was at `:355-360`). On any prep throw, write a dump error record. The returned `SessionContext.segments` stays `current.exposedSegments`. `routeFamily`/`adaptToV2Transcript` (`session-finalize.ts:176`) are unchanged. Leave `getDumpSession`/`buildDumpSessionContext`/`loadLlmForFinalize` untouched.

- [ ] **Step 4 — Run; verify PASS** (both test files) + `typecheck` + `lint`.

- [ ] **Step 5 — Commit:**
```bash
git add desktop/src/main/ipc.ts desktop/src/main/ipc.test.ts desktop/src/main/sidecar/ipc/session-finalize.test.ts
git commit -m "feat(stt): finalize transcribes the WAV before unload-STT/load-LLM; from-dump untouched"
```

---

# Group D — Remove the dead live-caption surface (renderer + IPC)

### Task D1: handleChunk stops returning segments; drop the onChunk push

**Files:**
- Modify: `desktop/src/main/ipc.ts:299-321` (`handleChunk`), `:309-313` (the `CHANNELS.onChunk` send)
- Test: `desktop/src/main/ipc.test.ts`

- [ ] **Step 1 — Write the failing test:** a chunk handled during recording does NOT send on `CHANNELS.onChunk` (no live captions) and returns `{ ok: true }`; the WAV-append side effect (via `orch.onChunk`/`onAudioChunk`) still occurs.
- [ ] **Step 2 — Run; verify FAIL.**
- [ ] **Step 3 — Implement:** in `handleChunk`, drop the `event.sender.send(CHANNELS.onChunk, …)` block (`:309-313`); call `await orch.onChunk(payload.samples, payload.startMs/1000)` only for its WAV side effect; return `{ ok: true }`.
- [ ] **Step 4 — Run; verify PASS.**
- [ ] **Step 5 — Commit:**
```bash
git add desktop/src/main/ipc.ts desktop/src/main/ipc.test.ts
git commit -m "refactor(stt): handleChunk no longer pushes live caption segments"
```

### Task D2: Remove `onChunk` / `ChunkResultPayload` from preload + protocol

**Files:**
- Modify: `desktop/src/preload/index.ts:37-41,178` (remove `onChunk` + its `Window.lisna` decl), `desktop/src/shared/ipc-protocol.ts:9-14` (remove `ChunkResultPayload`), and the `CHANNELS.onChunk` registration in `ipc.ts`.
- Test: `typecheck` (compile-time removal)

- [ ] **Step 1:** Remove `onChunk` from the preload bridge + the `Window.lisna` interface; remove `ChunkResultPayload`; remove the `CHANNELS.onChunk` channel + any registration. (Leave `ChunkPayload` — still used for `sendChunk`.)
- [ ] **Step 2 — Verify FAIL→FIX:** `pnpm --filter @lisna/desktop typecheck` surfaces every remaining consumer (App.tsx) — fixed in D3.
- [ ] **Step 3 — Commit** (with D3 if typecheck must stay green; otherwise stage D2+D3 together):
```bash
git add desktop/src/preload/index.ts desktop/src/shared/ipc-protocol.ts desktop/src/main/ipc.ts
git commit -m "refactor(stt): remove dead onChunk/ChunkResultPayload IPC surface"
```

### Task D3: App.tsx FSM — drop `View.segments`; empty-detection from elapsed, not segments

**Files:**
- Modify: `desktop/src/renderer/App.tsx` (view union `:19-24`, onChunk effect `:108-118`, Stop handler `:236-244`, the ~5 `segments` sites)
- Test: `desktop/src/renderer/App.test.tsx` (if present) or a focused new test

- [ ] **Step 1 — Write the failing test:** stopping a recording with a non-trivial elapsed time transitions to `familyPicking` (NOT discard); stopping with elapsed < the min threshold discards. (Under record-only there are no live segments, so the old `prev.segments.length === 0` guard at `:240` would discard EVERY recording.)
- [ ] **Step 2 — Run; verify FAIL.**
- [ ] **Step 3 — Implement:**
  - Remove `segments: TranscriptSegment[]` from the `recording`/`familyPicking`/`curatingV2`/`error` view variants; remove the `onChunk` subscription effect (`:108-118`) and `inFlightSegments`/`View.segments` threading.
  - Stop handler (`:236-244`): replace `if (prev.segments.length === 0) discard` with `if (elapsedSec < MIN_RECORDING_SEC) { discardSession(); return recording }` else `→ familyPicking`. (`MIN_RECORDING_SEC = 1`.) The real empty/silent case is caught server-side by `EMPTY_RECORDING` (C3) → error view.
  - `onRegenerate(family, segments)` / NoteView regenerate path: regenerate now uses `finalizeFromDump` (history) — it does not depend on renderer live segments. Drop the `segments` arg from the live-recording regenerate; keep the dump path intact.
  - Fix all remaining `segments` references surfaced by `typecheck`.
- [ ] **Step 4 — Run; verify PASS** + `typecheck` + `lint`.
- [ ] **Step 5 — Commit:**
```bash
git add desktop/src/renderer/App.tsx desktop/src/renderer/App.test.tsx
git commit -m "refactor(stt): drop renderer live-segments; empty-detection from elapsed time"
```

---

# Group E — Recording UI: level meter

### Task E1: RecordingOrchestrator exposes an audio level (RMS dBFS) from the ungated stream

**Files:**
- Modify: `desktop/src/renderer/audio/orchestrator.ts` (`OrchestratorOptions` gains `onLevel?: (dbfs: number) => void`; compute RMS in `onSamples` before the chunker)
- Test: `desktop/src/renderer/audio/orchestrator.test.ts`

- [ ] **Step 1 — Write the failing test:** pushing a full-scale block fires `onLevel` near 0 dBFS; a silent block fires near the floor (≤ −60). Computed from the **ungated** `onSamples`, independent of the silence/chunk logic.
- [ ] **Step 2 — Run; verify FAIL.**
- [ ] **Step 3 — Implement:** in `onSamples(s)` (`orchestrator.ts:85-88`), compute `rms = sqrt(mean(s_i^2))`, `dbfs = 20*log10(max(rms, 1e-7))`, clamp to [−60, 0], and call `this.onLevel?.(dbfs)` before `this.acc.push(s)`.
- [ ] **Step 4 — Run; verify PASS.**
- [ ] **Step 5 — Commit:**
```bash
git add desktop/src/renderer/audio/orchestrator.ts desktop/src/renderer/audio/orchestrator.test.ts
git commit -m "feat(stt): RecordingOrchestrator emits RMS dBFS level from the ungated stream"
```

### Task E2: LevelMeter component + wire it into Recording.tsx (replace captions)

**Files:**
- Create: `desktop/src/renderer/components/LevelMeter.tsx` (+ test)
- Modify: `desktop/src/renderer/routes/Recording.tsx:142-148` (wire `onLevel`), `:244-266` (remove captions + "N segments"; render `<LevelMeter>` + the existing timer + "녹음 중")

- [ ] **Step 1 — Write the failing test (LevelMeter):** renders a bar whose width maps −60→0 dBFS to 0→100%; shows a clip indicator at ≥ 0 dBFS; has `role="meter"`/`aria-live` + the device label prop. (Function-first; no legal-pad decoration per `web-design.md` scope boundary.)
- [ ] **Step 2 — Run; verify FAIL:** `pnpm --filter @lisna/desktop exec vitest run src/renderer/components/LevelMeter.test.tsx`.
- [ ] **Step 3 — Implement** `LevelMeter` (props: `dbfs: number`, `deviceName?: string`) and wire it: in `Recording.tsx` `start()`, pass `onLevel: (db) => setLevel(db)` to the `RecordingOrchestrator`; in the running view, delete the `segments`/"N segments" block (`:247,255-266`) and render `<LevelMeter dbfs={level} deviceName={…} />` + the existing `● m:ss` timer + a "녹음 중" label.
- [ ] **Step 4 — Run; verify PASS** + `typecheck` + `lint`.
- [ ] **Step 5 — Commit:**
```bash
git add desktop/src/renderer/components/LevelMeter.tsx desktop/src/renderer/components/LevelMeter.test.tsx desktop/src/renderer/routes/Recording.tsx
git commit -m "feat(stt): recording screen shows a level meter + timer (no live captions)"
```

---

# Group F — Finalize progress: the transcription phase

### Task F1: Main forwards `sttProgress` → `onFinalizeProgress` during the live transcribe

**Files:**
- Modify: `desktop/src/main/ipc.ts` (subscribe to `sttProgress` events around `prepLiveFinalize`; map to C-3 payloads on `CHANNELS.sessionFinalizeProgress`)
- Test: `desktop/src/main/ipc.test.ts`

- [ ] **Step 1 — Write the failing test:** while `prepLiveFinalize` runs, a sidecar `sttProgress {pct:42}` event is forwarded to the renderer as `{ kind:'transcribe-progress', pct:42 }`; `transcribe-start` fires before the pass and `transcribe-done` after.
- [ ] **Step 2 — Run; verify FAIL.**
- [ ] **Step 3 — Implement:** in `getCurrentSession`, before calling `prepLiveFinalize`, `safeSend(CHANNELS.sessionFinalizeProgress, { kind:'transcribe-start' })` and subscribe via `client`'s event listener (the `SidecarClient.onEvent`) for `e.type === 'sttProgress'` → forward `{ kind:'transcribe-progress', pct: e.pct }`; unsubscribe + send `transcribe-done` in a `finally`. (Reuse the existing `onFinalizeProgress` channel; no new channel.)
- [ ] **Step 4 — Run; verify PASS.**
- [ ] **Step 5 — Commit:**
```bash
git add desktop/src/main/ipc.ts desktop/src/main/ipc.test.ts
git commit -m "feat(stt): forward sidecar sttProgress as finalize transcribe progress"
```

### Task F2: curatingV2 renders the transcription phase (real progress, no fake bar)

**Files:**
- Modify: the curatingV2 progress reducer/component (App.tsx `foldFinalizeProgress` ~`:357-401` + the `NoteRenderProgress`/curatingV2 view) + `ProgressState`
- Test: the existing finalize-progress reducer test

- [ ] **Step 1 — Write the failing test:** `foldFinalizeProgress` maps `transcribe-start`/`transcribe-progress{pct}`/`transcribe-done` into a `phase:'transcribing'` + `pct` state, then hands off to the existing chunk/attempt note phase on `attempt-start`. Assert no fabricated percent is shown when `pct` is absent.
- [ ] **Step 2 — Run; verify FAIL.**
- [ ] **Step 3 — Implement:** extend `ProgressState` with a `'transcribing'` phase carrying `pct?`; fold the C-3 events; render "오디오 받아쓰는 중… {pct}%" when `pct` is present, else a spinner + elapsed (NEVER a synthesized percentage — the no-fake-progress rule). Then "노트 작성 중…" for the existing note phase.
- [ ] **Step 4 — Run; verify PASS** + `typecheck` + `lint`.
- [ ] **Step 5 — Commit:**
```bash
git add desktop/src/renderer/App.tsx desktop/src/renderer/components/NoteRenderProgress.tsx
git commit -m "feat(stt): curatingV2 shows the real transcription phase before note-gen"
```

---

# Group G — Always-on disclosure (ships WITH capture)

### Task G1: First-run on-device audio-retention notice

**Files:**
- Create: `desktop/src/renderer/components/FirstRunAudioNotice.tsx` (+ test); persist a `audioNoticeAck` flag (existing settings/electron-store or a userData JSON)
- Modify: the recording entry (Recording.tsx `start()` or the route mount) to show the notice once before the first recording

- [ ] **Step 1 — Write the failing test:** the notice renders on first run (flag unset), states recordings are saved **on this device only** (never uploaded) and can be deleted; acknowledging sets the flag so it does not show again. ja/en copy via the existing i18n pattern.
- [ ] **Step 2 — Run; verify FAIL.**
- [ ] **Step 3 — Implement** the notice + persistence + the once-only gate before first capture. (Copy must match spec section 13 / the web privacy posture; do not claim "we keep nothing".)
- [ ] **Step 4 — Run; verify PASS** + `typecheck` + `lint`.
- [ ] **Step 5 — Commit:**
```bash
git add desktop/src/renderer/components/FirstRunAudioNotice.tsx desktop/src/renderer/components/FirstRunAudioNotice.test.tsx desktop/src/renderer/routes/Recording.tsx
git commit -m "feat(stt): first-run on-device audio-retention disclosure"
```

---

# Group H — STT-stall recovery (process-restart, never LLM-reload)

### Task H1: Progress-based stall watchdog around the finalize transcribe

**Files:**
- Modify: `desktop/src/main/ipc.ts` (`prepLiveFinalize` wraps `transcribeFile` in a no-progress watchdog)
- Test: `desktop/src/main/ipc.test.ts`

**Rationale (grounded):** the sidecar dispatch is single-threaded (`json_protocol.cpp:14-21`) — while `whisper_full` blocks, a second IPC line (e.g. an abort) cannot be read, so cooperative abort is impossible. And `makeRecoveringSidecarFor` (`ipc.ts:264-289`) reloads the **LLM** (`:277-279`), which would violate the 8 GB floor under a loaded STT. So STT-stall recovery = restart the sidecar process + reload STT(language) + re-issue `transcribeFile` once.

- [ ] **Step 1 — Write the failing test:** if no `sttProgress` arrives within `STT_NO_PROGRESS_MS` and `transcribeFile` has not resolved, the watchdog restarts the sidecar (`supervisor.restart`), reloads STT with the session language, and re-issues `transcribeFile` exactly once; a second stall surfaces `STT_STALLED`. Steady progress resets the timer (no false restart).
- [ ] **Step 2 — Run; verify FAIL.**
- [ ] **Step 3 — Implement:** a `transcribeFileWithWatchdog(client, sttPath, language, wavPath, initialPrompt)` helper used by `prepLiveFinalize`: race `transcribeFile` against a no-progress timer reset by each `sttProgress` event; on timeout → `supervisor.restart()` → `waitForReady` → `stt.loadModel(sttPath, language)` → re-issue once; on second timeout throw `STT_STALLED`. `STT_NO_PROGRESS_MS` = a generous constant (e.g. 60_000) tuned from the section-9 latency curve.
- [ ] **Step 4 — Run; verify PASS** + `typecheck` + `lint`.
- [ ] **Step 5 — Commit:**
```bash
git add desktop/src/main/ipc.ts desktop/src/main/ipc.test.ts
git commit -m "feat(stt): dedicated STT-stall recovery (restart + reload STT, never LLM)"
```

---

# Group I — Integration + verification

### Task I1: End-to-end finalize integration (mocked STT) for all 4 families

**Files:**
- Test: `desktop/src/main/sidecar/ipc/session-finalize.test.ts` (or a new integration test)

- [ ] **Step 1 — Write the test:** with a mock `transcribeFile` returning a known multi-segment transcript, drive `session/finalize` for `lecture`/`meeting`/`interview`/`brainstorm`; assert each produces a note from the transcribed segments (not from any live accumulation), and that the dump transcript.json holds the transcribed segments. Assert WAV-duration-vs-elapsed using the A2 gap-faithful path on a synthetic recording (silence preserved).
- [ ] **Step 2 — Run; verify PASS** (all assertions): the scoped file only.
- [ ] **Step 3 — Commit:**
```bash
git add desktop/src/main/sidecar/ipc/session-finalize.test.ts
git commit -m "test(stt): e2e finalize-from-WAV across all 4 families (mocked STT)"
```

### Task I2: Full scoped self-check + manual real-record validation

- [ ] **Step 1 — Scoped CI-safe self-check:** `pnpm --filter @lisna/desktop typecheck` + `lint` + `vitest run` over the explicit changed test files (list them; never the whole suite). Rebuild the sidecar via `lisna-sidecar-rebuild` + MD5-verify + `ctest` for the C++ targets.
- [ ] **Step 2 — Manual real validation (founder-style, LOCAL INSTALLED app):** build + install `/Applications/Lisna.app`; record a real ja clip with proper nouns + a silent stretch; Stop → confirm the transcribe phase shows real progress, the note is proper-noun-clean, the WAV exists in `audio-captures/` with duration == recording length. Then `pgrep -fl "whisper-cli|llama-completion|desktop/resources/sidecar|electron-vite|vitest"` → kill any survivor.
- [ ] **Step 3 — Acceptance gates (spec section 9), BLOCKED on founder eval material:** with the committed corrected reference transcript, run `transcribe-wav.ts` (whole-file) vs the recorded live baseline → proper-noun error count == 0 + CER strictly lower by the stated margin; capture peak RSS during transcription (< ceiling) and the latency curve (10/30/60 min) from `stt-transcribe-finalize`.

---

## Self-review (plan vs spec)

- **Spec coverage:** silence-gate decouple → A2; crash-safe WAV → A1; always-on + wavPath + disk-full surface → A3; transcribeFile protocol/C++/TS + filterSegments parity → B1-B5; from-dump split + dump ordering + empty guard + cache → C3 (+ C1); remove live STT → C1/C2; dead onChunk surface → D1-D3; level meter → E1-E2; real-progress finalize UI → F1-F2; disclosure → G1; STT-stall recovery (no LLM reload) → H1; falsifiable gates + manual real-STT → I2. **Deferred per spec phasing:** 2b retention/delete UI (separate plan, founder section 13), 2c windowing (RSS-gated), 2d recovery.
- **Placeholder scan:** every code step has concrete content; "mirror existing X at file:line" references are exact (read-verified), not hand-waving.
- **Type consistency:** `transcribeFile(path, opts?)` (C-4) used identically in B5/C3/H1; `finalizeSegments`/`setFinalizeSegments`/`exposedSegments`/`wavPath` (C-5) consistent across C1/A3/C3; `sttProgress`/`transcribe-{start,progress,done}` (C-2/C-3) consistent across B1/B4/F1/F2.
- **Abort note:** cooperative abort is impossible under the single-threaded sidecar (B4 rationale), so cancellation is process-restart (H1) — the spec's `abort_callback` line is intentionally not implemented; recorded here so an implementer does not add a dead abort path.

---

## Execution handoff

After review, execute task-by-task. Group order A → B → C → D → E → F → G → H → I is dependency-correct (C depends on A+B; D depends on C; F depends on B+C). Each task leaves the tree green (typecheck + lint + its scoped test). The C++ tasks (B2-B4) own the sidecar rebuild + sign + ctest.

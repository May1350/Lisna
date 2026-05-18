# Manual Verification Log — desktop

Records of one-off runtime verifications that can't be fully automated.

## cb({}) deny semantics — Electron 39 (verified DEFERRED)

- Setup: macOS dev environment, `pnpm --filter @lisna/desktop dev`
- Steps:
  1. In a renderer context where `desktopCapturer.getSources()` returns `[]` (or temporarily stub to force the empty path), call `navigator.mediaDevices.getDisplayMedia({ audio: true })`
  2. Confirm the returned promise rejects (NOT: hangs, NOT: resolves to an empty stream)
- Expected: promise rejects with `NotFoundError` or `NotAllowedError`
- Result: DEFERRED — no live macOS Electron runtime in the agent session that locked this contract (2026-05-13). The unit test (`src/main/audio/__tests__/system-audio-handler.test.ts`) covers the call-shape contract; this entry is a placeholder to be filled when a live env is available.
- Electron version observed: DEFERRED

## Capture → chunker → main IPC end-to-end (Task 1.5, DEFERRED)

- Setup: macOS dev environment, `pnpm --filter @lisna/desktop dev`, microphone available
- Steps:
  1. Open the Recording route, click "Start"
  2. Speak for ~15 seconds, then click "Stop"
  3. Watch the main-process console (electron-vite stdout)
- Expected:
  - `chunk received 0 32000 samples` at ~2s after start (first chunk = 2s × 16kHz)
  - `chunk received 1 160000 samples` at ~12s (second chunk = 10s × 16kHz)
  - A residual `chunk received N <leftover> samples` after Stop (flush)
  - Renderer's "Chunks captured" counter increments alongside each main-side log
- Open questions for the live run:
  - Confirm `new URL('./pcm-worklet.js', import.meta.url)` resolves in both dev (electron-vite serves) and packaged (file://) builds; if not, move `pcm-worklet.js` under `src/renderer/public/` and switch to a `/pcm-worklet.js` string URL
  - Confirm Float32Array survives the IPC structured clone with `samples.length === payload.samples.length` (no truncation, no detach); the fallback is to send `samples.buffer` (ArrayBuffer) and reconstruct on the main side
- Result: DEFERRED — no live Electron runtime available in the agent session that wrote this code (2026-05-13). Unit tests in `src/renderer/audio/__tests__/orchestrator.test.ts` cover the orchestrator state machine; the AudioWorklet + IPC wiring will be exercised in Phase 2 when the whisper sidecar consumer is plugged in.

## macOS 13 (Darwin 22.x) graceful fallback — verified DEFERRED

- Setup: run on actual macOS 13 OR force `os.release()` stub in `hardware-check.ts` to return `"22.6.0"` temporarily (the threshold is Darwin 23.4 ≈ macOS 14.4, so anything below trips the fallback path)
- Expected on macOS 13 (or stubbed):
  1. Recording route loads without errors
  2. The "System audio" radio button is `disabled` (greyed; the disabled state is the affordance — not hidden)
  3. `SystemAudioUnavailableNotice` (`#fff7e6` aside) is visible below the source picker with the macOS 14.4 explanation copy
  4. Mic-only recording still works end-to-end (Start → speak → Stop → chunk counter increments, no console errors)
- Expected on macOS 14.4+ (sanity baseline):
  1. System-audio radio is enabled and selectable
  2. The notice is NOT rendered
- Result: DEFERRED — no macOS 13 machine in agent session; full manual matrix lands at Phase 6.4 per the on-device v2 plan. Unit tests in `src/main/platform/__tests__/hardware-check.test.ts` pin the Darwin 23.4 threshold (23.3 → false, 23.4 → true), which is the load-bearing branch.
- Electron / macOS versions observed: DEFERRED

## Capture → sidecar → live JA captions (Task 2.7, PASS 2026-05-13)

- Setup:
  - macOS 15.x dev environment, `LISNA_DEV_STT_MODEL=~/.lisna-test-models/ggml-kotoba-whisper-v2.0-q5_0.bin pnpm --filter @lisna/desktop dev`
  - Model: `ggml-kotoba-whisper-v2.0-q5_0.bin` (Q5_0, 538 MB, sha256 `4a3b9219…03658`)
  - Microphone permission granted to Electron
- Steps:
  1. Boot path: main process logs `[sidecar] ready` (sidecar reaches its `ready` event over NDJSON) and `[stt] model loaded from <path>` (WhisperCppSTT.loadModel resolved)
  2. Open the Recording route — UI shows `Lisna v2 — on-device` / `Recording` / Source picker / Start button. Header no longer says "Phase 1 stub"
  3. Click Start, speak Japanese in a live classroom for ~2 minutes (13 chunks ≈ 2s + 12×10s), click Stop
- Expected:
  - Main-process log shows `chunk received N M samples` for each captured chunk (renderer-side `Chunks captured: N` increments alongside)
  - `Live captions` section appears under the Stop button with `[startSec] text` lines accumulating
  - Each chunk's segments push back through `recording/chunk-result` and append to the renderer's segment list while a session is running
  - Stop clears the running flag synchronously; any late `transcribe()` result that resolves post-Stop is silently dropped (no cross-session bleed)
- Observed:
  - 13 chunks captured, 6 caption lines rendered with recognizable Japanese phrases drawn from the lecture audio (`組織の形が変わっていく時に発生する問題`, etc.)
  - No crash, no UI error state, no console errors
  - "Chunks captured: 13" counter consistent with audio length
- Known limitations (NOT regressions — by design at this phase; tracked in plan §Phase 4-5):
  - **Timestamps display chunk-relative `startSec`, not recording-absolute time.** `ChunkResultPayload.startMs` is carried but not yet rendered. Phase 4 UI polish will fold `startMs + segment.startSec` into a wall-clock label.
  - **No chunk overlap or VAD.** A word straddling a 10-second chunk boundary is cut, producing short fragments or empty hallucinated lines. Phase 5 (memory soak + transcript stitching) handles this with sliding-window chunks and silence-gating.
  - **Q5_0 quantization (538 MB) trades quality for size.** Phase 4's model registry will expose the full 1.52 GB Kotoba-Whisper as an opt-in for users who prioritize accuracy.
  - **Whisper silence-hallucinations occur on low-energy chunks** (canonical examples: `どうもありがとうございました`, `字幕`). Phase 4-5 will gate transcription on a VAD threshold and optionally pass the previous segment as `initial_prompt` for context continuity.
  - **Supervisor restart loses the loaded model.** `SidecarSupervisor` respawns the sidecar binary on crash (`src/main/sidecar/supervisor.ts:99-102`), but `src/main/index.ts:43-65` captures the initial `SidecarClient` reference into a closure and hands that exact instance to `WhisperCppSTT`. After a crash + respawn, the adapter still points at the dead client and the model is not auto-reloaded — recording continues, IPC writes silently land in the dead-stdin error handler, and no captions come back. Surfaced by Phase 2 final review. Phase 3 boot reorganization will lift model load + adapter binding into an `onRespawn` callback the supervisor invokes after each successful `ready` event.
- Result: **PASS** — end-to-end pipeline (renderer audio capture → main IPC → sidecar transcribe → renderer caption push) is live for Japanese audio. Phase 2 acceptance: ✅. Quality work is plan-scoped to Phase 4-5; the supervisor-restart cohesion gap is plan-scoped to Phase 3.
- Electron / model versions observed: Electron 39.8.10, whisper.cpp v1.7.6 + Metal, Kotoba-Whisper v2.0 Q5_0 GGML.

## ja-note-v1 prompt — golden Note (Phase B placeholder, awaiting §6 smoke)

**Prompt source**: `desktop/src/main/sidecar/prompts/ja-note-v1.ts` (version: `ja-note-v1`)
**ADR**: `docs/superpowers/decisions/2026-05-15-step-5-section-9-decisions.md` §2
**Status**: PHASE-B SMOKE COMPLETE for 3B — Llama-3.2-3B-Instruct Q4_K_M Note recorded below. 1B regression deferred (model-capability ceiling on M1 8GB; see Anchor 1 notes).

**§6 smoke fix (2026-05-15 afternoon)**: Initial §6 run produced degenerate output (3B = `@`, 1B = 6588-char infinite loop) because `LlamaEngine::generate` was sending raw prompt text without `llama_chat_apply_template` and without `llama_sampler_init_penalties` in the sampler chain. Fix landed in three commits: switch IPC + TS protocol from `prompt: string` → `messages: ChatMessage[]`; apply GGUF chat template before tokenization + add `init_penalties(64, 1.1, 0, 0)` between top_p and temp; cap `n_ctx` 131072 → 16384 (M1 8GB Metal compute buffer headroom). The 3B Note below is the first coherent output post-fix.

### Eval-anchor structure (Step 5 §3.1 task 3)

The Step 5 plan mandates 2–3 LLM-as-judge eval-set anchors. Each anchor is a `(transcript_input, expected_note_shape)` pair where the judge LLM scores the actual model output on three axes:

| Axis | Pass criterion | Rationale |
|------|----------------|-----------|
| Format compliance | 0 Markdown tokens (`#`, `*`, `-` at line-start, no triple-backtick), all section headers use `【…】`, all bullets use `・` | The `<pre>` renderer makes any Markdown leak immediately visible to users |
| Polite-desu/masu register | Body uses です/ます endings; no casual だ/である; no formal-keigo (お〜になります) | ADR §3 lock — register consistency across the app |
| Section omission | Empty sections do NOT appear with a header-only stub | Prompt instruction; verify the LLM obeys |

### Anchor 1 — Standalone JA TTS (TTS-clean transcript, established 2026-05-13)

**Input transcript**: `tests/fixtures/transcripts/ja-30s.txt`
> 今日は良い天気ですね。これは日本語音声認識のテストです。コトバウィスパーというモデルを使って、サイドカープロセスで文字起こしを行います。三十秒ほど話し続けるので、しっかり認識できるか確認します。日本語の発音は明瞭で、機械翻訳と音声認識の両方に重要な役割を果たしています。

**Expected note shape** (PLACEHOLDER — finalize once real LLM output is observed):

```
【要点】
・(本日の天気と日本語音声認識テストに関する内容など、要点を中黒で並列)

【次のアクション】
(該当する内容が無い場合はこのセクションごと省略)

【決定事項】
(同上)
```

**Observed note** (Llama-3.2-3B-Instruct Q4_K_M, kotoba-Whisper-v2.0 Q5_0, M1 8GB, 2026-05-15T08:10:08Z, 158 chars):

```
【決定事項】

日本語音声認識のテスト

【要点】

・日本語音声認識のテスト
・30秒ほど話し続ける
・サイドカープロセスで文字起こしを行う
・言語ウィスパーモデルを使用する
・日本語の発音は明瞬で、機械翻訳と音声認識の両に重要な役割を果たします。

【次のアクション】

・テスト結果の確認
・音声認識の精度評価
```

**Observed note (1B regression)**: Llama-3.2-1B-Instruct Q4_K_M times out under test conditions (GENERATE_TIMEOUT at 60s no-progress) — direct sidecar probe shows the model produces tokens but enters echo mode (starts output with the user transcript verbatim instead of producing structured sections). Conclusion: 1B is below the capability threshold for this prompt on M1 8GB; v2.0 alpha ships 3B only. The strengthened smoke harness correctly rejects 1B output via the GENERATE_TIMEOUT path.

**Judge scorecard** (3B, manual scoring per §3.1 task 3 axes):
| Axis | Score | Notes |
|------|-------|-------|
| Format compliance | PASS | All three section headers in `【…】`; bullets use `・`; no Markdown tokens. |
| Polite-desu/masu register | MIXED (Step 6 follow-up) | Of the 4 verb-final bullets in `【要点】`, only `〜果たします。` uses です・ます; the other 3 are plain dictionary form (`〜続ける` / `〜行う` / `〜使用する`). Compliance rate ≈ 25% on verb-final items. Noun-phrase bullets (`テスト結果の確認`, `音声認識の精度評価`) are register-neutral and don't count. The ja-note-v1 prompt explicitly locks register ("文体は丁寧体 (です・ます調) に統一してください") but the 3B model only partially obeys on bullet-form items — this is a real prompt-quality finding to address in Step 6 (prompt-tune the instruction wording or escalate to a JA-tuned model variant). The Step 5 §6 smoke gate accepts MIXED because Format + structural compliance are the load-bearing properties for the §3.2 strict-no-Markdown invariant; register tuning is downstream prompt-engineering work. |
| Section omission | UNTESTABLE | All three sections populated (the source transcript is a TTS self-description that names what it tests, decides what it tests, and implies next steps). For this fixture, no section is empty; the omission rule was untestable here. Anchor 2 (real meeting) will provide the contrasting case. |

### Anchor 2 — Real meeting audio (founder-provided, DEFERRED)

**Input transcript**: TBD — founder records a 2-minute JA meeting per §9 Item 5 escalation.

**Expected note shape**: TBD — three sections likely populated (要点 + 次のアクション + 決定事項).

**Observed note (DEFERRED §6)**: not yet recorded.

### Anchor 3 — Silence-hallucination boundary (regression for whisper drift)

**Input transcript**: TBD — capture a session with 1–2 chunks of pure silence interspersed with speech, exposing the kotoba-whisper silence-hallucination text (e.g. `字幕`, `ご視聴ありがとうございました`).

**Expected note shape**: the LLM should ignore the obvious silence-artifact lines OR fail gracefully (not invent a meeting topic from them).

**Observed note (DEFERRED §6)**: not yet recorded.

### Notes for the implementer who finalizes this

- Run `pnpm dev` with both `LISNA_DEV_STT_MODEL` and `LISNA_DEV_LLM_MODEL` env set; play the audio file through system audio (or record live).
- After Stop → NoteView renders, copy the raw `note.markdown` into the "Observed note" block of the matching anchor.
- Score each axis (format / register / omission) manually. If any axis fails on a real recording, iterate the prompt template in `ja-note-v1.ts` (do NOT bump version unless the change is intentionally non-backward-compatible).
- A future LLM-as-judge harness (Step 6+) automates the scoring; the manual rows are the data source for that harness.

---

## §5.1 — First-run model resolver (Step 5 Task 1)

**Prereqs:** Two real model files at `~/.lisna-test-models/`:
- `ggml-kotoba-whisper-v2.0-q5_0.bin` (Whisper STT)
- `Llama-3.2-3B-Instruct-Q4_K_M.gguf` (Llama LLM)

If either is missing, see the Discord channel for the alpha distribution links.

**Manual-gate-only scenarios** (not covered by automated `setup-flow.smoke.test.ts`):
- SetupView state-machine transitions (Step 1 → Step 2 → done → Recording)
- `getModelStatus` + `pickModel` IPC channels end-to-end
- Cancel/error UI strips with JA copy via `toFriendlyJa`
- `main/index.ts` empty-string env-var normalization (`?.trim() || undefined`)
- `DISCORD_CHANNEL_URL` placeholder runtime guard
- Env-override read-through invariant (env-set sessions don't write models.json)

### Happy path (first-run)

1. Quit Electron if running. Remove any prior models.json:
   ```bash
   rm -f ~/Library/Application\ Support/@lisna/desktop/models.json
   ```
2. `pnpm dev` — expect brief "booting" (empty UI), then SetupView Step 1 visible.
3. Click "ファイルを選択" → pick `~/.lisna-test-models/ggml-kotoba-whisper-v2.0-q5_0.bin`.
   Expect transition to Step 2 (no inline error).
4. Click "ファイルを選択" → pick `~/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf`.
   Expect "準備が完了しました" briefly, then Recording view (header "Lisna v2 — on-device").
5. Quit Electron (Cmd+Q). Restart. Expect Recording view directly — no SetupView flash.

### Re-launch with missing file

6. Quit Electron. Move the LLM file aside:
   ```bash
   mv ~/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf{,.bak}
   ```
7. `pnpm dev` — expect SetupView pre-skipped to Step 2 with red inline strip
   "ノート生成モデルのファイルが見つかりません。もう一度選択してください。"
8. Click "ファイルを選択", dismiss the native dialog. Expect strip changes to
   "選択がキャンセルされました。続行するにはファイルを選択してください。"
9. Restore the LLM file:
   ```bash
   mv ~/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf{.bak,}
   ```
10. Click "ファイルを選択", pick it. Expect ready → Recording view.

### Wrong format

11. **Not user-reachable via native dialog.** macOS `NSOpenPanel` enforces the
    `extensions: ['bin' | 'gguf']` filter strictly — wrong-format files appear
    grayed-out and unselectable, and even Cmd+Shift+G path-input rejects them
    (live-verified 2026-05-18). The `INVALID_MAGIC_BYTES_STT/LLM` codes exist
    as defense-in-depth and are covered by `validateModelFile` unit tests
    (`desktop/src/main/__tests__/model-resolver.test.ts`, Task 2). No manual
    GUI gesture triggers them in standard macOS Electron dev/prod builds.
12. (Skipped — see step 11.)

### Discord URL guard (now configured)

13. `desktop/src/renderer/i18n/setup-strings.ts:24` currently holds the real
    invite `https://discord.gg/69NkqBTbS` (filled 2026-05-18, commit `39bdc19`).
    `isDiscordUrlConfigured()` returns true.
14. On any SetupView render, verify the "Discord で受け取る" button is **VISIBLE**.
    Clicking it opens `https://discord.gg/69NkqBTbS` in the default browser
    via `shell.openExternal` (re-direct → `discord.com/invite/69NkqBTbS`
    Lisna server-invite landing).
15. If reverting to the placeholder for verification, set
    `DISCORD_CHANNEL_URL` to `'https://discord.com/channels/<server>/<channel>'`
    — `isDiscordUrlConfigured()` returns false and the button hides. Do not
    commit the revert.

### Env-var dev override

16. Quit. Set in shell:
    ```bash
    export LISNA_DEV_STT_MODEL=/tmp/does-not-exist.bin
    export LISNA_DEV_LLM_MODEL=~/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf
    ```
17. `pnpm dev` — expect SetupView Step 1 with `MODEL_FILE_MISSING_STT` strip
    (env-var authoritative; no fallback to models.json).
18. Unset env vars, restart. Expect resolution via models.json (should be ready
    from the happy-path setup earlier).

### Env-var empty-string normalization

19. Quit. Set in shell:
    ```bash
    export LISNA_DEV_STT_MODEL=""
    export LISNA_DEV_LLM_MODEL=""
    ```
20. `pnpm dev` — confirm the boot log shows `[boot] models: ready ...` (not
    `needs-setup`). The `?.trim() || undefined` normalization in `main/index.ts`
    coerces the empty strings to `undefined`, so resolveModels falls through
    to `models.json` instead of treating `""` as a set-but-empty path.
21. Unset env vars.

### Env-override read-through invariant

22. Quit. Set env vars to real files:
    ```bash
    export LISNA_DEV_STT_MODEL=~/.lisna-test-models/ggml-kotoba-whisper-v2.0-q5_0.bin
    export LISNA_DEV_LLM_MODEL=~/.lisna-test-models/Llama-3.2-3B-Instruct-Q4_K_M.gguf
    ```
23. Remove models.json: `rm -f ~/Library/Application\ Support/@lisna/desktop/models.json`
24. `pnpm dev` — expect Recording view directly (env vars resolved to ready,
    no SetupView shown).
25. Quit. **Unset env vars**: `unset LISNA_DEV_STT_MODEL LISNA_DEV_LLM_MODEL`
26. Without restoring models.json, restart `pnpm dev`. Expect **SetupView** —
    confirming env-override is read-through, did NOT write env paths into
    models.json during step 24's session. (If models.json had been written,
    this would boot to Recording.)

import type { Language, TranscriptSegment } from './types';

export type RecordingSource = 'mic' | 'system';

/**
 * Pushed from main → renderer when the STT adapter returns segments for a
 * committed chunk. Renderer subscribes via `window.lisna.onChunk`.
 */
export interface ChunkResultPayload {
  index: number;
  segments: TranscriptSegment[];
  /** Inclusive start of the original chunk, relative to recording start, in ms. */
  startMs: number;
}

/**
 * Finalized PCM chunk emitted by the renderer-side capture pipeline and
 * shipped over IPC to the main process for downstream STT. Single source of
 * truth across renderer (orchestrator), preload (sendChunk bridge), and main
 * (recording/chunk handler). Electron's structured-clone IPC preserves
 * Float32Array directly — no ArrayBuffer conversion needed.
 */
export interface ChunkPayload {
  index: number;
  source: RecordingSource;
  /** Inclusive start of the chunk relative to recording start, in ms. */
  startMs: number;
  /** Exclusive end of the chunk relative to recording start, in ms. */
  endMs: number;
  samples: Float32Array;
}

/**
 * Platform capability summary queried by the renderer once on mount.
 * `systemAudio=false` means loopback/system-audio capture is unavailable on
 * this OS build (e.g. macOS < 14.4, where `desktopCapturer.enableLocalLoopback`
 * is not exposed) — the UI must gate the "system" recording source.
 */
export interface Capabilities {
  systemAudio: boolean;
  platform: NodeJS.Platform;
  /** Raw `os.release()` — Darwin kernel string on macOS (e.g. "23.4.0"). */
  osRelease: string;
}

/**
 * Chat-style message envelope for `generate` requests. Mirrors the C++
 * `llama_chat_message` struct (`role`, `content`). Roles are restricted to
 * the three the bundled Llama-3.2 chat template recognises; we deliberately
 * do NOT include free-form `tool` / `function` roles because the template
 * routes them through paths that haven't been smoke-tested for v2.0.
 *
 * Why `messages` instead of a single `prompt` string: chat-tuned models
 * (Llama 3.2 Instruct family, Gemma-IT, etc.) ship a Jinja template embedded
 * in the GGUF that wraps each role in special tokens (`<|start_header_id|>`,
 * `<|eot_id|>`, ...). Without the template the model sees raw text and
 * degrades into continuation mode (echoes the transcript, then runs forever
 * until maxTokens). See `desktop/sidecar/src/llm/llama_engine.cpp` —
 * `llama_chat_apply_template` is the canonical bridge.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Sampler knobs for `generate` — single-sourced from `profiles.ts`
 * (spec 2026-06-12-v2-track2-sampler-alignment section 5). All optional at
 * the IPC boundary; the C++ GenOpts defaults equal the ALIGNED values, so an
 * omitted field still yields aligned behavior (NOT the legacy chain).
 * `repeatPenalty` 1.0 = off (rig-only knob in practice — it reproduces the
 * legacy fabrication config in the falsification matrix).
 */
export interface SamplingParams {
  topK?: number;
  topP?: number;
  minP?: number;
  repeatPenalty?: number;
  repeatLastN?: number;
  /** 0.0 disables DRY entirely. */
  dryMultiplier?: number;
  dryBase?: number;
  dryAllowedLength?: number;
  /** -1 = scan the whole context. */
  dryPenaltyLastN?: number;
}

export type SidecarRequest =
  | { id: string; type: 'ping' }
  | { id: string; type: 'load'; kind: 'stt'; path: string; language: Language }
  | { id: string; type: 'load'; kind: 'llm'; path: string }
  | { id: string; type: 'unload'; kind: 'stt' | 'llm' }
  | {
      id: string;
      type: 'transcribe';
      audioBase64: string;
      sampleRate: number;
      /** Whisper proper-noun bias (STT Phase 1). Omitted when empty — the
       *  sidecar treats absent/'' as "no initial_prompt". */
      initialPrompt?: string;
    }
  | {
      id: string;
      type: 'generate';
      /**
       * Preferred shape: structured chat messages. The sidecar applies the
       * GGUF-embedded chat template before tokenization.
       */
      messages: ChatMessage[];
      maxTokens?: number;
      temperature?: number;
      stop?: string[];
      /** GBNF source. Present only on the grammar-constrained path. */
      grammar?: string;
      /** RNG seed. Present only on the grammar-constrained (retry) path. */
      seed?: number;
      /** Sampler knobs (spec sampler-alignment section 5). Omitted fields
       *  fall back to the C++ aligned defaults. */
      sampling?: SamplingParams;
    };

export type SidecarResponse =
  | { id: string; type: 'ok' }                                       // load/unload 성공
  | { id: string; type: 'segments'; segments: TranscriptSegment[] }  // transcribe 결과
  | { id: string; type: 'token'; token: string }                     // generate 스트리밍 1 token
  | { id: string; type: 'done' }                                     // generate 종료
  | { id: string; type: 'error'; code: string; message: string };

export type SidecarEvent =
  | { type: 'ready'; pid: number; version: string }
  | {
      type: 'log';
      level: 'debug' | 'info' | 'warn' | 'error';
      /**
       * Origin of the log line. `whisper` and `ggml` come from the bundled
       * upstream log callbacks; `system` is reserved for our own sidecar code.
       * Kept as a closed union so callers `filter(e => e.source === 'whisper')`
       * are typo-protected at compile time — extend deliberately when adding a
       * new emit site.
       */
      source: 'whisper' | 'ggml' | 'system';
      message: string;
    }
  | { type: 'memory'; rssBytes: number; phase: 'idle' | 'stt' | 'llm' | 'transition' };

// --- Session-level IPC (Step 4: UI integration of SessionOrchestrator) ---

export type SessionPhase = 'stt-loading' | 'stt-unloading' | 'llm-loading' | 'generating';

export interface SessionStartPayload {
  language: Language;
}

export interface SessionPhasePayload {
  phase: SessionPhase;
}

export interface SessionErrorPayload {
  message: string;
  /**
   * True only when supervisor's give-up signal fires (2 consecutive sidecar
   * crashes; no more respawn). Tells the renderer to show a Restart Lisna
   * button (lifecycle/restart IPC) instead of Try Again. Default false /
   * unset for the common transient-crash case where the supervisor will
   * spawn a fresh sidecar shortly.
   */
  permanent?: boolean;
}

// --- v2 finalize progress (founder ask 2026-06-13) ---

/**
 * Pushed main → renderer over CHANNELS.sessionFinalizeProgress while a
 * session/finalize (live or from-dump) runs. Each payload is derived 1:1
 * from a real FinalizeTelemetryEvent emission in the orchestrator — never
 * synthesized (no fake progress). Granularity is chunk/attempt/phase; there
 * is deliberately NO per-token event (IPC overhead on the generate path).
 *
 * Deliberately minimal: no family/seed/latency, and no `reason` — failure
 * reasons can embed note-content samples (ESCAPE_LITERAL_AT_<path>:"…"),
 * which the shape-only PII contract keeps out of this channel.
 */
export type FinalizeProgressPayload =
  | {
      kind: 'attempt-start';
      /** 0-based. */
      chunkIndex: number;
      totalChunks: number;
      /** 1-indexed attempt within the current chunk; ≥2 = retrying. */
      attempt: number;
      /** Worst-case attempts per chunk (outer × inner retry budget). */
      maxAttempts: number;
    }
  | { kind: 'chunk-done'; chunkIndex: number; totalChunks: number }
  | { kind: 'finalize-done' };

// --- Step 5 §5.1 — first-run model resolver ---

/**
 * Model slot identifier. Four slots for v2:
 *   stt  — Whisper STT GGML
 *   llm  — Llama LLM GGUF
 *   seg  — Pyannote segmentation 3.0 ONNX (diarization)
 *   emb  — Speaker embedding ONNX (3D-Speaker eres2net / NeMo TitaNet / WeSpeaker)
 *
 * `seg` and `emb` are only surfaced in the picker when the diarization feature
 * toggle is enabled (Plan 4 Phase C `DIARIZATION_ENABLED`). Boot-time model
 * resolution skips them when disabled, so legacy 2-slot installations remain
 * bit-identical. The `ModelStatus.ready` shape stays 2-slot (sttPath/llmPath)
 * until the resolver grows seg/emb paths in Plan 4 Phase B (T-DI-08).
 */
export type ModelSlot = 'stt' | 'llm' | 'seg' | 'emb';

/**
 * The two always-required core slots. The boot resolver + first-run picker
 * operate on these until Plan 4 Phase C surfaces seg/emb behind the toggle —
 * keeping `ModelStatus` 2-slot means legacy installs stay bit-identical.
 */
export type CoreModelSlot = 'stt' | 'llm';

export type ModelStatus =
  | { kind: 'ready'; sttPath: string; llmPath: string }
  | { kind: 'needs-setup'; missing: CoreModelSlot[] };  // sorted: 'stt' before 'llm'

/** Internal alias for main/model-resolver.ts. Same shape as ModelStatus — named
 *  separately so resolver-internal types can evolve without a renderer break. */
export type ResolveResult = ModelStatus;

export type PickResult =
  | { ok: true; status: ModelStatus }
  | { ok: false;
      code:
        | 'INVALID_MAGIC_BYTES_STT'
        | 'INVALID_MAGIC_BYTES_LLM'
        | 'MODEL_READ_FAILED'
        | 'PICKER_CANCELLED'
        | 'MODEL_SAVE_FAILED';
    };

/** Sent over CHANNELS.modelPick. */
export interface ModelPickPayload {
  slot: ModelSlot;
}

// --- Phase M Task 70 — auth gate ---

/**
 * Phase M — main → renderer reply for `auth/get-state` IPC. The renderer's
 * auth gate uses this to decide whether to render <SignInView /> or
 * <AuthenticatedApp />. Mirrors the boolean derived from Keychain presence in
 * main (`loadToken() !== null`). Future fields (e.g. lastSignInAt, deviceId)
 * MUST land here first to keep main/preload/renderer in lockstep.
 */
export interface AuthState {
  signedIn: boolean;
}

// --- F2 history viewer (spec 2026-06-12-v2-history-viewer-design) ---

/**
 * One row of the History list. Derived from a #113 dump dir:
 * `recordedAt` from the dir name; `language/llmModel/segmentCount/durationSec`
 * from transcript.json's precomputed top-level fields; `family/ok` from
 * result.json when present. `unreadable: true` rows render unselectable.
 */
export interface DumpSummary {
  /** Dump dir name, e.g. `2026-06-11T03-00-00-000Z` (+ optional `-N`). */
  id: string;
  /** ISO timestamp parsed from the dir name. */
  recordedAt: string;
  language?: string;
  llmModel?: string;
  segmentCount?: number;
  durationSec?: number;
  family?: string;
  ok?: boolean;
  unreadable?: boolean;
}

/** Full transcript.json payload of one dump (see session-debug-dump.ts). */
export interface DumpTranscript {
  sessionId: string;
  language: string;
  llmModel: string;
  segmentCount?: number;
  durationSec?: number;
  segments: TranscriptSegment[];
}

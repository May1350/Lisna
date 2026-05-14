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

export type SidecarRequest =
  | { id: string; type: 'ping' }
  | { id: string; type: 'load'; kind: 'stt'; path: string; language: Language }
  | { id: string; type: 'load'; kind: 'llm'; path: string }
  | { id: string; type: 'unload'; kind: 'stt' | 'llm' }
  | { id: string; type: 'transcribe'; audioBase64: string; sampleRate: number }
  | { id: string; type: 'generate'; prompt: string; maxTokens?: number; temperature?: number; stop?: string[] };

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

import type { Language, TranscriptSegment } from './types';

export type RecordingSource = 'mic' | 'system';

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
      /** Origin of the log line — set by the sidecar to disambiguate whisper.cpp / ggml internal logs from our own. */
      source: string;
      message: string;
    }
  | { type: 'memory'; rssBytes: number; phase: 'idle' | 'stt' | 'llm' | 'transition' };

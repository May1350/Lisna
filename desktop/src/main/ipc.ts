import os from 'node:os';
import { ipcMain } from 'electron';
import type { Capabilities, ChunkPayload, ChunkResultPayload } from '@shared/ipc-protocol';
import type { STTEngine } from '@shared/engine-interfaces';
import { isMacAudioLoopbackSupported } from './platform/hardware-check';

export const CHANNELS = {
  startRecording: 'recording/start',
  stopRecording: 'recording/stop',
  /** renderer → main: a finalized PCM chunk for downstream STT */
  chunk: 'recording/chunk',
  /** main → renderer: STT result segments pushed back after each chunk */
  onChunk: 'recording/chunk-result',
  /** renderer → main: query platform capabilities on mount (sync, cheap) */
  capabilities: 'platform/capabilities',
  /** renderer → main: create SessionOrchestrator + load STT */
  sessionStart: 'session/start',
  /** renderer → main: orch.stop() returning Note */
  sessionStop: 'session/stop',
  /** main → renderer: phase indicator during long awaits */
  sessionPhase: 'session/phase',
  /** main → renderer: sidecar crashed mid-session */
  sessionError: 'session/error',
} as const;

export interface IpcDeps {
  stt?: STTEngine;
}

/**
 * Exported for unit testing — the pure chunk handler logic without ipcMain
 * registration. Tests drive this directly with a fake IpcMainInvokeEvent and
 * a stub STTEngine.
 */
export async function handleChunk(
  event: { sender: { send: (channel: string, payload: ChunkResultPayload) => void } },
  payload: ChunkPayload,
  deps: IpcDeps,
): Promise<{ ok: boolean }> {
  console.log('chunk received', payload.index, payload.samples.length, 'samples');

  if (!deps.stt) {
    // STT not loaded (LISNA_DEV_STT_MODEL unset or failed to load) — no-op gracefully.
    return { ok: true };
  }

  try {
    const segments = await deps.stt.transcribe(payload.samples);
    const result: ChunkResultPayload = {
      index: payload.index,
      segments,
      startMs: payload.startMs,
    };
    event.sender.send(CHANNELS.onChunk, result);
  } catch (err) {
    // One failed chunk must not break the session — log and allow next chunk.
    console.error('[stt] transcribe error on chunk', payload.index, err);
  }

  return { ok: true };
}

export function registerIpc(deps: IpcDeps) {
  ipcMain.handle(CHANNELS.startRecording, async (_e, opts: { source: 'mic' | 'system' }) => {
    // Phase 1 후속 task 에서 audio/index.ts 의 startRecording 호출로 교체
    return { ok: true, source: opts.source };
  });
  ipcMain.handle(CHANNELS.stopRecording, async () => ({ ok: true }));
  ipcMain.handle(CHANNELS.chunk, (e, payload: ChunkPayload) => handleChunk(e, payload, deps));
  ipcMain.handle(CHANNELS.capabilities, (): Capabilities => ({
    systemAudio: isMacAudioLoopbackSupported(),
    platform: process.platform,
    osRelease: os.release(),
  }));
}

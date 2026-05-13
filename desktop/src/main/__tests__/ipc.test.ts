/**
 * Unit tests for the chunk handler in ipc.ts.
 *
 * Uses `handleChunk` exported for testability — no real ipcMain or Electron
 * needed. Tests use a stub event (with a `sender.send` spy) and a fake STTEngine.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleChunk, CHANNELS } from '../ipc';
import type { ChunkPayload } from '../../shared/ipc-protocol';
import type { STTEngine } from '../../shared/engine-interfaces';
import type { TranscriptSegment } from '../../shared/types';

// handleChunk imports isMacAudioLoopbackSupported via ipc.ts → the real module
// is fine here because handleChunk does not call it. But ipc.ts does import
// ipcMain from electron at module load time, so we mock electron.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  default: {},
}));

// node:os is imported by ipc.ts for the capabilities handler — mock it so the
// import doesn't fail in vitest's Node environment.
vi.mock('node:os', () => ({
  default: { release: () => '24.0.0' },
}));

// hardware-check uses process.platform; mock it to avoid import side-effects.
vi.mock('../platform/hardware-check', () => ({
  isMacAudioLoopbackSupported: vi.fn().mockReturnValue(false),
}));

// Minimal stub for IpcMainInvokeEvent.sender
function makeEvent() {
  return {
    sender: {
      send: vi.fn<(channel: string, payload: unknown) => void>(),
    },
  };
}

// Minimal ChunkPayload
function makeChunk(overrides: Partial<ChunkPayload> = {}): ChunkPayload {
  return {
    index: 0,
    source: 'mic',
    startMs: 0,
    endMs: 2000,
    samples: new Float32Array([0.1, 0.2, 0.3]),
    ...overrides,
  };
}

// Fake STTEngine that resolves with provided segments
function makeFakeSTT(segments: TranscriptSegment[]): STTEngine {
  return {
    loadModel: vi.fn().mockResolvedValue(undefined),
    unloadModel: vi.fn().mockResolvedValue(undefined),
    transcribe: vi.fn().mockResolvedValue(segments),
  };
}

describe('handleChunk — with STT loaded', () => {
  it('calls stt.transcribe with the chunk samples', async () => {
    const event = makeEvent();
    const samples = new Float32Array([0.5, -0.5, 0.0]);
    const chunk = makeChunk({ index: 3, startMs: 6000, samples });
    const segments: TranscriptSegment[] = [{ startSec: 0, endSec: 1.2, text: 'こんにちは' }];
    const stt = makeFakeSTT(segments);

    await handleChunk(event, chunk, { stt });

    expect(stt.transcribe).toHaveBeenCalledWith(samples);
  });

  it('pushes ChunkResultPayload to event.sender.send on the onChunk channel', async () => {
    const event = makeEvent();
    const chunk = makeChunk({ index: 7, startMs: 14000 });
    const segments: TranscriptSegment[] = [
      { startSec: 0, endSec: 1.5, text: 'テスト' },
      { startSec: 1.5, endSec: 3.0, text: '音声' },
    ];
    const stt = makeFakeSTT(segments);

    await handleChunk(event, chunk, { stt });

    expect(event.sender.send).toHaveBeenCalledTimes(1);
    expect(event.sender.send).toHaveBeenCalledWith(CHANNELS.onChunk, {
      index: 7,
      segments,
      startMs: 14000,
    });
  });

  it('returns { ok: true } even when stt is provided', async () => {
    const event = makeEvent();
    const stt = makeFakeSTT([]);
    const result = await handleChunk(event, makeChunk(), { stt });
    expect(result).toEqual({ ok: true });
  });

  it('logs error and skips send when transcribe throws — does not rethrow', async () => {
    const event = makeEvent();
    const stt: STTEngine = {
      loadModel: vi.fn(),
      unloadModel: vi.fn(),
      transcribe: vi.fn().mockRejectedValue(new Error('sidecar crashed')),
    };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await handleChunk(event, makeChunk({ index: 2 }), { stt });

    expect(result).toEqual({ ok: true });
    expect(event.sender.send).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[stt]'),
      expect.anything(),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});

describe('handleChunk — without STT (graceful degrade)', () => {
  it('returns { ok: true } without calling send', async () => {
    const event = makeEvent();
    const result = await handleChunk(event, makeChunk(), {});
    expect(result).toEqual({ ok: true });
    expect(event.sender.send).not.toHaveBeenCalled();
  });

  it('returns { ok: true } when deps is explicitly { stt: undefined }', async () => {
    const event = makeEvent();
    const result = await handleChunk(event, makeChunk(), { stt: undefined });
    expect(result).toEqual({ ok: true });
    expect(event.sender.send).not.toHaveBeenCalled();
  });
});

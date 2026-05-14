import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChunkPayload } from '@shared/ipc-protocol';

// Mock electron's ipcMain — capture the handlers registered so tests can invoke them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ipcHandlers: Record<string, (e: any, payload: any) => Promise<any>> = {};
vi.mock('electron', () => ({
  ipcMain: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handle: vi.fn((channel: string, handler: any) => {
      ipcHandlers[channel] = handler;
    }),
  },
}));

// Mock the adapter constructors — they're constructed per-session inside the
// handler. Tests assert on construction calls + capture the instances passed
// into SessionOrchestrator.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeSttInstances: any[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeLlmInstances: any[] = [];
vi.mock('../engines/whisper-cpp-stt', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  WhisperCppSTT: vi.fn().mockImplementation(function (this: any, client: any) {
    this.client = client;
    this.loadModel = vi.fn(async () => {});
    this.unloadModel = vi.fn(async () => {});
    this.transcribe = vi.fn(async () => [{ startSec: 0, endSec: 1, text: 'こんにちは' }]);
    fakeSttInstances.push(this);
  }),
}));
vi.mock('../engines/llama-cpp-llm', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  LlamaCppLLM: vi.fn().mockImplementation(function (this: any, client: any) {
    this.client = client;
    this.loadModel = vi.fn(async () => {});
    this.unloadModel = vi.fn(async () => {});
    this.generate = vi.fn(async function* () { yield 'Note '; yield 'body'; });
    fakeLlmInstances.push(this);
  }),
}));

// Helpers to build a fake supervisor + window.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeSupervisor(client: any = {}) {
  return {
    getClient: vi.fn(() => client),
    start: vi.fn(),
    shutdown: vi.fn(async () => {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeFakeWindow() {
  const send = vi.fn();
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    win: { isDestroyed: () => false, webContents: { send } } as any,
    send,
  };
}

// IMPORTANT: import the module AFTER mocks are set up. Use dynamic import inside
// beforeEach so each test gets a fresh module state (current=null, recording=false).
let ipc: typeof import('../ipc');

describe('main/ipc FSM', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    fakeSttInstances.length = 0;
    fakeLlmInstances.length = 0;
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k]);
    vi.resetModules();
    ipc = await import('../ipc');
  });

  it('double session/start → second rejects SESSION_ACTIVE', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, sttModelPath: '/s', llmModelPath: '/l' });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).rejects.toThrow('SESSION_ACTIVE');
  });

  it('recording/chunk before session/start → silent no-op', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, sttModelPath: '/s', llmModelPath: '/l' });
    const payload: ChunkPayload = {
      index: 0, source: 'mic', startMs: 0, endMs: 2000, samples: new Float32Array(32000),
    };
    const event = { sender: { send: vi.fn() } };
    const result = await ipcHandlers['recording/chunk']!(event, payload);
    expect(result).toEqual({ ok: true });
    expect(event.sender.send).not.toHaveBeenCalled();
  });

  it('session/start with missing env paths → MODELS_NOT_CONFIGURED', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, sttModelPath: undefined, llmModelPath: '/l' });
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).rejects.toThrow('MODELS_NOT_CONFIGURED');
  });

  it('session/start with language !== ja → UNSUPPORTED_LANGUAGE', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, sttModelPath: '/s', llmModelPath: '/l' });
    await expect(ipcHandlers['session/start']!({}, { language: 'en' })).rejects.toThrow('UNSUPPORTED_LANGUAGE');
  });

  it('session/start when supervisor.getClient() returns null → SIDECAR_DOWN', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor(null);
    ipc.registerIpc({ getMainWindow: () => win, supervisor, sttModelPath: '/s', llmModelPath: '/l' });
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).rejects.toThrow('SIDECAR_DOWN');
  });

  it('session/start pushes stt-loading phase BEFORE orch.start awaits', async () => {
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, sttModelPath: '/s', llmModelPath: '/l' });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    const firstSend = send.mock.calls[0];
    expect(firstSend).toEqual(['session/phase', { phase: 'stt-loading' }]);
  });

  it('session/stop with current === null → NO_ACTIVE_SESSION', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, sttModelPath: '/s', llmModelPath: '/l' });
    await expect(ipcHandlers['session/stop']!({}, undefined)).rejects.toThrow('NO_ACTIVE_SESSION');
  });

  it('session/stop emits stt-unloading, llm-loading, generating phases in order', async () => {
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, sttModelPath: '/s', llmModelPath: '/l' });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    await ipcHandlers['session/stop']!({}, undefined);
    const phases = send.mock.calls
      .filter((c) => c[0] === 'session/phase')
      .map((c) => c[1].phase);
    expect(phases).toEqual(['stt-loading', 'stt-unloading', 'llm-loading', 'generating']);
  });

  it('handleSidecarExit clears flags + pushes session/error when session active', async () => {
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, sttModelPath: '/s', llmModelPath: '/l' });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    send.mockClear();
    ipc.handleSidecarExit();
    expect(send).toHaveBeenCalledWith('session/error', expect.objectContaining({ message: expect.any(String) }));
    // Subsequent session/stop should reject (state cleared)
    await expect(ipcHandlers['session/stop']!({}, undefined)).rejects.toThrow('NO_ACTIVE_SESSION');
  });

  it('handleSidecarExit when idle → no session/error push', async () => {
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, sttModelPath: '/s', llmModelPath: '/l' });
    ipc.handleSidecarExit();
    expect(send).not.toHaveBeenCalled();
  });

  it('adapter freshness across sequential session/start (respawn pattern)', async () => {
    const { win } = makeFakeWindow();
    const clientA = { id: 'A' };
    const clientB = { id: 'B' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supervisor: any = {
      getClient: vi.fn().mockReturnValueOnce(clientA).mockReturnValueOnce(clientB),
      start: vi.fn(),
      shutdown: vi.fn(),
    };
    ipc.registerIpc({ getMainWindow: () => win, supervisor, sttModelPath: '/s', llmModelPath: '/l' });
    // First session
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    await ipcHandlers['session/stop']!({}, undefined);
    // Second session — supervisor.getClient now returns clientB (simulating respawn)
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    expect(fakeSttInstances).toHaveLength(2);
    expect(fakeSttInstances[0].client).toBe(clientA);
    expect(fakeSttInstances[1].client).toBe(clientB);
  });
});

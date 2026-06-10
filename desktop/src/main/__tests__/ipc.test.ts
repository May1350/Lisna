import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChunkPayload } from '@shared/ipc-protocol';

// Mock electron's ipcMain — capture the handlers registered so tests can invoke them.
// Also mock app.relaunch/quit so the restart IPC handler doesn't actually kill
// the test process; tests assert the calls landed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ipcHandlers: Record<string, (e: any, payload: any) => Promise<any>> = {};
const appRelaunch = vi.fn();
const appQuit = vi.fn();
vi.mock('electron', () => ({
  ipcMain: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handle: vi.fn((channel: string, handler: any) => {
      ipcHandlers[channel] = handler;
    }),
  },
  app: {
    relaunch: (...args: unknown[]) => appRelaunch(...args),
    quit: (...args: unknown[]) => appQuit(...args),
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
    appRelaunch.mockClear();
    appQuit.mockClear();
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k]);
    vi.resetModules();
    ipc = await import('../ipc');
  });

  it('double session/start → second rejects SESSION_ACTIVE', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).rejects.toThrow('SESSION_ACTIVE');
  });

  // Discard route (2026-06-10, founder request): Stop previously forced every
  // session into the note pipeline — an empty/unwanted recording locked the
  // FSM (next Start hit SESSION_ACTIVE forever). Discard clears the session
  // without finalize.
  it('session/discard clears the session → next session/start succeeds', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    await ipcHandlers['session/discard']!({}, undefined);
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).resolves.toBeUndefined();
  });

  it('session/discard is a safe no-op with no active session', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    await expect(ipcHandlers['session/discard']!({}, undefined)).resolves.toBeUndefined();
  });

  // P0-3 (2026-06-09) — failure path PRESERVES the orchestrator so the
  // ErrorView retry can re-invoke session/finalize against the SAME
  // accumulated transcript. The previous contract was "any settled =
  // clear" (so UNKNOWN_FAMILY garbage was followed by a fresh start);
  // the new contract is "ONLY success clears." A retry without an
  // intervening successful finalize must hit SESSION_ACTIVE — the user's
  // expected mental model is "the recording is still mine until I either
  // get a note OR explicitly restart." See memory
  // v2_30min_real_record_3_p0s_2026-06-09 for the founder-loss incident
  // this fixes.
  it('session/finalize FAILURE preserves current (P0-3) → next session/start rejects SESSION_ACTIVE', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    await expect(ipcHandlers['session/finalize']!({}, { family: 'garbage' }))
      .rejects.toThrow(/UNKNOWN_FAMILY/);
    // Orchestrator preserved → next session/start refused, NOT idle.
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' }))
      .rejects.toThrow('SESSION_ACTIVE');
  });

  // The dual of the test above: if the sidecar exits (crash OR app close),
  // handleSidecarExit clears `current` — so the user CAN start a fresh
  // session after a crash without restarting the app. This is the escape
  // hatch from "orchestrator stuck forever" if a finalize keeps failing.
  it('handleSidecarExit clears current → next session/start succeeds (escape hatch)', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    await expect(ipcHandlers['session/finalize']!({}, { family: 'garbage' }))
      .rejects.toThrow(/UNKNOWN_FAMILY/);
    // Sidecar crashes → handleSidecarExit fires → cache + current cleared.
    ipc.handleSidecarExit();
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' }))
      .resolves.toBeUndefined();
  });

  it('recording/chunk before session/start → silent no-op', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
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
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => null });
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).rejects.toThrow('MODELS_NOT_CONFIGURED');
  });

  it('session/start rejects un-eval\'d languages (ko/zh) → UNSUPPORTED_LANGUAGE', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    await expect(ipcHandlers['session/start']!({}, { language: 'ko' })).rejects.toThrow('UNSUPPORTED_LANGUAGE');
    await expect(ipcHandlers['session/start']!({}, { language: 'zh' })).rejects.toThrow('UNSUPPORTED_LANGUAGE');
  });

  it('session/start accepts en (minimal EN support, 2026-06-10)', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    // Resolves (no UNSUPPORTED_LANGUAGE) — full start-path behavior is
    // covered by the ja FSM tests; language only changes the gate + STT load.
    await expect(ipcHandlers['session/start']!({}, { language: 'en' })).resolves.toBeUndefined();
  });

  it('session/start when supervisor.getClient() returns null → SIDECAR_DOWN', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor(null);
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).rejects.toThrow('SIDECAR_DOWN');
  });

  it('session/start pushes stt-loading phase BEFORE orch.start awaits', async () => {
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    const firstSend = send.mock.calls[0];
    expect(firstSend).toEqual(['session/phase', { phase: 'stt-loading' }]);
  });

  it('session/stop with current === null → NO_ACTIVE_SESSION', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    await expect(ipcHandlers['session/stop']!({}, undefined)).rejects.toThrow('NO_ACTIVE_SESSION');
  });

  it('session/stop while recording === false (start in flight) → SESSION_NOT_READY', async () => {
    // Slow STT loadModel — never resolves during this test — so session/start
    // remains awaiting (current=orch, recording=false).
    let resolveStartAwait: (() => void) | undefined;
    const slowLoad = new Promise<void>((r) => { resolveStartAwait = r; });
    const sttModule = await import('../engines/whisper-cpp-stt');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sttModule.WhisperCppSTT as any).mockImplementationOnce(function (this: any) {
      this.loadModel = vi.fn(() => slowLoad);
      this.unloadModel = vi.fn(async () => {});
      this.transcribe = vi.fn();
    });

    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    // Fire session/start but don't await — it's hanging on slowLoad.
    const startPromise = ipcHandlers['session/start']!({}, { language: 'ja' });
    // At this point: current=orch (set sync before await), recording=false (await orch.start not yet resolved).
    await expect(ipcHandlers['session/stop']!({}, undefined)).rejects.toThrow('SESSION_NOT_READY');
    // Cleanup: resolve the hanging load so startPromise can complete.
    resolveStartAwait!();
    await startPromise;
  });

  // R3 polish: end-to-end EMPTY_TRANSCRIPT through the ipc.ts handler boundary.
  // The orchestrator unit test (sidecar/__tests__/orchestrator.test.ts) covers
  // the throw mechanic; this one covers the integration:
  //   - session/start succeeds, then
  //   - session/stop fires WITHOUT any chunks having been fed, →
  //   - the handler propagates EMPTY_TRANSCRIPT through the IPC contract, AND
  //   - module state is cleared so the next session/start can claim it.
  it('session/stop with no chunks fed → EMPTY_TRANSCRIPT bubbles through handler + state reset', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    // No `recording/chunk` calls → segments is empty when stop fires.
    await expect(ipcHandlers['session/stop']!({}, undefined)).rejects.toThrow('EMPTY_TRANSCRIPT');
    // Post-rejection: state must be cleared (finally block runs even on
    // EMPTY_TRANSCRIPT throw). A second session/start succeeding proves it.
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).resolves.toBeUndefined();
  });

  it('session/stop emits stt-unloading, llm-loading, generating phases in order', async () => {
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    // Feed one chunk so segments isn't empty (M1 EMPTY_TRANSCRIPT guard would
    // otherwise throw before reaching the llm-loading / generating phases).
    await ipcHandlers['recording/chunk']!(
      { sender: { send: vi.fn() } },
      { index: 0, source: 'mic', startMs: 0, endMs: 2000, samples: new Float32Array(32000) },
    );
    await ipcHandlers['session/stop']!({}, undefined);
    const phases = send.mock.calls
      .filter((c) => c[0] === 'session/phase')
      .map((c) => c[1].phase);
    expect(phases).toEqual(['stt-loading', 'stt-unloading', 'llm-loading', 'generating']);
  });

  it('handleSidecarExit clears flags + pushes session/error when session active (no handler in-flight)', async () => {
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    send.mockClear();
    // session/start has resolved, so _sessionHandlerInFlight is false.
    // Sidecar crash here = "user has been recording, now sidecar died." Push expected.
    ipc.handleSidecarExit();
    expect(send).toHaveBeenCalledWith('session/error', expect.objectContaining({ message: expect.any(String) }));
    // Subsequent session/stop should reject (state cleared by handleSidecarExit)
    await expect(ipcHandlers['session/stop']!({}, undefined)).rejects.toThrow('NO_ACTIVE_SESSION');
  });

  it('handleSidecarExit when idle → no session/error push', async () => {
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    ipc.handleSidecarExit();
    expect(send).not.toHaveBeenCalled();
  });

  // C2 regression: sidecar crash mid-session/stop. Two error paths converge:
  // (a) supervisor.onExit → handleSidecarExit (synchronous), and (b) the
  // in-flight orch.stop rejects → session/stop IPC promise rejects (microtask).
  // Without the _sessionHandlerInFlight guard in handleSidecarExit, BOTH would
  // surface to the renderer → two transitions to ErrorView (and the second
  // could clobber preserved transcript segments). With the guard:
  // handleSidecarExit observes _sessionHandlerInFlight=true and skips the push,
  // letting the IPC rejection alone surface the error.
  it('sidecar crash mid-session/stop → only handler rejects, no duplicate session/error push', async () => {
    const llmModule = await import('../engines/llama-cpp-llm');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (llmModule.LlamaCppLLM as any).mockImplementationOnce(function (this: any) {
      this.loadModel = vi.fn(async () => {});
      this.unloadModel = vi.fn(async () => {});
      // eslint-disable-next-line require-yield -- intentional: simulate immediate throw before any token
      this.generate = vi.fn(async function* () {
        throw new Error('sidecar process exited');
      });
    });

    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    // Feed one chunk so segments isn't empty (avoids M1 EMPTY_TRANSCRIPT guard).
    await ipcHandlers['recording/chunk']!(
      { sender: { send: vi.fn() } },
      { index: 0, source: 'mic', startMs: 0, endMs: 2000, samples: new Float32Array(32000) },
    );
    send.mockClear();
    // Simulate: session/stop in flight, supervisor.onExit fires while orch.stop is awaiting.
    const stopPromise = ipcHandlers['session/stop']!({}, undefined);
    ipc.handleSidecarExit();
    await expect(stopPromise).rejects.toThrow('sidecar process exited');
    const errorPushes = send.mock.calls.filter((c) => c[0] === 'session/error');
    expect(errorPushes).toEqual([]);  // handler rejection was the only error surface
  });

  // Same C2 invariant on the start side: sidecar crash mid-session/start.
  it('sidecar crash mid-session/start → only handler rejects, no duplicate session/error push', async () => {
    let resolveStartAwait: (() => void) | undefined;
    let rejectStartAwait: ((err: Error) => void) | undefined;
    const hangingLoad = new Promise<void>((res, rej) => {
      resolveStartAwait = res;
      rejectStartAwait = rej;
    });
    const sttModule = await import('../engines/whisper-cpp-stt');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sttModule.WhisperCppSTT as any).mockImplementationOnce(function (this: any) {
      this.loadModel = vi.fn(() => hangingLoad);
      this.unloadModel = vi.fn(async () => {});
      this.transcribe = vi.fn();
    });

    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    const startPromise = ipcHandlers['session/start']!({}, { language: 'ja' });
    send.mockClear();
    // Supervisor.onExit fires while orch.start is awaiting stt.loadModel.
    ipc.handleSidecarExit();
    // Now make the loadModel reject (simulating client.rejectAllPending).
    rejectStartAwait!(new Error('sidecar process exited'));
    await expect(startPromise).rejects.toThrow('sidecar process exited');
    const errorPushes = send.mock.calls.filter((c) => c[0] === 'session/error');
    expect(errorPushes).toEqual([]);
    // Cleanup: resolve in case the test framework reuses.
    resolveStartAwait!();
  });

  // --- Step 5 §3.6 permanent give-up recovery ---

  it('handleSidecarGiveUp pushes session/error with permanent=true and clears state', async () => {
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    send.mockClear();
    ipc.handleSidecarGiveUp();
    expect(send).toHaveBeenCalledWith(
      'session/error',
      expect.objectContaining({ permanent: true, message: expect.any(String) }),
    );
    // State must be cleared so any in-flight state is consistent.
    await expect(ipcHandlers['session/stop']!({}, undefined)).rejects.toThrow('NO_ACTIVE_SESSION');
  });

  it('session/start after handleSidecarGiveUp rejects with SIDECAR_GAVE_UP (not SIDECAR_DOWN)', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    ipc.handleSidecarGiveUp();
    // Even though supervisor.getClient() returns truthy here (the mock), the
    // give-up flag must short-circuit BEFORE the SIDECAR_DOWN check so the
    // renderer can distinguish transient vs terminal state.
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).rejects.toThrow('SIDECAR_GAVE_UP');
  });

  it('handleSidecarGiveUp from idle state still pushes the permanent error', async () => {
    // Different from handleSidecarExit (which silently no-ops when idle). The
    // give-up signal MUST surface to the renderer even if no session was active,
    // because the user's next click would otherwise hit SIDECAR_GAVE_UP without
    // context. Tells them to restart up-front.
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    ipc.handleSidecarGiveUp();
    expect(send).toHaveBeenCalledWith(
      'session/error',
      expect.objectContaining({ permanent: true }),
    );
  });

  it('lifecycle/restart IPC handler calls app.relaunch then app.quit', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    expect(ipcHandlers['lifecycle/restart']).toBeDefined();
    await ipcHandlers['lifecycle/restart']!({}, undefined);
    expect(appRelaunch).toHaveBeenCalledTimes(1);
    expect(appQuit).toHaveBeenCalledTimes(1);
    // relaunch must be called BEFORE quit — quit will dispatch before-quit,
    // which would un-schedule a later relaunch.
    expect(appRelaunch.mock.invocationCallOrder[0]).toBeLessThan(
      appQuit.mock.invocationCallOrder[0]!,
    );
  });

  it('handleSidecarExit (transient) sends permanent=undefined (NOT permanent=true)', async () => {
    // Regression guard: handleSidecarExit is the transient crash path; the
    // payload MUST NOT carry permanent=true, or the renderer would
    // mis-render the restart button. Only handleSidecarGiveUp tags it.
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    send.mockClear();
    ipc.handleSidecarExit();
    const errCall = send.mock.calls.find((c) => c[0] === 'session/error');
    expect(errCall).toBeDefined();
    expect(errCall![1]).not.toHaveProperty('permanent', true);
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
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: '/s', llmPath: '/l' }) });
    // First session — feed a chunk to avoid M1 EMPTY_TRANSCRIPT guard.
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    await ipcHandlers['recording/chunk']!(
      { sender: { send: vi.fn() } },
      { index: 0, source: 'mic', startMs: 0, endMs: 2000, samples: new Float32Array(32000) },
    );
    await ipcHandlers['session/stop']!({}, undefined);
    // Second session — supervisor.getClient now returns clientB (simulating respawn)
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    expect(fakeSttInstances).toHaveLength(2);
    expect(fakeSttInstances[0].client).toBe(clientA);
    expect(fakeSttInstances[1].client).toBe(clientB);
  });
});

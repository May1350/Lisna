import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChunkPayload } from '@shared/ipc-protocol';

// Mock electron's ipcMain — capture the handlers registered so tests can invoke them.
// Also mock app.relaunch/quit so the restart IPC handler doesn't actually kill
// the test process; tests assert the calls landed. app.getPath backs the
// finalize debug dump — the default (undefined) impl makes the dump silently
// unavailable, mirroring tests that don't care about it; the dump wiring test
// points it at a tmp dir.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ipcHandlers: Record<string, (e: any, payload: any) => Promise<any>> = {};
const appRelaunch = vi.fn();
const appQuit = vi.fn();
const appGetPath = vi.fn();
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
    getPath: (...args: unknown[]) => appGetPath(...args),
  },
}));

// Mock the adapter constructors — they're constructed per-session inside the
// handler. Tests assert on construction calls + capture the instances passed
// into SessionOrchestrator.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeSttInstances: any[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeLlmInstances: any[] = [];
// Shared cross-engine call log so finalize-ordering tests (C3) can assert the
// 8 GB-floor sequence: STT load → transcribeFile → STT unload → LLM load. Each
// mocked method appends one tagged entry. Reset per test in beforeEach.
// `clientId` records WHICH sidecar client instance the engine adapter was built
// with (read from an optional `__id` tag the H1 stall tests set) so a test can
// prove a post-restart LLM load ran against the FRESH client, not the dead one.
type EngineCall = { engine: 'stt' | 'llm'; method: string; clientId?: string };
const engineCallLog: EngineCall[] = [];
// C3: getCurrentSession now drives the WAV → transcribeFile path. Tests can
// override this per case (e.g. resolve [] to exercise EMPTY_RECORDING).
let transcribeFileResult: () => Promise<{ startSec: number; endSec: number; text: string }[]> =
  async () => [{ startSec: 0, endSec: 1, text: 'こんにちは' }];
// F1 progress forwarding: a per-test hook fired by the mocked transcribeFile
// WHILE the transcribe is "in flight" (after engineCallLog is stamped, before
// the result resolves). It receives the STT engine's captured client so the
// test can drive `client.emitEvent({ type: 'sttProgress', pct })` exactly as
// the real sidecar would emit mid-transcribeFile. Reset to a no-op per test.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let onTranscribeFileCall: (client: any) => void = () => {};
vi.mock('../engines/whisper-cpp-stt', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  WhisperCppSTT: vi.fn().mockImplementation(function (this: any, client: any) {
    this.client = client;
    const cid = client?.__id as string | undefined;
    this.loadModel = vi.fn(async () => { engineCallLog.push({ engine: 'stt', method: 'load', clientId: cid }); });
    this.unloadModel = vi.fn(async () => { engineCallLog.push({ engine: 'stt', method: 'unload', clientId: cid }); });
    this.transcribe = vi.fn(async () => [{ startSec: 0, endSec: 1, text: 'こんにちは' }]);
    this.transcribeFile = vi.fn(async () => {
      engineCallLog.push({ engine: 'stt', method: 'transcribeFile', clientId: cid });
      // Mid-transcribe: let the test emit sidecar events to the client's
      // onEvent subscribers (the subscription transcribeWithProgress installs).
      onTranscribeFileCall(this.client);
      return transcribeFileResult();
    });
    fakeSttInstances.push(this);
  }),
}));
vi.mock('../engines/llama-cpp-llm', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  LlamaCppLLM: vi.fn().mockImplementation(function (this: any, client: any) {
    this.client = client;
    const cid = client?.__id as string | undefined;
    this.loadModel = vi.fn(async () => { engineCallLog.push({ engine: 'llm', method: 'load', clientId: cid }); });
    this.unloadModel = vi.fn(async () => { engineCallLog.push({ engine: 'llm', method: 'unload', clientId: cid }); });
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

// session/start reads userData unconditionally now — the audio-save marker-gate
// (`<userData>/save-audio.on`) and the optional proper-noun glossary
// (`<userData>/glossary.json`). Electron's app.getPath('userData') is always a
// real path in production, so the FSM mock must supply one; otherwise
// path.join(undefined, …) throws "path argument must be of type string".
const fsmUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-ipc-fsm-'));
// C2: session/start now checks fs.existsSync(paths.sttPath) before doing any work
// (fail-fast model-presence precheck). Tests that only need the happy path use
// fsmFakeSttPath — a real file on disk so the check passes without any mocking.
const fsmFakeSttPath = path.join(fsmUserDataDir, 'fake-stt.bin');
fs.writeFileSync(fsmFakeSttPath, ''); // empty placeholder — only its existence matters

describe('main/ipc FSM', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    appGetPath.mockReturnValue(fsmUserDataDir);
    fakeSttInstances.length = 0;
    fakeLlmInstances.length = 0;
    engineCallLog.length = 0;
    transcribeFileResult = async () => [{ startSec: 0, endSec: 1, text: 'こんにちは' }];
    onTranscribeFileCall = () => {};
    appRelaunch.mockClear();
    appQuit.mockClear();
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k]);
    vi.resetModules();
    ipc = await import('../ipc');
  });

  it('double session/start → second rejects SESSION_ACTIVE', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
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
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    await ipcHandlers['session/discard']!({}, undefined);
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).resolves.toBeUndefined();
  });

  // ── Session-scoped sidecar lifecycle (2026-06-10, founder reboot) ──

  it('session/start lazily respawns a stopped sidecar instead of SIDECAR_DOWN', async () => {
    const { win } = makeFakeWindow();
    const freshClient = { send: vi.fn(async () => ({})), waitForReady: vi.fn(async () => ({})) };
    const supervisor = makeFakeSupervisor(null);          // idle-stopped: no client
    supervisor.start = vi.fn(() => freshClient);          // lazy spawn returns fresh
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    expect(supervisor.start).toHaveBeenCalledTimes(1);
    expect(freshClient.waitForReady).toHaveBeenCalled();
  });

  it('session/start surfaces SIDECAR_DOWN when the lazy respawn never reaches ready', async () => {
    const { win } = makeFakeWindow();
    const deadClient = { send: vi.fn(async () => ({})), waitForReady: vi.fn(async () => { throw new Error('timeout'); }) };
    const supervisor = makeFakeSupervisor(null);
    supervisor.start = vi.fn(() => deadClient);
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).rejects.toThrow('SIDECAR_DOWN');
  });

  it('session/discard unloads nothing but arms idle-stop → supervisor.stop fires after the window', async () => {
    vi.useFakeTimers();
    try {
      const { win } = makeFakeWindow();
      const client = { send: vi.fn(async () => ({})) };
      const supervisor = makeFakeSupervisor(client);
      supervisor.stop = vi.fn(async () => {});
      ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
      await ipcHandlers['session/discard']!({}, undefined);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(supervisor.stop).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('idle-stop does NOT fire when a new session started inside the window', async () => {
    vi.useFakeTimers();
    try {
      const { win } = makeFakeWindow();
      const client = { send: vi.fn(async () => ({})) };
      const supervisor = makeFakeSupervisor(client);
      supervisor.stop = vi.fn(async () => {});
      ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
      await ipcHandlers['session/discard']!({}, undefined);  // arms idle
      await vi.advanceTimersByTimeAsync(60_000);
      await ipcHandlers['session/start']!({}, { language: 'ja' }); // cancels
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(supervisor.stop).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('isSessionInFlight reflects the FSM (the supervisor respawn gate)', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({ send: vi.fn(async () => ({})) });
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    expect(ipc.isSessionInFlight()).toBe(false);
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    expect(ipc.isSessionInFlight()).toBe(true);
    await ipcHandlers['session/discard']!({}, undefined);
    expect(ipc.isSessionInFlight()).toBe(false);
  });

  it('session/discard is a safe no-op with no active session', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
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
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    await expect(ipcHandlers['session/finalize']!({}, { family: 'garbage' }))
      .rejects.toThrow(/UNKNOWN_FAMILY/);
    // Orchestrator preserved → next session/start refused, NOT idle.
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' }))
      .rejects.toThrow('SESSION_ACTIVE');
  });

  // Task 2 reframe (was: "crash clears current = escape hatch"). Under the lane
  // split, a sidecar exit is a GENERATION-lane event and must NOT clear a live
  // capture (spec §4.5) — so a crash PRESERVES `current`, and the escape hatch
  // from a stuck session is now `session/discard`, not a crash.
  it('handleSidecarExit preserves current; session/discard is the escape hatch', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    await expect(ipcHandlers['session/finalize']!({}, { family: 'garbage' }))
      .rejects.toThrow(/UNKNOWN_FAMILY/);
    // Sidecar crashes → generation lane invalidated, capture PRESERVED.
    ipc.handleSidecarExit();
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' }))
      .rejects.toThrow('SESSION_ACTIVE');
    // Discard clears the capture lane → a fresh start now succeeds.
    await ipcHandlers['session/discard']!({}, undefined);
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' }))
      .resolves.toBeUndefined();
  });

  // Debug dump (2026-06-11) — every finalize persists {transcript, exact
  // prompts, raw LLM output per attempt, parsed note} under
  // <userData>/sessions/<timestamp>/ so the next coverage-collapse incident
  // is diagnosable post-hoc (the 13-min founder lecture was not).
  it('session/finalize writes a debug dump: transcript + llm calls + note + result', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-ipc-userdata-'));
    appGetPath.mockReturnValue(userDataDir);
    // Hoisted so the finally can restore it even if the try throws early.
    let ctorSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const { win } = makeFakeWindow();
      const noteJson = JSON.stringify({
        schemaVersion: 1,
        family: 'lecture',
        title: 'テスト講義',
        generatedAt: new Date().toISOString(),
        generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
        language: 'ja',
        durationSec: 60,
        sections: [
          {
            heading: 'セクション',
            ts: 0,
            summary: 'テストの要約です。',
            key_terms: [],
            examples: [],
            points: [{ text: '重要な点', ts: 0, important: true }],
          },
        ],
      });
      // Real makeGrammarSidecar streams from client.sendStream — fake yields
      // the whole note JSON as one token and reports decode stats via onDone.
      const client = {
        send: vi.fn(async () => ({})),
        sendStream: vi.fn(
          (_req: unknown, opts: { onDone?: (s: { tokensOut: number; genMs: number }) => void }) => {
            opts.onDone?.({ tokensOut: 5, genMs: 10 });
            return (async function* () { yield noteJson; })();
          },
        ),
      };
      const supervisor = makeFakeSupervisor(client);

      // STT Phase 2: live STT was removed — recording only captures the WAV and
      // the transcript is supplied at finalize via setFinalizeSegments (Task
      // C3 wires the WAV → transcribeFile → setFinalizeSegments path). Capture
      // the live orchestrator instance so we can seed it the same way C3 will.
      const orchModule = await import('../sidecar/orchestrator');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orchInstances: any[] = [];
      const RealOrch = orchModule.SessionOrchestrator;
      ctorSpy = vi
        .spyOn(orchModule, 'SessionOrchestrator')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockImplementation((opts: any) => {
          const inst = new RealOrch(opts);
          orchInstances.push(inst);
          return inst;
        }) as unknown as ReturnType<typeof vi.spyOn>;

      ipc.registerIpc({
        getMainWindow: () => win,
        supervisor,
        getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf' }),
      });
      await ipcHandlers['session/start']!({}, { language: 'ja' });
      // The chunk side-channels audio to the WAV writer (no live STT now).
      const payload: ChunkPayload = {
        index: 0, source: 'mic', startMs: 0, endMs: 2000, samples: new Float32Array(32000),
      };
      await ipcHandlers['recording/chunk']!({ sender: { send: vi.fn() } }, payload);

      // Seed the finalize transcript (stand-in for the C3 WAV re-transcription).
      expect(orchInstances).toHaveLength(1);
      orchInstances[0].setFinalizeSegments([{ startSec: 0, endSec: 1, text: 'こんにちは' }]);

      const result = await ipcHandlers['session/finalize']!({}, { family: 'lecture' });
      expect(result.note).toMatchObject({ family: 'lecture' });

      const sessionsDir = path.join(userDataDir, 'sessions');
      const dumps = fs.readdirSync(sessionsDir);
      expect(dumps).toHaveLength(1);
      const dir = path.join(sessionsDir, dumps[0]!);

      const transcript = JSON.parse(fs.readFileSync(path.join(dir, 'transcript.json'), 'utf8'));
      expect(transcript.segmentCount).toBe(1);
      expect(transcript.segments[0]).toMatchObject({ text: 'こんにちは' });
      expect(transcript.llmModel).toBe('Llama-3.2-3B-Instruct-Q4_K_M.gguf');

      const calls = fs
        .readFileSync(path.join(dir, 'llm-calls.ndjson'), 'utf8')
        .trimEnd().split('\n').map((l) => JSON.parse(l));
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0].prompt).toContain('こんにちは');   // exact prompt persisted
      expect(calls[0].rawText).toBe(noteJson);            // raw model output persisted
      expect(calls[0].ok).toBe(true);

      const resultJson = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
      expect(resultJson).toMatchObject({ ok: true, family: 'lecture' });
      const note = JSON.parse(fs.readFileSync(path.join(dir, 'note.json'), 'utf8'));
      expect(note).toMatchObject({ family: 'lecture', title: 'テスト講義' });
    } finally {
      ctorSpy?.mockRestore();
      appGetPath.mockReset();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  // ── C3: getCurrentSession transcribes the WAV at finalize ─────────────────
  //
  // STT Phase 2 (record-then-transcribe): live STT is gone — recording only
  // captures a WAV, and getCurrentSession transcribes the whole file at
  // finalize via transcribeFile, BEFORE the unload-STT → load-LLM prep. These
  // tests drive that path end-to-end (real orchestrator + streaming sidecar)
  // and assert the 8 GB memory floor (STT unload precedes LLM load), the two
  // independent caches (transcript vs LLM), and the EMPTY/WAV_MISSING guards.

  // A note JSON the streaming sidecar yields so routeFamily('lecture') parses
  // into a valid Note (shared by the full-finalize C3 cases below).
  const c3NoteJson = JSON.stringify({
    schemaVersion: 1,
    family: 'lecture',
    title: 'C3講義',
    generatedAt: new Date().toISOString(),
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 60,
    sections: [
      {
        heading: 'セクション',
        ts: 0,
        summary: 'テストの要約です。',
        key_terms: [],
        examples: [],
        points: [{ text: '重要な点', ts: 0, important: true }],
      },
    ],
  });

  // Fake sidecar client: `sendStream` yields the whole note JSON as one token
  // (real makeGrammarSidecar streams from this); `send` is unused because the
  // STT/LLM engines are constructor-mocked, but present so any stray call is safe.
  //
  // F1: a minimal event bus mirrors SidecarClient.onEvent — transcribeWithProgress
  // subscribes for the duration of the transcribe, and the test fires
  // `emitEvent({ type: 'sttProgress', pct })` (via onTranscribeFileCall) to
  // simulate the sidecar's mid-transcribeFile progress lines. emitEvent only
  // reaches CURRENT subscribers, so an event fired outside the transcribe window
  // (after unsub) is correctly dropped — matching production's scoped lifetime.
  function makeC3StreamClient() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let listeners: ((e: any) => void)[] = [];
    return {
      send: vi.fn(async () => ({})),
      sendStream: vi.fn(
        (_req: unknown, opts: { onDone?: (s: { tokensOut: number; genMs: number }) => void }) => {
          opts.onDone?.({ tokensOut: 5, genMs: 10 });
          return (async function* () { yield c3NoteJson; })();
        },
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onEvent: vi.fn((cb: (e: any) => void) => {
        listeners.push(cb);
        return () => { listeners = listeners.filter((x) => x !== cb); };
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      emitEvent: (e: any) => { for (const cb of listeners) cb(e); },
    };
  }

  // Register IPC with a real-orchestrator ctor spy so wavPath / exposedSegments /
  // setFinalizeSegments behave like production. Returns the captured instances +
  // a restore fn. Caller supplies a per-test userData dir (dump + WAV land there).
  async function setupC3(userDataDir: string) {
    appGetPath.mockReturnValue(userDataDir);
    const { win, send } = makeFakeWindow();
    const client = makeC3StreamClient();
    const supervisor = makeFakeSupervisor(client);
    const orchModule = await import('../sidecar/orchestrator');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orchInstances: any[] = [];
    const RealOrch = orchModule.SessionOrchestrator;
    const ctorSpy = vi
      .spyOn(orchModule, 'SessionOrchestrator')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((opts: any) => {
        const inst = new RealOrch(opts);
        orchInstances.push(inst);
        return inst;
      });
    ipc.registerIpc({
      getMainWindow: () => win,
      supervisor,
      getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf' }),
    });
    return { win, send, client, orchInstances, ctorSpy };
  }

  it('C3: first finalize transcribes the WAV in order load→transcribeFile→unload(STT)→load(LLM)', async () => {
    delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-c3-order-'));
    let restore: (() => void) | undefined;
    try {
      const { ctorSpy } = await setupC3(userDataDir);
      restore = () => ctorSpy.mockRestore();
      await ipcHandlers['session/start']!({}, { language: 'ja' });
      const result = await ipcHandlers['session/finalize']!({}, { family: 'lecture' });
      expect(result.note).toMatchObject({ family: 'lecture' });

      // The 8 GB floor: STT load → transcribeFile → STT unload all precede the
      // LLM load. loadLlmForFinalize also does its own idempotent STT unload, so
      // we assert RELATIVE ordering of the key events rather than exact equality.
      const seq = engineCallLog.map((c) => `${c.engine}:${c.method}`);
      const sttLoad = seq.indexOf('stt:load');
      const transcribe = seq.indexOf('stt:transcribeFile');
      const sttUnload = seq.indexOf('stt:unload');
      const llmLoad = seq.indexOf('llm:load');
      expect(sttLoad).toBeGreaterThanOrEqual(0);
      expect(transcribe).toBeGreaterThan(sttLoad);
      expect(sttUnload).toBeGreaterThan(transcribe);
      expect(llmLoad).toBeGreaterThan(sttUnload); // STT out of RAM before LLM in
    } finally {
      restore?.();
      appGetPath.mockReset();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('C3: the transcribeFile result is stored on the orchestrator + returned in the context', async () => {
    delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-c3-store-'));
    let restore: (() => void) | undefined;
    try {
      const segs = [
        { startSec: 0, endSec: 2, text: '第一の発言' },
        { startSec: 2, endSec: 4, text: '第二の発言' },
      ];
      transcribeFileResult = async () => segs;
      const { orchInstances, ctorSpy } = await setupC3(userDataDir);
      restore = () => ctorSpy.mockRestore();

      await ipcHandlers['session/start']!({}, { language: 'ja' });
      await ipcHandlers['session/finalize']!({}, { family: 'lecture' });

      expect(orchInstances).toHaveLength(1);
      // The transcript got stored on the orchestrator instance…
      expect(orchInstances[0].exposedSegments).toEqual(segs);
      // …and the dump recorded the TRANSCRIBED segments (not empty).
      const sessionsDir = path.join(userDataDir, 'sessions');
      const dumps = fs.readdirSync(sessionsDir);
      expect(dumps).toHaveLength(1);
      const transcript = JSON.parse(
        fs.readFileSync(path.join(sessionsDir, dumps[0]!, 'transcript.json'), 'utf8'),
      );
      expect(transcript.segmentCount).toBe(2);
      expect(transcript.segments).toEqual(segs);
    } finally {
      restore?.();
      appGetPath.mockReset();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('C3: EMPTY_RECORDING when transcribeFile yields [] — no LLM load happens', async () => {
    delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-c3-empty-'));
    let restore: (() => void) | undefined;
    try {
      transcribeFileResult = async () => [];
      const { ctorSpy } = await setupC3(userDataDir);
      restore = () => ctorSpy.mockRestore();
      await ipcHandlers['session/start']!({}, { language: 'ja' });
      await expect(ipcHandlers['session/finalize']!({}, { family: 'lecture' }))
        .rejects.toThrow('EMPTY_RECORDING');
      // transcribeFile ran, STT was unloaded, but the LLM was NEVER loaded —
      // the empty guard short-circuits before (E).
      const seq = engineCallLog.map((c) => `${c.engine}:${c.method}`);
      expect(seq).toContain('stt:transcribeFile');
      expect(seq).not.toContain('llm:load');
    } finally {
      restore?.();
      appGetPath.mockReset();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('C3: WAV_MISSING when the orchestrator wavPath does not exist — before any model load', async () => {
    // Kill-switch ON → no WAV writer opened → orch.wavPath is null → WAV_MISSING.
    process.env['LISNA_DISABLE_AUDIO_SAVE'] = '1';
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-c3-nowav-'));
    let restore: (() => void) | undefined;
    try {
      const { ctorSpy, orchInstances } = await setupC3(userDataDir);
      restore = () => { ctorSpy.mockRestore(); delete process.env['LISNA_DISABLE_AUDIO_SAVE']; };
      await ipcHandlers['session/start']!({}, { language: 'ja' });
      expect(orchInstances[0].wavPath).toBeNull(); // confirms the precondition
      await expect(ipcHandlers['session/finalize']!({}, { family: 'lecture' }))
        .rejects.toThrow('WAV_MISSING');
      // The WAV guard precedes every model load: neither STT nor the LLM was
      // loaded (and transcribeFile never ran). The only entry that may appear
      // is the settle-time idle LLM unload (onSessionSettled fires even on a
      // failed finalize) — assert the absence of LOADS, not strict emptiness.
      const seq = engineCallLog.map((c) => `${c.engine}:${c.method}`);
      expect(seq).not.toContain('stt:load');
      expect(seq).not.toContain('stt:transcribeFile');
      expect(seq).not.toContain('llm:load');
    } finally {
      restore?.();
      appGetPath.mockReset();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('C3: a retry (LLM cache reset) reuses the held transcript — transcribeFile runs ONCE, LLM reloads', async () => {
    delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-c3-retry-'));
    let restore: (() => void) | undefined;
    try {
      // First finalize FAILS at note generation (NOT at family routing — an
      // unknown family is rejected BEFORE getCurrentSession, so it would never
      // transcribe). Make EVERY generate attempt throw a plain error (not a
      // "no progress" stall, so the recovering wrapper just rethrows and the
      // lecture pipeline exhausts its fresh-seed retries → CHUNK_FAILED). The
      // failing finalize still runs getCurrentSession fully (transcribe + LLM
      // load), then onSessionSettled(ok:false) nulls _llmLoadedForCurrent +
      // idle-unloads the LLM, PRESERVING current + its transcript (P0-3). The
      // retry must NOT re-transcribe but MUST reload the LLM.
      const { ctorSpy, client } = await setupC3(userDataDir);
      restore = () => ctorSpy.mockRestore();
      await ipcHandlers['session/start']!({}, { language: 'ja' });

      // Pass 1: every generate attempt throws → finalize rejects, but
      // transcribe + LLM-load both ran inside getCurrentSession first.
      const workingStream = client.sendStream.getMockImplementation()!;
      client.sendStream.mockImplementation(() => { throw new Error('GENERATE_BOOM'); });
      await expect(ipcHandlers['session/finalize']!({}, { family: 'lecture' }))
        .rejects.toThrow();
      // Restore the working stream for the retry below.
      client.sendStream.mockImplementation(workingStream);

      const afterFirst = engineCallLog.map((c) => `${c.engine}:${c.method}`);
      expect(afterFirst.filter((s) => s === 'stt:transcribeFile')).toHaveLength(1);
      expect(afterFirst.filter((s) => s === 'llm:load')).toHaveLength(1);

      // Pass 2 (retry): same orchestrator, but _llmLoadedForCurrent was nulled by
      // onSessionSettled(ok:false). transcribeFile must NOT run again (transcript
      // reused); the LLM must reload (it was idle-unloaded).
      const result = await ipcHandlers['session/finalize']!({}, { family: 'lecture' });
      expect(result.note).toMatchObject({ family: 'lecture' });

      const afterRetry = engineCallLog.map((c) => `${c.engine}:${c.method}`);
      expect(afterRetry.filter((s) => s === 'stt:transcribeFile')).toHaveLength(1); // still once
      expect(afterRetry.filter((s) => s === 'llm:load').length).toBeGreaterThanOrEqual(2); // reloaded
    } finally {
      restore?.();
      appGetPath.mockReset();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  // ── I1: record-then-transcribe finalize, end-to-end, ALL 4 families ────────
  //
  // The C3 cases above prove the new finalize path for LECTURE: a mocked
  // transcribeFile returns a known transcript → the orchestrator stores it
  // (setFinalizeSegments / exposedSegments) → routeFamily adapts it and the
  // family core builds the note FROM the transcribed segments (NOT from any
  // live accumulation, which Group D removed) → the dump transcript.json holds
  // those segments. I1 generalizes that proof to meeting / interview /
  // brainstorm so every family routes correctly through the transcribe-fed path.
  //
  // The caveat: setupC3's stream client yields c3NoteJson (a LECTURE note). The
  // real pipeline PARSES + VALIDATES the streamed JSON against the family's
  // schema/grammar, so meeting/interview/brainstorm need their OWN matching note
  // JSON or finalize fails. The minimal valid per-family note JSON below mirror
  // the builders in sidecar/ipc/__tests__/session-finalize.test.ts (which are
  // not exported); replicated here so the stream can yield a family-matching
  // note. setupI1 is setupC3 with a parameterized stream note.
  describe('I1: finalize e2e across all 4 families (mocked STT)', () => {
    // Minimal valid note JSON per family. Pipeline Stage 3 inserts `from`
    // provenance post-decode for items carrying ts + (text|term|…), so the raw
    // response must NOT include `from` (same constraint as the orchestrator
    // family tests). brainstorm ideas omit `id` (UUID assigned post-decode).
    const familyNoteJson: Record<string, () => string> = {
      lecture: () =>
        JSON.stringify({
          schemaVersion: 1,
          family: 'lecture',
          title: 'I1講義',
          generatedAt: new Date().toISOString(),
          generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
          language: 'ja',
          durationSec: 60,
          sections: [
            {
              heading: 'セクション',
              ts: 0,
              summary: 'テストの要約です。',
              key_terms: [{ term: '概念', definition: '定義', ts: 0 }],
              examples: [],
              points: [{ text: '重要な点', ts: 0, important: true }],
            },
          ],
        }),
      meeting: () =>
        JSON.stringify({
          schemaVersion: 1,
          family: 'meeting',
          title: 'I1会議',
          generatedAt: new Date().toISOString(),
          generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
          language: 'ja',
          durationSec: 60,
          purpose: 'プロジェクトの進捗確認',
          executive_summary: 'プロジェクトは順調です。',
          topic_arc: [{ topic: '進捗確認', ts: 0, speakers_involved: [] }],
          discussions: [{ topic: '進捗', ts_start: 0, summary: '報告がありました。' }],
          decisions: [],
          open_questions: [],
        }),
      interview: () =>
        JSON.stringify({
          schemaVersion: 1,
          family: 'interview',
          title: 'I1面談',
          generatedAt: new Date().toISOString(),
          generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
          language: 'ja',
          durationSec: 60,
          purpose: 'インタビューの目的',
          subject_summary: '被取材者の概要です。',
          qa_pairs: [{ question: '質問', answer: '回答', ts: 0, asked_by: 0, answered_by: 1 }],
          themes: [],
          quotable_lines: [],
          key_takeaways: [],
        }),
      brainstorm: () =>
        JSON.stringify({
          schemaVersion: 1,
          family: 'brainstorm',
          title: 'I1ブレスト',
          generatedAt: new Date().toISOString(),
          generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
          language: 'ja',
          durationSec: 60,
          purpose: 'ブレインストーミングの目的',
          idea_clusters: [{ theme: 'テーマ', ideas: [{ text: 'アイデア', ts: 0 }] }],
        }),
    };

    // setupC3 with a parameterized streamed note (the only divergence from the
    // hardcoded-lecture makeC3StreamClient). Everything else — real-orchestrator
    // ctor spy, supervisor, model paths — is identical so wavPath /
    // exposedSegments / setFinalizeSegments behave like production.
    async function setupI1(userDataDir: string, noteJson: string) {
      appGetPath.mockReturnValue(userDataDir);
      const { win, send } = makeFakeWindow();
      const client = makeC3StreamClient();
      // Re-point sendStream to yield this family's note (default yields lecture).
      client.sendStream.mockImplementation(
        (_req: unknown, opts: { onDone?: (s: { tokensOut: number; genMs: number }) => void }) => {
          opts.onDone?.({ tokensOut: 5, genMs: 10 });
          return (async function* () { yield noteJson; })();
        },
      );
      const supervisor = makeFakeSupervisor(client);
      const orchModule = await import('../sidecar/orchestrator');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orchInstances: any[] = [];
      const RealOrch = orchModule.SessionOrchestrator;
      const ctorSpy = vi
        .spyOn(orchModule, 'SessionOrchestrator')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockImplementation((opts: any) => {
          const inst = new RealOrch(opts);
          orchInstances.push(inst);
          return inst;
        });
      ipc.registerIpc({
        getMainWindow: () => win,
        supervisor,
        getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf' }),
      });
      return { win, send, client, orchInstances, ctorSpy };
    }

    // A known multi-segment transcript every family case is fed. The note JSON
    // is independent of the transcript text (the streamed note is what the
    // family core parses), so the assertion that finalize consumed the
    // TRANSCRIBED segments comes from exposedSegments + the dump, not the note.
    const knownSegments = [
      { startSec: 0, endSec: 3, text: '最初の発言です' },
      { startSec: 3, endSec: 6, text: '二番目の発言です' },
      { startSec: 6, endSec: 9, text: '三番目の発言です' },
    ];

    for (const family of ['lecture', 'meeting', 'interview', 'brainstorm'] as const) {
      it(`${family}: transcribeFile result feeds the note; stt:transcribeFile precedes llm:load; dump holds the transcript`, async () => {
        delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
        const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `lisna-i1-${family}-`));
        let restore: (() => void) | undefined;
        try {
          transcribeFileResult = async () => knownSegments;
          const { orchInstances, ctorSpy } = await setupI1(userDataDir, familyNoteJson[family]!());
          restore = () => ctorSpy.mockRestore();

          await ipcHandlers['session/start']!({}, { language: 'ja' });
          const result = await ipcHandlers['session/finalize']!({}, { family });

          // (1) Routed correctly through the new transcribe-fed path for THIS family.
          expect(result.note).toMatchObject({ family, schemaVersion: 1 });
          expect(typeof result.noteId).toBe('string');

          // (2) The finalize consumed the TRANSCRIBED segments — the orchestrator's
          // exposedSegments reflect the mocked transcribeFile output exactly (not
          // any live accumulation, which Group D removed). adaptToV2Transcript
          // built the note's transcript from THESE segments.
          expect(orchInstances).toHaveLength(1);
          expect(orchInstances[0].exposedSegments).toEqual(knownSegments);

          // (3) The 8 GB floor + ordering: STT transcribed the WAV BEFORE the LLM
          // loaded (and STT unloaded in between). Reuses the C3 indexOf pattern.
          const seq = engineCallLog.map((c) => `${c.engine}:${c.method}`);
          const sttLoad = seq.indexOf('stt:load');
          const transcribe = seq.indexOf('stt:transcribeFile');
          const sttUnload = seq.indexOf('stt:unload');
          const llmLoad = seq.indexOf('llm:load');
          expect(sttLoad).toBeGreaterThanOrEqual(0);
          expect(transcribe).toBeGreaterThan(sttLoad);
          expect(sttUnload).toBeGreaterThan(transcribe);
          expect(llmLoad).toBeGreaterThan(sttUnload);

          // (4) The dump transcript.json holds the TRANSCRIBED segments verbatim.
          const sessionsDir = path.join(userDataDir, 'sessions');
          const dumps = fs.readdirSync(sessionsDir);
          expect(dumps).toHaveLength(1);
          const transcript = JSON.parse(
            fs.readFileSync(path.join(sessionsDir, dumps[0]!, 'transcript.json'), 'utf8'),
          );
          expect(transcript.segmentCount).toBe(knownSegments.length);
          expect(transcript.segments).toEqual(knownSegments);
        } finally {
          restore?.();
          appGetPath.mockReset();
          fs.rmSync(userDataDir, { recursive: true, force: true });
        }
      });
    }

    // Crash-safe / gap-faithful WAV (A1/A2) is already unit-covered by
    // audio-wav-writer.test.ts (WAV header + crash-safe size patch) and
    // orchestrator.test.ts (silence preserved → gap-faithful). The e2e harness's
    // mocked transcribeFile reads no real audio, so duplicating those byte-level
    // assertions here would prove nothing new. Instead assert only the seam I1
    // owns: that session/start opens a real WAV writer and the orchestrator
    // exposes a non-null wavPath that exists on disk — the precondition the
    // finalize transcribe step (B) depends on (it throws WAV_MISSING otherwise,
    // covered separately in the C3 block).
    it('the finalize WAV path exists on disk after recording (the transcribe precondition)', async () => {
      delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-i1-wav-'));
      let restore: (() => void) | undefined;
      try {
        const { orchInstances, ctorSpy } = await setupI1(userDataDir, familyNoteJson['lecture']!());
        restore = () => ctorSpy.mockRestore();
        await ipcHandlers['session/start']!({}, { language: 'ja' });
        // Feed a chunk so the WAV writer has appended audio before finalize.
        await ipcHandlers['recording/chunk']!(
          { sender: { send: vi.fn() } },
          { index: 0, source: 'mic', startMs: 0, endMs: 2000, samples: new Float32Array(32000) },
        );
        expect(orchInstances).toHaveLength(1);
        const wavPath: string | null = orchInstances[0].wavPath;
        expect(wavPath).not.toBeNull();
        expect(wavPath!.endsWith('.wav')).toBe(true);
        expect(fs.existsSync(wavPath!)).toBe(true);
        // The appended chunk grew the file past the bare 44-byte WAV header.
        expect(fs.statSync(wavPath!).size).toBeGreaterThan(44);
        // Clean up the FSM (close the writer) so the next test starts idle.
        await ipcHandlers['session/discard']!({}, undefined);
      } finally {
        restore?.();
        appGetPath.mockReset();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });
  });

  // ── session/transcribe: LLM-free whole-WAV raw transcript ─────────────────
  //
  // Raw-transcript output mode (2026-06-19): the post-Stop picker's 文字起こし
  // choice routes here. It reuses the SAME whole-WAV transcription + transcript
  // cache + debug dump as session/finalize, but STOPS before the LLM load — no
  // note is generated. Reuses the C3 harness (setupC3 / makeC3StreamClient /
  // transcribeFileResult / engineCallLog) defined above.
  describe('session/transcribe (raw transcript)', () => {
    it('returns the transcribed segments + language + durationSec (last endSec); never loads the LLM', async () => {
      delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-tx-ret-'));
      let restore: (() => void) | undefined;
      try {
        const segs = [
          { startSec: 0, endSec: 2, text: '第一の発言' },
          { startSec: 2, endSec: 7, text: '第二の発言' },
        ];
        transcribeFileResult = async () => segs;
        const { ctorSpy } = await setupC3(userDataDir);
        restore = () => ctorSpy.mockRestore();
        await ipcHandlers['session/start']!({}, { language: 'ja' });

        const result = await ipcHandlers['session/transcribe']!({}, undefined);
        expect(result.segments).toEqual(segs);
        expect(result.language).toBe('ja');
        expect(result.durationSec).toBe(7); // last segment endSec
        expect(result.sessionId).toBe('live');

        // The core property: the LLM is NEVER loaded on the transcribe path.
        const seq = engineCallLog.map((c) => `${c.engine}:${c.method}`);
        expect(seq).toContain('stt:transcribeFile');
        expect(seq).not.toContain('llm:load');
      } finally {
        restore?.();
        appGetPath.mockReset();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    it('reuses the orchestrator transcript cache: a second transcribe does NOT re-run transcribeFile', async () => {
      delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-tx-cache-'));
      let restore: (() => void) | undefined;
      try {
        const { ctorSpy, orchInstances } = await setupC3(userDataDir);
        restore = () => ctorSpy.mockRestore();
        await ipcHandlers['session/start']!({}, { language: 'ja' });
        // Pre-populate the transcript cache so transcribeFile must NOT run.
        orchInstances[0].setFinalizeSegments([{ startSec: 0, endSec: 3, text: 'こんにちは' }]);

        const result = await ipcHandlers['session/transcribe']!({}, undefined);
        expect(result.segments).toEqual([{ startSec: 0, endSec: 3, text: 'こんにちは' }]);
        const seq = engineCallLog.map((c) => `${c.engine}:${c.method}`);
        expect(seq.filter((s) => s === 'stt:transcribeFile')).toHaveLength(0);
        expect(seq).not.toContain('llm:load');
      } finally {
        restore?.();
        appGetPath.mockReset();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    it('writes transcript.json with the real segments to the dump dir', async () => {
      delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-tx-dump-'));
      let restore: (() => void) | undefined;
      try {
        const segs = [
          { startSec: 0, endSec: 2, text: '一つ目' },
          { startSec: 2, endSec: 4, text: '二つ目' },
        ];
        transcribeFileResult = async () => segs;
        const { ctorSpy } = await setupC3(userDataDir);
        restore = () => ctorSpy.mockRestore();
        await ipcHandlers['session/start']!({}, { language: 'ja' });
        await ipcHandlers['session/transcribe']!({}, undefined);

        const sessionsDir = path.join(userDataDir, 'sessions');
        const dumps = fs.readdirSync(sessionsDir);
        expect(dumps).toHaveLength(1);
        const transcript = JSON.parse(
          fs.readFileSync(path.join(sessionsDir, dumps[0]!, 'transcript.json'), 'utf8'),
        );
        expect(transcript.segmentCount).toBe(2);
        expect(transcript.segments).toEqual(segs);
        expect(transcript.llmModel).toBe('Llama-3.2-3B-Instruct-Q4_K_M.gguf');
        // No note was generated → no result.json for a transcript run.
        expect(fs.existsSync(path.join(sessionsDir, dumps[0]!, 'result.json'))).toBe(false);
      } finally {
        restore?.();
        appGetPath.mockReset();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    it('EMPTY_RECORDING when transcribeFile yields [] — no LLM load, session preserved', async () => {
      delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-tx-empty-'));
      let restore: (() => void) | undefined;
      try {
        transcribeFileResult = async () => [];
        const { ctorSpy } = await setupC3(userDataDir);
        restore = () => ctorSpy.mockRestore();
        await ipcHandlers['session/start']!({}, { language: 'ja' });
        await expect(ipcHandlers['session/transcribe']!({}, undefined))
          .rejects.toThrow('EMPTY_RECORDING');
        const seq = engineCallLog.map((c) => `${c.engine}:${c.method}`);
        expect(seq).toContain('stt:transcribeFile');
        expect(seq).not.toContain('llm:load');
        // Failure PRESERVES the live session (mirrors note finalize P0-3).
        await expect(ipcHandlers['session/start']!({}, { language: 'ja' }))
          .rejects.toThrow('SESSION_ACTIVE');
      } finally {
        restore?.();
        appGetPath.mockReset();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    it('WAV_MISSING when the orchestrator wavPath does not exist — before any model load', async () => {
      process.env['LISNA_DISABLE_AUDIO_SAVE'] = '1';
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-tx-nowav-'));
      let restore: (() => void) | undefined;
      try {
        const { ctorSpy, orchInstances } = await setupC3(userDataDir);
        restore = () => { ctorSpy.mockRestore(); delete process.env['LISNA_DISABLE_AUDIO_SAVE']; };
        await ipcHandlers['session/start']!({}, { language: 'ja' });
        expect(orchInstances[0].wavPath).toBeNull();
        await expect(ipcHandlers['session/transcribe']!({}, undefined))
          .rejects.toThrow('WAV_MISSING');
        const seq = engineCallLog.map((c) => `${c.engine}:${c.method}`);
        expect(seq).not.toContain('stt:load');
        expect(seq).not.toContain('stt:transcribeFile');
        expect(seq).not.toContain('llm:load');
      } finally {
        restore?.();
        appGetPath.mockReset();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    it('shares finalizeInFlight: a concurrent session/finalize rejects FINALIZE_IN_FLIGHT', async () => {
      delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-tx-inflight-'));
      let restore: (() => void) | undefined;
      try {
        // Hang transcribeFile so the transcribe handler stays in flight while we
        // fire session/finalize concurrently — it must hit the shared flag.
        let release!: (segs: { startSec: number; endSec: number; text: string }[]) => void;
        transcribeFileResult = () =>
          new Promise((res) => { release = res; });
        const { ctorSpy } = await setupC3(userDataDir);
        restore = () => ctorSpy.mockRestore();
        await ipcHandlers['session/start']!({}, { language: 'ja' });

        const txPromise = ipcHandlers['session/transcribe']!({}, undefined);
        // Let the transcribe handler set finalizeInFlight before we race.
        await Promise.resolve();
        await expect(ipcHandlers['session/finalize']!({}, { family: 'lecture' }))
          .rejects.toThrow('FINALIZE_IN_FLIGHT');
        // Release the hung transcribe so the first call settles cleanly.
        release([{ startSec: 0, endSec: 1, text: 'こんにちは' }]);
        const result = await txPromise;
        expect(result.segments).toHaveLength(1);
      } finally {
        restore?.();
        appGetPath.mockReset();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    it('clears the live session on success → next session/start is NOT rejected SESSION_ACTIVE', async () => {
      delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-tx-clear-'));
      let restore: (() => void) | undefined;
      try {
        transcribeFileResult = async () => [{ startSec: 0, endSec: 1, text: 'こんにちは' }];
        const { ctorSpy } = await setupC3(userDataDir);
        restore = () => ctorSpy.mockRestore();
        await ipcHandlers['session/start']!({}, { language: 'ja' });
        await ipcHandlers['session/transcribe']!({}, undefined);
        // Success clears `current` → a fresh start succeeds.
        await expect(ipcHandlers['session/start']!({}, { language: 'ja' }))
          .resolves.toBeUndefined();
      } finally {
        restore?.();
        appGetPath.mockReset();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    it('NO_ACTIVE_SESSION when no session is active', async () => {
      const { win } = makeFakeWindow();
      const supervisor = makeFakeSupervisor({});
      ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
      await expect(ipcHandlers['session/transcribe']!({}, undefined))
        .rejects.toThrow('NO_ACTIVE_SESSION');
    });
  });

  // ── F1: whole-WAV transcribe forwards sttProgress → finalize-progress ──────
  //
  // During the finalize/transcribe whole-WAV pass the sidecar emits id-less
  // `{ type: 'sttProgress', pct }` events (Group B). transcribeWithProgress
  // subscribes for that one pass only and forwards: a `transcribe-start` before
  // the transcribe, each sttProgress as `transcribe-progress`, a `transcribe-done`
  // after. Both the NOTE path (session/finalize) and the TRANSCRIPT path
  // (session/transcribe) wire it. The fake STT's transcribeFile fires
  // onTranscribeFileCall(client) mid-call so the test emits the sidecar event
  // exactly while the subscription is live.
  describe('transcribe progress forwarding (F1)', () => {
    // Pull just the finalize-progress payloads (in order) out of the window send log.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function progressPayloads(send: { mock: { calls: any[][] } }) {
      return send.mock.calls
        .filter((c) => c[0] === 'session/finalize-progress')
        .map((c) => c[1]);
    }

    it('NOTE path: emits transcribe-start, forwards sttProgress {pct:42}, then transcribe-done', async () => {
      delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-f1-note-'));
      let restore: (() => void) | undefined;
      try {
        // Emit a single sttProgress mid-transcribe, on the SAME client the STT
        // engine captured (the one transcribeWithProgress subscribed to).
        onTranscribeFileCall = (client) => {
          client.emitEvent({ type: 'sttProgress', pct: 42 });
        };
        const { send, ctorSpy } = await setupC3(userDataDir);
        restore = () => ctorSpy.mockRestore();
        await ipcHandlers['session/start']!({}, { language: 'ja' });
        const result = await ipcHandlers['session/finalize']!({}, { family: 'lecture' });
        expect(result.note).toMatchObject({ family: 'lecture' });

        const progress = progressPayloads(send);
        // The transcribe phase contributes start → progress(42) → done, in order
        // and before any note-generation (attempt-start/chunk-done) events.
        const startIdx = progress.findIndex((p) => p.kind === 'transcribe-start');
        const progIdx = progress.findIndex(
          (p) => p.kind === 'transcribe-progress' && p.pct === 42,
        );
        const doneIdx = progress.findIndex((p) => p.kind === 'transcribe-done');
        expect(startIdx).toBeGreaterThanOrEqual(0);
        expect(progIdx).toBeGreaterThan(startIdx);
        expect(doneIdx).toBeGreaterThan(progIdx);
      } finally {
        restore?.();
        appGetPath.mockReset();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    it('TRANSCRIPT path: emits transcribe-start, forwards sttProgress {pct:42}, then transcribe-done', async () => {
      delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-f1-tx-'));
      let restore: (() => void) | undefined;
      try {
        onTranscribeFileCall = (client) => {
          client.emitEvent({ type: 'sttProgress', pct: 42 });
        };
        const { send, ctorSpy } = await setupC3(userDataDir);
        restore = () => ctorSpy.mockRestore();
        await ipcHandlers['session/start']!({}, { language: 'ja' });
        await ipcHandlers['session/transcribe']!({}, undefined);

        const progress = progressPayloads(send);
        const startIdx = progress.findIndex((p) => p.kind === 'transcribe-start');
        const progIdx = progress.findIndex(
          (p) => p.kind === 'transcribe-progress' && p.pct === 42,
        );
        const doneIdx = progress.findIndex((p) => p.kind === 'transcribe-done');
        expect(startIdx).toBeGreaterThanOrEqual(0);
        expect(progIdx).toBeGreaterThan(startIdx);
        expect(doneIdx).toBeGreaterThan(progIdx);
        // No LLM/note path on the transcript route: there must be no note-gen
        // progress events, only the transcribe trio.
        expect(progress.every((p) => p.kind.startsWith('transcribe-'))).toBe(true);
      } finally {
        restore?.();
        appGetPath.mockReset();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    it('transcribe-done still fires when transcribeFile throws (subscription cleaned up)', async () => {
      delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-f1-throw-'));
      let restore: (() => void) | undefined;
      try {
        // Emit progress, then make the transcribe itself reject — transcribe-done
        // must still be sent (the forwarding wrapper's finally), and the unsub
        // must run so no later event leaks.
        onTranscribeFileCall = (client) => {
          client.emitEvent({ type: 'sttProgress', pct: 17 });
        };
        transcribeFileResult = async () => { throw new Error('STT_BOOM'); };
        const { send, ctorSpy } = await setupC3(userDataDir);
        restore = () => ctorSpy.mockRestore();
        await ipcHandlers['session/start']!({}, { language: 'ja' });
        await expect(ipcHandlers['session/transcribe']!({}, undefined)).rejects.toThrow();

        const progress = progressPayloads(send);
        expect(progress.some((p) => p.kind === 'transcribe-start')).toBe(true);
        expect(progress.some((p) => p.kind === 'transcribe-progress' && p.pct === 17)).toBe(true);
        expect(progress.some((p) => p.kind === 'transcribe-done')).toBe(true);
      } finally {
        restore?.();
        appGetPath.mockReset();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });
  });

  // ── H1: whole-WAV transcribe STALL watchdog + single-retry recovery ────────
  //
  // transcribeFile is sent with timeoutMs:Infinity (a wall-clock cap would abort
  // an 84-min lecture). The main side instead arms a NO-PROGRESS watchdog that
  // resets on every sttProgress heartbeat. On expiry the recovery is: restart
  // the sidecar PROCESS → waitForReady → reload STT → re-issue transcribeFile
  // ONCE. It must NEVER load/reload the LLM (8 GB floor). A second stall after
  // the single retry surfaces STT_STALLED. Uses fake timers to drive the
  // STT_TRANSCRIBE_NO_PROGRESS_MS (60s) window without real waiting.
  describe('STT stall watchdog (H1)', () => {
    // A C3-style client with the extra surface the recovery path touches:
    // waitForReady (awaited after restart) plus the onEvent/emitEvent bus. The
    // `__id` tag flows into engineCallLog so a test can prove the post-restart
    // LLM load ran against the FRESH client, not the dead initial one.
    function makeStallClient(id: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let listeners: ((e: any) => void)[] = [];
      return {
        __id: id,
        send: vi.fn(async () => ({})),
        sendStream: vi.fn(
          (_req: unknown, opts: { onDone?: (s: { tokensOut: number; genMs: number }) => void }) => {
            opts.onDone?.({ tokensOut: 5, genMs: 10 });
            return (async function* () { yield c3NoteJson; })();
          },
        ),
        waitForReady: vi.fn(async () => ({ type: 'ready' })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onEvent: vi.fn((cb: (e: any) => void) => {
          listeners.push(cb);
          return () => { listeners = listeners.filter((x) => x !== cb); };
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        emitEvent: (e: any) => { for (const cb of listeners) cb(e); },
      };
    }

    // Register IPC with a real-orchestrator ctor spy + a supervisor whose
    // restart() hands back a FRESH stall-client each call (mirrors
    // SidecarSupervisor.restart → new SidecarClient). Returns the supervisor,
    // the captured fresh clients, and the usual spy/window handles.
    async function setupH1(userDataDir: string) {
      appGetPath.mockReturnValue(userDataDir);
      const { win, send } = makeFakeWindow();
      const initialClient = makeStallClient('initial');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const freshClients: any[] = [];
      const supervisor = makeFakeSupervisor(initialClient);
      supervisor.restart = vi.fn(async () => {
        const c = makeStallClient(`fresh-${freshClients.length + 1}`);
        freshClients.push(c);
        // restart hands the new client back AND makes it the live getClient().
        supervisor.getClient.mockReturnValue(c);
        return c;
      });
      const orchModule = await import('../sidecar/orchestrator');
      const RealOrch = orchModule.SessionOrchestrator;
      const ctorSpy = vi
        .spyOn(orchModule, 'SessionOrchestrator')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockImplementation((opts: any) => new RealOrch(opts));
      ipc.registerIpc({
        getMainWindow: () => win,
        supervisor,
        getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf' }),
      });
      return { win, send, initialClient, freshClients, supervisor, ctorSpy };
    }

    it('single stall → restart once → reload STT → re-issue transcribeFile → success; never loads the LLM during transcribe', async () => {
      vi.useFakeTimers();
      delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-h1-single-'));
      let restore: (() => void) | undefined;
      try {
        // Attempt 0 hangs forever AND emits no progress → the watchdog fires.
        // Attempt 1 (after restart) resolves with real segments.
        let calls = 0;
        transcribeFileResult = () => {
          calls += 1;
          if (calls === 1) return new Promise(() => { /* never resolves — stall */ });
          return Promise.resolve([{ startSec: 0, endSec: 1, text: 'こんにちは' }]);
        };
        const { supervisor, ctorSpy } = await setupH1(userDataDir);
        restore = () => ctorSpy.mockRestore();

        await ipcHandlers['session/start']!({}, { language: 'ja' });
        const txPromise = ipcHandlers['session/transcribe']!({}, undefined);
        const settled = txPromise.then((v) => ({ v }), (e) => ({ e }));

        // Drive past the 60s no-progress window → stall sentinel → restart → retry.
        await vi.advanceTimersByTimeAsync(60_000 + 10);
        // Let the restart/waitForReady/reload microtasks + attempt-1 resolve flush.
        await vi.advanceTimersByTimeAsync(0);

        const out = (await settled) as { v?: { segments: unknown[] }; e?: Error };
        expect(out.e).toBeUndefined();
        expect(out.v?.segments).toHaveLength(1);

        expect(supervisor.restart).toHaveBeenCalledTimes(1);
        // STT was loaded on BOTH the initial client and the fresh one (reload).
        const seq = engineCallLog.map((c) => `${c.engine}:${c.method}`);
        expect(seq.filter((s) => s === 'stt:load').length).toBeGreaterThanOrEqual(2);
        expect(seq.filter((s) => s === 'stt:transcribeFile').length).toBeGreaterThanOrEqual(2);
        // The 8 GB floor: the LLM is NEVER loaded on the transcript path.
        expect(seq).not.toContain('llm:load');
      } finally {
        restore?.();
        vi.useRealTimers();
        appGetPath.mockReset();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    it('NOTE path single stall → step-E LLM load + STT-unload run against the FRESH client, not the dead one (no hang)', async () => {
      // Regression for the stale-client hang: getCurrentSession captures `client`
      // ONCE before step B. When the watchdog restarts the sidecar during the
      // transcribe, the captured client points at the SIGKILLed process; step E's
      // loadLlmForFinalize(client, …) issues unload/load with timeoutMs:Infinity
      // on that dead client whose rejectAllPending already fired → never settles →
      // the note finalize hangs forever. The fix re-resolves the live client after
      // transcribe. This test pins the LLM-load + step-E unload to the FRESH client.
      vi.useFakeTimers();
      delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-h1-note-'));
      let restore: (() => void) | undefined;
      try {
        // Attempt 0 (on the initial client) stalls; attempt 1 (on the fresh client)
        // resolves. Emit a heartbeat on the fresh client's pass so the retry both
        // forwards progress and never re-stalls.
        let calls = 0;
        onTranscribeFileCall = (client) => {
          if (client?.__id !== 'initial') client.emitEvent({ type: 'sttProgress', pct: 80 });
        };
        transcribeFileResult = () => {
          calls += 1;
          if (calls === 1) return new Promise(() => { /* never resolves — stall */ });
          return Promise.resolve([{ startSec: 0, endSec: 1, text: 'こんにちは' }]);
        };
        const { supervisor, ctorSpy } = await setupH1(userDataDir);
        restore = () => ctorSpy.mockRestore();

        await ipcHandlers['session/start']!({}, { language: 'ja' });
        const finPromise = ipcHandlers['session/finalize']!({}, { family: 'lecture' });
        const settled = finPromise.then((v) => ({ v }), (e) => ({ e }));

        await vi.advanceTimersByTimeAsync(60_000 + 10); // attempt 0 stall → restart → retry
        await vi.advanceTimersByTimeAsync(0);           // flush restart/reload/load/generate

        const out = (await settled) as { v?: { note: { family: string } }; e?: Error };
        expect(out.e).toBeUndefined();
        expect(out.v?.note).toMatchObject({ family: 'lecture' });

        expect(supervisor.restart).toHaveBeenCalledTimes(1);

        // The headline assertion: step E ran against the FRESH client. The dead
        // 'initial' client must NEVER see an LLM load (that's the hang).
        const llmLoads = engineCallLog.filter((c) => c.engine === 'llm' && c.method === 'load');
        expect(llmLoads.length).toBeGreaterThanOrEqual(1);
        expect(llmLoads.every((c) => c.clientId === 'fresh-1')).toBe(true);
        expect(llmLoads.some((c) => c.clientId === 'initial')).toBe(false);
        // loadLlmForFinalize's own idempotent STT unload (step E) is also on fresh.
        const stepEUnloads = engineCallLog.filter(
          (c) => c.engine === 'stt' && c.method === 'unload' && c.clientId === 'initial',
        );
        // The only 'initial' STT unload allowed is the watchdog's — and on a stall
        // the watchdog does NOT unload (restart frees the RAM). So zero 'initial'
        // unloads: every STT unload after the restart is on the fresh client.
        expect(stepEUnloads).toHaveLength(0);
      } finally {
        restore?.();
        vi.useRealTimers();
        appGetPath.mockReset();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    it('double stall → STT_STALLED; no LLM load; finalizeInFlight cleared (next finalize not FINALIZE_IN_FLIGHT)', async () => {
      vi.useFakeTimers();
      delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-h1-double-'));
      let restore: (() => void) | undefined;
      try {
        // Every attempt hangs with no progress → both attempt 0 and attempt 1 stall.
        transcribeFileResult = () => new Promise(() => { /* always stalls */ });
        const { supervisor, ctorSpy } = await setupH1(userDataDir);
        restore = () => ctorSpy.mockRestore();

        await ipcHandlers['session/start']!({}, { language: 'ja' });
        const txPromise = ipcHandlers['session/transcribe']!({}, undefined);
        const settled = txPromise.then((v) => ({ v }), (e) => ({ e }));

        // First window → stall → restart → retry; second window → stall → cleanup restart → STT_STALLED.
        await vi.advanceTimersByTimeAsync(60_000 + 10); // attempt 0 stall
        await vi.advanceTimersByTimeAsync(0);           // restart + reload + re-arm
        await vi.advanceTimersByTimeAsync(60_000 + 10); // attempt 1 stall
        await vi.advanceTimersByTimeAsync(0);           // cleanup restart + throw

        const out = (await settled) as { v?: unknown; e?: Error };
        expect(out.e).toBeInstanceOf(Error);
        expect(out.e?.message).toContain('STT_STALLED');
        // restart fired for the retry AND once more for cleanup (leave a healthy sidecar).
        expect(supervisor.restart).toHaveBeenCalledTimes(2);

        const seq = engineCallLog.map((c) => `${c.engine}:${c.method}`);
        expect(seq).not.toContain('llm:load');

        // finalizeInFlight must be cleared on the terminal failure: a subsequent
        // transcribe must NOT bounce with FINALIZE_IN_FLIGHT. Make this next call
        // resolve quickly so we only assert the flag, not another stall.
        transcribeFileResult = async () => [{ startSec: 0, endSec: 1, text: 'やり直し' }];
        await expect(ipcHandlers['session/transcribe']!({}, undefined))
          .resolves.toBeTruthy(); // P0-3: session preserved on failure → retry works
      } finally {
        restore?.();
        vi.useRealTimers();
        appGetPath.mockReset();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    it('steady heartbeat keeps the pass alive past the window in aggregate (no false restart)', async () => {
      vi.useFakeTimers();
      delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisna-h1-heartbeat-'));
      let restore: (() => void) | undefined;
      try {
        // transcribeFile hangs until we manually resolve it; while it "runs" we
        // emit an sttProgress every 30s for 150s total (5× the window). Each
        // heartbeat must reset the no-progress timer so the watchdog never fires.
        let release!: (segs: { startSec: number; endSec: number; text: string }[]) => void;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let activeClient: any;
        onTranscribeFileCall = (client) => { activeClient = client; };
        transcribeFileResult = () => new Promise((res) => { release = res; });
        const { supervisor, ctorSpy } = await setupH1(userDataDir);
        restore = () => ctorSpy.mockRestore();

        await ipcHandlers['session/start']!({}, { language: 'ja' });
        const txPromise = ipcHandlers['session/transcribe']!({}, undefined);
        const settled = txPromise.then((v) => ({ v }), (e) => ({ e }));
        await vi.advanceTimersByTimeAsync(0); // let transcribeFile start + arm timer

        for (let i = 0; i < 5; i++) {
          await vi.advanceTimersByTimeAsync(30_000); // < 60s window
          activeClient.emitEvent({ type: 'sttProgress', pct: (i + 1) * 15 });
        }
        // 150s elapsed in aggregate, but never 60s WITHOUT a heartbeat → alive.
        expect(supervisor.restart).not.toHaveBeenCalled();

        // Finish the pass cleanly.
        release([{ startSec: 0, endSec: 9, text: 'こんにちは' }]);
        await vi.advanceTimersByTimeAsync(0);
        const out = (await settled) as { v?: { segments: unknown[] }; e?: Error };
        expect(out.e).toBeUndefined();
        expect(out.v?.segments).toHaveLength(1);
        expect(supervisor.restart).not.toHaveBeenCalled();
      } finally {
        restore?.();
        vi.useRealTimers();
        appGetPath.mockReset();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });
  });

  it('recording/chunk before session/start → silent no-op', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
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

  it('session/start rejects un-eval\'d languages (zh) → UNSUPPORTED_LANGUAGE', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    // ko is now accepted (Phase 1: transcription-only); only zh + unknown codes are rejected.
    await expect(ipcHandlers['session/start']!({}, { language: 'zh' })).rejects.toThrow('UNSUPPORTED_LANGUAGE');
  });

  it('session/start accepts en (minimal EN support, 2026-06-10)', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    // Resolves (no UNSUPPORTED_LANGUAGE) — full start-path behavior is
    // covered by the ja FSM tests; language only changes the gate + STT load.
    await expect(ipcHandlers['session/start']!({}, { language: 'en' })).resolves.toBeUndefined();
  });

  it('session/start when supervisor.getClient() returns null → SIDECAR_DOWN', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor(null);
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).rejects.toThrow('SIDECAR_DOWN');
  });

  // C2: stt-loading phase is REMOVED — session/start no longer emits it.
  // Recording only captures audio; the WAV is transcribed whole at finalize
  // (STT Phase 2 re-transcribe design). The renderer transitions to "recording"
  // on the resolved promise, not on a phase event.
  it('session/start (C2) does NOT emit stt-loading phase', async () => {
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    const sttLoadingCalls = send.mock.calls.filter(
      (c) => c[0] === 'session/phase' && c[1]?.phase === 'stt-loading',
    );
    expect(sttLoadingCalls).toHaveLength(0);
  });

  // C2 fail-fast: if the STT model file has been moved/deleted since
  // getModelPaths() last validated it, session/start rejects BEFORE any side
  // effect (no WAV writer opened, no sidecar load, current stays null).
  it('session/start rejects STT_MODEL_MISSING when sttPath does not exist on disk', async () => {
    // Use a path that genuinely does not exist on disk — no mocking needed.
    const missingSttPath = path.join(fsmUserDataDir, 'no-such-model.bin');
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: missingSttPath, llmPath: '/l' }) });
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).rejects.toThrow('STT_MODEL_MISSING');
    // No side effects: current is null, so subsequent start succeeds (not SESSION_ACTIVE).
    // Point the second call at a path that DOES exist so the precheck passes.
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).resolves.toBeUndefined();
  });

  // NOTE: the legacy `session/stop` handler was removed in STT Phase 2 (Task
  // C1) — the v2 flow finalizes via `session/finalize`, never `session/stop`.
  // Its NO_ACTIVE_SESSION / SESSION_NOT_READY / EMPTY_TRANSCRIPT / phase-order /
  // sidecar-crash-mid-stop tests are gone with it. The empty-transcript +
  // phase mechanics now live on the finalize path; "state cleared" probes below
  // use `session/finalize` (rejects NO_ACTIVE_SESSION when `current` is null).

  it('handleSidecarExit pushes a non-blocking error but PRESERVES a live capture', async () => {
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    send.mockClear();
    // session/start resolved (_sessionHandlerInFlight false). Sidecar crash with
    // a live capture = generation-lane failure: push the non-blocking code, but
    // the recording survives (capture is model-free; spec §4.5).
    ipc.handleSidecarExit();
    expect(send).toHaveBeenCalledWith('session/error', expect.objectContaining({ message: expect.any(String) }));
    // Capture PRESERVED → a fresh session/start is rejected (current still set).
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).rejects.toThrow('SESSION_ACTIVE');
  });

  it('handleSidecarExit when idle → no session/error push', async () => {
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    ipc.handleSidecarExit();
    expect(send).not.toHaveBeenCalled();
  });

  // ── Task 2: lane-aware crash — a sidecar exit must NOT kill a live capture ──
  // Capture is model-free (recording never touches the sidecar). A sidecar exit
  // is a GENERATION-lane failure; the live recording's writer must stay open and
  // `recording`/`current` must survive so the user keeps their audio (spec §4.5,
  // guarantee 5). The respawn gate (isSessionInFlight) resurrects the sidecar.
  it('handleSidecarExit during a live capture preserves it — writer open, recording survives', async () => {
    delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
    const orchModule = await import('../sidecar/orchestrator');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orchInstances: any[] = [];
    const Real = orchModule.SessionOrchestrator;
    const ctorSpy = vi
      .spyOn(orchModule, 'SessionOrchestrator')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((opts: any) => { const i = new Real(opts); orchInstances.push(i); return i; });
    try {
      const { win, send } = makeFakeWindow();
      const supervisor = makeFakeSupervisor({});
      ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
      await ipcHandlers['session/start']!({}, { language: 'ja' });
      // Append a chunk so the WAV holds data; record the size.
      await ipcHandlers['recording/chunk']!(
        { sender: { send: vi.fn() } },
        { index: 0, source: 'mic', startMs: 0, endMs: 2000, samples: new Float32Array(32000) },
      );
      const wavPath = orchInstances[0].wavPath as string;
      const sizeBefore = fs.statSync(wavPath).size;
      send.mockClear();

      // Sidecar crashes (e.g. a background generation OOM). Capture is model-free.
      ipc.handleSidecarExit();

      // recording survives → a fresh start is rejected (current preserved).
      await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).rejects.toThrow('SESSION_ACTIVE');
      expect(ipc.isSessionInFlight()).toBe(true);
      // writer still open → the next chunk appends + grows the file (no AUDIO_WRITE_FAILED).
      await ipcHandlers['recording/chunk']!(
        { sender: { send: vi.fn() } },
        { index: 1, source: 'mic', startMs: 2000, endMs: 4000, samples: new Float32Array(32000) },
      );
      expect(fs.statSync(wavPath).size).toBeGreaterThan(sizeBefore);
      const writeFails = send.mock.calls.filter(
        (c) => c[0] === 'session/error' && c[1]?.message === 'AUDIO_WRITE_FAILED',
      );
      expect(writeFails).toHaveLength(0);

      await ipcHandlers['session/discard']!({}, undefined); // cleanup: close the writer + reset FSM
    } finally {
      ctorSpy.mockRestore();
    }
  });

  // C2 invariant on the start side: sidecar crash WHILE the session/start
  // handler is awaiting (its `_sessionHandlerInFlight` guard must make
  // handleSidecarExit skip its own session/error push, letting the handler's
  // own rejection be the SOLE error surface — no duplicate ErrorView jump).
  //
  // STT Phase 2: `orch.start()` no longer loads STT, so we anchor the await on
  // `orch.start()` itself (still the awaited call in the handler) via a
  // constructor spy whose start() hangs then rejects — the mid-stop counterpart
  // was removed with the legacy stop handler.
  it('sidecar crash mid-session/start → only handler rejects, no duplicate session/error push', async () => {
    let resolveStartAwait: (() => void) | undefined;
    let rejectStartAwait: ((err: Error) => void) | undefined;
    const hangingStart = new Promise<void>((res, rej) => {
      resolveStartAwait = res;
      rejectStartAwait = rej;
    });
    const orchModule = await import('../sidecar/orchestrator');
    const RealOrch = orchModule.SessionOrchestrator;
    const ctorSpy = vi
      .spyOn(orchModule, 'SessionOrchestrator')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((opts: any) => {
        const inst = new RealOrch(opts);
        inst.start = vi.fn(() => hangingStart);
        return inst;
      });

    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    const startPromise = ipcHandlers['session/start']!({}, { language: 'ja' });
    send.mockClear();
    // Supervisor.onExit fires while orch.start is awaiting.
    ipc.handleSidecarExit();
    // Now make orch.start reject (simulating client.rejectAllPending).
    rejectStartAwait!(new Error('sidecar process exited'));
    await expect(startPromise).rejects.toThrow('sidecar process exited');
    const errorPushes = send.mock.calls.filter((c) => c[0] === 'session/error');
    expect(errorPushes).toEqual([]);
    // Cleanup: resolve in case the test framework reuses.
    resolveStartAwait!();
    ctorSpy.mockRestore();
  });

  // --- Step 5 §3.6 permanent give-up recovery ---

  it('handleSidecarGiveUp pushes session/error with permanent=true and clears state', async () => {
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    send.mockClear();
    ipc.handleSidecarGiveUp();
    expect(send).toHaveBeenCalledWith(
      'session/error',
      expect.objectContaining({ permanent: true, message: expect.any(String) }),
    );
    // State must be cleared so any in-flight state is consistent. Probe via
    // session/finalize (the v2 path): known family + null current → NO_ACTIVE_SESSION.
    await expect(ipcHandlers['session/finalize']!({}, { family: 'lecture' })).rejects.toThrow('NO_ACTIVE_SESSION');
  });

  it('session/start after handleSidecarGiveUp rejects with SIDECAR_GAVE_UP (not SIDECAR_DOWN)', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
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
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    ipc.handleSidecarGiveUp();
    expect(send).toHaveBeenCalledWith(
      'session/error',
      expect.objectContaining({ permanent: true }),
    );
  });

  // ── A3: always-on audio capture + wavPath + surfaced write errors ─────────

  it('session/start always opens a WAV writer + sets orchestrator.wavPath regardless of env', async () => {
    // The LISNA_DISABLE_AUDIO_SAVE kill-switch must NOT be set for this test.
    // Spy on the (real, un-mocked) SessionOrchestrator constructor to capture
    // the instance so we can assert its wavPath getter — the exact value Task
    // C1 reads at finalize. Guards against a regression where opts.wavPath
    // stops being set even though the WAV file is still created.
    delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
    const orchModule = await import('../sidecar/orchestrator');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orchInstances: any[] = [];
    const Real = orchModule.SessionOrchestrator;
    const ctorSpy = vi
      .spyOn(orchModule, 'SessionOrchestrator')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((opts: any) => {
        const inst = new Real(opts);
        orchInstances.push(inst);
        return inst;
      });

    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });

    await ipcHandlers['session/start']!({}, { language: 'ja' });

    // A .wav file lands in audio-captures/.
    const capturesDir = path.join(fsmUserDataDir, 'audio-captures');
    const files = fs.existsSync(capturesDir) ? fs.readdirSync(capturesDir).filter((f) => f.endsWith('.wav')) : [];
    expect(files.length).toBeGreaterThan(0);

    // The orchestrator's wavPath getter points at the opened file (the plumbing
    // Task C1 relies on). Non-null + lives under audio-captures/ + exists on disk.
    expect(orchInstances).toHaveLength(1);
    const wavPath: string | null = orchInstances[0].wavPath;
    expect(wavPath).not.toBeNull();
    expect(path.dirname(wavPath!)).toBe(capturesDir);
    expect(wavPath!.endsWith('.wav')).toBe(true);
    expect(fs.existsSync(wavPath!)).toBe(true);

    // Cleanup: discard so the writer is closed and the FSM is reset.
    await ipcHandlers['session/discard']!({}, undefined);
    ctorSpy.mockRestore();
  });

  it('WAV append failure surfaces session/error AUDIO_WRITE_FAILED and clears session', async () => {
    // Spy on WavWriter.prototype.append to throw on the first call —
    // simulates an ENOSPC (disk-full) mid-recording.
    // The module was freshly loaded in beforeEach via vi.resetModules() +
    // dynamic import; import it here to get the live class and spy on its prototype.
    const wavModule = await import('../audio-wav-writer');
    const appendSpy = vi.spyOn(wavModule.WavWriter.prototype, 'append').mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    delete process.env['LISNA_DISABLE_AUDIO_SAVE'];
    const { win, send } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });

    await ipcHandlers['session/start']!({}, { language: 'ja' });
    send.mockClear();

    // Sending a chunk triggers onAudioChunk → w.append(audio) → throws.
    await ipcHandlers['recording/chunk']!(
      { sender: { send: vi.fn() } },
      { index: 0, source: 'mic', startMs: 0, endMs: 2000, samples: new Float32Array(32000) },
    );

    // session/error must have been pushed with AUDIO_WRITE_FAILED.
    expect(send).toHaveBeenCalledWith(
      'session/error',
      expect.objectContaining({ message: 'AUDIO_WRITE_FAILED' }),
    );

    // Session must be cleared: next session/start should succeed, not SESSION_ACTIVE.
    await expect(ipcHandlers['session/start']!({}, { language: 'ja' })).resolves.toBeUndefined();

    appendSpy.mockRestore();
  });

  it('lifecycle/restart IPC handler calls app.relaunch then app.quit', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
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
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
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
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    // First session — end it via discard (the v2 flow has no session/stop; discard
    // clears `current` so the second start isn't rejected with SESSION_ACTIVE).
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    await ipcHandlers['session/discard']!({}, undefined);
    // Second session — supervisor.getClient now returns clientB (simulating respawn)
    await ipcHandlers['session/start']!({}, { language: 'ja' });
    expect(fakeSttInstances).toHaveLength(2);
    expect(fakeSttInstances[0].client).toBe(clientA);
    expect(fakeSttInstances[1].client).toBe(clientB);
  });

  it('session/start accepts ko (transcription) and still rejects zh/unknown', async () => {
    const { win } = makeFakeWindow();
    const supervisor = makeFakeSupervisor({});
    ipc.registerIpc({ getMainWindow: () => win, supervisor, getModelPaths: () => ({ sttPath: fsmFakeSttPath, llmPath: '/l' }) });
    await expect(ipcHandlers['session/start']!({}, { language: 'ko' })).resolves.toBeUndefined();
    // reset session between calls exactly as the 'session/discard clears' test does:
    await ipcHandlers['session/discard']!({}, undefined);
    await expect(ipcHandlers['session/start']!({}, { language: 'zh' })).rejects.toThrow('UNSUPPORTED_LANGUAGE');
  });
});

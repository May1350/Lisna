import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { SidecarSupervisor } from '../supervisor';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp',
  },
}));

const spawnMock = vi.fn();
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args),
  };
});

/**
 * Minimal ChildProcess-shaped EventEmitter for deterministic tests. We
 * control `exit` emission manually so timing is predictable. Real
 * SidecarClient binds to stdout/stdin in its constructor — give them
 * EventEmitter shape with the methods SidecarClient touches.
 */
class FakeChild extends EventEmitter {
  stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), { write: vi.fn() });
  killed = false;
  pid = 9999;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  kill(_sig?: NodeJS.Signals) {
    this.killed = true;
    return true;
  }
}

describe('SidecarSupervisor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnMock.mockImplementation(() => new FakeChild());
  });

  it('fires onExit once per unexpected exit', () => {
    const onExit = vi.fn();
    const sup = new SidecarSupervisor({ onCrash: vi.fn(), onExit, restartDelayMs: 10000 });
    sup.start();
    const proc = spawnMock.mock.results[0]!.value as FakeChild;
    proc.emit('exit', 1, null);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onExit when shutdown() was called', async () => {
    const onExit = vi.fn();
    const sup = new SidecarSupervisor({ onCrash: vi.fn(), onExit });
    sup.start();
    const proc = spawnMock.mock.results[0]!.value as FakeChild;
    const shutdownPromise = sup.shutdown();
    proc.emit('exit', 0, null);
    await shutdownPromise;
    expect(onExit).not.toHaveBeenCalled();
  });

  it('fires onExit before onCrash on give-up', async () => {
    const callOrder: string[] = [];
    const onExit = vi.fn(() => { callOrder.push('onExit'); });
    const onCrash = vi.fn(() => { callOrder.push('onCrash'); });
    const sup = new SidecarSupervisor({
      onCrash, onExit,
      maxConsecutiveFailures: 2,
      restartDelayMs: 5,
    });
    sup.start();
    const proc1 = spawnMock.mock.results[0]!.value as FakeChild;
    proc1.emit('exit', 1, null);
    // Wait for respawn (5ms timer) — 30ms margin for CI.
    await new Promise((r) => setTimeout(r, 30));
    const proc2 = spawnMock.mock.results[1]!.value as FakeChild;
    proc2.emit('exit', 1, null);
    expect(onExit).toHaveBeenCalledTimes(2);
    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['onExit', 'onExit', 'onCrash']);
  });

  // Critical invariant: in supervisor.start(), `new SidecarClient(proc)` runs
  // BEFORE `proc.on('exit', handleExit)`. SidecarClient's constructor
  // registers `proc.on('exit', rejectAllPending)`. Node fires listeners in
  // registration order, so client's pending-rejection runs first when proc
  // crashes — that lets in-flight orch.stop() / orch.onChunk() complete their
  // `finally` (clearing ipc.ts state) BEFORE supervisor's handleExit calls
  // onExit → handleSidecarExit.
  //
  // Verification strategy: behavior-based, not closure-string introspection.
  // We seed the client with one pending request, then emit 'exit'. At the
  // moment supervisor's onExit fires (synchronously inside handleExit), check
  // whether client's pending map is already empty. If client's listener ran
  // first (correct order), pending is empty (0). If supervisor's ran first,
  // pending still has 1 entry — test fails. This survives minification, ES5
  // downlevel, and any future refactor that renames closures, because it
  // checks actual runtime behavior rather than source text.
  it('listener registration order — client clears pending before supervisor onExit fires', async () => {
    let pendingSizeWhenOnExitFired = -1;
    // Holder ref so the onExit closure can read clientRef.current after assignment.
    const clientRef: { current: { pending: Map<string, unknown> } | null } = { current: null };
    const sup = new SidecarSupervisor({
      onCrash: vi.fn(),
      onExit: () => {
        if (clientRef.current) pendingSizeWhenOnExitFired = clientRef.current.pending.size;
      },
      restartDelayMs: 10000,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clientRef.current = sup.start() as any;
    const proc = spawnMock.mock.results[0]!.value as FakeChild;

    // Seed client with one pending request (returns a Promise; we catch the rejection
    // so the test process doesn't see an unhandled rejection).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pendingPromise = (clientRef.current as any).send({ type: 'ping' }, { timeoutMs: Infinity })
      .catch(() => { /* expected — sidecar process exited */ });
    expect(clientRef.current!.pending.size).toBe(1);  // pre-condition

    // Trigger exit. Listeners fire synchronously in registration order:
    //   1. client.rejectAllPending → pending map cleared synchronously
    //   2. supervisor.handleExit → onExit callback fires
    // Our onExit captures pending.size at that moment.
    proc.emit('exit', 1, null);

    // If client registered FIRST (correct), pending was cleared before onExit ran.
    expect(pendingSizeWhenOnExitFired).toBe(0);

    await pendingPromise;  // drain the rejection
  });
});

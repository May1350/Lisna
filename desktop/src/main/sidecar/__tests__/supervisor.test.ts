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

  // ---- Zombie-defense Layer B: emergency-kill surface (2026-06-10) ----
  // Founder-reported 10+ times: sidecar survives Electron death. These APIs
  // let index.ts's process-level safety nets SIGKILL the child synchronously.

  it('getPid() returns the live child pid, undefined after exit', () => {
    const sup = new SidecarSupervisor({ onCrash: vi.fn(), restartDelayMs: 10000 });
    expect(sup.getPid()).toBeUndefined();
    sup.start();
    expect(sup.getPid()).toBe(9999);
    const proc = spawnMock.mock.results[0]!.value as FakeChild;
    proc.emit('exit', 1, null);
    expect(sup.getPid()).toBeUndefined();
  });

  it('panicKill() SIGKILLs synchronously and clears pid', () => {
    const sup = new SidecarSupervisor({ onCrash: vi.fn(), restartDelayMs: 10000 });
    sup.start();
    const proc = spawnMock.mock.results[0]!.value as FakeChild;
    const killSpy = vi.spyOn(proc, 'kill');
    sup.panicKill();
    expect(killSpy).toHaveBeenCalledWith('SIGKILL');
    expect(sup.getPid()).toBeUndefined();
  });

  it('panicKill() cancels a pending respawn', async () => {
    const sup = new SidecarSupervisor({ onCrash: vi.fn(), maxConsecutiveFailures: 5, restartDelayMs: 20 });
    sup.start();
    const proc = spawnMock.mock.results[0]!.value as FakeChild;
    proc.emit('exit', 1, null);  // schedules respawn in 20ms
    sup.panicKill();             // must cancel it
    await new Promise((r) => setTimeout(r, 60));
    expect(spawnMock).toHaveBeenCalledTimes(1);  // no respawn happened
  });

  it('panicKill() never throws when no child is running', () => {
    const sup = new SidecarSupervisor({ onCrash: vi.fn() });
    expect(() => sup.panicKill()).not.toThrow();
  });

  it('shutdown() is idempotent — concurrent callers share one promise', () => {
    const sup = new SidecarSupervisor({ onCrash: vi.fn() });
    sup.start();
    const p1 = sup.shutdown();
    const p2 = sup.shutdown();
    expect(p1).toBe(p2);
  });

  it('shutdown() escalates SIGTERM → SIGKILL and resolves at hard ceiling even without exit event', async () => {
    vi.useFakeTimers();
    try {
      const sup = new SidecarSupervisor({ onCrash: vi.fn() });
      sup.start();
      const proc = spawnMock.mock.results[0]!.value as FakeChild;
      const killSpy = vi.spyOn(proc, 'kill');
      const done = vi.fn();
      void sup.shutdown().then(done);
      expect(killSpy).toHaveBeenCalledWith('SIGTERM');
      await vi.advanceTimersByTimeAsync(1500);
      expect(killSpy).toHaveBeenCalledWith('SIGKILL');
      // Child never emits 'exit' (simulates a reaped-by-kernel process whose
      // listener is stale) — ceiling must still resolve the promise at 2s.
      await vi.advanceTimersByTimeAsync(500);
      expect(done).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shutdown() cancels a pending respawn', async () => {
    const sup = new SidecarSupervisor({ onCrash: vi.fn(), maxConsecutiveFailures: 5, restartDelayMs: 20 });
    sup.start();
    const proc = spawnMock.mock.results[0]!.value as FakeChild;
    proc.emit('exit', 1, null);  // schedules respawn in 20ms
    void sup.shutdown();
    await new Promise((r) => setTimeout(r, 60));
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  // ---- restart(): deliberate kill + fresh spawn (wedged-retry fix 2026-06-10) ----

  it('restart() SIGKILLs the old child, spawns a fresh one, suppresses onExit', async () => {
    const onExit = vi.fn();
    const sup = new SidecarSupervisor({ onCrash: vi.fn(), onExit, restartDelayMs: 10000 });
    sup.start();
    const oldProc = spawnMock.mock.results[0]!.value as FakeChild;
    const killSpy = vi.spyOn(oldProc, 'kill');
    // FakeChild.kill doesn't emit 'exit'; simulate the kernel doing so.
    killSpy.mockImplementation(() => {
      setTimeout(() => oldProc.emit('exit', null, 'SIGKILL'), 5);
      return true;
    });
    const client = await sup.restart();
    expect(killSpy).toHaveBeenCalledWith('SIGKILL');
    expect(client).toBeDefined();
    expect(spawnMock).toHaveBeenCalledTimes(2);          // old + fresh
    expect(onExit).not.toHaveBeenCalled();               // deliberate, not a crash
    expect(sup.getPid()).toBe(9999);                     // fresh child live
  });

  it('restart() resumes crash supervision for the fresh child', async () => {
    const onExit = vi.fn();
    const sup = new SidecarSupervisor({ onCrash: vi.fn(), onExit, restartDelayMs: 10000 });
    sup.start();
    const oldProc = spawnMock.mock.results[0]!.value as FakeChild;
    vi.spyOn(oldProc, 'kill').mockImplementation(() => {
      setTimeout(() => oldProc.emit('exit', null, 'SIGKILL'), 5);
      return true;
    });
    await sup.restart();
    const freshProc = spawnMock.mock.results[1]!.value as FakeChild;
    freshProc.emit('exit', 1, null);                     // unexpected crash AFTER restart
    expect(onExit).toHaveBeenCalledTimes(1);             // supervision is back on
  });

  it('restart() refuses after shutdown()', async () => {
    const sup = new SidecarSupervisor({ onCrash: vi.fn() });
    sup.start();
    void sup.shutdown();
    await expect(sup.restart()).rejects.toThrow('already shut down');
  });

  // Reviewer-caught race (2026-06-10): a wedged child under swap pressure can
  // take >2s for the kernel to reap. restart()'s kill-wait ceiling then
  // resolves FIRST: flags reset, fresh child spawned — and the old child's
  // 'exit' arrives LATE. Without the proc-identity guard in handleExit, that
  // stale exit re-enters the crash path: disowns the fresh child (zombie),
  // fires onExit (wipes in-flight finalize state — P0-3 violation), and
  // schedules a respawn that fights the live process.
  it('late exit from a restart()-killed child does not disturb the fresh child', async () => {
    vi.useFakeTimers();
    try {
      const onExit = vi.fn();
      const sup = new SidecarSupervisor({ onCrash: vi.fn(), onExit, restartDelayMs: 10000 });
      sup.start();
      const oldProc = spawnMock.mock.results[0]!.value as FakeChild;
      // Wedged child: kill() does NOT produce an exit — the ceiling must win.
      vi.spyOn(oldProc, 'kill').mockImplementation(() => true);
      const restartP = sup.restart();
      await vi.advanceTimersByTimeAsync(2000); // ceiling fires
      const client = await restartP;
      expect(client).toBeDefined();
      expect(spawnMock).toHaveBeenCalledTimes(2);
      const freshPid = sup.getPid();
      expect(freshPid).toBe(9999);

      // The kernel finally reaps the old child — its 'exit' arrives late.
      oldProc.emit('exit', null, 'SIGKILL');

      expect(onExit).not.toHaveBeenCalled();      // not treated as a crash
      expect(sup.getPid()).toBe(freshPid);        // fresh child NOT disowned
      await vi.advanceTimersByTimeAsync(10000);
      expect(spawnMock).toHaveBeenCalledTimes(2); // no rogue respawn scheduled
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Session-scoped lifecycle (2026-06-10, founder reboot incident) ──

  it('does NOT respawn after exit when shouldRespawn() is false (idle kill stays dead)', async () => {
    const onExit = vi.fn();
    const sup = new SidecarSupervisor({
      onCrash: vi.fn(), onExit,
      shouldRespawn: () => false,
      maxConsecutiveFailures: 5, restartDelayMs: 10,
    });
    sup.start();
    const proc = spawnMock.mock.results[0]!.value as FakeChild;
    proc.emit('exit', null, 'SIGKILL');     // user force-quit while idle
    expect(onExit).toHaveBeenCalledTimes(1); // state cleanup still signals
    await new Promise((r) => setTimeout(r, 50));
    expect(spawnMock).toHaveBeenCalledTimes(1); // NO resurrection
  });

  it('respawns after exit when shouldRespawn() is true (mid-session crash)', async () => {
    const sup = new SidecarSupervisor({
      onCrash: vi.fn(),
      shouldRespawn: () => true,
      maxConsecutiveFailures: 5, restartDelayMs: 10,
    });
    sup.start();
    const proc = spawnMock.mock.results[0]!.value as FakeChild;
    proc.emit('exit', 1, null);
    await new Promise((r) => setTimeout(r, 50));
    expect(spawnMock).toHaveBeenCalledTimes(2); // P0-2 recovery preserved
  });

  it('stop() kills the child and a later start() spawns fresh', async () => {
    const onExit = vi.fn();
    const sup = new SidecarSupervisor({ onCrash: vi.fn(), onExit, restartDelayMs: 10000 });
    sup.start();
    const proc = spawnMock.mock.results[0]!.value as FakeChild;
    const killSpy = vi.spyOn(proc, 'kill').mockImplementation(() => {
      setTimeout(() => proc.emit('exit', null, 'SIGTERM'), 5);
      return true;
    });
    await sup.stop();
    expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    expect(sup.getClient()).toBeUndefined();
    expect(onExit).not.toHaveBeenCalled();   // deliberate stop ≠ crash
    const client = sup.start();              // lazy respawn on next session
    expect(client).toBeDefined();
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('onSpawn fires on boot, crash-respawn, and restart()', async () => {
    const onSpawn = vi.fn();
    const sup = new SidecarSupervisor({
      onCrash: vi.fn(), onSpawn,
      maxConsecutiveFailures: 5, restartDelayMs: 5,
    });
    sup.start();
    expect(onSpawn).toHaveBeenCalledTimes(1);     // boot
    const proc1 = spawnMock.mock.results[0]!.value as FakeChild;
    proc1.emit('exit', 1, null);                  // crash → respawn in 5ms
    await new Promise((r) => setTimeout(r, 30));
    expect(onSpawn).toHaveBeenCalledTimes(2);     // crash-respawn
    const proc2 = spawnMock.mock.results[1]!.value as FakeChild;
    vi.spyOn(proc2, 'kill').mockImplementation(() => {
      setTimeout(() => proc2.emit('exit', null, 'SIGKILL'), 5);
      return true;
    });
    await sup.restart();
    expect(onSpawn).toHaveBeenCalledTimes(3);     // deliberate restart
  });
});

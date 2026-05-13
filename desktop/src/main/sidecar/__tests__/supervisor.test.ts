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
  let proc: FakeChild;

  beforeEach(() => {
    vi.clearAllMocks();
    proc = new FakeChild();
    spawnMock.mockReturnValue(proc);
  });

  it('fires onExit once per unexpected exit', () => {
    const onExit = vi.fn();
    const sup = new SidecarSupervisor({ onCrash: vi.fn(), onExit, restartDelayMs: 10000 });
    sup.start();
    proc.emit('exit', 1, null);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onExit when shutdown() was called', async () => {
    const onExit = vi.fn();
    const sup = new SidecarSupervisor({ onCrash: vi.fn(), onExit });
    sup.start();
    const shutdownPromise = sup.shutdown();
    // shutdown() awaits proc.once('exit'); emit to resolve it.
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
    // First crash → onExit fires, respawn scheduled in 5ms.
    proc.emit('exit', 1, null);
    // Wait for respawn timer to fire and start() to be called again.
    await new Promise((r) => setTimeout(r, 30));
    // Second proc was created by the respawn. Replace our local handle.
    proc = spawnMock.mock.results[spawnMock.mock.results.length - 1]!.value as FakeChild;
    // Second crash → onExit + onCrash (give-up).
    proc.emit('exit', 1, null);
    expect(onExit).toHaveBeenCalledTimes(2);
    expect(onCrash).toHaveBeenCalledTimes(1);
    // 2nd onExit fires immediately before onCrash within the same handleExit.
    expect(callOrder).toEqual(['onExit', 'onExit', 'onCrash']);
  });

  it('listener registration order — client registers exit handler before supervisor', () => {
    // Critical invariant: in supervisor.start(), `new SidecarClient(proc)` runs
    // BEFORE `proc.on('exit', handleExit)`. SidecarClient's constructor
    // registers `proc.on('exit', rejectAllPending)`. Node fires listeners in
    // registration order, so client's pending-rejection runs first when proc
    // crashes — that lets in-flight orch.stop() / orch.onChunk() complete
    // their `finally` (clearing ipc.ts state) BEFORE supervisor's handleExit
    // calls onExit → handleSidecarExit.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onExitCalls: ((...args: any[]) => void)[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    proc.on = vi.fn((event: string, listener: any) => {
      if (event === 'exit') onExitCalls.push(listener);
      return proc;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    const sup = new SidecarSupervisor({ onCrash: vi.fn(), onExit: vi.fn() });
    sup.start();
    // At least 2 exit listeners registered: client's rejectAllPending + supervisor's handleExit.
    expect(onExitCalls.length).toBeGreaterThanOrEqual(2);
    // First listener is from SidecarClient (rejectAllPending closes over `this.pending`,
    // does NOT reference `failuresInARow`).
    expect(onExitCalls[0]!.toString()).not.toContain('failuresInARow');
    expect(onExitCalls[0]!.toString()).toMatch(/rejectAllPending|sidecar process exited/);
  });
});

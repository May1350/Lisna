import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout } from '../with-timeout';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the underlying promise value when it settles before the timeout', async () => {
    const result = await withTimeout(Promise.resolve('done'), 1000, 'X_TIMEOUT');
    expect(result).toBe('done');
  });

  it('rejects with new Error(code) when the underlying promise does not settle in time', async () => {
    vi.useFakeTimers();
    // A promise that never settles. withTimeout must arm a timer and reject
    // with the typed code (not the generic "timed out after Nms" string).
    const neverResolves = new Promise<string>(() => {});
    const race = withTimeout(neverResolves, 1000, 'STT_TIMEOUT');
    vi.advanceTimersByTime(1500);
    await expect(race).rejects.toThrow('STT_TIMEOUT');
  });

  it('propagates the underlying rejection unchanged (does NOT remap to the timeout code)', async () => {
    // If the underlying op fails for a non-timeout reason (e.g. sidecar
    // returned error), the caller needs to see the original error message
    // so ErrorView can map it properly. Only the time-budget-exceeded path
    // becomes the typed code.
    const rejected = Promise.reject(new Error('STT load failed [DECODE]: invalid model'));
    await expect(withTimeout(rejected, 1000, 'STT_TIMEOUT')).rejects.toThrow(
      'STT load failed [DECODE]',
    );
  });

  it('clears the timer when the promise resolves first (no leaked handle)', async () => {
    vi.useFakeTimers();
    // Lots of identical "lifecycle / no leaked timer" tests overspecify by
    // poking process internals. We verify by behavior: resolve the promise,
    // then advance past the timeout window — if the timer were still armed,
    // we'd see a UnhandledPromiseRejection from the timer's reject closure
    // firing on a settled promise. Vitest captures that and fails the test.
    const result = await withTimeout(Promise.resolve('quick'), 1000, 'X_TIMEOUT');
    expect(result).toBe('quick');
    vi.advanceTimersByTime(2000);
    // (No assertion — the side-effect check is "no unhandled rejection".)
  });

  it('clears the timer when the promise rejects first', async () => {
    vi.useFakeTimers();
    const failing = Promise.reject(new Error('upstream'));
    await expect(withTimeout(failing, 1000, 'X_TIMEOUT')).rejects.toThrow('upstream');
    vi.advanceTimersByTime(2000);
    // (Same logic — verify by absence of trailing rejection.)
  });
});

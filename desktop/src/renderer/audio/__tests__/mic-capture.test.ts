import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startMicCapture, stopMicCapture } from '../mic-capture';

describe('mic-capture', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue({
            getTracks: () => [{ stop: vi.fn() }],
          } as unknown as MediaStream),
        },
      },
    });
  });

  afterEach(async () => {
    await stopMicCapture();
  });

  it('start 시 getUserMedia({audio:true}) 호출', async () => {
    await startMicCapture();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
  });

  it('stop 은 트랙 stop() 호출', async () => {
    const stop = vi.fn();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValueOnce({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await startMicCapture();
    await stopMicCapture();
    expect(stop).toHaveBeenCalled();
  });

  it('두 번째 start 는 getUserMedia 를 재호출하지 않음', async () => {
    const s1 = await startMicCapture();
    const s2 = await startMicCapture();
    expect(s1).toBe(s2);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });
});

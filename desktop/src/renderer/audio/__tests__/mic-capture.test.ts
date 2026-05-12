import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  it('start 시 getUserMedia({audio:true}) 호출', async () => {
    await startMicCapture();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    await stopMicCapture();
  });

  it('stop 은 트랙 stop() 호출', async () => {
    const stop = vi.fn();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValueOnce({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await startMicCapture();
    await stopMicCapture();
    expect(stop).toHaveBeenCalled();
  });
});

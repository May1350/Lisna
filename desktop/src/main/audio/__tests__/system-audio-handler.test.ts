import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  desktopCapturer: { getSources: vi.fn() },
  session: { defaultSession: { setDisplayMediaRequestHandler: vi.fn() } },
}));

import { desktopCapturer, session } from 'electron';
import { installSystemAudioHandler } from '../system-audio-handler';

describe('system-audio-handler — deny semantics', () => {
  beforeEach(() => vi.clearAllMocks());

  function captureHandler() {
    installSystemAudioHandler();
    const setter = vi.mocked(session.defaultSession.setDisplayMediaRequestHandler);
    return setter.mock.calls[0]![0] as (req: unknown, cb: (arg: unknown) => void) => Promise<void>;
  }

  it('빈 sources → cb 는 video/audio 키 없는 객체 (= 거부)', async () => {
    vi.mocked(desktopCapturer.getSources).mockResolvedValueOnce([]);
    const handler = captureHandler();
    const cb = vi.fn();
    await handler({}, cb);
    expect(cb).toHaveBeenCalledTimes(1);
    const arg = cb.mock.calls[0]![0] as { video?: unknown; audio?: unknown };
    expect(arg.video).toBeUndefined();
    expect(arg.audio).toBeUndefined();
  });

  it('getSources throw → cb 도 video/audio 키 없는 객체 (= 거부)', async () => {
    vi.mocked(desktopCapturer.getSources).mockRejectedValueOnce(new Error('boom'));
    const handler = captureHandler();
    const cb = vi.fn();
    await handler({}, cb);
    expect(cb).toHaveBeenCalledTimes(1);
    const arg = cb.mock.calls[0]![0] as { video?: unknown; audio?: unknown };
    expect(arg.video).toBeUndefined();
    expect(arg.audio).toBeUndefined();
  });
});

import { session, desktopCapturer } from 'electron';

// Electron 39 types omit enableLocalLoopback from Streams; extend locally.
type StreamsWithLoopback = Electron.Streams & { enableLocalLoopback: boolean };

export function installSystemAudioHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      if (sources.length === 0) { cb({}); return; }
      // macOS 는 항상 최소 한 개의 디스플레이를 보유 — 위 가드는 비-macOS / 비정상 케이스 방어.
      const streams: StreamsWithLoopback = {
        video: sources[0]!,
        audio: 'loopback',
        enableLocalLoopback: true,
      };
      cb(streams);
    } catch {
      cb({}); // deny → renderer getDisplayMedia() rejects rather than hanging
    }
  }, { useSystemPicker: false });
}

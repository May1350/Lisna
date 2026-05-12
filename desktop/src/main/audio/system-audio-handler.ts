import { session, desktopCapturer } from 'electron';

// Electron 39 types omit enableLocalLoopback from Streams; extend locally.
type StreamsWithLoopback = Electron.Streams & { enableLocalLoopback: boolean };

export function installSystemAudioHandler(): void {
  // Both deny paths below (empty sources + catch) call cb({}) — this empty-object
  // shape is the deny contract for Electron's setDisplayMediaRequestHandler:
  // the renderer-side getDisplayMedia() promise rejects rather than hanging.
  // Electron's docs do not document a deny sentinel; verified by
  // system-audio-handler.test.ts + docs/manual-verification.md
  // "cb({}) deny semantics" section (Electron 39, 2026-05-13).
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
      cb({});
    }
  }, { useSystemPicker: false });
}

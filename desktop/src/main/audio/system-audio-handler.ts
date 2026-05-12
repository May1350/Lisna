import { session, desktopCapturer } from 'electron';

// Electron 39 types omit enableLocalLoopback from Streams; extend locally.
type StreamsWithLoopback = Electron.Streams & { enableLocalLoopback: boolean };

export function installSystemAudioHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    // macOS 는 항상 최소 한 개의 디스플레이를 보유 — getSources 가 빈 배열을 반환하는 경우 없음.
    const streams: StreamsWithLoopback = { video: sources[0]!, audio: 'loopback', enableLocalLoopback: true };
    cb(streams);
  }, { useSystemPicker: false });
}

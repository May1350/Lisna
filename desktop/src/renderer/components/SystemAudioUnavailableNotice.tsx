/**
 * Rendered when the host OS does not expose loopback / system-audio capture
 * (most commonly macOS < 14.4, where `desktopCapturer.enableLocalLoopback` is
 * unavailable). Korean copy is in-line for Phase 1 — i18n lands in Task 4.4.
 */
export function SystemAudioUnavailableNotice() {
  return (
    <aside
      role="note"
      style={{ background: '#fff7e6', padding: 12, borderRadius: 8, margin: '8px 0' }}
    >
      macOS 14.4+ 부터 시스템 오디오 캡쳐가 지원됩니다. 현재 환경에서는 마이크 녹음만 가능합니다.
      (LMS 강의 브라우저 재생 시나리오는 macOS 업데이트 후 이용 가능.)
    </aside>
  );
}

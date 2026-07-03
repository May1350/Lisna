let activeStream: MediaStream | null = null;
let pendingCapture: Promise<MediaStream> | null = null;
// Module-scoped preferred input device (ponytail: single active capture per app;
// no need to thread a deviceId through orchestrator → capturer → buildStream).
// '' / undefined = system default. Set by the source picker before recording.
let preferredDeviceId: string | undefined;

export function setPreferredMicDevice(deviceId: string | undefined): void {
  preferredDeviceId = deviceId || undefined;
}

export async function startMicCapture(): Promise<MediaStream> {
  if (activeStream) return activeStream;
  if (pendingCapture) return pendingCapture;
  pendingCapture = (async () => {
    try {
      const audio: MediaTrackConstraints | true = preferredDeviceId
        ? { deviceId: { exact: preferredDeviceId } }
        : true;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      } catch (err) {
        // The chosen device vanished (unplugged AirPods, etc.) between selection
        // and start — fall back to the system default so a stale pick never
        // blocks recording. Only for device-constraint failures, not permission.
        const name = (err as DOMException | undefined)?.name;
        if (preferredDeviceId && (name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'NotReadableError')) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } else {
          throw err;
        }
      }
      activeStream = stream;
      return stream;
    } finally {
      // Reset on BOTH success and failure so a rejected attempt doesn't wedge
      // every later call on the poisoned promise.
      pendingCapture = null;
    }
  })();
  return pendingCapture;
}

export async function stopMicCapture(): Promise<void> {
  if (!activeStream) return;
  for (const track of activeStream.getTracks()) track.stop();
  activeStream = null;
}

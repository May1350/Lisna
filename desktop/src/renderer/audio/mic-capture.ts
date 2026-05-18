let activeStream: MediaStream | null = null;
let pendingCapture: Promise<MediaStream> | null = null;

export async function startMicCapture(): Promise<MediaStream> {
  if (activeStream) return activeStream;
  if (pendingCapture) return pendingCapture;
  pendingCapture = navigator.mediaDevices
    .getUserMedia({ audio: true, video: false })
    .then((s) => {
      activeStream = s;
      pendingCapture = null;
      return s;
    });
  return pendingCapture;
}

export async function stopMicCapture(): Promise<void> {
  if (!activeStream) return;
  for (const track of activeStream.getTracks()) track.stop();
  activeStream = null;
}

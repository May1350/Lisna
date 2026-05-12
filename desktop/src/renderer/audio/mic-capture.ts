let activeStream: MediaStream | null = null;

export async function startMicCapture(): Promise<MediaStream> {
  if (activeStream) return activeStream;
  activeStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  return activeStream;
}

export async function stopMicCapture(): Promise<void> {
  if (!activeStream) return;
  for (const track of activeStream.getTracks()) track.stop();
  activeStream = null;
}

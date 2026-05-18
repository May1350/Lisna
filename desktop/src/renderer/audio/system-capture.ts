export async function startSystemAudioCapture(): Promise<MediaStream> {
  // video 는 받지만 즉시 stop 해서 오디오 트랙만 사용
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 1 },
    audio: true,
  });
  for (const v of stream.getVideoTracks()) v.stop();
  return stream;
}

export function stopSystemAudioCapture(stream: MediaStream): void {
  for (const t of stream.getTracks()) t.stop();
}

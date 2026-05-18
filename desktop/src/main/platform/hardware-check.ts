import os from 'node:os';

export function isMacAudioLoopbackSupported(): boolean {
  if (process.platform !== 'darwin') return false;
  // os.release() returns Darwin kernel; macOS 14.4 ≈ Darwin 23.4+
  const [maj, min] = os.release().split('.').map(Number);
  return (maj ?? 0) > 23 || ((maj ?? 0) === 23 && (min ?? 0) >= 4);
}

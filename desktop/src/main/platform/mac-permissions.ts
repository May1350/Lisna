import { systemPreferences } from 'electron';

export type Permission = 'microphone' | 'screen';

export async function ensurePermission(p: Permission): Promise<'granted' | 'denied'> {
  if (process.platform !== 'darwin') return 'granted';
  if (p === 'microphone') {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return 'granted';
    const ok = await systemPreferences.askForMediaAccess('microphone');
    return ok ? 'granted' : 'denied';
  }
  // screen (시스템 오디오 캡쳐 시 시스템 화면 기록 권한 필요 — Task 1.4 에서 처리)
  const status = systemPreferences.getMediaAccessStatus('screen');
  return status === 'granted' ? 'granted' : 'denied';
}

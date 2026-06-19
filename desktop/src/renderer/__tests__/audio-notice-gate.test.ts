/**
 * shouldShowAudioNotice — pure gate for the once-only first-run on-device
 * audio-retention disclosure (STT Phase 2 Group G1).
 *
 * This project's vitest config has NO DOM env (no jsdom / localStorage), so the
 * gate DECISION is extracted as a pure exported function and unit-tested here
 * (mirrors retryViewFor / applyFinalizeProgress). The localStorage-backed state
 * wiring + render swap in AuthenticatedApp is verified via the live app per
 * CLAUDE.md UI guidance.
 *
 * Contract: the notice gates ALL paths into recording (boot-direct AND
 * post-setup), so the gate keys ONLY on (a) not-yet-acknowledged and (b) the
 * view being `recording`. Until acknowledged, the FirstRunAudioNotice shows and
 * <Recording> is NOT mounted (capture cannot begin). After acknowledging, the
 * gate opens and <Recording> mounts.
 */
import { describe, it, expect } from 'vitest';
import { shouldShowAudioNotice } from '../App';

describe('shouldShowAudioNotice', () => {
  it('shows the notice on the recording view when not yet acknowledged', () => {
    expect(shouldShowAudioNotice(false, 'recording')).toBe(true);
  });

  it('opens the gate (no notice → Recording mounts) once acknowledged', () => {
    expect(shouldShowAudioNotice(true, 'recording')).toBe(false);
  });

  it('never shows the notice on non-recording views', () => {
    expect(shouldShowAudioNotice(false, 'booting')).toBe(false);
    expect(shouldShowAudioNotice(false, 'setup')).toBe(false);
    expect(shouldShowAudioNotice(false, 'familyPicking')).toBe(false);
    expect(shouldShowAudioNotice(false, 'note')).toBe(false);
  });
});

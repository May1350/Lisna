/**
 * FIX-B (audit P0 pack B) — connector flow & lifecycle routing helpers.
 *
 * B1 (H3): `connectorReturnView` — ConnectorView's 戻る previously hardcoded
 * the recording view; entering from the family-picker upsell orphaned the
 * stopped session waiting in familyPicking (its finalize choices vanished
 * from the screen). The origin view is captured at open (returnTo) and
 * restored on back; degenerate origins fall back to recording.
 *
 * B2 (M17): `dismissRoutesToFamilyPicking` — dismissing (✕) the error chip of
 * a job whose failure left the LIVE session pending must route the user back
 * to familyPicking instead of stranding main's `current` (next session/start
 * → SESSION_ACTIVE until app restart). The only reachable such failure is
 * CONNECTOR_NO_KEY: it is thrown BEFORE snapshotAndFreeCapture (the C-1
 * carve-out), so the capture lane stays claimed. Every other failure already
 * freed the capture at pick, so a plain dismiss leaves start working. The
 * route preserves user choice (picker offers on-device / transcript / 破棄)
 * — no silent session discard.
 *
 * No DOM env in this package's vitest config — pure functions only; the
 * 1-line setView wiring per call site is verified in the live app (same
 * convention as generation-chip.test.tsx).
 */
import { describe, it, expect } from 'vitest';
import { connectorReturnView, dismissRoutesToFamilyPicking, type BackgroundJob } from '../App';

describe('connectorReturnView (B1/H3)', () => {
  it('returns to familyPicking when opened from the picker upsell (KEY case — pending session preserved)', () => {
    expect(connectorReturnView({ kind: 'familyPicking' })).toEqual({ kind: 'familyPicking' });
  });

  it('returns to the History detail (same id) when opened from History', () => {
    expect(connectorReturnView({ kind: 'history', id: '2026-07-08T00-00-00-000Z' })).toEqual({
      kind: 'history',
      id: '2026-07-08T00-00-00-000Z',
    });
  });

  it('returns to recording when opened from the Recording footer', () => {
    expect(connectorReturnView({ kind: 'recording' })).toEqual({ kind: 'recording' });
  });

  it('falls back to recording when no origin was captured', () => {
    expect(connectorReturnView(undefined)).toEqual({ kind: 'recording' });
  });

  it('falls back to recording for degenerate origins (connector itself / booting)', () => {
    expect(connectorReturnView({ kind: 'connector' })).toEqual({ kind: 'recording' });
    expect(connectorReturnView({ kind: 'booting' })).toEqual({ kind: 'recording' });
  });
});

describe('dismissRoutesToFamilyPicking (B2/M17)', () => {
  const noKeyJob: BackgroundJob = {
    kind: 'note',
    status: 'error',
    progress: null,
    target: 'claude',
    message: 'CONNECTOR_NO_KEY',
    retry: { family: 'lecture' },
  };

  it('routes a live NO_KEY cloud failure (session still pending — the C-1 carve-out)', () => {
    expect(dismissRoutesToFamilyPicking(noKeyJob)).toBe(true);
  });

  it('matches a wrapped NO_KEY message (substring convention, like resolveCloudErrorActions)', () => {
    expect(
      dismissRoutesToFamilyPicking({ ...noKeyJob, message: 'Error: CONNECTOR_NO_KEY at ipc.ts:42' }),
    ).toBe(true);
  });

  it('does NOT route a History-regen NO_KEY failure (fromDumpId present — no live session behind it)', () => {
    expect(
      dismissRoutesToFamilyPicking({ ...noKeyJob, retry: { family: 'lecture', fromDumpId: 'D-1' } }),
    ).toBe(false);
  });

  it('does NOT route post-STT cloud failures (capture already freed — plain dismiss is safe)', () => {
    expect(
      dismissRoutesToFamilyPicking({
        ...noKeyJob,
        message: 'CONNECTOR_TIMEOUT:dump=D-1',
        retry: { family: 'lecture', fromDumpId: 'D-1' },
      }),
    ).toBe(false);
    expect(dismissRoutesToFamilyPicking({ ...noKeyJob, message: 'CONNECTOR_BAD_RESPONSE' })).toBe(false);
  });

  it('does NOT route on-device / transcript / running / done / absent jobs', () => {
    expect(
      dismissRoutesToFamilyPicking({ ...noKeyJob, target: 'ondevice', message: 'GENERATE_TIMEOUT' }),
    ).toBe(false);
    expect(
      dismissRoutesToFamilyPicking({ kind: 'transcript', status: 'error', progress: null, message: 'STT_STALLED' }),
    ).toBe(false);
    expect(dismissRoutesToFamilyPicking({ ...noKeyJob, status: 'running' })).toBe(false);
    expect(dismissRoutesToFamilyPicking({ ...noKeyJob, status: 'done' })).toBe(false);
    expect(dismissRoutesToFamilyPicking(null)).toBe(false);
  });
});

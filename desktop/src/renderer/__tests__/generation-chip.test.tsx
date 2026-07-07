/**
 * Task 10 — cloud-error chip fallback. `resolveCloudErrorActions` and
 * `backgroundProgressHint` are pure (exported from App.tsx for direct unit
 * testing); `GenerationChip`'s structure is verified via renderToStaticMarkup
 * (no DOM env in this package's vitest config — click wiring that fires
 * finalize/setView is verified in the live app, consistent with
 * HistoryList.test.tsx / NoteView.test.tsx / History.test.tsx).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  resolveCloudErrorActions,
  backgroundProgressHint,
  GenerationChip,
  type BackgroundJob,
} from '../App';

describe('resolveCloudErrorActions', () => {
  it('offers no actions for an on-device job (retry lives in History already)', () => {
    expect(resolveCloudErrorActions('ondevice', 'GENERATE_TIMEOUT')).toEqual([]);
  });

  it('offers no actions when target is absent (transcript jobs)', () => {
    expect(resolveCloudErrorActions(undefined, 'STT_STALLED')).toEqual([]);
  });

  it('offers only the on-device retry for a generic cloud error', () => {
    expect(resolveCloudErrorActions('claude', 'CONNECTOR_BAD_RESPONSE')).toEqual(['retry-ondevice']);
  });

  it('adds the settings shortcut for CONNECTOR_NO_KEY', () => {
    expect(resolveCloudErrorActions('claude', 'CONNECTOR_NO_KEY')).toEqual(['retry-ondevice', 'open-settings']);
  });

  it('adds the settings shortcut for CONNECTOR_AUTH_INVALID', () => {
    expect(resolveCloudErrorActions('claude', 'CONNECTOR_AUTH_INVALID')).toEqual(['retry-ondevice', 'open-settings']);
  });

  it('matches a wrapped error message (substring), not just an exact code', () => {
    expect(resolveCloudErrorActions('claude', 'Error: CONNECTOR_NO_KEY at ipc.ts:42')).toEqual([
      'retry-ondevice',
      'open-settings',
    ]);
  });

  it('treats an absent message as a generic cloud failure (retry only)', () => {
    expect(resolveCloudErrorActions('claude', undefined)).toEqual(['retry-ondevice']);
  });
});

describe('backgroundProgressHint', () => {
  const NOW = 1_700_000_010_000;

  it('shows the transcribing pct', () => {
    expect(backgroundProgressHint({ phase: 'transcribing', pct: 42, startedAt: NOW }, NOW)).toBe('42%');
  });

  it('shows the chunk index/total', () => {
    expect(
      backgroundProgressHint({ phase: 'chunk', chunkIndex: 1, totalChunks: 3, startedAt: NOW }, NOW),
    ).toBe('2/3');
  });

  it('shows elapsed time for the cloud phase (no chunk counts on the cloud path)', () => {
    const startedAt = NOW - 7_000;
    expect(backgroundProgressHint({ phase: 'cloud', startedAt }, NOW)).toBe('0:07');
  });

  it('is empty for a cloud phase with no startedAt', () => {
    expect(backgroundProgressHint({ phase: 'cloud' }, NOW)).toBe('');
  });

  it('is empty when there is no progress yet', () => {
    expect(backgroundProgressHint(null, NOW)).toBe('');
  });
});

describe('GenerationChip', () => {
  const noop = () => {};

  it('renders nothing when there is no job', () => {
    const html = renderToStaticMarkup(
      <GenerationChip job={null} onOpen={noop} onDismiss={noop} onRetryOndevice={noop} onOpenConnectorSettings={noop} />,
    );
    expect(html).toBe('');
  });

  it('a cloud note error shows the friendly JA message and an on-device retry action', () => {
    const job: BackgroundJob = {
      kind: 'note',
      status: 'error',
      progress: null,
      target: 'claude',
      message: 'CONNECTOR_BAD_RESPONSE',
    };
    const html = renderToStaticMarkup(
      <GenerationChip job={job} onOpen={noop} onDismiss={noop} onRetryOndevice={noop} onOpenConnectorSettings={noop} />,
    );
    expect(html).toContain('gen-chip-error');
    // toFriendlyJa(CONNECTOR_BAD_RESPONSE) — the raw code must never leak to the UI.
    expect(html).not.toContain('CONNECTOR_BAD_RESPONSE');
    expect(html).toContain('ノートの生成結果を読み取れませんでした');
    expect(html).toContain('gen-chip-retry-ondevice');
    expect(html).toContain('オンデバイスで再生成');
    expect(html).not.toContain('gen-chip-open-settings');
  });

  it('a CONNECTOR_NO_KEY cloud error additionally shows the settings shortcut', () => {
    const job: BackgroundJob = {
      kind: 'note',
      status: 'error',
      progress: null,
      target: 'claude',
      message: 'CONNECTOR_NO_KEY',
    };
    const html = renderToStaticMarkup(
      <GenerationChip job={job} onOpen={noop} onDismiss={noop} onRetryOndevice={noop} onOpenConnectorSettings={noop} />,
    );
    expect(html).toContain('gen-chip-retry-ondevice');
    expect(html).toContain('gen-chip-open-settings');
    expect(html).toContain('設定を開く');
  });

  it('an on-device note error shows neither the retry action nor a message (unchanged scope)', () => {
    const job: BackgroundJob = {
      kind: 'note',
      status: 'error',
      progress: null,
      target: 'ondevice',
      message: 'GENERATE_TIMEOUT',
    };
    const html = renderToStaticMarkup(
      <GenerationChip job={job} onOpen={noop} onDismiss={noop} onRetryOndevice={noop} onOpenConnectorSettings={noop} />,
    );
    expect(html).toContain('gen-chip-error');
    expect(html).not.toContain('gen-chip-retry-ondevice');
    expect(html).not.toContain('gen-chip-open-settings');
    expect(html).not.toContain('GENERATE_TIMEOUT');
  });

  it('a running cloud note job shows the Claude label', () => {
    const job: BackgroundJob = {
      kind: 'note',
      status: 'running',
      progress: { phase: 'cloud', startedAt: Date.now() },
      target: 'claude',
    };
    const html = renderToStaticMarkup(
      <GenerationChip job={job} onOpen={noop} onDismiss={noop} onRetryOndevice={noop} onOpenConnectorSettings={noop} />,
    );
    expect(html).toContain('gen-chip-running');
    expect(html).toContain('Claude');
  });
});

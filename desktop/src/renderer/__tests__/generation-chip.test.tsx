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
  extractDumpIdFromError,
  backgroundProgressHint,
  GenerationChip,
  type BackgroundJob,
} from '../App';

// C-1 — the cloud LIVE failure path appends `:dump=<id>` so the renderer can
// route the on-device retry through finalize-from-dump (the failed attempt froze
// the live capture lane but wrote transcript.json to the dump).
describe('extractDumpIdFromError', () => {
  it('extracts the dump id from a suffixed connector error', () => {
    expect(extractDumpIdFromError('CONNECTOR_RATE_LIMITED:dump=2026-07-08T00-00-00-000Z')).toBe(
      '2026-07-08T00-00-00-000Z',
    );
  });

  it('extracts from a wrapped-and-suffixed message (id is the final segment)', () => {
    expect(extractDumpIdFromError('Error: CONNECTOR_TIMEOUT at ipc.ts:42:dump=DUMP-9')).toBe('DUMP-9');
  });

  it('returns null when there is no suffix (on-device error)', () => {
    expect(extractDumpIdFromError('GENERATE_TIMEOUT')).toBeNull();
    expect(extractDumpIdFromError('Error: NO_ACTIVE_SESSION at ...')).toBeNull();
  });

  it('returns null for an absent / empty message', () => {
    expect(extractDumpIdFromError(undefined)).toBeNull();
    expect(extractDumpIdFromError('')).toBeNull();
  });
});

describe('resolveCloudErrorActions', () => {
  it('offers no actions for an on-device job (retry lives in History already)', () => {
    expect(resolveCloudErrorActions('ondevice', 'GENERATE_TIMEOUT')).toEqual([]);
  });

  it('offers no actions when target is absent (transcript jobs)', () => {
    expect(resolveCloudErrorActions(undefined, 'STT_STALLED')).toEqual([]);
  });

  // C-1 honest gate: a generic cloud error offers the on-device retry ONLY when
  // a from-dump route exists (production live-cloud failure ⇒ fromDumpId lifted
  // from the `:dump=<id>` suffix; History regen ⇒ fromDumpId from the start).
  it('offers the on-device retry for a generic cloud error WHEN a dump route exists', () => {
    expect(resolveCloudErrorActions('claude', 'CONNECTOR_BAD_RESPONSE', 'dump-1')).toEqual(['retry-ondevice']);
  });

  // C-1 honest gate: without a dump route (LISNA_DISABLE_SESSION_DUMP dev env / a
  // dump-create disk failure) the capture is freed and no dump survives, so the
  // dead on-device retry is suppressed rather than promised.
  it('suppresses the on-device retry for a generic cloud error with NO dump route', () => {
    expect(resolveCloudErrorActions('claude', 'CONNECTOR_BAD_RESPONSE', undefined)).toEqual([]);
  });

  // CONNECTOR_NO_KEY fires BEFORE STT, so the live capture is intact →
  // runFinalize('ondevice') works even without a dump. Both actions offered.
  it('offers retry + settings for CONNECTOR_NO_KEY even without a dump (live session intact)', () => {
    expect(resolveCloudErrorActions('claude', 'CONNECTOR_NO_KEY')).toEqual(['retry-ondevice', 'open-settings']);
  });

  // CONNECTOR_AUTH_INVALID is POST-STT (key rejected by Anthropic). In production
  // a dump survives → retry + settings; with no dump route only settings remain.
  it('offers retry + settings for CONNECTOR_AUTH_INVALID WHEN a dump route exists', () => {
    expect(resolveCloudErrorActions('claude', 'CONNECTOR_AUTH_INVALID', 'dump-1')).toEqual([
      'retry-ondevice',
      'open-settings',
    ]);
  });

  it('offers only settings for CONNECTOR_AUTH_INVALID with NO dump route (post-STT, no live session)', () => {
    expect(resolveCloudErrorActions('claude', 'CONNECTOR_AUTH_INVALID', undefined)).toEqual(['open-settings']);
  });

  it('matches a wrapped error message (substring), not just an exact code', () => {
    expect(resolveCloudErrorActions('claude', 'Error: CONNECTOR_NO_KEY at ipc.ts:42')).toEqual([
      'retry-ondevice',
      'open-settings',
    ]);
  });

  it('offers no actions for an absent message with no dump route (nothing to route to)', () => {
    expect(resolveCloudErrorActions('claude', undefined)).toEqual([]);
  });

  it('offers the on-device retry for an absent message WHEN a dump route exists', () => {
    expect(resolveCloudErrorActions('claude', undefined, 'dump-1')).toEqual(['retry-ondevice']);
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

  it('a cloud note error (with a dump route) shows the friendly JA message and an on-device retry action', () => {
    // Production live-cloud failure: main appended `:dump=<id>`, runFinalize lifted
    // it into retry.fromDumpId — so the on-device retry route exists (C-1).
    const job: BackgroundJob = {
      kind: 'note',
      status: 'error',
      progress: null,
      target: 'claude',
      message: 'CONNECTOR_BAD_RESPONSE:dump=DUMP-1',
      retry: { family: 'lecture', fromDumpId: 'DUMP-1' },
    };
    const html = renderToStaticMarkup(
      <GenerationChip job={job} onOpen={noop} onDismiss={noop} onRetryOndevice={noop} onOpenConnectorSettings={noop} />,
    );
    expect(html).toContain('gen-chip-error');
    // toFriendlyJa(CONNECTOR_BAD_RESPONSE) — neither the raw code nor the dump
    // routing suffix may leak to the UI.
    expect(html).not.toContain('CONNECTOR_BAD_RESPONSE');
    expect(html).not.toContain(':dump=');
    expect(html).toContain('ノートの生成結果を読み取れませんでした');
    expect(html).toContain('gen-chip-retry-ondevice');
    expect(html).toContain('オンデバイスで再生成');
    expect(html).not.toContain('gen-chip-open-settings');
  });

  it('a cloud note error with NO dump route suppresses the on-device retry (C-1 honest gate)', () => {
    // Dev-only dead case (LISNA_DISABLE_SESSION_DUMP): capture freed, no dump —
    // the chip must NOT promise an on-device retry that dead-ends in NO_ACTIVE_SESSION.
    const job: BackgroundJob = {
      kind: 'note',
      status: 'error',
      progress: null,
      target: 'claude',
      message: 'CONNECTOR_TIMEOUT',
      retry: { family: 'lecture' },
    };
    const html = renderToStaticMarkup(
      <GenerationChip job={job} onOpen={noop} onDismiss={noop} onRetryOndevice={noop} onOpenConnectorSettings={noop} />,
    );
    expect(html).toContain('gen-chip-error');
    // The friendly message still shows (the failure is real); only the dead retry
    // button is withheld.
    expect(html).toContain('Claudeの応答がタイムアウトしました');
    expect(html).not.toContain('gen-chip-retry-ondevice');
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

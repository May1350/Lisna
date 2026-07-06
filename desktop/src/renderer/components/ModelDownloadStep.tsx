import { useEffect, useState } from 'react';
import type { ModelStatus, ModelDownloadProgressPayload } from '@shared/ipc-protocol';
import { DEFAULT_MODELS } from '@shared/models/catalog';
import { toFriendlyJa } from '../i18n/error-message-map';
import { SETUP_STRINGS_JA } from '../i18n/setup-strings';

interface Props {
  /** Fired once the in-app download completes and models resolve to 'ready'
   *  (or 'needs-setup' — the caller decides what to do with a partial
   *  result; in practice SetupView expects 'ready' here). */
  onReady: (status: ModelStatus) => void;
  /** User already has model files on disk — fall back to the manual
   *  file-picker flow (ModelPickerStep) instead of downloading. */
  onUsePicker: () => void;
}

type DownloadPhase =
  | { kind: 'idle' }
  | { kind: 'downloading'; progress?: ModelDownloadProgressPayload }
  | { kind: 'error'; code: string };

/** Total download size, computed from the catalog (single source of truth) —
 *  NOT a hardcoded literal. 574_041_195 + 2_019_377_696 bytes ≈ 2.6 GB. */
const TOTAL_GB = ((DEFAULT_MODELS.stt.sizeBytes + DEFAULT_MODELS.llm.sizeBytes) / 1e9).toFixed(1);

function progressLabel(progress: ModelDownloadProgressPayload | undefined): string | null {
  if (!progress) return null;
  const name =
    progress.slot === 'stt' ? SETUP_STRINGS_JA.downloadingStt : SETUP_STRINGS_JA.downloadingLlm;
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;
  return `${name} ${pct}%`;
}

/**
 * In-app first-run model downloader — the download-first default step shown
 * by SetupView. Fetches both DEFAULT_MODELS slots via
 * `window.lisna.downloadModels`, showing per-slot progress from
 * `onModelDownloadProgress`. Users who already have model files can fall
 * back to the existing ModelPickerStep flow via `usePickerLink`.
 */
export function ModelDownloadStep({ onReady, onUsePicker }: Props) {
  const [phase, setPhase] = useState<DownloadPhase>({ kind: 'idle' });

  useEffect(() => {
    return window.lisna.onModelDownloadProgress((msg) => {
      setPhase((prev) => (prev.kind === 'downloading' ? { kind: 'downloading', progress: msg } : prev));
    });
  }, []);

  async function handleDownload(): Promise<void> {
    setPhase({ kind: 'downloading' });
    const result = await window.lisna.downloadModels();
    if (result.ok) {
      onReady(result.status);
    } else {
      setPhase({ kind: 'error', code: result.code });
    }
  }

  const busy = phase.kind === 'downloading';
  const label = phase.kind === 'downloading' ? progressLabel(phase.progress) : null;

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <h2>{SETUP_STRINGS_JA.downloadTitle}</h2>
      <p>{SETUP_STRINGS_JA.downloadBody(TOTAL_GB)}</p>
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button
          onClick={handleDownload}
          disabled={busy}
          data-testid="download-models"
          style={{ padding: '8px 16px', fontSize: 14 }}
        >
          {SETUP_STRINGS_JA.downloadButton}
        </button>
      </div>
      {busy && (
        <p data-testid="download-progress" style={{ marginTop: 16, color: '#888', fontSize: 14 }}>
          {label ?? SETUP_STRINGS_JA.downloadingStt}
        </p>
      )}
      {phase.kind === 'error' && (
        <div
          data-testid="download-error"
          style={{
            marginTop: 16,
            padding: 12,
            border: '1px solid #c33',
            borderRadius: 4,
            color: '#c33',
            background: '#fff5f5',
            fontSize: 14,
          }}
        >
          <p>{toFriendlyJa(phase.code)}</p>
          <button onClick={handleDownload} data-testid="download-retry" style={{ padding: '8px 16px', fontSize: 14 }}>
            {SETUP_STRINGS_JA.retryButton}
          </button>
        </div>
      )}
      <p style={{ marginTop: 24 }}>
        <a
          href="#"
          data-testid="use-picker"
          onClick={(e) => {
            e.preventDefault();
            onUsePicker();
          }}
        >
          {SETUP_STRINGS_JA.usePickerLink}
        </a>
      </p>
    </div>
  );
}

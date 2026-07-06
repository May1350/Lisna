import { useEffect, useState } from 'react';
import type { ModelStatus, ModelDownloadProgressPayload } from '@shared/ipc-protocol';
import { DEFAULT_MODELS } from '@shared/models/catalog';
import { toFriendlyJa } from '../i18n/error-message-map';
import { SETUP_STRINGS_JA } from '../i18n/setup-strings';
import { Spinner } from './Spinner';

interface Props {
  /** Fired once the in-app download completes and models resolve to 'ready'
   *  (or 'needs-setup' — SetupView decides what to do with a partial
   *  result). */
  onReady: (status: ModelStatus) => void;
}

type DownloadPhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
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
 * In-app first-run model downloader — dark centered-hero flow shown by
 * SetupView. Phase machine: idle (wordmark + CTA) → checking (spinner, while
 * `window.lisna.downloadModels` resolves whether anything even needs
 * fetching) → downloading (per-slot progress via `onModelDownloadProgress`)
 * → done (onReady) or error (retry). No manual-picker escape hatch — this
 * is the unconditional onboarding path (Task 3; picker removal).
 */
export function ModelDownloadStep({ onReady }: Props) {
  const [phase, setPhase] = useState<DownloadPhase>({ kind: 'idle' });

  useEffect(() => {
    return window.lisna.onModelDownloadProgress((msg) => {
      setPhase((prev) =>
        prev.kind === 'checking' || prev.kind === 'downloading'
          ? { kind: 'downloading', progress: msg }
          : prev,
      );
    });
  }, []);

  async function handleStart(): Promise<void> {
    setPhase({ kind: 'checking' });
    const result = await window.lisna.downloadModels();
    if (result.ok) {
      onReady(result.status);
    } else {
      setPhase({ kind: 'error', code: result.code });
    }
  }

  return (
    <div className="lz-onb" data-testid="onboarding-hero">
      {phase.kind === 'idle' && (
        <>
          <h1 className="lz-onb-word">{SETUP_STRINGS_JA.wordmark}</h1>
          <p className="lz-onb-body">{SETUP_STRINGS_JA.startBody}</p>
          <button className="lz-primary lz-onb-cta" onClick={handleStart} data-testid="start">
            {SETUP_STRINGS_JA.startButton}
          </button>
          <p className="lz-hint lz-onb-hint">{SETUP_STRINGS_JA.sizeDisclosure(TOTAL_GB)}</p>
        </>
      )}

      {phase.kind === 'checking' && (
        <>
          <Spinner size={28} thickness={3} />
          <h2 className="lz-onb-title">{SETUP_STRINGS_JA.checkingTitle}</h2>
          <p className="lz-onb-body">{SETUP_STRINGS_JA.checkingBody}</p>
        </>
      )}

      {phase.kind === 'downloading' && (
        <>
          <Spinner size={28} thickness={3} />
          <h2 className="lz-onb-title">{SETUP_STRINGS_JA.downloadTitle}</h2>
          <p className="lz-onb-body">{SETUP_STRINGS_JA.downloadBody2}</p>
          <p data-testid="download-progress" className="lz-hint lz-onb-hint">
            {progressLabel(phase.progress) ?? SETUP_STRINGS_JA.downloadingStt}
          </p>
        </>
      )}

      {phase.kind === 'error' && (
        <div data-testid="download-error" className="lz-onb-error">
          <p className="lz-onb-body">{toFriendlyJa(phase.code)}</p>
          <button className="lz-primary lz-onb-cta" onClick={handleStart} data-testid="download-retry">
            {SETUP_STRINGS_JA.retryButton}
          </button>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import type { ModelSlot, ModelStatus } from '@shared/ipc-protocol';
import { toFriendlyJa } from '../i18n/error-message-map';
import {
  SETUP_STRINGS_JA,
  DISCORD_CHANNEL_URL,
  isDiscordUrlConfigured,
} from '../i18n/setup-strings';

interface Props {
  slot: ModelSlot;
  stepIndicator: { current: 1 | 2; total: 2 };
  /** Re-launch case: preset error code for the missing slot. */
  initialError?: string;
  /** Called after a PASS — status is the authoritative ModelStatus returned
   *  by the main process (spec Decision #13). */
  onSuccess: (status: ModelStatus) => void;
}

/**
 * Single-slot picker step. Reused for STT (Step 1) and LLM (Step 2). Renders:
 *   - step indicator "ステップ N / 2"
 *   - slot-specific title (.bin / .gguf)
 *   - Discord channel hint body
 *   - ファイルを選択 button (triggers window.lisna.pickModel)
 *   - Discord を開く button (only when isDiscordUrlConfigured())
 *   - red inline error strip when error state set
 *
 * On pick FAIL, stores the error code locally and renders the JA copy via
 * toFriendlyJa (re-uses the same i18n map as ErrorView).
 */
export function ModelPickerStep({ slot, stepIndicator, initialError, onSuccess }: Props) {
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);

  const title = slot === 'stt' ? SETUP_STRINGS_JA.sttTitle : SETUP_STRINGS_JA.llmTitle;

  async function handlePick(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await window.lisna.pickModel(slot);
      if (result.ok) {
        onSuccess(result.status);
      } else {
        setError(result.code);
      }
    } finally {
      setBusy(false);
    }
  }

  function handleDiscord(): void {
    void window.lisna.openExternal(DISCORD_CHANNEL_URL);
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <p style={{ color: '#888', fontSize: 14 }}>
        {SETUP_STRINGS_JA.stepIndicator(stepIndicator.current, stepIndicator.total)}
      </p>
      <h2 style={{ marginTop: 8 }}>{title}</h2>
      <p>{SETUP_STRINGS_JA.body}</p>
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button
          onClick={handlePick}
          disabled={busy}
          data-testid={`pick-${slot}`}
          style={{ padding: '8px 16px', fontSize: 14 }}
        >
          {SETUP_STRINGS_JA.pickButton}
        </button>
        {isDiscordUrlConfigured() && (
          <button
            onClick={handleDiscord}
            data-testid="discord-open"
            style={{ padding: '8px 16px', fontSize: 14 }}
          >
            {SETUP_STRINGS_JA.discordButton}
          </button>
        )}
      </div>
      {error && (
        <div
          data-testid="picker-error"
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
          {toFriendlyJa(error)}
        </div>
      )}
    </div>
  );
}

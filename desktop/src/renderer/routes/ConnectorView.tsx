import { useEffect, useState } from 'react';
import { toFriendlyJa } from '../i18n/error-message-map';
import { CONNECTOR_STRINGS_JA as S } from '../i18n/connector-strings';

interface Props {
  onBack: () => void;
}

/** Local mirror of main/connector/ipc.ts's `ConnectorStatus` — kept as a
 *  structural shape (not a cross-layer import) so this file only depends on
 *  `window.lisna`'s already-global preload types. */
type ConnectorStatus = { connected: boolean };

/** The subset of `window.lisna` this view calls, extracted as an interface so
 *  the connect/disconnect submission logic below can be unit-tested with a
 *  fake client — this package's vitest config has no DOM env (no jsdom), so
 *  interaction wiring can't be driven through a rendered component the way
 *  `@testing-library/react` would; pure/injectable functions are the
 *  established substitute here (mirrors `shouldShowAudioNotice` /
 *  `applyBackgroundProgress` in App.tsx). */
export interface ConnectorLisnaClient {
  connectorStatus(): Promise<ConnectorStatus>;
  connectorConnect(apiKey: string): Promise<ConnectorStatus>;
  connectorDisconnect(): Promise<ConnectorStatus>;
}

type ConnectSubmitResult =
  | { ok: true; status: ConnectorStatus }
  | { ok: false; error: string };

/** Pure status → JA label mapper (unit-tested directly). */
export function connectorStatusLabel(connected: boolean): string {
  return connected ? S.statusConnected : S.statusDisconnected;
}

/**
 * Connect submission. Trims the typed key (whitespace-only is a no-op — the
 * connect button is also disabled in that state, mirroring TermsView's add()
 * dedup guard; this is a second line of defense for a direct Enter-key
 * submit). On success returns the new status (caller clears the input and
 * flips the status label). On failure, maps the thrown CONNECTOR_* code to
 * its JA copy via `toFriendlyJa` — never storing anything on failure (the
 * main-side handler already guarantees that; see connector/ipc.ts).
 */
export async function submitConnect(
  apiKey: string,
  lisna: ConnectorLisnaClient,
): Promise<ConnectSubmitResult | null> {
  const trimmed = apiKey.trim();
  if (!trimmed) return null;
  try {
    const status = await lisna.connectorConnect(trimmed);
    return { ok: true, status };
  } catch (err) {
    return { ok: false, error: toFriendlyJa(String((err as Error)?.message ?? err)) };
  }
}

/** Disconnect submission — trivial passthrough, extracted alongside
 *  submitConnect for the same DOM-less testability reason. */
export async function submitDisconnect(lisna: ConnectorLisnaClient): Promise<ConnectorStatus> {
  return lisna.connectorDisconnect();
}

/**
 * Claude連携 — connect/disconnect UX for the LLM connector (spec 2026-07-07
 * §7). The disclosure block is ALWAYS rendered above the API-key input (never
 * gated behind a click/expander). Native-Mac dense work surface: `--lz-*`
 * tokens only, no legal-pad decoration (that's web/-only per web-design.md's
 * scope-boundary rule).
 *
 * The key input never re-displays a stored key — when connected, the input
 * branch doesn't render at all; only a 解除 button does. A successful connect
 * clears the typed key from state immediately.
 *
 * `connected` defaults to `false` (pessimistic default, same pattern as
 * Recording.tsx's `systemAudioAvailable`: assume the safer/simpler state
 * until the `connectorStatus()` round-trip confirms otherwise) rather than a
 * separate loading state — a genuinely-connected reopen briefly shows 未接続
 * before the IPC round-trip resolves, which is an acceptable, established
 * trade-off in this codebase for a local IPC call.
 */
export function ConnectorView({ onBack }: Props) {
  const [connected, setConnected] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    window.lisna.connectorStatus().then((s) => {
      if (live) setConnected(s.connected);
    });
    return () => { live = false; };
  }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    const result = await submitConnect(apiKey, window.lisna);
    setBusy(false);
    if (!result) return; // empty/whitespace key — no-op
    if (result.ok) {
      setApiKey('');
      setConnected(result.status.connected);
    } else {
      setError(result.error);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    const next = await submitDisconnect(window.lisna);
    setBusy(false);
    setConnected(next.connected);
  }

  return (
    <section className="lz-pad" style={{ maxWidth: 620, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{S.title}</h2>
        <button data-testid="connector-back" onClick={onBack} style={{ marginLeft: 'auto' }}>
          {S.backLabel}
        </button>
      </header>

      <p className="lz-label" style={{ margin: '0 0 20px', textTransform: 'none', letterSpacing: 'normal' }}>
        {S.statusLabel}:{' '}
        <span
          style={{
            fontWeight: 500,
            color: connected ? 'var(--lz-success)' : 'var(--lz-text-2)',
          }}
        >
          {connectorStatusLabel(connected)}
        </span>
      </p>

      <div data-testid="connector-disclosure" style={{ marginBottom: 22 }}>
        {S.disclosure.map((line) => (
          <p key={line} className="lz-muted" style={{ fontSize: 13.5, lineHeight: 1.7, margin: '0 0 8px' }}>
            {line}
          </p>
        ))}
      </div>

      {connected && (
        <button
          className="lz-danger-outline"
          onClick={() => void disconnect()}
          disabled={busy}
          data-testid="connector-disconnect"
        >
          {busy ? S.disconnectingButton : S.disconnectButton}
        </button>
      )}

      {!connected && (
        <>
          <p className="lz-label">{S.apiKeyLabel}</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
              placeholder={S.apiKeyPlaceholder}
              aria-label={S.apiKeyLabel}
              autoComplete="off"
              style={{ flex: 1, padding: '9px 12px', fontSize: 14 }}
              data-testid="connector-key-input"
            />
            <button
              className="lz-primary"
              onClick={() => void connect()}
              disabled={busy || apiKey.trim().length === 0}
              data-testid="connector-connect"
            >
              {busy ? S.connectingButton : S.connectButton}
            </button>
          </div>
          {error && (
            <p style={{ color: 'var(--lz-record)', fontSize: 12.5, margin: '4px 0 0' }} data-testid="connector-error">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}

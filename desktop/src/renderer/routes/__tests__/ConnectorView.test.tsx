/**
 * ConnectorView — Claude連携 disclosure + connect/disconnect UX
 * (spec 2026-07-07 §7, Task 8).
 *
 * This package's vitest config has no DOM env (no jsdom) — consistent with
 * TermsView.test.tsx / ErrorView.test.tsx / NoteView.test.tsx / History.test.tsx,
 * click→callback interaction wiring is verified via the live app per CLAUDE.md
 * UI guidance, NOT here. What IS covered here:
 *   - Static structural markup (react-dom/server): the disclosure block
 *     renders BEFORE the API-key input, always, with all four disclosure
 *     points; the key input is masked; a back control is present.
 *   - The connect/disconnect submission logic, extracted from the component
 *     as pure/injectable async functions (submitConnect / submitDisconnect)
 *     that take a fake `lisna` client instead of reading `window.lisna` —
 *     the same DOM-less-testability extraction pattern this package already
 *     uses for `shouldShowAudioNotice` / `applyBackgroundProgress` in App.tsx.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ConnectorView,
  connectorStatusLabel,
  submitConnect,
  submitDisconnect,
  type ConnectorLisnaClient,
} from '../ConnectorView';
import { CONNECTOR_STRINGS_JA } from '../../i18n/connector-strings';

function fakeLisna(overrides: Partial<ConnectorLisnaClient> = {}): ConnectorLisnaClient {
  return {
    connectorStatus: vi.fn().mockResolvedValue({ connected: false }),
    connectorConnect: vi.fn().mockResolvedValue({ connected: true }),
    connectorDisconnect: vi.fn().mockResolvedValue({ connected: false }),
    ...overrides,
  };
}

describe('ConnectorView (static structure)', () => {
  it('renders the title and all four disclosure points BEFORE the API-key input', () => {
    const html = renderToStaticMarkup(<ConnectorView onBack={() => {}} />);
    expect(html).toContain(CONNECTOR_STRINGS_JA.title);
    for (const line of CONNECTOR_STRINGS_JA.disclosure) {
      expect(html).toContain(line);
    }
    const disclosureIdx = html.indexOf('connector-disclosure');
    const inputIdx = html.indexOf('connector-key-input');
    expect(disclosureIdx).toBeGreaterThan(-1);
    expect(inputIdx).toBeGreaterThan(disclosureIdx);
  });

  it('renders a masked (password) key input and a back control, default unconnected', () => {
    const html = renderToStaticMarkup(<ConnectorView onBack={() => {}} />);
    expect(html).toContain('type="password"');
    expect(html).toContain('connector-back');
    expect(html).toContain(CONNECTOR_STRINGS_JA.backLabel);
    expect(html).toContain(CONNECTOR_STRINGS_JA.statusDisconnected);
  });

  it('never renders a disconnect control before the connected status is known', () => {
    // Pessimistic default (connected=false) — the 解除 button only ever
    // appears once connectorStatus() resolves true, never on first paint.
    const html = renderToStaticMarkup(<ConnectorView onBack={() => {}} />);
    expect(html).not.toContain('connector-disconnect');
  });
});

describe('connectorStatusLabel', () => {
  it('maps connected/disconnected to the JA status copy', () => {
    expect(connectorStatusLabel(true)).toBe(CONNECTOR_STRINGS_JA.statusConnected);
    expect(connectorStatusLabel(false)).toBe(CONNECTOR_STRINGS_JA.statusDisconnected);
  });
});

describe('submitConnect', () => {
  it('calls connectorConnect with the TRIMMED typed key and returns the new status on success', async () => {
    const lisna = fakeLisna({ connectorConnect: vi.fn().mockResolvedValue({ connected: true }) });
    const result = await submitConnect('  sk-ant-abc123  ', lisna);
    expect(lisna.connectorConnect).toHaveBeenCalledWith('sk-ant-abc123');
    expect(result).toEqual({ ok: true, status: { connected: true } });
  });

  it("is a no-op for an empty/whitespace-only key (mirrors TermsView's add() guard)", async () => {
    const lisna = fakeLisna();
    const result = await submitConnect('   ', lisna);
    expect(lisna.connectorConnect).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('maps a rejected CONNECTOR_AUTH_INVALID error to its friendly JA message via toFriendlyJa', async () => {
    const lisna = fakeLisna({ connectorConnect: vi.fn().mockRejectedValue(new Error('CONNECTOR_AUTH_INVALID')) });
    const result = await submitConnect('bad-key', lisna);
    expect(result?.ok).toBe(false);
    expect(result && !result.ok && result.error).toBe(
      'APIキーが無効です。Anthropicコンソールで確認し、接続し直してください。',
    );
  });

  it('falls back to the unknown-error JA copy for an unrecognized rejection', async () => {
    const lisna = fakeLisna({ connectorConnect: vi.fn().mockRejectedValue(new Error('boom')) });
    const result = await submitConnect('some-key', lisna);
    expect(result?.ok).toBe(false);
    expect(result && !result.ok && result.error).toBe('予期しないエラーが発生しました。もう一度お試しください。');
  });
});

describe('submitDisconnect', () => {
  it('calls connectorDisconnect and returns the resulting status', async () => {
    const lisna = fakeLisna({ connectorDisconnect: vi.fn().mockResolvedValue({ connected: false }) });
    const result = await submitDisconnect(lisna);
    expect(lisna.connectorDisconnect).toHaveBeenCalled();
    expect(result).toEqual({ connected: false });
  });
});

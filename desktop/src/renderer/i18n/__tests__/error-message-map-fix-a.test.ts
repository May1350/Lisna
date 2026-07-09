/**
 * FIX-A (audit 2026-07-09 §H1/H2/M13) — split out of error-message-map.test.ts
 * (already at the file-size ceiling) per the FIX-A brief's <200-line rule.
 * Covers A5 (the two new CONNECTOR_* codes' JA copy) and A1.4's requirement
 * that the new `:<reason>` suffix on CONNECTOR_BAD_RESPONSE stacks safely
 * UNDER the pre-existing C-1 `:dump=<id>` suffix (session-finalize.ts) — both
 * toFriendlyJa's `.includes(code)` substring match and the `:dump=<id>`
 * extractor's `$`-anchored regex must keep working on the combined form.
 */
import { describe, it, expect } from 'vitest';
import { toFriendlyJa, ERROR_MESSAGE_MAP_JA, ALL_ERROR_CODES } from '../error-message-map';

describe('CONNECTOR_SERVER_BUSY (M13 — 5xx/529 classification)', () => {
  it('is registered with the exact JA copy from the FIX-A brief', () => {
    expect(ALL_ERROR_CODES).toContain('CONNECTOR_SERVER_BUSY');
    expect(ERROR_MESSAGE_MAP_JA.CONNECTOR_SERVER_BUSY).toBe(
      'Anthropicのサーバーが混み合っています。しばらくしてからもう一度お試しください。',
    );
  });

  it('resolves via toFriendlyJa (exact + wrapped substring)', () => {
    expect(toFriendlyJa('CONNECTOR_SERVER_BUSY')).toBe(ERROR_MESSAGE_MAP_JA.CONNECTOR_SERVER_BUSY);
    expect(toFriendlyJa('Error: CONNECTOR_SERVER_BUSY at claude-errors.ts:44')).toBe(
      ERROR_MESSAGE_MAP_JA.CONNECTOR_SERVER_BUSY,
    );
  });
});

describe('CONNECTOR_OUTPUT_TRUNCATED (H2 — never blind-retry a truncated response)', () => {
  it('is registered with the exact JA copy from the FIX-A brief', () => {
    expect(ALL_ERROR_CODES).toContain('CONNECTOR_OUTPUT_TRUNCATED');
    expect(ERROR_MESSAGE_MAP_JA.CONNECTOR_OUTPUT_TRUNCATED).toBe(
      'ノートが長すぎて生成しきれませんでした。オンデバイス生成をご利用いただくか、録音を分けてお試しください。',
    );
  });

  it('resolves via toFriendlyJa (exact + wrapped substring)', () => {
    expect(toFriendlyJa('CONNECTOR_OUTPUT_TRUNCATED')).toBe(ERROR_MESSAGE_MAP_JA.CONNECTOR_OUTPUT_TRUNCATED);
  });
});

describe('A1.4 — CONNECTOR_BAD_RESPONSE:<reason> stacks safely under :dump=<id>', () => {
  it('toFriendlyJa resolves the reason-suffixed AND dump-suffixed form to the base code copy', () => {
    const raw = 'CONNECTOR_BAD_RESPONSE:schema:decisions:dump=2026-07-08T00-00-00-000Z';
    expect(toFriendlyJa(raw)).toBe(ERROR_MESSAGE_MAP_JA.CONNECTOR_BAD_RESPONSE);
  });

  it('the :dump=<id> extractor ($-anchored, same regex as App.tsx extractDumpIdFromError) still finds the id past the :<reason> suffix', () => {
    const raw = 'CONNECTOR_BAD_RESPONSE:schema:decisions:dump=2026-07-08T00-00-00-000Z';
    const m = raw.match(/:dump=([^:]+)$/);
    expect(m?.[1]).toBe('2026-07-08T00-00-00-000Z');
  });

  it('resolves a lang-mismatch-reasoned form too', () => {
    expect(toFriendlyJa('CONNECTOR_BAD_RESPONSE:lang-mismatch')).toBe(
      ERROR_MESSAGE_MAP_JA.CONNECTOR_BAD_RESPONSE,
    );
  });

  it('resolves a parse-reasoned, dump-suffixed form too', () => {
    const raw = 'CONNECTOR_BAD_RESPONSE:parse:dump=DUMP-9';
    expect(toFriendlyJa(raw)).toBe(ERROR_MESSAGE_MAP_JA.CONNECTOR_BAD_RESPONSE);
    expect(raw.match(/:dump=([^:]+)$/)?.[1]).toBe('DUMP-9');
  });
});

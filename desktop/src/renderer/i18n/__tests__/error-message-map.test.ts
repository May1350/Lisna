import { describe, it, expect } from 'vitest';
import {
  toFriendlyJa,
  ERROR_MESSAGE_MAP_JA,
  UNKNOWN_ERROR_FALLBACK_JA,
  ALL_ERROR_CODES,
  type ErrorCode,
} from '../error-message-map';

describe('error-message-map (JA)', () => {
  it('covers all 21 known codes (Step 5 §3.2 + §5.1 + fabrication guard)', () => {
    // Coverage contract: every code we throw from anywhere in main/ has a
    // corresponding JA copy. This list is duplicated in main/ipc.ts and
    // main/sidecar/timeouts.ts as bare string throws — if a new code is
    // added there, this test fails until the map is extended.
    const expectedCodes: ErrorCode[] = [
      'MODELS_NOT_CONFIGURED',
      'SIDECAR_DOWN',
      'SIDECAR_GAVE_UP',
      'NO_ACTIVE_SESSION',
      'SESSION_NOT_READY',
      'SESSION_ACTIVE',
      'APP_QUIT',
      'UNSUPPORTED_LANGUAGE',
      'EMPTY_TRANSCRIPT',
      'NOTE_LANGUAGE_MISMATCH',
      'STT_TIMEOUT',
      'LLM_LOAD_TIMEOUT',
      'LLM_UNLOAD_TIMEOUT',
      'GENERATE_TIMEOUT',
      // Step 5 §5.1 — first-run model resolver
      'MODEL_FILE_MISSING_STT',
      'MODEL_FILE_MISSING_LLM',
      'INVALID_MAGIC_BYTES_STT',
      'INVALID_MAGIC_BYTES_LLM',
      'MODEL_READ_FAILED',
      'PICKER_CANCELLED',
      'MODEL_SAVE_FAILED',
    ];
    expect(ALL_ERROR_CODES).toEqual(expect.arrayContaining(expectedCodes));
    expect(ALL_ERROR_CODES).toHaveLength(expectedCodes.length);
    for (const code of expectedCodes) {
      expect(ERROR_MESSAGE_MAP_JA[code]).toBeTruthy();
    }
  });

  it('every JA string is non-empty and at least 6 chars (rough sanity)', () => {
    for (const code of ALL_ERROR_CODES) {
      const msg = ERROR_MESSAGE_MAP_JA[code]!;
      expect(msg.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('every JA string ends with a sentence terminator (。 or 。 + suggestion period)', () => {
    // Soft style guard — JA sentences should end with 「。」 not「.」or nothing.
    // The polite desu/masu register naturally produces this. A copy that
    // forgot the period (regression case) trips this check.
    for (const code of ALL_ERROR_CODES) {
      const msg = ERROR_MESSAGE_MAP_JA[code]!;
      expect(msg.endsWith('。')).toBe(true);
    }
  });

  it('uses polite desu/masu form (ADR §3) — contains です, ます, ません, or ください', () => {
    // ADR §3 locked the register. Quick heuristic: each copy must contain
    // at least one polite-form marker. Casual だ/である endings (which would
    // NOT contain these) will fail this check.
    //   - です: copula polite
    //   - ます: verb polite affirmative
    //   - ません: verb polite negative (e.g. サポートされていません)
    //   - ください: imperative polite ("please ~")
    for (const code of ALL_ERROR_CODES) {
      const msg = ERROR_MESSAGE_MAP_JA[code]!;
      const polite =
        msg.includes('です') ||
        msg.includes('ます') ||
        msg.includes('ません') ||
        msg.includes('ください');
      expect({ code, polite, msg }).toMatchObject({ polite: true });
    }
  });

  it('toFriendlyJa: exact code match returns mapped JA copy', () => {
    expect(toFriendlyJa('STT_TIMEOUT')).toBe(ERROR_MESSAGE_MAP_JA.STT_TIMEOUT);
    expect(toFriendlyJa('EMPTY_TRANSCRIPT')).toBe(ERROR_MESSAGE_MAP_JA.EMPTY_TRANSCRIPT);
  });

  it('toFriendlyJa: substring match (raw error like "Error: STT_TIMEOUT at ...") returns mapped copy', () => {
    // Real error objects often arrive as `Error: <CODE>` strings or with
    // additional context. The matcher must find embedded codes too.
    expect(toFriendlyJa('Error: STT_TIMEOUT')).toBe(ERROR_MESSAGE_MAP_JA.STT_TIMEOUT);
    expect(toFriendlyJa('something something SIDECAR_DOWN something')).toBe(
      ERROR_MESSAGE_MAP_JA.SIDECAR_DOWN,
    );
  });

  it('toFriendlyJa: unknown raw message returns the fallback JA copy', () => {
    expect(toFriendlyJa('completely unrecognized error string')).toBe(UNKNOWN_ERROR_FALLBACK_JA);
    expect(toFriendlyJa('')).toBe(UNKNOWN_ERROR_FALLBACK_JA);
  });

  it('UNKNOWN_ERROR_FALLBACK_JA is in polite desu/masu form', () => {
    expect(
      UNKNOWN_ERROR_FALLBACK_JA.includes('です') ||
        UNKNOWN_ERROR_FALLBACK_JA.includes('ます') ||
        UNKNOWN_ERROR_FALLBACK_JA.includes('ください'),
    ).toBe(true);
    expect(UNKNOWN_ERROR_FALLBACK_JA.endsWith('。')).toBe(true);
  });

  // §3.6 — give-up code MUST tell the user to restart, since the Restart Lisna
  // button is the only recovery path.
  it('SIDECAR_GAVE_UP copy mentions restart (再起動)', () => {
    expect(ERROR_MESSAGE_MAP_JA.SIDECAR_GAVE_UP).toMatch(/再起動/);
  });

  // §3.5 — timeout codes should hint at retry, since retry is the recovery.
  it('timeout codes (STT/LLM_LOAD/LLM_UNLOAD/GENERATE) hint at retry (もう一度)', () => {
    expect(ERROR_MESSAGE_MAP_JA.STT_TIMEOUT).toMatch(/もう一度|再度|再試行/);
    expect(ERROR_MESSAGE_MAP_JA.LLM_LOAD_TIMEOUT).toMatch(/もう一度|再度|再試行/);
    expect(ERROR_MESSAGE_MAP_JA.LLM_UNLOAD_TIMEOUT).toMatch(/もう一度|再度|再試行/);
    expect(ERROR_MESSAGE_MAP_JA.GENERATE_TIMEOUT).toMatch(/もう一度|再度|再試行/);
  });
});

// Fabrication guard (2026-06-12): NOTE_LANGUAGE_MISMATCH surfaces inside a
// CHUNK_FAILED:<i>:NOTE_LANGUAGE_MISMATCH:ratio=… message — substring
// resolution must map it to friendly copy with a retry hint (F1's
// 「ノートを作り直す」 is the recovery path).
describe('NOTE_LANGUAGE_MISMATCH (fabrication guard)', () => {
  it('resolves the wrapped CHUNK_FAILED form via substring match', () => {
    const raw = 'CHUNK_FAILED:0:NOTE_LANGUAGE_MISMATCH:ratio=0.012,checked=2841';
    expect(toFriendlyJa(raw)).toBe(ERROR_MESSAGE_MAP_JA.NOTE_LANGUAGE_MISMATCH);
  });

  it('copy hints at retry (もう一度/再度) per ADR §3.5 style', () => {
    expect(ERROR_MESSAGE_MAP_JA.NOTE_LANGUAGE_MISMATCH).toMatch(/もう一度|再度|再試行/);
  });
});

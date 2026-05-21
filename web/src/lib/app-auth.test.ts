import { describe, expect, it, vi } from 'vitest';

// Stub db so app-auth.ts module-load doesn't trigger env validation
// (env.ts runs Zod .refine() at import time; no .env.local exists in this worktree).
vi.mock('./db', () => ({ db: {} }));

import { generateExchangeCode, buildCallbackUrl } from './app-auth';

describe('app-auth pure helpers', () => {
  it('generateExchangeCode returns a 64-char hex string', () => {
    const code = generateExchangeCode();
    expect(code).toMatch(/^[a-f0-9]{64}$/);
  });
  it('two generated codes are unique', () => {
    const a = generateExchangeCode();
    const b = generateExchangeCode();
    expect(a).not.toBe(b);
  });
  it('buildCallbackUrl appends the code to the lisna:// callback', () => {
    const url = buildCallbackUrl('lisna://callback', 'abc123');
    expect(url).toBe('lisna://callback?code=abc123');
  });
  it('buildCallbackUrl handles a callback that already has query params', () => {
    const url = buildCallbackUrl('lisna://callback?foo=bar', 'abc123');
    expect(url).toBe('lisna://callback?foo=bar&code=abc123');
  });
  it('buildCallbackUrl rejects non-lisna schemes', () => {
    expect(() => buildCallbackUrl('https://evil.example.com/cb', 'abc')).toThrow(/scheme/i);
  });
});

import { describe, expect, it, vi } from 'vitest';

// Stub env so auth.ts (and its transitive db.ts import) doesn't throw at module load.
// NEXTAUTH_SECRET requires min(32); NEXTAUTH_URL requires a valid URL.
vi.mock('./env', () => ({
  env: {
    NEXTAUTH_URL: 'http://localhost:3000',
    NEXTAUTH_SECRET: 'smoke-test-secret-that-is-32-chars-long!!',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    RDS_PROXY_ENDPOINT: undefined,
    RDS_USERNAME: undefined,
    AWS_REGION: 'ap-northeast-1',
    RESEND_API_KEY: 're_test_smoke',
    EMAIL_FROM: 'auth@lisna.jp',
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
    GITHUB_CLIENT_ID: undefined,
    GITHUB_CLIENT_SECRET: undefined,
    APPLE_CLIENT_ID: undefined,
    APPLE_CLIENT_SECRET: undefined,
  },
}));

// next-auth v5 beta.31 imports "next/server" (no .js extension) from its lib/env.js.
// Next.js 16 ships server.js but has no package.json#exports entry for "./server",
// so Node's ESM resolver fails in the Vitest environment. We stub the entire
// next-auth module to return the four exports shape that auth.ts destructures.
// This is intentional: the smoke test validates the export contract, not NextAuth internals.
vi.mock('next-auth', () => {
  const NextAuth = (_config: unknown) => ({
    handlers: { GET: vi.fn(), POST: vi.fn() },
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: vi.fn(),
  });
  return { default: NextAuth };
});

// Stub provider imports (they also transitively depend on next/server in next-auth).
vi.mock('next-auth/providers/google', () => ({ default: vi.fn() }));
vi.mock('next-auth/providers/github', () => ({ default: vi.fn() }));
vi.mock('next-auth/providers/apple', () => ({ default: vi.fn() }));

// Stub Drizzle adapter (avoids pg Pool connection attempts in test env).
vi.mock('@auth/drizzle-adapter', () => ({ DrizzleAdapter: vi.fn(() => ({})) }));

describe('auth module', () => {
  it('exports handlers, signIn, signOut, auth', async () => {
    const mod = await import('./auth');
    expect(mod.handlers).toBeDefined();
    expect(typeof mod.signIn).toBe('function');
    expect(typeof mod.signOut).toBe('function');
    expect(typeof mod.auth).toBe('function');
  });
});

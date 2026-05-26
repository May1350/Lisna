import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// ── DB mock ──────────────────────────────────────────────────────────────────
// The handler looks up the authed user's email by payload.sub so it can pass
// it to evaluateModelDownloadFlag. We stub query() to return a user row.
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock('../../src/lib/db.js', () => ({
  query: queryMock,
  getPool: vi.fn(),
}))

// ── Secrets / env mock ───────────────────────────────────────────────────────
// Skip Secrets Manager; the handler calls loadAppSecrets() for side-effects.
// Return env vars needed by Env.parse(process.env) inside the handler.
vi.mock('../../src/lib/env.js', () => ({
  loadAppSecrets: vi.fn(async () => ({})),
  Env: {
    parse: vi.fn((_src: unknown) => ({
      MODEL_DOWNLOAD_ENABLED: 'allowlist',
      MODEL_DOWNLOAD_ROLLOUT_PCT: 0,
      MIN_SUPPORTED_APP_VERSION: '0.1.1',
      R2_ACCESS_KEY_ID: 'k',
      R2_SECRET_ACCESS_KEY: 's',
      R2_BUCKET: 'lisna-models-prod',
      R2_ENDPOINT_URL: 'https://test.r2.example',
      ALLOWLIST_EMAILS: 'alpha@lisna.jp',
    })),
  },
}))

// ── Manifest loader mock ─────────────────────────────────────────────────────
// Must be hoisted (vi.mock factory runs before top-level code, so a plain
// const isn't initialised yet when the factory executes).
const { loadAndSignManifestMock } = vi.hoisted(() => ({
  loadAndSignManifestMock: vi.fn().mockResolvedValue({
    manifest_version: 1,
    generated_at: '2026-05-25T10:00:00Z',
    cache_max_age_seconds: 604800,
    models: [{ slot: 'stt', id: 'kotoba-v2', sha256: 'abc123', url: 'https://signed.r2/' }],
  }),
}))
vi.mock('../../src/lib/manifest-loader.js', () => ({
  loadAndSignManifest: loadAndSignManifestMock,
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long-xxxxx'
})

beforeEach(() => {
  queryMock.mockReset()
  loadAndSignManifestMock.mockClear()
})

import { signJwt } from '../../src/lib/auth.js'
import { handler } from '../../src/handlers/models-manifest.js'

/**
 * Build a minimal API Gateway V2 event. The handler reads:
 *   event.headers['user-agent']      — UA parse + EOL gate
 *   event.headers.authorization      — withAuth Bearer unwrap
 */
function makeEvent(opts: { token?: string; ua?: string }) {
  const headers: Record<string, string> = {}
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  if (opts.ua !== undefined) headers['user-agent'] = opts.ua
  return {
    headers,
    requestContext: {},
  } as unknown as Parameters<typeof handler>[0]
}

describe('GET /v1/models/manifest', () => {
  it('returns 401 when Bearer token is missing', async () => {
    const res = await handler(makeEvent({ ua: 'Lisna/v0.2.0' }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')
    expect(res.statusCode).toBe(401)
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('returns 400 INVALID_USER_AGENT for a browser UA', async () => {
    const token = await signJwt({ sub: 'user-1', plan: 'free' }, 60)
    // DB returns email for the user (stub in case withAuth succeeds)
    queryMock.mockResolvedValueOnce([{ email: 'alpha@lisna.jp' }])

    const res = await handler(makeEvent({ token, ua: 'Mozilla/5.0 (Macintosh)' }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(String(res.body))).toEqual({ code: 'INVALID_USER_AGENT' })
  })

  it('returns 410 APP_VERSION_UNSUPPORTED + minimum for UA < MIN_SUPPORTED_APP_VERSION', async () => {
    const token = await signJwt({ sub: 'user-1', plan: 'free' }, 60)
    queryMock.mockResolvedValueOnce([{ email: 'alpha@lisna.jp' }])

    // v0.1.0 is below MIN=0.1.1
    const res = await handler(makeEvent({ token, ua: 'Lisna/v0.1.0' }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')
    expect(res.statusCode).toBe(410)
    const body = JSON.parse(String(res.body))
    expect(body.code).toBe('APP_VERSION_UNSUPPORTED')
    expect(body.minimum).toBe('0.1.1')
    expect(loadAndSignManifestMock).not.toHaveBeenCalled()
  })

  it('returns 503 NOT_IN_ALLOWLIST for a user whose email is not on the allowlist', async () => {
    const token = await signJwt({ sub: 'user-outsider', plan: 'free' }, 60)
    queryMock.mockResolvedValueOnce([{ email: 'outsider@example.com' }])

    const res = await handler(makeEvent({ token, ua: 'Lisna/v0.2.0' }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(String(res.body))).toEqual({ code: 'NOT_IN_ALLOWLIST' })
    expect(loadAndSignManifestMock).not.toHaveBeenCalled()
  })

  it('returns 200 + manifest body for allowlisted user with valid UA', async () => {
    const token = await signJwt({ sub: 'founder-uuid', plan: 'pro' }, 60)
    queryMock.mockResolvedValueOnce([{ email: 'alpha@lisna.jp' }])

    const res = await handler(makeEvent({ token, ua: 'Lisna/v0.2.0' }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')
    expect(res.statusCode).toBe(200)
    expect(res.headers?.['Content-Type']).toBe('application/json')
    const body = JSON.parse(String(res.body))
    expect(body.manifest_version).toBe(1)
    expect(body.models).toHaveLength(1)
    expect(body.models[0].url).toBe('https://signed.r2/')

    // Manifest loader must have been called with correct R2 config
    expect(loadAndSignManifestMock).toHaveBeenCalledOnce()
    const callArg = loadAndSignManifestMock.mock.calls[0][0]
    expect(callArg.r2.bucket).toBe('lisna-models-prod')
    expect(callArg.urlTtlSec).toBe(3600)
  })
})

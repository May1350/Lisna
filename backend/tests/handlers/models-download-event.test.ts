import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// ── insertDownloadEvent mock ──────────────────────────────────────────────────
const { insertDownloadEventMock } = vi.hoisted(() => ({
  insertDownloadEventMock: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/lib/telemetry-models.js', () => ({
  insertDownloadEvent: insertDownloadEventMock,
}))

// ── DB / pool mock ────────────────────────────────────────────────────────────
// The handler calls query() for the email lookup (flag gate) and getPool()
// to pass to insertDownloadEvent.
const { queryMock, getPoolMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getPoolMock: vi.fn().mockResolvedValue({ query: vi.fn() }),
}))
vi.mock('../../src/lib/db.js', () => ({
  query: queryMock,
  getPool: getPoolMock,
}))

// ── Secrets / env mock ────────────────────────────────────────────────────────
vi.mock('../../src/lib/env.js', () => ({
  loadAppSecrets: vi.fn(async () => ({})),
  loadModelDownloadSecrets: vi.fn(async () => ({})),
  Env: {
    parse: vi.fn((_src: unknown) => ({
      MODEL_DOWNLOAD_ENABLED: 'allowlist',
      MODEL_DOWNLOAD_ROLLOUT_PCT: 0,
      MIN_SUPPORTED_APP_VERSION: '0.1.1',
      ALLOWLIST_EMAILS: 'alpha@lisna.jp',
    })),
  },
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long-xxxxx'
})

beforeEach(() => {
  queryMock.mockReset()
  insertDownloadEventMock.mockReset()
  insertDownloadEventMock.mockResolvedValue(undefined)
  getPoolMock.mockReset()
  getPoolMock.mockResolvedValue({ query: vi.fn() })
})

import { signJwt } from '../../src/lib/auth.js'
import { handler } from '../../src/handlers/models-download-event.js'

/** Minimal valid event body */
const VALID_BODY = {
  event: 'download.start',
  event_id: '11111111-1111-4111-8111-111111111111',
  timestamp: '2026-05-25T10:00:00.000Z',
  device_id: '22222222-2222-4222-8222-222222222222',
  app_version: '0.2.0',
  os_family: 'darwin',
  arch: 'arm64',
  source_intent: 'meeting',
  payload: { model_id: 'kotoba-v2' },
}

/**
 * Build a minimal API Gateway V2 event.
 */
function makeEvent(opts: {
  token?: string
  ua?: string
  body?: unknown
  identifyHeader?: boolean
}) {
  const headers: Record<string, string> = {}
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  if (opts.ua !== undefined) headers['user-agent'] = opts.ua
  if (opts.identifyHeader) headers['x-lisna-telemetry-identify'] = '1'
  return {
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : JSON.stringify(VALID_BODY),
    requestContext: {},
  } as unknown as Parameters<typeof handler>[0]
}

describe('POST /v1/models/download-event', () => {
  it('inserts event with device_id only (no user_id) when identify header absent', async () => {
    const token = await signJwt({ sub: 'founder-uuid', plan: 'pro' }, 60)
    // query() used for email lookup in flag gate
    queryMock.mockResolvedValueOnce([{ email: 'alpha@lisna.jp' }])
    const fakePool = { query: vi.fn() }
    getPoolMock.mockResolvedValueOnce(fakePool)

    const res = await handler(
      makeEvent({ token, ua: 'Lisna/v0.2.0', identifyHeader: false }),
      {} as never,
      () => {},
    )

    if (!res || typeof res !== 'object' || !('statusCode' in res)) {
      throw new Error('expected response object')
    }
    expect(res.statusCode).toBe(204)
    expect(res.body).toBeFalsy()

    expect(insertDownloadEventMock).toHaveBeenCalledOnce()
    const [_pool, row] = insertDownloadEventMock.mock.calls[0]
    expect(row.device_id).toBe(VALID_BODY.device_id)
    expect(row.user_id).toBeNull()
    expect(row.event_type).toBe('download.start')
  })

  it('inserts event with user_id populated when X-Lisna-Telemetry-Identify: 1', async () => {
    const token = await signJwt({ sub: 'founder-uuid', plan: 'pro' }, 60)
    queryMock.mockResolvedValueOnce([{ email: 'alpha@lisna.jp' }])
    const fakePool = { query: vi.fn() }
    getPoolMock.mockResolvedValueOnce(fakePool)

    const res = await handler(
      makeEvent({ token, ua: 'Lisna/v0.2.0', identifyHeader: true }),
      {} as never,
      () => {},
    )

    if (!res || typeof res !== 'object' || !('statusCode' in res)) {
      throw new Error('expected response object')
    }
    expect(res.statusCode).toBe(204)

    expect(insertDownloadEventMock).toHaveBeenCalledOnce()
    const [_pool, row] = insertDownloadEventMock.mock.calls[0]
    expect(row.user_id).toBe('founder-uuid')
    expect(row.device_id).toBe(VALID_BODY.device_id)
  })

  it('returns 400 INVALID_EVENT_BODY for body with unknown event type', async () => {
    const token = await signJwt({ sub: 'founder-uuid', plan: 'pro' }, 60)
    queryMock.mockResolvedValueOnce([{ email: 'alpha@lisna.jp' }])

    const badBody = { ...VALID_BODY, event: 'unknown.event.type' }
    const res = await handler(
      makeEvent({ token, ua: 'Lisna/v0.2.0', body: badBody }),
      {} as never,
      () => {},
    )

    if (!res || typeof res !== 'object' || !('statusCode' in res)) {
      throw new Error('expected response object')
    }
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(String(res.body))
    expect(body.code).toBe('INVALID_EVENT_BODY')
    expect(body.detail).toBeDefined()
    expect(insertDownloadEventMock).not.toHaveBeenCalled()
  })

  it('returns 503 when flag=off and does not insert any event', async () => {
    // Override Env.parse to return flag=off for this test
    const { Env } = await import('../../src/lib/env.js')
    vi.mocked(Env.parse).mockReturnValueOnce({
      MODEL_DOWNLOAD_ENABLED: 'off',
      MODEL_DOWNLOAD_ROLLOUT_PCT: 0,
      MIN_SUPPORTED_APP_VERSION: '0.1.1',
      ALLOWLIST_EMAILS: 'alpha@lisna.jp',
    } as ReturnType<typeof Env.parse>)

    const token = await signJwt({ sub: 'founder-uuid', plan: 'pro' }, 60)
    queryMock.mockResolvedValueOnce([{ email: 'alpha@lisna.jp' }])

    const res = await handler(
      makeEvent({ token, ua: 'Lisna/v0.2.0' }),
      {} as never,
      () => {},
    )

    if (!res || typeof res !== 'object' || !('statusCode' in res)) {
      throw new Error('expected response object')
    }
    expect(res.statusCode).toBe(503)
    expect(insertDownloadEventMock).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// Mock the DB layer so the handler runs without a live Postgres. The
// handler is a single UPDATE...RETURNING — we only need to control what
// rows the mock returns to assert the 204 / 404 branching.
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock('../src/lib/db.js', () => ({
  query: queryMock,
  getPool: vi.fn(),
}))

// Skip Secrets Manager — handler awaits it for side effects only.
vi.mock('../src/lib/env.js', () => ({
  loadAppSecrets: vi.fn(async () => ({})),
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long-xxxxx'
})

beforeEach(() => {
  queryMock.mockReset()
})

import { signJwt } from '../src/lib/auth.js'
import { handler } from '../src/handlers/session-delete.js'

function makeEvent(opts: { token?: string; id?: string }) {
  return {
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    pathParameters: opts.id ? { id: opts.id } : undefined,
    requestContext: {},
  } as unknown as Parameters<typeof handler>[0]
}

describe('DELETE /v1/sessions/{id}', () => {
  it('rejects missing Bearer header with 401, no DB call', async () => {
    const res = await handler(makeEvent({ id: 'abc' }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')
    expect(res.statusCode).toBe(401)
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('rejects invalid JWT with 401, no DB call', async () => {
    const res = await handler(makeEvent({ token: 'not-a-jwt', id: 'abc' }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')
    expect(res.statusCode).toBe(401)
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('returns 400 when path param id is missing', async () => {
    const token = await signJwt({ sub: 'user-1', plan: 'free' }, 60)
    const res = await handler(makeEvent({ token }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')
    expect(res.statusCode).toBe(400)
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('returns 204 on owned + active session (UPDATE returns 1 row)', async () => {
    queryMock.mockResolvedValueOnce([{ id: 'sess-123' }])
    const token = await signJwt({ sub: 'user-1', plan: 'free' }, 60)
    const res = await handler(makeEvent({ token, id: 'sess-123' }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')
    expect(res.statusCode).toBe(204)

    // Confirm the defense-in-depth user_id filter is wired into params.
    expect(queryMock).toHaveBeenCalledTimes(1)
    const [, params] = queryMock.mock.calls[0]
    expect(params).toEqual(['sess-123', 'user-1'])
  })

  it('returns 404 with {error:"not_found"} on foreign UUID (0 rows)', async () => {
    queryMock.mockResolvedValueOnce([])
    const token = await signJwt({ sub: 'user-1', plan: 'free' }, 60)
    const res = await handler(makeEvent({ token, id: 'sess-foreign' }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')
    expect(res.statusCode).toBe(404)
    expect(res.headers?.['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(res.body))).toEqual({ error: 'not_found' })
  })

  it('returns 404 on already-deleted session (WHERE status != deleted excludes)', async () => {
    // Same wire shape as foreign-uuid: WHERE clause filters it out, RETURNING is empty.
    // The handler intentionally collapses both cases to 404 to avoid leaking ownership.
    queryMock.mockResolvedValueOnce([])
    const token = await signJwt({ sub: 'user-1', plan: 'free' }, 60)
    const res = await handler(makeEvent({ token, id: 'sess-deleted' }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')
    expect(res.statusCode).toBe(404)
  })

  it('propagates DB error (handler does not try-catch the UPDATE)', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection terminated'))
    const token = await signJwt({ sub: 'user-1', plan: 'free' }, 60)
    await expect(
      handler(makeEvent({ token, id: 'sess-1' }), {} as never, () => {})
    ).rejects.toThrow('connection terminated')
  })
})

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// Mock the DB layer + curator so the handler exercises only its lock /
// validation / try-finally logic without hitting Postgres or a live LLM.
const { queryMock, curateOutlineMock, sendToSessionMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  curateOutlineMock: vi.fn(),
  sendToSessionMock: vi.fn(async () => {}),
}))

vi.mock('../src/lib/db.js', () => ({
  query: queryMock,
  getPool: vi.fn(),
}))

vi.mock('../src/lib/env.js', () => ({
  loadAppSecrets: vi.fn(async () => ({})),
}))

vi.mock('../src/lib/curator.js', () => ({
  curateOutline: curateOutlineMock,
}))

vi.mock('../src/lib/ws-broadcast.js', () => ({
  sendToSession: sendToSessionMock,
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long-xxxxx'
})

beforeEach(() => {
  queryMock.mockReset()
  curateOutlineMock.mockReset()
  sendToSessionMock.mockClear()
})

import { signJwt } from '../src/lib/auth.js'
import { handler } from '../src/handlers/session-curate.js'

// Valid v4 UUID — Zod's z.string().uuid() in zod v4 enforces RFC 4122
// version + variant nibbles, so '11111111-2222-...' would be rejected.
const SESSION_ID = '11111111-2222-4333-8444-555555555555'

function makeEvent(opts: { token?: string; body?: unknown; raw?: string }) {
  return {
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    body: opts.raw !== undefined ? opts.raw : opts.body !== undefined ? JSON.stringify(opts.body) : '',
    requestContext: { requestId: 'test-rid' },
  } as unknown as Parameters<typeof handler>[0]
}

function makeOutline() {
  return { title: 'T', sections: [{ heading: 'H', ts: 0, points: [] }] }
}

describe('POST /v1/session/curate', () => {
  it('returns 401 when Bearer is missing', async () => {
    const res = await handler(makeEvent({ body: { session_id: SESSION_ID } }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')
    expect(res.statusCode).toBe(401)
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('throws on body validation failure (Zod) — caller surfaces 400', async () => {
    const token = await signJwt({ sub: 'user-1', plan: 'free' }, 60)
    // Missing session_id → Zod throws. Handler intentionally does not
    // catch this; the API Gateway runtime maps it to 400. We just assert
    // that the body-parse path explodes loudly when invalid.
    await expect(
      handler(makeEvent({ token, body: {} }), {} as never, () => {})
    ).rejects.toThrow()
  })

  it('happy path: lock acquired → curator runs → outline persisted → lock released', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: SESSION_ID }])                          // lock UPDATE
      .mockResolvedValueOnce([{ transcripts: [{ ts: 0, text: 'hello' }], outline: null }]) // SELECT
      .mockResolvedValueOnce([])                                            // outline UPDATE
      .mockResolvedValueOnce([])                                            // lock release UPDATE
    curateOutlineMock.mockResolvedValueOnce(makeOutline())

    const token = await signJwt({ sub: 'user-1', plan: 'free' }, 60)
    const res = await handler(
      makeEvent({ token, body: { session_id: SESSION_ID } }),
      {} as never,
      () => {},
    )
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(String(res.body))
    expect(body.outline).toMatchObject({ title: 'T' })
    expect(curateOutlineMock).toHaveBeenCalledTimes(1)
    expect(queryMock).toHaveBeenCalledTimes(4)

    // Final query must be the lock-release setting curate_lock_at = NULL.
    const lastSql = queryMock.mock.calls[queryMock.mock.calls.length - 1][0] as string
    expect(lastSql).toMatch(/curate_lock_at = NULL/)
    const lastParams = queryMock.mock.calls[queryMock.mock.calls.length - 1][1]
    expect(lastParams).toEqual([SESSION_ID, 'user-1'])
  })

  it('returns 409 curate_in_progress when lock unavailable but session is owned', async () => {
    queryMock
      .mockResolvedValueOnce([])                          // lock UPDATE: 0 rows (busy or wrong owner)
      .mockResolvedValueOnce([{ id: SESSION_ID }])        // ownership probe finds it → busy

    const token = await signJwt({ sub: 'user-1', plan: 'free' }, 60)
    const res = await handler(
      makeEvent({ token, body: { session_id: SESSION_ID } }),
      {} as never,
      () => {},
    )
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(String(res.body))).toEqual({ error: 'curate_in_progress' })
    expect(curateOutlineMock).not.toHaveBeenCalled()
  })

  it('returns 404 when lock unavailable and ownership probe finds nothing', async () => {
    queryMock
      .mockResolvedValueOnce([])  // lock UPDATE: 0 rows
      .mockResolvedValueOnce([])  // ownership probe: nothing

    const token = await signJwt({ sub: 'user-1', plan: 'free' }, 60)
    const res = await handler(
      makeEvent({ token, body: { session_id: SESSION_ID } }),
      {} as never,
      () => {},
    )
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(404)
    expect(JSON.parse(String(res.body))).toEqual({ error: 'session not found' })
    expect(curateOutlineMock).not.toHaveBeenCalled()
  })

  it('returns 200 with no_transcripts_yet when transcripts are empty (no curator call, lock still released)', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: SESSION_ID }])         // lock UPDATE
      .mockResolvedValueOnce([{ transcripts: [], outline: null }]) // SELECT — empty
      .mockResolvedValueOnce([])                           // lock release UPDATE

    const token = await signJwt({ sub: 'user-1', plan: 'free' }, 60)
    const res = await handler(
      makeEvent({ token, body: { session_id: SESSION_ID } }),
      {} as never,
      () => {},
    )
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(String(res.body))).toEqual({ outline: null, reason: 'no_transcripts_yet' })
    expect(curateOutlineMock).not.toHaveBeenCalled()

    // The finally block must still run a lock-release UPDATE.
    const lastSql = queryMock.mock.calls[queryMock.mock.calls.length - 1][0] as string
    expect(lastSql).toMatch(/curate_lock_at = NULL/)
  })

  it('returns 502 curator_failed when curateOutline throws, lock still released', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: SESSION_ID }])                          // lock UPDATE
      .mockResolvedValueOnce([{ transcripts: [{ ts: 0, text: 'hi' }], outline: null }]) // SELECT
      .mockResolvedValueOnce([])                                            // lock release UPDATE
    curateOutlineMock.mockRejectedValueOnce(new Error('llm timeout'))

    const token = await signJwt({ sub: 'user-1', plan: 'free' }, 60)
    const res = await handler(
      makeEvent({ token, body: { session_id: SESSION_ID } }),
      {} as never,
      () => {},
    )
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(502)
    const body = JSON.parse(String(res.body))
    expect(body.error).toBe('curator_failed')
    expect(body.message).toBe('llm timeout')

    // Confirm the finally block fired despite the curator throw.
    const lastSql = queryMock.mock.calls[queryMock.mock.calls.length - 1][0] as string
    expect(lastSql).toMatch(/curate_lock_at = NULL/)
  })
})

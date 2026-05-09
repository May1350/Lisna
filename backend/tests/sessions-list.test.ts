import { describe, it, expect, vi, beforeAll } from 'vitest'

// Mock the DB layer so the handler can run without a live Postgres. The
// handler builds its response purely from query() rows + the JWT sub, so
// a small fixture is enough to assert the wire-shape contract that the
// extension's SessionHistory.tsx depends on.
//
// vi.hoisted() is required because vi.mock() runs before module top-level
// code; a plain `const queryMock = vi.fn()` would not exist yet when the
// factory executes.
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock('../src/lib/db.js', () => ({
  query: queryMock,
  getPool: vi.fn(),
}))

// Skip Secrets Manager — the handler only awaits this for side-effects.
vi.mock('../src/lib/env.js', () => ({
  loadAppSecrets: vi.fn(async () => ({})),
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long-xxxxx'
})

import { signJwt } from '../src/lib/auth.js'
import { handler } from '../src/handlers/sessions-list.js'

function makeEvent(token?: string) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    queryStringParameters: undefined,
    requestContext: {},
  } as unknown as Parameters<typeof handler>[0]
}

describe('GET /v1/sessions', () => {
  it('rejects missing Bearer token with 401', async () => {
    const res = await handler(makeEvent(), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')
    expect(res.statusCode).toBe(401)
  })

  it('rejects invalid token with 401', async () => {
    const res = await handler(makeEvent('not-a-jwt'), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')
    expect(res.statusCode).toBe(401)
  })

  it('returns ISO-coerced timestamps + numeric slide_count + null title for un-curated sessions', async () => {
    const created = new Date('2026-05-01T10:00:00Z')
    const updated = new Date('2026-05-08T12:34:56Z')
    queryMock.mockResolvedValueOnce([
      // Curated session: outline title present, slides as JSON int.
      {
        id: 'sess-1',
        url: 'https://example.com/lecture-a',
        title: 'Lecture A',
        status: 'idle',
        slide_count: 3,
        has_outline: true,
        created_at: created,
        updated_at: updated,
      },
      // Un-curated session: outline NULL → title NULL, jsonb_array_length
      // arrives as a stringified bigint — must round-trip as number.
      {
        id: 'sess-2',
        url: 'https://example.com/lecture-b',
        title: null,
        status: 'recording',
        slide_count: '0',
        has_outline: false,
        created_at: '2026-04-30T08:00:00Z',
        updated_at: '2026-04-30T08:30:00Z',
      },
    ])

    const token = await signJwt({ sub: 'user-xyz', plan: 'free' }, 60)
    const res = await handler(makeEvent(token), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(200)
    expect(res.headers?.['Content-Type']).toBe('application/json')
    const body = JSON.parse(String(res.body))
    expect(body.sessions).toHaveLength(2)

    expect(body.sessions[0]).toEqual({
      id: 'sess-1',
      url: 'https://example.com/lecture-a',
      title: 'Lecture A',
      status: 'idle',
      slide_count: 3,
      has_outline: true,
      created_at: '2026-05-01T10:00:00.000Z',
      updated_at: '2026-05-08T12:34:56.000Z',
    })

    // Number coercion: even though pg handed us "0" as a string, the
    // wire shape must be a number primitive.
    expect(typeof body.sessions[1].slide_count).toBe('number')
    expect(body.sessions[1].slide_count).toBe(0)
    expect(body.sessions[1].title).toBeNull()
    expect(body.sessions[1].has_outline).toBe(false)
  })
})

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// Mock DB query, the Google verifiers, and signJwt. The handler does
// not need a live network or DB to exercise its branching: zod refine,
// upsert wire-shape, currentSession eager-load, and the catch-all 400.
const {
  queryMock,
  verifyGoogleIdTokenMock,
  verifyGoogleAccessTokenMock,
  signJwtMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  verifyGoogleIdTokenMock: vi.fn(),
  verifyGoogleAccessTokenMock: vi.fn(),
  signJwtMock: vi.fn(async () => 'fake.jwt.token'),
}))

vi.mock('../src/lib/db.js', () => ({
  query: queryMock,
  getPool: vi.fn(),
}))

vi.mock('../src/lib/env.js', () => ({
  loadAppSecrets: vi.fn(async () => ({})),
}))

// Mock the whole auth module so verifyGoogle{Id,Access}Token are stubs and
// signJwt can be observed without touching jose. The handler does not
// import anything else from this module.
vi.mock('../src/lib/auth.js', () => ({
  verifyGoogleIdToken: verifyGoogleIdTokenMock,
  verifyGoogleAccessToken: verifyGoogleAccessTokenMock,
  signJwt: signJwtMock,
}))

beforeAll(() => {
  // Not strictly needed since signJwt is mocked, but keep the env shape
  // consistent with other tests so any downstream import that touches
  // getSecret() does not blow up.
  process.env.JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long-xxxxx'
})

beforeEach(() => {
  queryMock.mockReset()
  verifyGoogleIdTokenMock.mockReset()
  verifyGoogleAccessTokenMock.mockReset()
  signJwtMock.mockClear()
})

import { handler } from '../src/handlers/auth-google.js'

function makeEvent(body: unknown) {
  return {
    headers: {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
    requestContext: {},
  } as unknown as Parameters<typeof handler>[0]
}

describe('POST /v1/auth/google', () => {
  it('returns 400 when neither id_token nor access_token is provided (Zod refine)', async () => {
    const res = await handler(makeEvent({}), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')
    expect(res.statusCode).toBe(400)
    expect(verifyGoogleAccessTokenMock).not.toHaveBeenCalled()
    expect(verifyGoogleIdTokenMock).not.toHaveBeenCalled()
  })

  it('returns 400 with the underlying error message when verifyGoogleAccessToken throws', async () => {
    verifyGoogleAccessTokenMock.mockRejectedValueOnce(new Error('Token aud mismatch'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await handler(makeEvent({ access_token: 'bad' }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(String(res.body))).toEqual({ error: 'Token aud mismatch' })
    // The breadcrumb commit added today logs message + stack on this path.
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('returns {token, user, currentSession:null} for a valid access_token (no current_url)', async () => {
    verifyGoogleAccessTokenMock.mockResolvedValueOnce({
      sub: 'g-sub-1',
      email: 'a@example.com',
      name: 'Alice',
      email_verified: true,
    })
    queryMock.mockResolvedValueOnce([{ id: 'user-uuid-1', plan: 'free' }]) // UPSERT RETURNING

    const res = await handler(makeEvent({ access_token: 'good' }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(String(res.body))
    expect(body.token).toBe('fake.jwt.token')
    expect(body.user).toEqual({ id: 'user-uuid-1', email: 'a@example.com', name: 'Alice', plan: 'free' })
    expect(body.currentSession).toBeNull()

    // The session eager-load query is gated by current_url; skip without it.
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(signJwtMock).toHaveBeenCalledWith({ sub: 'user-uuid-1', plan: 'free' }, 60 * 60 * 24 * 90)
  })

  it('refreshes email/display_name on a returning user (UPSERT EXCLUDED path)', async () => {
    verifyGoogleAccessTokenMock.mockResolvedValueOnce({
      sub: 'g-sub-2',
      email: 'newer@example.com',
      name: 'Renamed',
      email_verified: true,
    })
    queryMock.mockResolvedValueOnce([{ id: 'user-uuid-2', plan: 'pro' }])

    const res = await handler(makeEvent({ access_token: 'good' }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(200)

    // Confirm the SQL still routes the fresh email/name through EXCLUDED
    // and does NOT mention updated_at — the today's-commit guard.
    const [sql, params] = queryMock.mock.calls[0]
    expect(sql).toMatch(/ON CONFLICT \(google_sub\) DO UPDATE/)
    expect(sql).toMatch(/email = EXCLUDED.email/)
    expect(sql).toMatch(/display_name = EXCLUDED.display_name/)
    expect(sql).not.toMatch(/updated_at/)
    expect(params).toEqual(['g-sub-2', 'newer@example.com', 'Renamed'])

    const body = JSON.parse(String(res.body))
    expect(body.user.plan).toBe('pro')
  })

  it('eager-loads currentSession when current_url matches an existing row', async () => {
    verifyGoogleAccessTokenMock.mockResolvedValueOnce({
      sub: 'g-sub-3',
      email: 'c@example.com',
      email_verified: true,
    })
    const updatedAt = new Date('2026-05-09T00:00:00Z')
    queryMock
      .mockResolvedValueOnce([{ id: 'user-uuid-3', plan: 'free' }])  // UPSERT
      .mockResolvedValueOnce([{                                       // session lookup
        id: 'sess-A',
        slides: [{ ts: 1, ocr_text: 'hi' }],
        outline: { title: 'X', sections: [] },
        updated_at: updatedAt,
      }])

    const res = await handler(
      makeEvent({ access_token: 'good', current_url: 'https://example.com/foo#bar' }),
      {} as never,
      () => {},
    )
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(String(res.body))
    expect(body.currentSession).not.toBeNull()
    expect(body.currentSession.id).toBe('sess-A')
    expect(body.currentSession.outline).toEqual({ title: 'X', sections: [] })

    // Second query (the session lookup) must filter on user_id + url_hash.
    const [sessSql, sessParams] = queryMock.mock.calls[1]
    expect(sessSql).toMatch(/WHERE user_id = \$1 AND url_hash = \$2/)
    expect(sessParams[0]).toBe('user-uuid-3')
    // url_hash should be a sha256 hex digest of the normalised url (hash stripped).
    expect(sessParams[1]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns currentSession:null when current_url is provided but no session exists', async () => {
    verifyGoogleAccessTokenMock.mockResolvedValueOnce({
      sub: 'g-sub-4',
      email: 'd@example.com',
      email_verified: true,
    })
    queryMock
      .mockResolvedValueOnce([{ id: 'user-uuid-4', plan: 'free' }])  // UPSERT
      .mockResolvedValueOnce([])                                      // session lookup: empty

    const res = await handler(
      makeEvent({ access_token: 'good', current_url: 'https://example.com/never-seen' }),
      {} as never,
      () => {},
    )
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(String(res.body))
    expect(body.currentSession).toBeNull()
  })

  it('returns 400 with error message when DB UPSERT throws and logs to console.error', async () => {
    verifyGoogleAccessTokenMock.mockResolvedValueOnce({
      sub: 'g-sub-5',
      email: 'e@example.com',
      email_verified: true,
    })
    queryMock.mockRejectedValueOnce(new Error('relation "users" does not exist'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await handler(makeEvent({ access_token: 'good' }), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(String(res.body))).toEqual({ error: 'relation "users" does not exist' })
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

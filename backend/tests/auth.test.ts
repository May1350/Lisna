import { describe, it, expect, beforeAll } from 'vitest'
import { signJwt, verifyJwt } from '../src/lib/auth.js'

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-must-be-at-least-32-characters-long-xxxxx'
})

describe('JWT', () => {
  it('signs and verifies a payload roundtrip', async () => {
    const token = await signJwt({ sub: 'user-123', plan: 'free' }, 60)
    const payload = await verifyJwt(token)
    expect(payload.sub).toBe('user-123')
    expect(payload.plan).toBe('free')
  })

  it('rejects expired tokens', async () => {
    const token = await signJwt({ sub: 'user-123', plan: 'free' }, -10)
    await expect(verifyJwt(token)).rejects.toThrow()
  })

  it('rejects tampered tokens', async () => {
    const token = await signJwt({ sub: 'user-123', plan: 'free' }, 60)
    const tampered = token.slice(0, -2) + 'aa'
    await expect(verifyJwt(tampered)).rejects.toThrow()
  })
})

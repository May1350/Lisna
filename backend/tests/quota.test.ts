import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))
vi.mock('../src/lib/db.js', () => ({ query: mockQuery }))

beforeEach(() => mockQuery.mockReset())

import { checkQuota, recordUsage, FREE_LIMIT_SECS, PRO_LIMIT_SECS, currentPeriod } from '../src/lib/quota.js'

describe('currentPeriod', () => {
  it('returns YYYY-MM', () => {
    expect(currentPeriod(new Date('2026-04-26T12:00:00Z'))).toBe('2026-04')
  })
})

describe('checkQuota', () => {
  it('allows when under free limit', async () => {
    mockQuery.mockResolvedValue([{ seconds_used: 600 }])  // 10 min used
    const r = await checkQuota('u1', 'free')
    expect(r.allowed).toBe(true)
    expect(r.remainingSecs).toBe(FREE_LIMIT_SECS - 600)
  })

  it('blocks when over free limit', async () => {
    mockQuery.mockResolvedValue([{ seconds_used: FREE_LIMIT_SECS + 1 }])
    const r = await checkQuota('u1', 'free')
    expect(r.allowed).toBe(false)
  })

  it('uses pro limit for pro plan', async () => {
    mockQuery.mockResolvedValue([{ seconds_used: 0 }])
    const r = await checkQuota('u1', 'pro')
    expect(r.remainingSecs).toBe(PRO_LIMIT_SECS)
  })

  it('returns full limit when no row exists', async () => {
    mockQuery.mockResolvedValue([])
    const r = await checkQuota('u1', 'free')
    expect(r.remainingSecs).toBe(FREE_LIMIT_SECS)
  })
})

describe('recordUsage', () => {
  it('upserts usage row', async () => {
    mockQuery.mockResolvedValue([])
    await recordUsage('u1', 30)
    expect(mockQuery).toHaveBeenCalled()
    const sql = mockQuery.mock.calls[0][0] as string
    expect(sql).toMatch(/INSERT INTO quota_usage/)
    expect(sql).toMatch(/ON CONFLICT/)
  })
})

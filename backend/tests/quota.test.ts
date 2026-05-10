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
    mockQuery
      .mockResolvedValueOnce([])  // no active trial
      .mockResolvedValueOnce([{ seconds_used: 600 }])  // 10 min used
    const r = await checkQuota('u1', 'free')
    expect(r.allowed).toBe(true)
    expect(r.remainingSecs).toBe(FREE_LIMIT_SECS - 600)
  })

  it('blocks when over free limit', async () => {
    mockQuery
      .mockResolvedValueOnce([])  // no active trial
      .mockResolvedValueOnce([{ seconds_used: FREE_LIMIT_SECS + 1 }])
    const r = await checkQuota('u1', 'free')
    expect(r.allowed).toBe(false)
  })

  it('uses pro limit for pro plan (skips trial check)', async () => {
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
  it('upserts usage row when no trial is active', async () => {
    // recordUsage now consults getActiveTrial first; an empty result
    // means no trial → fall through to the monthly bucket INSERT.
    mockQuery.mockResolvedValue([])
    await recordUsage('u1', 'free', 30)
    expect(mockQuery).toHaveBeenCalled()
    const allSql = mockQuery.mock.calls.map(c => c[0] as string)
    expect(allSql.some(s => /INSERT INTO quota_usage/.test(s) && /ON CONFLICT/.test(s))).toBe(true)
  })

  it('increments trial counter when trial is active', async () => {
    mockQuery
      // 1st call — getActiveTrial returns a row → trial path
      .mockResolvedValueOnce([{ granted_at: new Date(), expires_at: new Date(Date.now() + 86400000), used_secs: 100, limit_secs: 7200 }])
      // 2nd call — UPDATE trial_grants
      .mockResolvedValueOnce([])
    await recordUsage('u1', 'free', 30)
    const sqls = mockQuery.mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => /UPDATE trial_grants/.test(s))).toBe(true)
    expect(sqls.some(s => /INSERT INTO quota_usage/.test(s))).toBe(false)
  })

  it('uses monthly bucket for pro users (skips trial check)', async () => {
    mockQuery.mockResolvedValue([])
    await recordUsage('u1', 'pro', 30)
    const sqls = mockQuery.mock.calls.map(c => c[0] as string)
    // Pro users bypass getActiveTrial entirely — only the INSERT runs.
    expect(sqls.some(s => /trial_grants/.test(s))).toBe(false)
    expect(sqls.some(s => /INSERT INTO quota_usage/.test(s))).toBe(true)
  })
})

describe('checkQuota with trial', () => {
  it('returns trial limits when grant is active', async () => {
    mockQuery.mockResolvedValueOnce([{
      granted_at: new Date(),
      expires_at: new Date(Date.now() + 86400000),
      used_secs: 600,
      limit_secs: 7200,
    }])
    const r = await checkQuota('u1', 'free')
    expect(r.trialActive).toBe(true)
    expect(r.limit).toBe(7200)
    expect(r.remainingSecs).toBe(7200 - 600)
  })

  it('falls back to free monthly bucket when no active trial', async () => {
    mockQuery
      .mockResolvedValueOnce([])  // getActiveTrial → no row
      .mockResolvedValueOnce([{ seconds_used: 60 }])  // monthly bucket
    const r = await checkQuota('u1', 'free')
    expect(r.trialActive).toBe(false)
    expect(r.limit).toBe(FREE_LIMIT_SECS)
  })
})

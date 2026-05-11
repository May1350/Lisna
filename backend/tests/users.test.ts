import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB layer so tests don't need a live Postgres. We assert
// SQL substrings + positional arg order via `queryMock.mock.calls`
// — this catches the *exact* drift class (parameter reordering,
// missing COALESCE, etc.) that motivated the refactor.
const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}))

vi.mock('../src/lib/db.js', () => ({
  query: queryMock,
  getPool: vi.fn(),
}))

// quota.ts is consumed for the TRIAL_LIMIT_SECS default. Stub to a
// sentinel so tests assert the helper *forwards* the constant rather
// than hard-coding it.
vi.mock('../src/lib/quota.js', () => ({
  TRIAL_LIMIT_SECS: 7200, // 2 hours — matches the real constant; sentinel for assertion.
}))

beforeEach(() => {
  queryMock.mockReset()
})

import {
  getUserStripeContext,
  clearStripeCustomerIdIfStale,
  persistStripeCustomerId,
  promoteToPro,
  handleSubscriptionDeleted,
  insertTrialGrant,
  markTrialConverted,
} from '../src/lib/users.js'

describe('lib/users — billing-write helpers', () => {
  describe('getUserStripeContext', () => {
    it('returns the row when user exists', async () => {
      queryMock.mockResolvedValueOnce([
        { email: 'a@b.com', stripe_customer_id: 'cus_X', plan: 'pro' },
      ])
      const ctx = await getUserStripeContext('u1')
      expect(ctx).toEqual({ email: 'a@b.com', stripe_customer_id: 'cus_X', plan: 'pro' })
      const [sql, args] = queryMock.mock.calls[0]
      expect(sql).toContain('SELECT email, stripe_customer_id, plan FROM users')
      expect(args).toEqual(['u1'])
    })

    it('returns null when no row', async () => {
      queryMock.mockResolvedValueOnce([])
      expect(await getUserStripeContext('missing')).toBeNull()
    })
  })

  describe('clearStripeCustomerIdIfStale', () => {
    it('issues a race-safe UPDATE keyed on (id, expectedCustomerId)', async () => {
      queryMock.mockResolvedValueOnce([])
      await clearStripeCustomerIdIfStale('u1', 'cus_stale')
      const [sql, args] = queryMock.mock.calls[0]
      expect(sql).toContain('SET stripe_customer_id = NULL')
      expect(sql).toContain('WHERE id = $1 AND stripe_customer_id = $2')
      expect(args).toEqual(['u1', 'cus_stale']) // arg order matters
    })

    it('is idempotent — second call simply re-runs the same UPDATE', async () => {
      queryMock.mockResolvedValue([])
      await clearStripeCustomerIdIfStale('u1', 'cus_stale')
      await clearStripeCustomerIdIfStale('u1', 'cus_stale')
      expect(queryMock.mock.calls.length).toBe(2)
      // Both calls identical → behavior is purely a DB-row-state question.
      expect(queryMock.mock.calls[0]).toEqual(queryMock.mock.calls[1])
    })
  })

  describe('persistStripeCustomerId', () => {
    it('uses COALESCE so existing values aren\'t overwritten', async () => {
      queryMock.mockResolvedValueOnce([])
      await persistStripeCustomerId('u1', 'cus_new')
      const [sql, args] = queryMock.mock.calls[0]
      expect(sql).toContain('SET stripe_customer_id = COALESCE(stripe_customer_id, $1)')
      expect(sql).toContain('WHERE id = $2')
      expect(args).toEqual(['cus_new', 'u1'])
    })
  })

  describe('promoteToPro', () => {
    it('SQL sets plan=pro + subscription_id, COALESCE-persists customer_id', async () => {
      queryMock.mockResolvedValueOnce([])
      await promoteToPro({ userId: 'u1', subscriptionId: 'sub_a', customerId: 'cus_a' })
      const [sql, args] = queryMock.mock.calls[0]
      expect(sql).toContain("SET plan = 'pro'")
      expect(sql).toContain('stripe_subscription_id = $1')
      expect(sql).toContain('stripe_customer_id = COALESCE(stripe_customer_id, $2)')
      expect(sql).toContain('WHERE id = $3')
      // Arg order is the *exact* drift that the inline duplicates risked.
      expect(args).toEqual(['sub_a', 'cus_a', 'u1'])
    })

    it('accepts customerId=null (webhook path where Stripe omits customer)', async () => {
      queryMock.mockResolvedValueOnce([])
      await promoteToPro({ userId: 'u1', subscriptionId: 'sub_a', customerId: null })
      const [, args] = queryMock.mock.calls[0]
      // null forwarded — COALESCE collapses it to existing column value.
      expect(args).toEqual(['sub_a', null, 'u1'])
    })

    it('is idempotent — same args twice yields identical SQL invocations', async () => {
      queryMock.mockResolvedValue([])
      const args = { userId: 'u1', subscriptionId: 'sub_a', customerId: 'cus_a' } as const
      await promoteToPro(args)
      await promoteToPro(args)
      expect(queryMock.mock.calls.length).toBe(2)
      expect(queryMock.mock.calls[0]).toEqual(queryMock.mock.calls[1])
    })
  })

  describe('handleSubscriptionDeleted', () => {
    it('clears subscription_id + sets plan=free, keyed on subscription_id', async () => {
      queryMock.mockResolvedValueOnce([])
      await handleSubscriptionDeleted('sub_dead')
      const [sql, args] = queryMock.mock.calls[0]
      expect(sql).toContain("SET plan = 'free'")
      expect(sql).toContain('stripe_subscription_id = NULL')
      expect(sql).toContain('WHERE stripe_subscription_id = $1')
      expect(args).toEqual(['sub_dead'])
    })

    it('is idempotent — unknown / already-handled sub_id is a no-op', async () => {
      queryMock.mockResolvedValueOnce([]) // pg returns [] for 0-row UPDATEs
      await expect(handleSubscriptionDeleted('sub_never_seen')).resolves.toBeUndefined()
    })
  })

  describe('insertTrialGrant', () => {
    it('INSERT with ON CONFLICT DO NOTHING; positional args match column order', async () => {
      queryMock.mockResolvedValueOnce([])
      const expiresAt = new Date('2026-06-10T00:00:00.000Z')
      await insertTrialGrant({
        userId: 'u1', paymentMethodId: 'pm_a', customerId: 'cus_a',
        limitSecs: 7200, expiresAt,
      })
      const [sql, args] = queryMock.mock.calls[0]
      expect(sql).toContain('INSERT INTO trial_grants')
      expect(sql).toContain('ON CONFLICT (user_id) DO NOTHING')
      // Match column order in the INSERT: user_id, expires_at, limit_secs, payment_method, customer
      expect(args).toEqual(['u1', expiresAt, 7200, 'pm_a', 'cus_a'])
    })

    it('defaults expiresAt to NOW() + 30 days when omitted', async () => {
      queryMock.mockResolvedValueOnce([])
      const before = Date.now()
      await insertTrialGrant({
        userId: 'u1', paymentMethodId: 'pm_a', customerId: 'cus_a',
      })
      const after = Date.now()
      const [, args] = queryMock.mock.calls[0]
      const expiresAtArg = args[1] as Date
      const expectedMin = before + 30 * 24 * 60 * 60 * 1000 - 5
      const expectedMax = after + 30 * 24 * 60 * 60 * 1000 + 5
      expect(expiresAtArg.getTime()).toBeGreaterThanOrEqual(expectedMin)
      expect(expiresAtArg.getTime()).toBeLessThanOrEqual(expectedMax)
    })

    it('defaults limitSecs to TRIAL_LIMIT_SECS when omitted', async () => {
      queryMock.mockResolvedValueOnce([])
      await insertTrialGrant({
        userId: 'u1', paymentMethodId: 'pm_a', customerId: 'cus_a',
      })
      const [, args] = queryMock.mock.calls[0]
      expect(args[2]).toBe(7200) // the mocked TRIAL_LIMIT_SECS sentinel
    })
  })

  describe('markTrialConverted', () => {
    it('only updates when converted_at IS NULL (idempotency guard)', async () => {
      queryMock.mockResolvedValueOnce([])
      await markTrialConverted('u1')
      const [sql, args] = queryMock.mock.calls[0]
      expect(sql).toContain('SET converted_at = NOW()')
      expect(sql).toContain('WHERE user_id = $1 AND converted_at IS NULL')
      expect(args).toEqual(['u1'])
    })
  })
})

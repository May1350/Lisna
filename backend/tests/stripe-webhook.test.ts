import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// Mock the DB layer so the handler can run without a live Postgres.
// We'll inspect queryMock.mock.calls to assert: (a) the dedup INSERT
// always runs first with [event_id, event_type], (b) the per-case
// UPDATE on users runs only on first delivery, (c) the dedup short-
// circuit suppresses the UPDATE on retry.
//
// Post-Phase-5d note: the user UPDATE now flows through
// `promoteToPro` / `handleSubscriptionDeleted` in lib/users.ts. The
// assertions below still hold because the helpers issue the same
// SQL with the same positional args — verifying SQL substring +
// arg-shape is the right invariant either way.
//
// vi.hoisted() is required because vi.mock() factories execute before
// module top-level code; a plain `const` would not yet exist.
const { queryMock, constructEventMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  constructEventMock: vi.fn(),
}))

vi.mock('../src/lib/db.js', () => ({
  query: queryMock,
  getPool: vi.fn(),
}))

// Skip Secrets Manager — handler awaits this only for side-effects
// (populating process.env from the secret bag in production).
vi.mock('../src/lib/env.js', () => ({
  loadAppSecrets: vi.fn(async () => ({})),
}))

// Stripe SDK: the handler does `new Stripe(secret)` then reads
// `.webhooks.constructEvent(...)` on the instance. We replace the
// default export with a constructor whose instances expose a
// webhooks.constructEvent backed by our spy. This avoids needing a
// real Stripe key or a real signed payload.
vi.mock('stripe', () => {
  return {
    default: class StripeMock {
      webhooks = { constructEvent: constructEventMock }
      constructor(_secret?: string) {}
    },
  }
})

beforeAll(() => {
  // Handler reads these at request time — values just need to exist.
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy'
})

beforeEach(() => {
  queryMock.mockReset()
  constructEventMock.mockReset()
})

import { handler } from '../src/handlers/stripe-webhook.js'

function makeEvent(body: string | undefined, sig: string | undefined) {
  return {
    headers: sig ? { 'stripe-signature': sig } : {},
    body,
    requestContext: {},
  } as unknown as Parameters<typeof handler>[0]
}

describe('POST /v1/stripe/webhook — idempotency gate', () => {
  it('first delivery of checkout.session.completed: INSERT then UPDATE users', async () => {
    constructEventMock.mockReturnValueOnce({
      id: 'evt_first',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'user-1',
          subscription: 'sub_abc',
          customer: 'cus_xyz',
        },
      },
    })
    // 1st query (dedup INSERT): first delivery → 1 row returned.
    queryMock.mockResolvedValueOnce([{ event_id: 'evt_first' }])
    // 2nd query (UPDATE users): pg returns [] for non-RETURNING UPDATEs.
    queryMock.mockResolvedValueOnce([])

    const res = await handler(makeEvent('{}', 'sig'), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('ok')
    expect(queryMock).toHaveBeenCalledTimes(2)

    // Dedup INSERT lands first, with [event_id, event_type] in that order.
    const dedupCall = queryMock.mock.calls[0]
    expect(dedupCall[0]).toContain('INSERT INTO processed_stripe_events')
    expect(dedupCall[0]).toContain('ON CONFLICT (event_id) DO NOTHING')
    expect(dedupCall[0]).toContain('RETURNING event_id')
    expect(dedupCall[1]).toEqual(['evt_first', 'checkout.session.completed'])

    // Then the user UPDATE, with [subscription_id, customer_id, user_id].
    const updateCall = queryMock.mock.calls[1]
    expect(updateCall[0]).toContain('UPDATE users')
    expect(updateCall[0]).toContain("plan = 'pro'")
    expect(updateCall[1]).toEqual(['sub_abc', 'cus_xyz', 'user-1'])
  })

  it('redelivery of the same event_id: dedup short-circuits, UPDATE never runs', async () => {
    constructEventMock.mockReturnValueOnce({
      id: 'evt_first', // same id as above
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'user-1',
          subscription: 'sub_abc',
          customer: 'cus_xyz',
        },
      },
    })
    // ON CONFLICT fired → RETURNING yields 0 rows.
    queryMock.mockResolvedValueOnce([])

    const res = await handler(makeEvent('{}', 'sig'), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('duplicate')

    // Exactly one query: the dedup INSERT. No UPDATE on users.
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(queryMock.mock.calls[0][0]).toContain('INSERT INTO processed_stripe_events')
  })

  it('bad signature: 400, no DB calls at all (dedup must not run before verification)', async () => {
    constructEventMock.mockImplementationOnce(() => {
      throw new Error('No signatures found matching the expected signature')
    })

    const res = await handler(makeEvent('{}', 'bad-sig'), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(400)
    expect(String(res.body)).toContain('signature error')
    // Critical: an unverified event MUST NOT touch the DB. If we
    // inserted the dedup row before signature verification, a hostile
    // sender could pre-poison processed_stripe_events with the next
    // legitimate event_id, blocking real deliveries.
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('missing signature header: 400, no DB calls', async () => {
    const res = await handler(makeEvent('{}', undefined), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(400)
    expect(queryMock).not.toHaveBeenCalled()
    // constructEvent should never even be reached.
    expect(constructEventMock).not.toHaveBeenCalled()
  })

  it('unknown event type: still INSERTed for tracking, default-case silent ok', async () => {
    constructEventMock.mockReturnValueOnce({
      id: 'evt_unknown',
      type: 'invoice.created', // not handled by switch
      data: { object: {} },
    })
    queryMock.mockResolvedValueOnce([{ event_id: 'evt_unknown' }])

    const res = await handler(makeEvent('{}', 'sig'), {} as never, () => {})
    if (!res || typeof res !== 'object' || !('statusCode' in res)) throw new Error('expected response object')

    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('ok')

    // Only the dedup INSERT — the switch's default case does nothing.
    // We INSERT anyway so the next redelivery of this same id is also
    // deduped (cheap insurance against future handler additions).
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(queryMock.mock.calls[0][1]).toEqual(['evt_unknown', 'invoice.created'])
  })
})

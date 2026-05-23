import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import Stripe from 'stripe'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { getStripe } from '../lib/stripe.js'
// Billing-write helpers (see lib/users.ts for invariants). The
// dedup INSERT below stays inline — ordering MUST be: insert dedup
// row before any side effect, so the retry path short-circuits
// before the helpers run. Don't move it.
import { promoteToPro, handleSubscriptionDeleted } from '../lib/users.js'

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const sig = event.headers['stripe-signature']
  if (!sig || !event.body) return { statusCode: 400, body: 'missing signature' }
  const stripe = await getStripe()

  let evt: Stripe.Event
  try {
    evt = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (e) {
    return { statusCode: 400, body: `signature error: ${e instanceof Error ? e.message : 'x'}` }
  }

  // Idempotency gate (see migrations/008_processed_stripe_events.sql).
  // Insert the dedup row BEFORE any side effect: if a retry races us
  // (Stripe's webhook delivery is at-least-once), the second attempt's
  // INSERT hits ON CONFLICT, RETURNING comes back empty, and we 200
  // out without re-running the switch. Returning 200 (not 5xx) tells
  // Stripe to stop retrying.
  const dedup = await query<{ event_id: string }>(
    `INSERT INTO processed_stripe_events (event_id, type)
     VALUES ($1, $2)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [evt.id, evt.type],
  )
  if (dedup.length === 0) {
    console.log('[stripe-webhook] dedup', { event_id: evt.id, type: evt.type })
    return { statusCode: 200, body: 'duplicate' }
  }

  switch (evt.type) {
    case 'checkout.session.completed': {
      const s = evt.data.object as Stripe.Checkout.Session
      const userId = s.client_reference_id
      const subscriptionId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id
      // s.customer arrives populated whether we passed `customer` or
      // `customer_email` to checkout.sessions.create — when it's the
      // latter, Stripe auto-created the customer during the session
      // and surfaces the new ID here. Persist it so subsequent upgrade
      // attempts use the existing customer (avoiding duplicates).
      const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id
      if (userId && subscriptionId) {
        await promoteToPro({
          userId,
          subscriptionId,
          customerId: customerId ?? null,
        })
      }
      break
    }
    case 'customer.subscription.deleted': {
      const sub = evt.data.object as Stripe.Subscription
      await handleSubscriptionDeleted(sub.id)
      break
    }
  }
  return { statusCode: 200, body: 'ok' }
}

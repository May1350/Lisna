import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import Stripe from 'stripe'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { getStripe } from '../lib/stripe.js'
// Billing-write helpers (see lib/users.ts for invariants). The
// trial_grants SELECT at the top of the handler stays inline — it
// reads grant-state fields that aren't part of the users.ts surface.
import { promoteToPro, markTrialConverted } from '../lib/users.js'

/**
 * Trial-end "Pro 가입 (원클릭)" path. User has used their 2 hours
 * and chose to upgrade. We use the payment method they saved during
 * the trial setup to create a Pro subscription server-side — no
 * extra Stripe Checkout round trip, just a single click in the
 * extension.
 *
 * On success we:
 *   1. Set the subscription's `default_payment_method` to the saved PM
 *   2. Update users.plan = 'pro' + stripe_subscription_id
 *   3. Mark the trial row converted
 *
 * If subscription creation fails (card declined, 3DS required, etc.),
 * we surface the error so the frontend can fall back to the regular
 * Stripe-hosted Checkout (existing /v1/billing/checkout). Don't
 * silently leave the user in a half-state.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }
  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid' } }

  const rows = await query<{
    stripe_payment_method_id: string | null
    stripe_customer_id: string | null
    converted_at: Date | null
    declined_at: Date | null
  }>(
    `SELECT stripe_payment_method_id, stripe_customer_id, converted_at, declined_at
       FROM trial_grants WHERE user_id = $1`,
    [payload.sub],
  )
  if (rows.length === 0) {
    return { statusCode: 404, body: JSON.stringify({ error: 'no_trial' }) }
  }
  const grant = rows[0]
  if (grant.converted_at) {
    // Idempotent: same final state, no need to call Stripe again.
    return { statusCode: 200, body: JSON.stringify({ ok: true, already: true }) }
  }
  if (grant.declined_at) {
    return { statusCode: 409, body: JSON.stringify({ error: 'trial_declined' }) }
  }
  if (!grant.stripe_payment_method_id || !grant.stripe_customer_id) {
    return { statusCode: 500, body: JSON.stringify({ error: 'missing_pm_or_customer' }) }
  }

  const stripe = await getStripe()

  // Stripe requires the PM to be attached to the customer before it
  // can be used as default for a subscription. Detach is reversible,
  // so this is a safe no-op-or-attach.
  try {
    await stripe.paymentMethods.attach(grant.stripe_payment_method_id, {
      customer: grant.stripe_customer_id,
    })
  } catch (e) {
    // Attach errors with "already attached" — that's fine to swallow.
    // Anything else (PM doesn't exist, customer doesn't exist) we
    // surface; the frontend should fall back to /v1/billing/checkout.
    if (!(e instanceof Error && /already attached|already-attached/i.test(e.message))) {
      console.warn('[trial-subscribe] attach failed', e)
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'attach_failed', detail: e instanceof Error ? e.message : 'x' }),
      }
    }
  }

  let subscription: Stripe.Subscription
  try {
    subscription = await stripe.subscriptions.create({
      customer: grant.stripe_customer_id,
      items: [{ price: process.env.STRIPE_PRICE_PRO! }],
      default_payment_method: grant.stripe_payment_method_id,
      metadata: { user_id: payload.sub, source: 'trial_conversion' },
      // expand: ['latest_invoice.payment_intent']  // for 3DS handling later
    })
  } catch (e) {
    console.warn('[trial-subscribe] subscriptions.create failed', e)
    return {
      statusCode: 402,
      body: JSON.stringify({
        error: 'subscription_failed',
        detail: e instanceof Error ? e.message : 'x',
      }),
    }
  }

  // Persist plan flip + subscription id. Mirrors the webhook path
  // (checkout.session.completed). Both call the same helper, so a
  // future webhook re-invocation is identically idempotent.
  await promoteToPro({
    userId: payload.sub,
    subscriptionId: subscription.id,
    customerId: grant.stripe_customer_id,
  })
  await markTrialConverted(payload.sub)

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, subscription_id: subscription.id }),
  }
}

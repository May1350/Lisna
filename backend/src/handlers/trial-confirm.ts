import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { loadAppSecrets } from '../lib/env.js'
import { getStripe } from '../lib/stripe.js'
import { TRIAL_LIMIT_SECS } from '../lib/quota.js'
// Billing-write helpers (see lib/users.ts for invariants).
import { persistStripeCustomerId, insertTrialGrant } from '../lib/users.js'

/**
 * Step 2 of the 2-hour trial flow: called by the frontend after the
 * Stripe-hosted setup page redirects back. We verify the Checkout
 * Session belongs to this user, that the SetupIntent succeeded, and
 * create the trial_grants row.
 *
 * Body: { session_id: string }
 *
 * Idempotent: if a row already exists for this user we return its
 * state without recreating. The frontend may call this multiple times
 * (e.g. user clicks the success URL twice) and shouldn't be punished.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }
  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid' } }

  const body = JSON.parse(event.body || '{}') as { session_id?: string }
  if (!body.session_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'session_id_required' }) }
  }

  const stripe = await getStripe()
  const session = await stripe.checkout.sessions.retrieve(body.session_id, {
    expand: ['setup_intent'],
  })

  // Defence in depth: the session_id came from a redirect and a
  // sufficiently motivated user could pass another user's session.
  // The client_reference_id was set to the JWT subject at create
  // time, so we re-check it matches.
  if (session.client_reference_id !== payload.sub) {
    return { statusCode: 403, body: JSON.stringify({ error: 'session_user_mismatch' }) }
  }
  if (session.mode !== 'setup') {
    return { statusCode: 400, body: JSON.stringify({ error: 'wrong_session_mode' }) }
  }
  const setupIntent = session.setup_intent
  if (!setupIntent || typeof setupIntent === 'string' || setupIntent.status !== 'succeeded') {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'setup_not_succeeded' }),
    }
  }
  const paymentMethodId = typeof setupIntent.payment_method === 'string'
    ? setupIntent.payment_method
    : setupIntent.payment_method?.id
  const customerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id
  if (!paymentMethodId || !customerId) {
    return { statusCode: 500, body: JSON.stringify({ error: 'missing_pm_or_customer' }) }
  }

  // Persist the customer id on users so a subsequent /v1/billing/checkout
  // (manual upgrade route) doesn't create a duplicate.
  await persistStripeCustomerId(payload.sub, customerId)

  // Insert grant. The helper does ON CONFLICT DO NOTHING — if the
  // user clicks the success URL twice we just return the existing
  // row state. expiresAt + limitSecs are passed explicitly so the
  // response body's `expires_at` / `limit_secs` reflect the same
  // values stored in the row (a single computation site).
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  await insertTrialGrant({
    userId: payload.sub,
    paymentMethodId,
    customerId,
    expiresAt,
    limitSecs: TRIAL_LIMIT_SECS,
  })

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, expires_at: expiresAt.toISOString(), limit_secs: TRIAL_LIMIT_SECS }),
  }
}

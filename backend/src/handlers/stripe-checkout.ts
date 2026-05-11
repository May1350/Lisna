import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import Stripe from 'stripe'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { getStripe } from '../lib/stripe.js'

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }
  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid' } }

  const stripe = await getStripe()
  const userRows = await query<{ email: string; stripe_customer_id: string | null }>(
    `SELECT email, stripe_customer_id FROM users WHERE id = $1`, [payload.sub]
  )
  if (userRows.length === 0) return { statusCode: 404, body: 'user not found' }
  const existingCustomerId = userRows[0].stripe_customer_id

  // Read the public-facing site root from env. Set in CDK as
  // PUBLIC_WEB_BASE_URL (commonEnv) so success/cancel pages are reachable.
  const baseUrl = process.env.PUBLIC_WEB_BASE_URL ?? 'https://lisna.jp'

  // First-time upgraders: pass `customer_email` instead of `customer`.
  // Stripe auto-creates a customer record DURING checkout (only when
  // the user actually pays), and the resulting customer ID arrives on
  // the `checkout.session.completed` webhook for us to persist. This
  // saves a full ~500-1000 ms `stripe.customers.create` round-trip
  // through NAT on every first upgrade. Repeat upgraders (already
  // have a customer ID) keep using `customer` so we don't create
  // duplicates with the same email.
  const baseParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_PRICE_PRO, quantity: 1 }],
    success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/cancel`,
    locale: 'ja',
    client_reference_id: payload.sub,
    metadata: { user_id: payload.sub },
  }
  const tryWithCustomer = () =>
    stripe.checkout.sessions.create({ ...baseParams, customer: existingCustomerId! })
  const tryWithEmail = () =>
    stripe.checkout.sessions.create({
      ...baseParams,
      customer_email: userRows[0].email,
      customer_creation: 'always',
    })
  // Defensive against stale customer ids (test/live mode mismatch,
  // customer deleted in Dashboard, etc.). On 'resource_missing' we
  // clear the dead pointer and retry with customer_email — Stripe
  // creates a fresh customer during checkout and the
  // checkout.session.completed webhook persists the new id.
  let session: Stripe.Checkout.Session
  if (existingCustomerId) {
    try {
      session = await tryWithCustomer()
    } catch (e) {
      const stale = e instanceof Stripe.errors.StripeError && e.code === 'resource_missing'
      if (!stale) throw e
      console.warn('[stripe-checkout] stale stripe_customer_id; clearing + retrying with email', {
        userId: payload.sub,
        bad_customer: existingCustomerId,
      })
      await query(
        `UPDATE users SET stripe_customer_id = NULL WHERE id = $1 AND stripe_customer_id = $2`,
        [payload.sub, existingCustomerId],
      )
      session = await tryWithEmail()
    }
  } else {
    session = await tryWithEmail()
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: session.url }),
  }
}

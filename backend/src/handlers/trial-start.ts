import Stripe from 'stripe'
import { query } from '../lib/db.js'
import { getStripe } from '../lib/stripe.js'
// Billing-write helpers (see lib/users.ts for invariants). The
// trial_grants SELECT (eligibility gate) stays inline — outside the
// users.ts helper surface.
import { getUserStripeContext, clearStripeCustomerIdIfStale } from '../lib/users.js'
import { withAuth } from '../lib/with-auth.js'

/**
 * Step 1 of the 2-hour trial flow: create a Stripe Checkout Session in
 * `setup` mode so the user attaches a payment method WITHOUT a charge.
 *
 * Stripe redirects the browser to a hosted page that handles the card
 * input; on success it redirects back to our success URL with the
 * checkout session id, at which point the frontend POSTs to
 * /v1/trial/confirm to finalise (verify the SetupIntent succeeded
 * and create the trial_grants row).
 *
 * Why setup mode (not subscription/payment mode):
 *   - We want the card on file but no immediate billing — the user
 *     hasn't agreed to subscribe yet, just to start their 2-hour
 *     trial. Charging here would be a dark pattern.
 *   - At trial end the frontend offers "Pro 가입 (원클릭)" which
 *     hits /v1/billing/subscribe-from-trial; that endpoint creates
 *     the actual subscription using the saved payment method.
 *
 * Eligibility gate: a user can only start ONE trial in their
 * lifetime. A row in trial_grants for this user blocks a fresh
 * setup, regardless of whether the prior trial was used / declined /
 * converted. The frontend should also hide the "Get 2 free hours"
 * button when /v1/auth/me's user object indicates trial_used,
 * but we re-check here to defend against stale clients and direct
 * API hits.
 */
export const handler = withAuth('trial-start', async (_event, payload) => {
  // One-trial-per-account check.
  const existing = await query<{ user_id: string }>(
    `SELECT user_id FROM trial_grants WHERE user_id = $1`, [payload.sub],
  )
  if (existing.length > 0) {
    return {
      statusCode: 409,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'trial_already_used' }),
    }
  }

  // Pro users don't need the trial — block defensively. They should
  // never see the button on the frontend either.
  const userCtx = await getUserStripeContext(payload.sub)
  if (!userCtx) return { statusCode: 404, body: 'user not found' }
  if (userCtx.plan === 'pro') {
    return { statusCode: 409, body: JSON.stringify({ error: 'already_pro' }) }
  }

  const stripe = await getStripe()
  const baseUrl = process.env.PUBLIC_WEB_BASE_URL ?? 'https://lisna.jp'

  // Setup mode collects a payment method without charging. Pass
  // payment_method_types: ['card'] explicitly — the default in setup
  // mode also includes link / sepa_debit / etc. depending on locale,
  // and we want to keep the trial UX as close to "type card and
  // confirm" as possible for our student demo.
  const baseParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'setup',
    payment_method_types: ['card'],
    success_url: `${baseUrl}/trial-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/trial-cancel`,
    locale: 'ja',
    client_reference_id: payload.sub,
    metadata: { user_id: payload.sub, trial_setup: '1' },
  }
  // Defensive: a stale stripe_customer_id (test/live mode mixup,
  // customer deleted from Dashboard, account switched, etc.) makes
  // checkout.sessions.create fail with code='resource_missing'. Clear
  // the dead pointer and retry with customer_email so the user isn't
  // stuck — Stripe creates a fresh customer during checkout and the
  // webhook persists the new id.
  const session = await createSetupSessionResilient(stripe, baseParams, {
    userId: payload.sub,
    email: userCtx.email,
    existingCustomerId: userCtx.stripe_customer_id,
  })

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: session.url, session_id: session.id }),
  }
})

async function createSetupSessionResilient(
  stripe: Stripe,
  base: Stripe.Checkout.SessionCreateParams,
  ctx: { userId: string; email: string; existingCustomerId: string | null },
): Promise<Stripe.Checkout.Session> {
  const tryWithCustomer = async (): Promise<Stripe.Checkout.Session> =>
    stripe.checkout.sessions.create({ ...base, customer: ctx.existingCustomerId! })
  const tryWithEmail = async (): Promise<Stripe.Checkout.Session> =>
    // NOTE: `customer_creation: 'always'` is INVALID in setup mode
    // (same Stripe API constraint as subscription mode — only valid
    // in 'payment' mode). In setup mode the customer is auto-created
    // from customer_email when the user attaches a payment method.
    // See stripe-checkout.ts for the matching fix.
    stripe.checkout.sessions.create({
      ...base,
      customer_email: ctx.email,
    })

  if (!ctx.existingCustomerId) return tryWithEmail()

  try {
    return await tryWithCustomer()
  } catch (e) {
    const stale = e instanceof Stripe.errors.StripeError && e.code === 'resource_missing'
    if (!stale) throw e
    console.warn('[trial-start] stale stripe_customer_id; clearing + retrying with email', {
      userId: ctx.userId,
      bad_customer: ctx.existingCustomerId,
    })
    await clearStripeCustomerIdIfStale(ctx.userId, ctx.existingCustomerId)
    return tryWithEmail()
  }
}

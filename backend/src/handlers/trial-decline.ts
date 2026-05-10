import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import Stripe from 'stripe'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'

/**
 * Trial-end "가입 안함" path. User has used their 2 hours and chose
 * NOT to convert to Pro. We:
 *   1. Detach the saved payment method from their Stripe customer
 *      (privacy / trust signal — "if I'm not paying you, you don't
 *      keep my card")
 *   2. Mark the trial_grants row declined
 *
 * After this, the user reverts to the regular Free tier (30 min /
 * month). They can come back next month with a fresh quota; they
 * cannot start a second trial.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }
  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid' } }

  const grant = await query<{ stripe_payment_method_id: string | null; converted_at: Date | null }>(
    `SELECT stripe_payment_method_id, converted_at
       FROM trial_grants WHERE user_id = $1`,
    [payload.sub],
  )
  if (grant.length === 0) {
    return { statusCode: 404, body: JSON.stringify({ error: 'no_trial' }) }
  }
  if (grant[0].converted_at) {
    return { statusCode: 409, body: JSON.stringify({ error: 'already_converted' }) }
  }

  // Best-effort PM detach — Stripe errors here (already detached,
  // PM never resolved, etc.) are fine to swallow because the DB
  // mutation below is the authoritative state.
  if (grant[0].stripe_payment_method_id) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
      await stripe.paymentMethods.detach(grant[0].stripe_payment_method_id)
    } catch (e) {
      console.warn('[trial-decline] PM detach failed (continuing)', {
        pm: grant[0].stripe_payment_method_id,
        error: e instanceof Error ? e.message : 'x',
      })
    }
  }

  await query(
    `UPDATE trial_grants
        SET declined_at = NOW(),
            stripe_payment_method_id = NULL
      WHERE user_id = $1
        AND declined_at IS NULL
        AND converted_at IS NULL`,
    [payload.sub],
  )

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  }
}

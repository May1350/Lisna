import Stripe from 'stripe'
import { query } from './db.js'

export interface ExpirableGrant {
  user_id: string
  stripe_payment_method_id: string | null
}

/** Detach the saved payment method (best-effort) and mark the trial
 *  grant declined. Shared by the user-initiated /v1/trial/decline path
 *  and the daily expiry cron. PM detach errors are swallowed because
 *  the DB row is the authoritative state — if Stripe says the PM is
 *  already gone, that's still the desired end state. */
export async function expireTrialGrant(
  stripe: Stripe,
  grant: ExpirableGrant,
): Promise<void> {
  if (grant.stripe_payment_method_id) {
    try {
      await stripe.paymentMethods.detach(grant.stripe_payment_method_id)
    } catch (e) {
      console.warn('[trial] PM detach failed (continuing)', {
        user_id: grant.user_id,
        pm: grant.stripe_payment_method_id,
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
    [grant.user_id],
  )
}

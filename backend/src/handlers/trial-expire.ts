import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { getStripe } from '../lib/stripe.js'
import { expireTrialGrant } from '../lib/trial.js'

/**
 * Daily cron: find trial grants whose 1-month deadline passed without
 * the user converting (Pro 가입) or declining (가입 안함). For each,
 * detach the saved PM + mark declined. Without this job a user who
 * stops using Lisna mid-trial would have their card on file forever.
 *
 * Triggered by EventBridge once per day. Runs in the same VPC as the
 * other Lambdas (DB access requires it). No HTTP gateway — direct
 * Lambda invoke from the schedule.
 */
export const handler = async (): Promise<{ processed: number; errors: number }> => {
  await loadAppSecrets()
  const stripe = await getStripe()

  // Cap per-run work — Stripe API call (~300 ms) × N rows must fit
  // inside the 2-min Lambda timeout. 500 rows ≈ 2.5 min worst case but
  // typical detach is faster; remaining rows roll over to tomorrow's
  // run (cron is idempotent — already-declined rows excluded by WHERE).
  // If this CAP is regularly hit we should batch or shorten the
  // schedule, not raise the timeout (Lambda billing).
  const CAP = 500
  const grants = await query<{ user_id: string; stripe_payment_method_id: string | null }>(
    `SELECT user_id, stripe_payment_method_id
       FROM trial_grants
      WHERE declined_at IS NULL
        AND converted_at IS NULL
        AND expires_at <= NOW()
      ORDER BY expires_at ASC
      LIMIT ${CAP}`,
  )
  if (grants.length === CAP) {
    console.warn('[trial-expire] cap reached — backlog may be growing', { cap: CAP })
  }

  let errors = 0
  for (const g of grants) {
    try {
      await expireTrialGrant(stripe, g)
    } catch (e) {
      errors += 1
      console.error('[trial-expire] grant cleanup failed', {
        user_id: g.user_id,
        error: e instanceof Error ? e.message : 'x',
      })
    }
  }

  console.log('[trial-expire] done', { processed: grants.length, errors })
  return { processed: grants.length, errors }
}

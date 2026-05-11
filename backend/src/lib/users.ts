// Single-source helpers for the user / trial billing writes that
// previously lived inline in 5 different Stripe handlers
// (stripe-webhook, stripe-checkout, trial-start, trial-confirm,
// trial-subscribe). Drift between any two of those copies was a
// real bug class — e.g. the 2026-05-11 customer_creation:'always'
// regression that landed in both stripe-checkout AND trial-start
// because the resilient-retry code was copy-pasted.
//
// Every helper here is INTENTIONALLY idempotent at the SQL level:
// running the same call twice yields the same end state, never an
// error. That property is what lets stripe-webhook's retry path
// (Stripe delivers webhooks at-least-once) coexist with
// trial-subscribe's one-click upgrade path — both routes can call
// `promoteToPro` for the same user without coordinating.

import { query } from './db.js'
import { TRIAL_LIMIT_SECS } from './quota.js'

// Trial expires 30 days after the user attaches their card. Centralised
// here so future window adjustments aren't a 2-place SQL edit.
const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000

export interface UserStripeContext {
  email: string
  stripe_customer_id: string | null
  plan: 'free' | 'pro'
}

/**
 * Load the user-row fields every billing handler reads on entry.
 * Returns null if the user_id doesn't exist (handler should respond
 * 404 in that case).
 */
export async function getUserStripeContext(
  userId: string,
): Promise<UserStripeContext | null> {
  const rows = await query<UserStripeContext>(
    `SELECT email, stripe_customer_id, plan FROM users WHERE id = $1`,
    [userId],
  )
  return rows[0] ?? null
}

/**
 * Race-safe stale-customer-id clear. Only nulls `stripe_customer_id`
 * when the stored value still matches `expectedCustomerId`. This
 * prevents clobbering a concurrent write that may have replaced the
 * stale id with a valid one between observation and clear.
 *
 * Idempotent: if the stored value already moved on (no match), the
 * UPDATE matches 0 rows and silently no-ops.
 *
 * Used by: stripe-checkout, trial-start (both trigger this when
 * Stripe returns `resource_missing` for the stored customer id).
 */
export async function clearStripeCustomerIdIfStale(
  userId: string,
  expectedCustomerId: string,
): Promise<void> {
  await query(
    `UPDATE users SET stripe_customer_id = NULL
       WHERE id = $1 AND stripe_customer_id = $2`,
    [userId, expectedCustomerId],
  )
}

/**
 * COALESCE-persist a stripe_customer_id — writes only if the column
 * is currently NULL. Used after the first Stripe interaction creates
 * a customer (e.g. trial Setup session completed) so subsequent
 * billing flows reuse the existing customer instead of spawning
 * duplicates.
 *
 * Idempotent.
 *
 * **Caveat:** `users.stripe_customer_id` carries a `UNIQUE` constraint
 * (migration 001). A cross-row collision (e.g. the SAME stripe
 * customer somehow ended up referenced from two different users via
 * shared email) raises Postgres error 23505. Today no flow can
 * produce this, but be aware if you wire a new path.
 */
export async function persistStripeCustomerId(
  userId: string,
  customerId: string,
): Promise<void> {
  await query(
    `UPDATE users SET stripe_customer_id = COALESCE(stripe_customer_id, $1)
       WHERE id = $2`,
    [customerId, userId],
  )
}

/**
 * Promote a user to plan='pro' and attach the subscription id.
 * Persists `customerId` ONLY if currently NULL (COALESCE) so we don't
 * clobber a customer we already knew about.
 *
 * Called from:
 *   - stripe-webhook on customer.subscription.created /
 *     checkout.session.completed
 *   - trial-subscribe on the one-click trial→Pro conversion
 *
 * Idempotent — same args produces identical end state regardless of
 * how many times it runs. Note: if two paths race with DIFFERENT
 * subscriptionId values for the same user (theoretically possible if
 * the user opens both the regular Pro checkout AND the trial-end one-
 * click in different tabs), this is last-writer-wins on
 * `stripe_subscription_id`. Real risk is very low; flagged here so a
 * future bug investigation can find this docstring.
 *
 * Same UNIQUE-constraint caveat as `persistStripeCustomerId` applies.
 */
export async function promoteToPro(opts: {
  userId: string
  subscriptionId: string
  customerId: string | null
}): Promise<void> {
  await query(
    `UPDATE users
       SET plan = 'pro',
           stripe_subscription_id = $1,
           stripe_customer_id = COALESCE(stripe_customer_id, $2)
       WHERE id = $3`,
    [opts.subscriptionId, opts.customerId, opts.userId],
  )
}

/**
 * Webhook reconciliation when Stripe says a subscription was deleted.
 * Looks up the user by `subscription_id` (the webhook event payload
 * doesn't always carry user_id; subscription_id is the stable handle).
 * Sets plan='free' and clears stripe_subscription_id.
 *
 * Idempotent: a second call (or a call for an unknown subscription)
 * matches 0 rows and silently no-ops. The handler still 200's so
 * Stripe stops retrying — that's the desired contract.
 */
export async function handleSubscriptionDeleted(
  subscriptionId: string,
): Promise<void> {
  await query(
    `UPDATE users SET plan = 'free', stripe_subscription_id = NULL
       WHERE stripe_subscription_id = $1`,
    [subscriptionId],
  )
}

/**
 * Insert a trial grant row, idempotent via ON CONFLICT (user_id).
 *
 * `expiresAt` defaults to NOW() + 30 days; `limitSecs` defaults to
 * TRIAL_LIMIT_SECS (the canonical 2-hour window from lib/quota.ts).
 * Override only when running a trial-window experiment.
 *
 * Used by: trial-confirm (the post-setup callback).
 */
export async function insertTrialGrant(opts: {
  userId: string
  paymentMethodId: string
  customerId: string
  limitSecs?: number
  expiresAt?: Date
}): Promise<void> {
  const limitSecs = opts.limitSecs ?? TRIAL_LIMIT_SECS
  const expiresAt = opts.expiresAt ?? new Date(Date.now() + TRIAL_DURATION_MS)
  await query(
    `INSERT INTO trial_grants
       (user_id, granted_at, expires_at, used_secs, limit_secs, stripe_payment_method_id, stripe_customer_id)
     VALUES ($1, NOW(), $2, 0, $3, $4, $5)
     ON CONFLICT (user_id) DO NOTHING`,
    [opts.userId, expiresAt, limitSecs, opts.paymentMethodId, opts.customerId],
  )
}

/**
 * Stamp `converted_at = NOW()` on the user's trial grant — only the
 * first time. Subsequent calls are blocked by the `WHERE converted_at
 * IS NULL` guard, so this is safely idempotent.
 *
 * Used by: trial-subscribe (when the trial-end one-click upgrade
 * successfully creates a real subscription).
 */
export async function markTrialConverted(userId: string): Promise<void> {
  await query(
    `UPDATE trial_grants SET converted_at = NOW()
       WHERE user_id = $1 AND converted_at IS NULL`,
    [userId],
  )
}

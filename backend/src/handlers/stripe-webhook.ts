import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import Stripe from 'stripe'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const sig = event.headers['stripe-signature']
  if (!sig || !event.body) return { statusCode: 400, body: 'missing signature' }
  // Do NOT pin apiVersion — see stripe-checkout.ts for the rationale.
  // tl;dr: pin caused a production outage when Stripe deprecated
  // '2025-09-30.acacia'. SDK default tracks the SDK install.
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

  let evt: Stripe.Event
  try {
    evt = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (e) {
    return { statusCode: 400, body: `signature error: ${e instanceof Error ? e.message : 'x'}` }
  }

  switch (evt.type) {
    case 'checkout.session.completed': {
      const s = evt.data.object as Stripe.Checkout.Session
      const userId = s.client_reference_id
      const subscriptionId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id
      if (userId && subscriptionId) {
        await query(`UPDATE users SET plan = 'pro', stripe_subscription_id = $1 WHERE id = $2`,
          [subscriptionId, userId])
      }
      break
    }
    case 'customer.subscription.deleted': {
      const sub = evt.data.object as Stripe.Subscription
      await query(`UPDATE users SET plan = 'free', stripe_subscription_id = NULL WHERE stripe_subscription_id = $1`,
        [sub.id])
      break
    }
  }
  return { statusCode: 200, body: 'ok' }
}

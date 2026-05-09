import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import Stripe from 'stripe'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }
  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid' } }

  // Do NOT pin apiVersion — use whatever version the installed Stripe
  // SDK was built against. We previously pinned to '2025-09-30.acacia'
  // which Stripe deprecated, taking down all upgrades with a 400
  // "Invalid Stripe API version". The canonical Stripe-recommended
  // pattern is "upgrade SDK ⇒ upgrade pinned version together"; the
  // simplest expression of that is to let the SDK default. When we
  // bump `stripe@^N` in package.json we get the SDK's then-current
  // pinned version automatically and the typings stay in sync.
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  const userRows = await query<{ email: string; stripe_customer_id: string | null }>(
    `SELECT email, stripe_customer_id FROM users WHERE id = $1`, [payload.sub]
  )
  if (userRows.length === 0) return { statusCode: 404, body: 'user not found' }
  let customerId = userRows[0].stripe_customer_id
  if (!customerId) {
    const c = await stripe.customers.create({ email: userRows[0].email, metadata: { user_id: payload.sub } })
    customerId = c.id
    await query(`UPDATE users SET stripe_customer_id = $1 WHERE id = $2`, [customerId, payload.sub])
  }

  // Read the public-facing site root from env. Set in CDK as
  // PUBLIC_WEB_BASE_URL (commonEnv) so success/cancel pages are reachable.
  const baseUrl = process.env.PUBLIC_WEB_BASE_URL ?? 'https://lisna-may1350s-projects.vercel.app'
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: process.env.STRIPE_PRICE_PRO, quantity: 1 }],
    success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/cancel`,
    locale: 'ja',
    client_reference_id: payload.sub,
  })

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: session.url }),
  }
}

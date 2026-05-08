import Stripe from 'stripe'
import { withAuth } from '../lib/auth.js'
import { query } from '../lib/db.js'

export const handler = withAuth(async (_event, payload) => {
  // Plan-mandated apiVersion '2025-09-30.acacia'. The currently-installed
  // Stripe SDK has moved its single-literal type to a newer version
  // ('2026-04-22.dahlia'), but our integration was tested against the
  // 2025-09 snapshot and needs to keep that exact wire format. Cast
  // through `unknown` to bypass the narrow union type — this is the
  // canonical pattern when the SDK's literal type drifts ahead of the
  // operator-specified API version that you've already verified works.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stripe = new Stripe(
    process.env.STRIPE_SECRET_KEY!,
    { apiVersion: '2025-09-30.acacia' as any },
  )
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

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: process.env.STRIPE_PRICE_PRO, quantity: 1 }],
    success_url: 'https://study-helper.example.com/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://study-helper.example.com/cancel',
    locale: 'ja',
    client_reference_id: payload.sub,
  })

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: session.url }),
  }
})

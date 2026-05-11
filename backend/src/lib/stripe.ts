// Stripe SDK singleton.
//
// Today seven handlers (stripe-checkout, stripe-webhook, and the
// five trial-* handlers) each `new Stripe(process.env.STRIPE_SECRET_KEY!)`
// inside the handler body. That re-runs the SDK constructor on
// every invocation (~5-10 ms per cold-path call) and was the
// pattern before loadAppSecrets() was reliable. Now that
// loadAppSecrets() is the established secrets loader, we can lazily
// construct the Stripe client once per warm container.
//
// Note: do NOT pin `apiVersion` here. The codebase's earlier
// stripe-webhook.ts comment explicitly tombstones a prior outage
// caused by pinning `2025-09-30.acacia` — Stripe deprecated that
// version, and any handler that had hard-coded it returned 400 for
// every request. Tracking the SDK install version (default) means
// `pnpm up stripe` is the only place version coupling lives, and
// types + runtime stay in sync.
//
// Cache lifetime is the Lambda warm container. A rotated key won't
// take effect until containers recycle — identical to the existing
// behaviour where loadAppSecrets() caches the secret bag for the
// container's life.

import Stripe from 'stripe'
import { loadAppSecrets } from './env.js'

let cached: Stripe | undefined

export async function getStripe(): Promise<Stripe> {
  if (cached) return cached
  await loadAppSecrets()
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY missing after loadAppSecrets()')
  }
  cached = new Stripe(key)
  return cached
}

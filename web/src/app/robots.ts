import type { MetadataRoute } from 'next'

// Explicit robots.txt — overrides Vercel's default-noindex behavior
// for non-production-domain deployments. Stripe verification, Google,
// and any other crawler should be allowed to index the public marketing
// surface (landing, pricing, refunds, terms, privacy, tokusho).
//
// If/when we move to a production custom domain, this file is still
// the authoritative robots policy and should NOT need changes.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
  }
}

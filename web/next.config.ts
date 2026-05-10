import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // Force `x-robots-tag: index, follow` on every public page. Vercel
  // adds `x-robots-tag: noindex` by default to non-production-domain
  // deployments (which trips Stripe verification, Google indexing,
  // etc.). Setting our own value here OVERRIDES the platform default
  // and signals to crawlers that this is a real public site.
  // The internal Stripe redirect pages (/success, /cancel,
  // /trial-success, /trial-cancel) intentionally stay noindex —
  // they're transient post-checkout destinations.
  async headers() {
    return [
      {
        source: '/((?!success|cancel|trial-success|trial-cancel).*)',
        headers: [
          { key: 'x-robots-tag', value: 'index, follow' },
        ],
      },
    ]
  },
}

export default config

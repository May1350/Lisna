import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import createMDX from '@next/mdx'

const withNextIntl = createNextIntlPlugin()
// Plugins are passed as serializable string names (not imported functions) so
// that Turbopack — which serializes loader options to its rust worker — can
// accept them. `@next/mdx` resolves these names through @mdx-js/loader.
// See `@next/mdx/index.d.ts`: `remarkPlugins?: (string | [name, ...options])[]`.
const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: ['remark-gfm'],
    rehypePlugins: ['rehype-slug'],
  },
})

const config: NextConfig = {
  reactStrictMode: true,
  pageExtensions: ['ts', 'tsx', 'mdx'],
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

export default withMDX(withNextIntl(config))

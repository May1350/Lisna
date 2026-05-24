import '@/styles/globals.css'
import type { Metadata } from 'next'
import Script from 'next/script'
import { fraunces, inter, caveat } from '@/lib/fonts'
import { env } from '@/lib/env'

// Root-level metadata. The `robots` block is the load-bearing piece
// here: Vercel's auto-generated *.vercel.app domains ship with an
// `x-robots-tag: noindex` header by default, which trips Stripe
// account-verification (and any other crawler-driven trust check).
// Setting metadata.robots at the root layout puts an explicit
// `<meta name="robots" content="index, follow">` on every page —
// individual pages can still opt out by setting their own robots
// metadata, but the default is now indexable.
export const metadata: Metadata = {
  metadataBase: new URL('https://lisna.jp'),
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${caveat.variable}`}>
      <head>
        {/* next/script default strategy=afterInteractive — non-blocking, post-hydration */}
        <Script
          data-domain={env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN}
          src="https://plausible.io/js/script.tagged-events.js"
        />
      </head>
      <body>
        {/* Pencil rough filter — shared SVG filter for all pencil-style accents (circle, underline, star, arrow). Inline once at root. */}
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <defs>
            <filter id="pencil-rough" x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence type="fractalNoise" baseFrequency="0.05 1.2" numOctaves={2} seed={3} />
              <feDisplacementMap in="SourceGraphic" scale={2.8} />
            </filter>
          </defs>
        </svg>
        {children}
      </body>
    </html>
  )
}

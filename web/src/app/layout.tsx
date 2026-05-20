import '@/styles/globals.css'
import type { Metadata } from 'next'
import { fraunces, inter } from '@/lib/fonts'

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
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  )
}

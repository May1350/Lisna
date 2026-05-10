import type { Metadata } from 'next'

// Root-level metadata. The `robots` block is the load-bearing piece
// here: Vercel's auto-generated *.vercel.app domains ship with an
// `x-robots-tag: noindex` header by default, which trips Stripe
// account-verification (and any other crawler-driven trust check).
// Setting metadata.robots at the root layout puts an explicit
// `<meta name="robots" content="index, follow">` on every page —
// individual pages can still opt out by setting their own robots
// metadata, but the default is now indexable.
export const metadata: Metadata = {
  metadataBase: new URL('https://lisna-may1350s-projects.vercel.app'),
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 800, margin: '40px auto', padding: '0 20px' }}>
        {children}
      </body>
    </html>
  )
}

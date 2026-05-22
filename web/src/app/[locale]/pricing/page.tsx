import { setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { PricingCards } from '@/components/marketing/pricing-cards';
import Link from 'next/link';
import type { Locale } from '@/i18n/routing';

export default async function PricingPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <MarketingShell locale={locale}>
      <section className="mx-auto max-w-5xl px-6 lg:px-12 py-16">
        <h1 className="font-serif text-h1 text-ink-900">Pricing</h1>
        <p className="mt-3 font-sans text-body text-ink-700 max-w-[60ch]">
          Lisna is in alpha and free for early users. The Pro tier turns on after alpha concludes.
        </p>

        {/* v2 plans */}
        <div className="mt-12">
          <PricingCards
            heading="v2 — Mac desktop alpha"
            sub="Pay only when alpha ends — at fair, predictable pricing."
            plans={[
              {
                name: 'Alpha',
                amount: '$0',
                period: '/forever during alpha',
                badge: { label: 'Free', tone: 'free' },
                features: ['Unlimited recordings', 'On-device STT + LLM', 'Markdown / PDF export', 'Discord support'],
                cta: { label: 'Download for Mac →', href: '/dl/dmg/latest' },
                highlighted: true,
              },
              {
                name: 'Pro',
                amount: '$?',
                period: '/month (post-alpha)',
                badge: { label: 'Coming soon', tone: 'soon' },
                features: ['Everything in Free', 'Cloud sync optional', 'Team workspace', 'Priority support'],
              },
            ]}
          />
        </div>

        {/* v1 plans */}
        <section className="mt-24 border-t border-ink-900/10 pt-16">
          <h2 className="font-serif text-h2-sm text-ink-900">v1 — Chrome extension (existing)</h2>
          <p className="mt-3 text-body text-ink-700 max-w-[60ch]">
            The Chrome extension version of Lisna remains available at the existing price. It uses cloud transcription and is being maintained alongside v2.
          </p>
          <div className="mt-8 max-w-md rounded-md border border-ink-900/10 bg-cream-50 p-8">
            <p className="font-serif text-plan text-ink-900">Chrome extension</p>
            <p className="mt-4">
              <span className="font-serif text-display-2 text-ink-900">¥980</span>
              <span className="ml-2 font-sans text-body text-ink-700/70">/月</span>
            </p>
            <ul className="mt-6 space-y-2 text-body text-ink-700">
              <li>· Cloud transcription (Whisper / Groq)</li>
              <li>· YouTube + Drive supported</li>
              <li>· Curator-powered notes</li>
            </ul>
            <div className="mt-8">
              <Link href="https://chromewebstore.google.com/" className="underline text-ink-900">View on Chrome Web Store →</Link>
            </div>
          </div>
        </section>

        <p className="mt-16 text-body text-ink-700/70">
          Comparing plans? See <Link href={`/${locale === 'en' ? '' : locale + '/'}compare`} className="underline">Lisna vs other tools</Link>.
        </p>
      </section>
    </MarketingShell>
  );
}

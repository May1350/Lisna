import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { PricingCards } from '@/components/marketing/pricing-cards';
import { BRAND } from '@/i18n/brand-vocabulary';
import Link from 'next/link';
import type { Locale } from '@/i18n/routing';

export default async function PricingPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pricingPage');
  const tPr = await getTranslations('pricingSection');
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return (
    <MarketingShell locale={locale}>
      <section className="mx-auto max-w-5xl pad-x py-16">
        <h1 className="font-serif text-h1 text-ink-900">{t('heading')}</h1>
        <p className="mt-3 font-sans text-body text-ink-700 max-w-[60ch]">
          {t('intro')}
        </p>

        {/* v2 plans */}
        <div className="mt-12">
          <PricingCards
            heading={t('v2Heading')}
            sub={t('v2Sub')}
            plans={[
              {
                name: tPr('alphaName'),
                amount: tPr('alphaAmount'),
                period: tPr('alphaPeriod'),
                badge: { label: tPr('alphaBadge'), tone: 'free' },
                features: [tPr('alphaFeature1'), tPr('alphaFeature2'), tPr('alphaFeature3'), tPr('alphaFeature4')],
                cta: { label: tPr('alphaCta'), href: '/dl/dmg/latest' },
                highlighted: true,
              },
              {
                name: tPr('proName'),
                amount: tPr('proAmount'),
                period: tPr('proPeriod'),
                badge: { label: tPr('proBadge'), tone: 'soon' },
                features: [tPr('proFeature1'), tPr('proFeature2'), tPr('proFeature3'), tPr('proFeature4')],
              },
            ]}
          />
        </div>

        {/* v1 plans */}
        <section className="mt-24 border-t border-ink-900/10 pt-16">
          <h2 className="font-serif text-h2-sm text-ink-900">{t('v1Heading')}</h2>
          <p className="mt-3 text-body text-ink-700 max-w-[60ch]">
            {t('v1Body')}
          </p>
          <div className="mt-8 max-w-md rounded-md border border-ink-900/10 bg-cream-50 p-8">
            <p className="font-serif text-plan text-ink-900">{t('v1PlanName')}</p>
            <p className="mt-4">
              <span className="font-serif text-display-2 text-ink-900">{BRAND.jpy}980</span>
              <span className="ml-2 font-sans text-body text-ink-700/70">{t('v1Period')}</span>
            </p>
            <ul className="mt-6 space-y-2 text-body text-ink-700">
              <li>· {t('v1Feature1')}</li>
              <li>· {t('v1Feature2')}</li>
              <li>· {t('v1Feature3')}</li>
            </ul>
            <div className="mt-8">
              <Link href="https://chromewebstore.google.com/" className="underline text-ink-900">{t('v1Cta')}</Link>
            </div>
          </div>
        </section>

        <p className="mt-16 text-body text-ink-700/70">
          {t('comparePrefix')}<Link href={`${prefix}/compare`} className="underline">{t('compareLink')}</Link>{t('compareSuffix')}
        </p>
      </section>
    </MarketingShell>
  );
}

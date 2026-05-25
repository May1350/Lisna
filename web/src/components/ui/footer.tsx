// web/src/components/ui/footer.tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BRAND, LOCALE_SHORT } from '@/i18n/brand-vocabulary';
import type { Locale } from '@/i18n/routing';

export interface FooterProps {
  locale: Locale;
}

export async function Footer({ locale }: FooterProps) {
  const t = await getTranslations('footer');
  const tL = await getTranslations('footer.links');
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return (
    <footer className="bg-ink-900 text-cream-200/60 mt-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-12 py-16 grid grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr] gap-10">
        <div>
          <h4 className="font-serif text-[18px] text-cream-200 mb-4">{BRAND.appName}</h4>
          <p className="text-body-sm text-cream-200/70 leading-relaxed">{t('tagline')}</p>
        </div>
        <div>
          <h5 className="text-meta uppercase text-cream-200/50 mb-4">{t('productHeading')}</h5>
          <ul className="space-y-2 text-body-sm">
            <li><Link href={`${prefix}/#features`}>{tL('features')}</Link></li>
            <li><Link href={`${prefix}/pricing`}>{tL('pricing')}</Link></li>
            <li><Link href={`${prefix}/download`}>{tL('download')}</Link></li>
            <li><Link href={`${prefix}/changelog`}>{tL('changelog')}</Link></li>
          </ul>
        </div>
        <div>
          <h5 className="text-meta uppercase text-cream-200/50 mb-4">{t('docsHeading')}</h5>
          <ul className="space-y-2 text-body-sm">
            <li><Link href={`${prefix}/docs/getting-started`}>{tL('gettingStarted')}</Link></li>
            <li><Link href={`${prefix}/docs/faq`}>{tL('faq')}</Link></li>
            <li><Link href={`${prefix}/compare`}>{tL('compare')}</Link></li>
            <li><Link href={`${prefix}/download#system-requirements`}>{tL('systemReqs')}</Link></li>
          </ul>
        </div>
        <div>
          <h5 className="text-meta uppercase text-cream-200/50 mb-4">{t('communityHeading')}</h5>
          <ul className="space-y-2 text-body-sm">
            <li><a href="https://discord.gg/69NkqBTbS" target="_blank" rel="noreferrer" className="plausible-event-name=discord_click">{BRAND.discord}<span className="sr-only"> {t('opensInNewTab')}</span></a></li>
            <li><a href="https://github.com/May1350/Lisna" target="_blank" rel="noreferrer">{BRAND.github}<span className="sr-only"> {t('opensInNewTab')}</span></a></li>
            <li><a href="https://bsky.app/profile/lisna.jp" target="_blank" rel="noreferrer">{BRAND.bluesky}<span className="sr-only"> {t('opensInNewTab')}</span></a></li>
            <li><a href="https://github.com/May1350/Lisna/issues" target="_blank" rel="noreferrer">{tL('bugReports')}<span className="sr-only"> {t('opensInNewTab')}</span></a></li>
          </ul>
        </div>
        <div>
          <h5 className="text-meta uppercase text-cream-200/50 mb-4">{t('legalHeading')}</h5>
          <ul className="space-y-2 text-body-sm">
            <li><Link href={`${prefix}/privacy`}>{tL('privacy')}</Link></li>
            <li><Link href={`${prefix}/terms`}>{tL('terms')}</Link></li>
            <li><Link href={`${prefix}/tokusho`}>{tL('tokusho')}</Link></li>
            <li><Link href={`${prefix}/refunds`}>{tL('refunds')}</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-cream-200/10 px-6 lg:px-12 py-6 max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-body-sm">
        <p>{t('copyright')}</p>
        <p aria-label={t('availableLocales')}>
          {LOCALE_SHORT.en}<span aria-hidden="true"> · </span>{LOCALE_SHORT.ja}<span aria-hidden="true"> · </span>{LOCALE_SHORT.ko}
        </p>
      </div>
    </footer>
  );
}

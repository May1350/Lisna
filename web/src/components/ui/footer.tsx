// web/src/components/ui/footer.tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';

export interface FooterProps {
  locale: Locale;
}

export async function Footer({ locale }: FooterProps) {
  const t = await getTranslations('footer');
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return (
    <footer className="bg-ink-900 text-cream-200/60 mt-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-12 py-16 grid grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr] gap-10">
        <div>
          <h4 className="font-serif text-[18px] text-cream-200 mb-4">Lisna</h4>
          <p className="text-body-sm text-cream-200/70 leading-relaxed">{t('tagline')}</p>
        </div>
        <div>
          <h5 className="text-meta uppercase text-cream-200/50 mb-4">{t('productHeading')}</h5>
          <ul className="space-y-2 text-body-sm">
            <li><Link href={`${prefix}/#features`}>Features</Link></li>
            <li><Link href={`${prefix}/pricing`}>Pricing</Link></li>
            <li><Link href={`${prefix}/download`}>Download</Link></li>
            <li><Link href={`${prefix}/changelog`}>Changelog</Link></li>
          </ul>
        </div>
        <div>
          <h5 className="text-meta uppercase text-cream-200/50 mb-4">{t('docsHeading')}</h5>
          <ul className="space-y-2 text-body-sm">
            <li><Link href={`${prefix}/docs/getting-started`}>Getting started</Link></li>
            <li><Link href={`${prefix}/docs/faq`}>FAQ</Link></li>
            <li><Link href={`${prefix}/compare`}>Compare</Link></li>
            <li><Link href={`${prefix}/download#system-requirements`}>System reqs</Link></li>
          </ul>
        </div>
        <div>
          <h5 className="text-meta uppercase text-cream-200/50 mb-4">{t('communityHeading')}</h5>
          <ul className="space-y-2 text-body-sm">
            <li><a href="https://discord.gg/69NkqBTbS" target="_blank" rel="noreferrer">Discord</a></li>
            <li><a href="https://github.com/May1350/Lisna" target="_blank" rel="noreferrer">GitHub</a></li>
            <li><a href="https://bsky.app/profile/lisna.jp" target="_blank" rel="noreferrer">Bluesky</a></li>
            <li><a href="https://github.com/May1350/Lisna/issues" target="_blank" rel="noreferrer">Bug reports</a></li>
          </ul>
        </div>
        <div>
          <h5 className="text-meta uppercase text-cream-200/50 mb-4">{t('legalHeading')}</h5>
          <ul className="space-y-2 text-body-sm">
            <li><Link href={`${prefix}/privacy`}>Privacy</Link></li>
            <li><Link href={`${prefix}/terms`}>Terms</Link></li>
            <li><Link href={`${prefix}/tokusho`}>Tokusho</Link></li>
            <li><Link href={`${prefix}/refunds`}>Refunds</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-cream-200/10 px-6 lg:px-12 py-6 max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-body-sm">
        <p>{t('copyright')}</p>
        <p>EN<span aria-hidden="true"> · </span>日本語<span aria-hidden="true"> · </span>한국어</p>
      </div>
    </footer>
  );
}

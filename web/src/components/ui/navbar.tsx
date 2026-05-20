import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from './locale-switcher';
import type { Locale } from '@/i18n/routing';

export interface NavBarProps {
  locale: Locale;
  pathname: string;
  authState: 'guest' | { name: string; email: string; image?: string | null };
}

export async function NavBar({ locale, pathname, authState }: NavBarProps) {
  const t = await getTranslations('nav');
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return (
    <nav className="fixed top-0 inset-x-0 z-40 backdrop-blur-md bg-cream-200/70 border-b border-ink-900/5">
      <div className="mx-auto max-w-7xl flex items-center justify-between px-6 lg:px-12 h-14">
        <Link href={prefix || '/'} className="font-serif text-[18px] text-ink-900">Lisna</Link>
        <div className="flex items-center gap-6 text-body text-ink-900">
          <Link href={`${prefix}/#features`}>{t('product')}</Link>
          <Link href={`${prefix}/pricing`}>{t('pricing')}</Link>
          <Link href={`${prefix}/docs/getting-started`}>{t('docs')}</Link>
          <Link href={`${prefix}/changelog`}>{t('changelog')}</Link>
          <LocaleSwitcher currentLocale={locale} pathname={pathname} />
          {authState === 'guest' ? (
            <Link href={`${prefix}/signin`} className="underline underline-offset-4">
              {t('signin')}
            </Link>
          ) : (
            <Link href={`${prefix}/dashboard`} className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-accent-tan text-cream-50 text-body-sm grid place-items-center font-serif">
                {authState.name?.[0]?.toUpperCase() ?? '·'}
              </span>
              <span>{authState.name}</span>
              <span className="text-[10px]" aria-hidden="true">▾</span>
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from './locale-switcher';
import { AvatarMenu } from './avatar-menu';
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
            <AvatarMenu
              name={authState.name}
              email={authState.email}
              image={authState.image}
              prefix={prefix}
              onSignOut={async () => {
                'use server';
                const { signOut } = await import('@/lib/auth');
                await signOut({ redirectTo: '/' });
              }}
            />
          )}
        </div>
      </div>
    </nav>
  );
}

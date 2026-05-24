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
    <nav className="fixed top-0 inset-x-0 z-40 bg-burgundy text-cream-100">
      <div className="mx-auto max-w-7xl flex items-center justify-between px-6 lg:px-12 h-14">
        <Link href={prefix || '/'} className="font-serif text-[18px] text-cream-100 hover:text-white transition-colors">Lisna</Link>
        <div className="flex items-center gap-6 text-body">
          <Link href={`${prefix}/#features`} className="hover:text-white transition-colors">{t('product')}</Link>
          <Link href={`${prefix}/pricing`} className="hover:text-white transition-colors">{t('pricing')}</Link>
          <Link href={`${prefix}/docs/getting-started`} className="hover:text-white transition-colors">{t('docs')}</Link>
          <Link href={`${prefix}/changelog`} className="hover:text-white transition-colors">{t('changelog')}</Link>
          <LocaleSwitcher currentLocale={locale} pathname={pathname} />
          {authState === 'guest' ? (
            <Link href={`${prefix}/signin`} className="underline underline-offset-4 hover:text-white transition-colors">
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

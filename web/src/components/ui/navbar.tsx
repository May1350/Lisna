import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from './locale-switcher';
import { AvatarMenu } from './avatar-menu';
import { NavBarMobileMenu } from './navbar-mobile-menu';
import type { Locale } from '@/i18n/routing';

export interface NavBarProps {
  locale: Locale;
  pathname: string;
  authState: 'guest' | { name: string; email: string; image?: string | null };
}

export async function NavBar({ locale, pathname, authState }: NavBarProps) {
  const t = await getTranslations('nav');
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const navItems = [
    { href: `${prefix}/#features`,            label: t('product') },
    { href: `${prefix}/pricing`,              label: t('pricing') },
    { href: `${prefix}/docs/getting-started`, label: t('docs') },
    { href: `${prefix}/changelog`,            label: t('changelog') },
  ];
  return (
    <nav className="fixed top-0 inset-x-0 z-40 bg-burgundy text-cream-100">
      <div className="mx-auto max-w-7xl flex items-center justify-between px-6 lg:px-12 h-14">
        <Link href={prefix || '/'} className="font-serif text-[18px] text-cream-100 hover:text-white transition-colors">Lisna</Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6 text-body">
          {navItems.map((it) => (
            <Link key={it.href} href={it.href} className="hover:text-white transition-colors">{it.label}</Link>
          ))}
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

        {/* Mobile nav */}
        <div className="flex md:hidden items-center gap-2 text-body">
          <LocaleSwitcher currentLocale={locale} pathname={pathname} />
          {authState === 'guest' ? (
            <NavBarMobileMenu
              items={navItems}
              signinHref={`${prefix}/signin`}
              signinLabel={t('signin')}
              authState="guest"
            />
          ) : (
            <>
              <NavBarMobileMenu
                items={navItems}
                signinHref={`${prefix}/signin`}
                signinLabel={t('signin')}
                authState="signedIn"
              />
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
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

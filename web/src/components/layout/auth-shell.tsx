import Link from 'next/link';
import { LocaleSwitcher } from '@/components/ui/locale-switcher';
import { headers } from 'next/headers';
import type { Locale } from '@/i18n/routing';

export interface AuthShellProps {
  locale: Locale;
  children: React.ReactNode;
}

export async function AuthShell({ locale, children }: AuthShellProps) {
  const hdrs = await headers();
  const pathname = hdrs.get('x-pathname') ?? '/';
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return (
    <div className="notebook-bg ruled-paper red-margin min-h-screen">
      <nav className="absolute top-0 inset-x-0 z-40 backdrop-blur-md bg-cream-200/60">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 lg:px-12 h-14">
          <Link href={prefix || '/'} className="font-serif text-[18px] text-ink-900">Lisna</Link>
          <LocaleSwitcher currentLocale={locale} pathname={pathname} />
        </div>
      </nav>
      <main className="pt-14 min-h-screen grid place-items-center px-6">{children}</main>
    </div>
  );
}

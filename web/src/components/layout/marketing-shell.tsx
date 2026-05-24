import { headers } from 'next/headers';
import { NavBar } from '@/components/ui/navbar';
import { Footer } from '@/components/ui/footer';
import { getAuthState } from '@/lib/auth-state';  // placeholder helper; implemented in Task 53
import type { Locale } from '@/i18n/routing';

export interface MarketingShellProps {
  locale: Locale;
  children: React.ReactNode;
}

export async function MarketingShell({ locale, children }: MarketingShellProps) {
  const hdrs = await headers();
  const pathname = hdrs.get('x-pathname') ?? '/';
  // Until Phase J lands, getAuthState always returns 'guest':
  const authState = await getAuthState();
  return (
    <div className="pad-paper min-h-screen">
      <NavBar locale={locale} pathname={pathname} authState={authState} />
      <main className="pt-14">{children}</main>
      <Footer locale={locale} />
    </div>
  );
}

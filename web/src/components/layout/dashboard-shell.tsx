import { headers } from 'next/headers';
import { NavBar } from '@/components/ui/navbar';
import { Footer } from '@/components/ui/footer';
import { getAuthState } from '@/lib/auth-state';
import type { Locale } from '@/i18n/routing';

export interface DashboardShellProps {
  locale: Locale;
  children: React.ReactNode;
}

export async function DashboardShell({ locale, children }: DashboardShellProps) {
  const hdrs = await headers();
  const pathname = hdrs.get('x-pathname') ?? '/';
  const authState = await getAuthState();
  return (
    <div className="notebook-bg min-h-screen">
      <NavBar locale={locale} pathname={pathname} authState={authState} />
      <main className="pt-14 mx-auto max-w-7xl px-6 lg:px-12 py-12">{children}</main>
      <Footer locale={locale} />
    </div>
  );
}

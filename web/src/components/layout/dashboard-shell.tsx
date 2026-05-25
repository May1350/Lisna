import { headers } from 'next/headers';
import { NavBar } from '@/components/ui/navbar';
import { Footer } from '@/components/ui/footer';
import { getAuthState } from '@/lib/auth-state';  // placeholder helper; implemented in Task 53
import type { Locale } from '@/i18n/routing';

export interface DashboardShellProps {
  locale: Locale;
  children: React.ReactNode;
}

export async function DashboardShell({ locale, children }: DashboardShellProps) {
  const hdrs = await headers();
  const pathname = hdrs.get('x-pathname') ?? '/';
  // Until Phase J lands, getAuthState always returns 'guest' — NavBar renders public state on dashboard routes:
  const authState = await getAuthState();
  return (
    <div className="pad-paper min-h-screen">
      <NavBar locale={locale} pathname={pathname} authState={authState} />
      {/* pt-14 clears the fixed NavBar (h-14); pad-x keeps content right of the printed red margin. */}
      <main className="pt-14 mx-auto max-w-7xl pad-x py-12">{children}</main>
      <Footer locale={locale} />
    </div>
  );
}

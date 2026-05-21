// web/src/app/[locale]/dashboard/page.tsx
import { setRequestLocale } from 'next-intl/server';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import type { Locale } from '@/i18n/routing';

export default async function DashboardPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <DashboardShell locale={locale}>
      <h1 className="font-serif text-h2-sm text-ink-900">Signed in.</h1>
      <p className="mt-3 text-body text-ink-700">
        This is a placeholder dashboard. The full dashboard arrives in a later phase.
      </p>
      <p className="mt-3 text-body text-ink-700">
        For now, Lisna runs entirely on your Mac — there&apos;s nothing to do here. You can close
        this tab and return to the desktop app.
      </p>
    </DashboardShell>
  );
}

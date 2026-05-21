import { setRequestLocale } from 'next-intl/server';
import { AuthShell } from '@/components/layout/auth-shell';
import type { Locale } from '@/i18n/routing';
import { AutoCloseTab } from './_auto-close';

export default async function AuthSuccessPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AuthShell locale={locale}>
      <div className="max-w-[420px] w-full text-center">
        <p className="font-serif text-[64px] text-accent-tan">✓</p>
        <h1 className="mt-2 font-serif text-h2-sm text-ink-900">Signed in.</h1>
        <p className="mt-3 text-body text-ink-700">Lisna is ready to use on your Mac. You can close this tab.</p>
        <AutoCloseTab />
      </div>
    </AuthShell>
  );
}

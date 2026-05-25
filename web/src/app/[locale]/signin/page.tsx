// web/src/app/[locale]/signin/page.tsx
import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { AuthShell } from '@/components/layout/auth-shell';
import { SignInPanel } from '@/components/ui/sign-in-panel';
import { BRAND } from '@/i18n/brand-vocabulary';
import type { Locale } from '@/i18n/routing';
import { signIn } from '@/lib/auth';

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ source?: string; next?: string; app_callback?: string; ['check-email']?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('auth');
  const prefix = locale === 'en' ? '' : `/${locale}`;

  const checkEmail = sp['check-email'] === '1';

  async function sendMagicLink(email: string) {
    'use server';
    const callbackUrl = sp.source === 'app'
      ? `/api/auth/exchange-code/issue?app_callback=${encodeURIComponent(sp.app_callback ?? 'lisna://callback')}`
      : (sp.next ?? '/dashboard');
    await signIn('resend', { email, redirectTo: callbackUrl });
  }

  async function oauth(provider: 'google' | 'apple' | 'github') {
    'use server';
    const callbackUrl = sp.source === 'app'
      ? `/api/auth/exchange-code/issue?app_callback=${encodeURIComponent(sp.app_callback ?? 'lisna://callback')}`
      : (sp.next ?? '/dashboard');
    await signIn(provider, { redirectTo: callbackUrl });
  }

  if (checkEmail) {
    return (
      <AuthShell locale={locale}>
        <div className="max-w-[440px] w-full text-center">
          <h1 className="font-serif text-h2-sm text-ink-900">{t('checkEmailHeading')}</h1>
          <p className="mt-3 text-body text-ink-700">{t('checkEmailBody')}</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell locale={locale}>
      <div className="max-w-[440px] w-full">
        <h1 className="font-serif text-h2-sm text-ink-900 text-center">
          {t('continueHeadingPrefix')}<em className="italic text-accent-tan">{BRAND.appName}</em>{t('continueHeadingSuffix')}
        </h1>

        <div className="mt-8">
          <SignInPanel
            sendMagicLink={sendMagicLink}
            googleAction={oauth.bind(null, 'google')}
            appleAction={oauth.bind(null, 'apple')}
            githubAction={oauth.bind(null, 'github')}
          />
        </div>

        <p className="mt-8 text-hint text-ink-700/60 text-center">
          {t('tosPrefix')}<Link href={`${prefix}/terms`} className="underline">{t('tosTerms')}</Link>{t('tosMiddle')}<Link href={`${prefix}/privacy`} className="underline">{t('tosPrivacy')}</Link>{t('tosSuffix')}
        </p>
        <p className="mt-3 text-hint text-ink-700/60 text-center">
          {t('needHelpPrefix')}<a href="https://discord.gg/69NkqBTbS" className="underline" target="_blank" rel="noreferrer">{BRAND.discord}</a>{t('needHelpSuffix')}
        </p>
      </div>
    </AuthShell>
  );
}

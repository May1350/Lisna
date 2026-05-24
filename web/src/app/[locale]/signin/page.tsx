// web/src/app/[locale]/signin/page.tsx
import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { EmailMagicLinkForm } from '@/components/ui/email-magic-link-form';
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
        <p className="mt-3 text-body text-ink-700 text-center">
          {t('continueBody')}
        </p>

        <div className="mt-8">
          <EmailMagicLinkForm onSubmit={sendMagicLink} hint={t('magicLinkHint')} />
        </div>

        <div className="my-8 flex items-center gap-3">
          <span className="flex-1 h-px bg-ink-900/10" />
          <span className="text-meta uppercase text-accent-tan">{t('oauthDivider')}</span>
          <span className="flex-1 h-px bg-ink-900/10" />
        </div>

        <form className="space-y-3">
          <Button formAction={oauth.bind(null, 'google')} variant="ghost" className="w-full justify-center">{t('continueGoogle')}</Button>
          <Button formAction={oauth.bind(null, 'apple')} variant="ghost" className="w-full justify-center">{t('continueApple')}</Button>
          <Button formAction={oauth.bind(null, 'github')} variant="ghost" className="w-full justify-center">{t('continueGithub')}</Button>
        </form>

        <p className="mt-8 text-hint text-ink-700/60 text-center">
          {t('tosPrefix')}<Link href="/terms" className="underline">{t('tosTerms')}</Link>{t('tosMiddle')}<Link href="/privacy" className="underline">{t('tosPrivacy')}</Link>{t('tosSuffix')}
        </p>
        <p className="mt-3 text-hint text-ink-700/60 text-center">
          {t('needHelpPrefix')}<a href="https://discord.gg/69NkqBTbS" className="underline" target="_blank" rel="noreferrer">{BRAND.discord}</a>{t('needHelpSuffix')}
        </p>
      </div>
    </AuthShell>
  );
}

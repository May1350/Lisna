// web/src/app/[locale]/signin/page.tsx
import { setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { EmailMagicLinkForm } from '@/components/ui/email-magic-link-form';
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
          <h1 className="font-serif text-h2-sm text-ink-900">Check your email.</h1>
          <p className="mt-3 text-body text-ink-700">We sent a magic link to your inbox. It expires in 10 minutes.</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell locale={locale}>
      <div className="max-w-[440px] w-full">
        <h1 className="font-serif text-h2-sm text-ink-900 text-center">
          Continue to <em className="italic text-accent-tan">Lisna</em>.
        </h1>
        <p className="mt-3 text-body text-ink-700 text-center">
          Sign in or sign up — same flow either way. Either method below works.
        </p>

        <div className="mt-8">
          <EmailMagicLinkForm onSubmit={sendMagicLink} hint="We'll email you a magic link." />
        </div>

        <div className="my-8 flex items-center gap-3">
          <span className="flex-1 h-px bg-ink-900/10" />
          <span className="text-meta uppercase text-accent-tan">or</span>
          <span className="flex-1 h-px bg-ink-900/10" />
        </div>

        <form className="space-y-3">
          <Button formAction={oauth.bind(null, 'google')} variant="ghost" className="w-full justify-center">Continue with Google</Button>
          <Button formAction={oauth.bind(null, 'apple')} variant="ghost" className="w-full justify-center">Continue with Apple</Button>
          <Button formAction={oauth.bind(null, 'github')} variant="ghost" className="w-full justify-center">Continue with GitHub</Button>
        </form>

        <p className="mt-8 text-hint text-ink-700/60 text-center">
          By continuing, you agree to our <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy</Link> policy.
        </p>
        <p className="mt-3 text-hint text-ink-700/60 text-center">
          Need help? Join our <a href="https://discord.gg/69NkqBTbS" className="underline" target="_blank" rel="noreferrer">Discord</a>.
        </p>
      </div>
    </AuthShell>
  );
}

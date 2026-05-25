'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from './button';
import { EmailMagicLinkForm } from './email-magic-link-form';
import { GoogleIcon, AppleIcon, GithubIcon } from './provider-icons';
import { BRAND } from '@/i18n/brand-vocabulary';

type Method = 'email' | 'google' | 'apple' | 'github';
const STORE_KEY = 'lisna:lastAuth';
const METHODS: Method[] = ['email', 'google', 'apple', 'github'];

function record(m: Method) {
  try { localStorage.setItem(STORE_KEY, m); } catch { /* private mode / disabled */ }
}

export interface SignInPanelProps {
  // Server actions, bound on the server page and passed down.
  sendMagicLink: (email: string) => Promise<void>;
  googleAction: () => Promise<void>;
  appleAction: () => Promise<void>;
  githubAction: () => Promise<void>;
}

export function SignInPanel({ sendMagicLink, googleAction, appleAction, githubAction }: SignInPanelProps) {
  const t = useTranslations('auth');
  const [last, setLast] = React.useState<Method | null>(null);

  React.useEffect(() => {
    try {
      const v = localStorage.getItem(STORE_KEY) as Method | null;
      if (v && METHODS.includes(v)) setLast(v);
    } catch { /* ignore */ }
  }, []);

  const methodName: Record<Method, string> = {
    email: t('methodEmail'),
    google: BRAND.google,
    apple: BRAND.apple,
    github: BRAND.github,
  };

  return (
    <>
      {last && (
        <p className="mb-5 text-center text-body-sm text-ink-700">
          {t('lastUsed', { method: methodName[last] })}
        </p>
      )}

      <EmailMagicLinkForm
        onSubmit={async (email) => { record('email'); await sendMagicLink(email); }}
        hint={t('magicLinkHint')}
        submitLabel={t('sendLink')}
        submittingLabel={t('sending')}
        sentLabel={t('linkSent')}
      />

      <div className="my-8 flex items-center gap-3">
        <span className="flex-1 h-px bg-ink-900/10" />
        <span className="text-meta uppercase text-accent-tan">{t('oauthDivider')}</span>
        <span className="flex-1 h-px bg-ink-900/10" />
      </div>

      <form className="space-y-3">
        <Button
          formAction={googleAction}
          onClick={() => record('google')}
          variant="ghost"
          className="w-full justify-center gap-3 font-medium bg-white border-[#dadce0] text-[#3c4043] hover:bg-[#f8f9fa]"
        >
          <GoogleIcon className="h-[18px] w-[18px]" />
          {t('continueGoogle')}
        </Button>
        <Button
          formAction={appleAction}
          onClick={() => record('apple')}
          variant="ghost"
          className="w-full justify-center gap-3 font-medium bg-black border-black text-white hover:bg-[#1a1a1a]"
        >
          <AppleIcon className="h-[19px] w-[19px] -mt-[2px]" />
          {t('continueApple')}
        </Button>
        <Button
          formAction={githubAction}
          onClick={() => record('github')}
          variant="ghost"
          className="w-full justify-center gap-3 font-medium bg-[#24292f] border-[#24292f] text-white hover:bg-[#1b1f23]"
        >
          <GithubIcon className="h-[19px] w-[19px]" />
          {t('continueGithub')}
        </Button>
      </form>
    </>
  );
}

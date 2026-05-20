import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { routing, type Locale } from '@/i18n/routing';
import { notoSerifJP } from '@/lib/fonts';
import { cn } from '@/lib/cn';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await getMessages();

  const localeFontClass = locale === 'ja' ? notoSerifJP.variable : '';

  return (
    <div className={cn(localeFontClass)} data-locale={locale}>
      <NextIntlClientProvider locale={locale as Locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </div>
  );
}

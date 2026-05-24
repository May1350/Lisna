import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { listDocs } from '@/lib/mdx';
import type { Locale } from '@/i18n/routing';

export default async function DocsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  // Next.js 16 generates LayoutProps with `params: Promise<{ locale: string }>`
  // (path-segment-inferred shape, not narrowed). Widen to match here; the
  // value is still a valid Locale at runtime because the parent [locale]/
  // layout already validates via `hasLocale(routing.locales, locale)`.
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const slugs = await listDocs();
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return (
    <MarketingShell locale={locale as Locale}>
      <div className="mx-auto max-w-6xl pad-x py-12 grid lg:grid-cols-[220px_1fr] gap-12">
        <aside className="lg:sticky lg:top-20 self-start">
          <p className="text-meta uppercase text-ink-700/60 mb-3">Docs</p>
          <ul className="space-y-2 text-body text-ink-900">
            {slugs.map((s) => (
              <li key={s}>
                <Link href={`${prefix}/docs/${s}`} className="hover:text-margin-red">
                  {s.replace(/-/g, ' ')}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
        <article className="prose prose-stone max-w-[720px] font-sans text-body text-ink-700 leading-[1.7]">
          {children}
        </article>
      </div>
    </MarketingShell>
  );
}

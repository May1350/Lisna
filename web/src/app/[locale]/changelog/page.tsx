// web/src/app/[locale]/changelog/page.tsx
import { setRequestLocale } from 'next-intl/server';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { listChangelog } from '@/lib/changelog';
import { cn } from '@/lib/cn';
import { mdxComponents } from '@/lib/mdx-components';
import type { Locale } from '@/i18n/routing';

const CAT_COLOR: Record<string, string> = {
  feature: 'text-accent-sage',
  fix: 'text-accent-tan',
  breaking: 'text-margin-red',
};

export default async function ChangelogPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const entries = await listChangelog();
  const components = mdxComponents(locale);
  return (
    <MarketingShell locale={locale}>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-serif text-h1 text-ink-900">Changelog</h1>
        <p className="mt-3 text-body text-ink-700">Release notes for Lisna desktop. <a href="/changelog/rss.xml" className="underline">RSS</a>.</p>
        <ol className="mt-12 space-y-12">
          {entries.map((e) => (
            <li key={e.slug} id={e.slug}>
              <header className="flex items-center gap-3 text-body-sm">
                <time dateTime={e.date} className="font-mono text-ink-700/70">{e.date}</time>
                <span className="rounded-sm bg-cream-300 px-2 py-0.5 font-mono">v{e.version}</span>
                <span className={cn('uppercase text-meta', CAT_COLOR[e.category])}>{e.category}</span>
              </header>
              <h2 className="mt-3 font-serif text-h2-sm text-ink-900">{e.title}</h2>
              <div className="mt-4 prose prose-stone max-w-none text-body text-ink-700">
                <MDXRemote source={e.source.replace(/^---\n[\s\S]*?\n---/, '')} components={components} />
              </div>
            </li>
          ))}
        </ol>
      </section>
    </MarketingShell>
  );
}

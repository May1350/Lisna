import { notFound } from 'next/navigation';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { setRequestLocale } from 'next-intl/server';
import { loadDocBySlug, listDocs } from '@/lib/mdx';
import type { Locale } from '@/i18n/routing';

export async function generateStaticParams() {
  const slugs = await listDocs();
  return slugs.map((s) => ({ slug: [s] }));
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ locale: Locale; slug: string[] }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const doc = await loadDocBySlug(slug);
  if (!doc) notFound();
  return <MDXRemote source={doc.source} />;
}

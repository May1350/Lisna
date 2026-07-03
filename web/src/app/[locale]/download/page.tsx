import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { Locale } from '@/i18n/routing';
import { env } from '@/lib/env';

/**
 * Latest-release facts for the version line — fetched from the GitHub API so the
 * page never hardcodes (and never goes stale on) a version. Mirrors the
 * resolution in /dl/dmg/latest. Cached 5 min; null on any error so the page
 * still renders using the message's default placeholders.
 */
async function getLatestReleaseInfo(): Promise<{ version: string | null; sizeMB: number | null; checksumsUrl: string | null } | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'lisna.jp' },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const assets: { name?: string; size?: number; browser_download_url?: string }[] = data.assets ?? [];
    const dmg = assets.find((a) => a.name?.toLowerCase().endsWith('.dmg'));
    const sums = assets.find((a) => a.name === 'SHA256SUMS.txt');
    return {
      version: (data.tag_name as string) || null,
      sizeMB: dmg?.size ? Math.round(dmg.size / 1_000_000) : null,
      checksumsUrl: sums?.browser_download_url ?? null,
    };
  } catch {
    return null;
  }
}

export default async function DownloadPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('downloadPage');
  const rel = await getLatestReleaseInfo();
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return (
    <MarketingShell locale={locale}>
      <section className="relative mx-auto max-w-5xl pad-x py-16">
        <h1 className="font-serif text-h1 text-ink-900">{t('title')}</h1>
        <p className="mt-3 font-sans text-body text-ink-700">{t('versionLine', { version: rel?.version ?? 'latest', size: rel?.sizeMB ?? 110 })}</p>
        {rel?.checksumsUrl && (
          <a href={rel.checksumsUrl} className="mt-2 inline-block text-body-sm text-ink-700/70 hover:text-ink-700 underline">{t('shaToggle')} →</a>
        )}
        <div className="mt-8">
          <Button asChild size="lg">
            <Link href="/dl/dmg/latest">{t('downloadCta')}</Link>
          </Button>
        </div>

        <div id="system-requirements" className="mt-20 grid lg:grid-cols-2 gap-6">
          <Card>
            <h2 className="font-serif text-h2-sm text-ink-900">{t('sysReqHeading')}</h2>
            <ul className="mt-4 space-y-2 text-body text-ink-700">
              <li>· {t('sysReq1')}</li>
              <li>· {t('sysReq2')}</li>
              <li>· {t('sysReq3')}</li>
              <li>· {t('sysReq4')}</li>
            </ul>
          </Card>
          <Card>
            <h2 className="font-serif text-h2-sm text-ink-900">{t('installHeading')}</h2>
            <ol className="mt-4 space-y-2 text-body text-ink-700 list-decimal list-inside">
              <li>{t('install1')}</li>
              <li>{t('install2')}</li>
              <li>{t('install3')}</li>
            </ol>
          </Card>
        </div>

        <aside className="mt-10 max-w-3xl rounded-md border-l-4 border-print-red bg-cream-50 px-6 py-5">
          <h3 className="font-serif text-h2-sm text-ink-900">{t('gatekeeperTitle')}</h3>
          <p className="mt-2 text-body text-ink-700">
            {t('gatekeeperBody')}<Link href={`${prefix}/docs/troubleshooting`} className="underline">{t('troubleLink')}</Link>{t('gatekeeperSuffix')}
          </p>
        </aside>

        <section id="model-files-advanced" className="mt-20">
          <h2 className="font-serif text-h2-sm text-ink-900">{t('modelsHeading')}</h2>
          <p className="mt-4 text-body text-ink-700 max-w-[60ch]">
            {t('modelsBody')}
          </p>
          <ul className="mt-4 space-y-3 text-body-sm text-ink-700 font-mono bg-cream-50 p-6 rounded-md border border-ink-900/10">
            <li>· {t('modelsWhisperLabel')}: <strong>ggml-large-v3-turbo-q5_0.bin</strong> (~574 MB) → <code>~/Library/Application Support/@lisna/desktop/models/whisper.bin</code></li>
            <li>· {t('modelsLlamaLabel')}: <strong>Llama-3.2-3B-Instruct-Q4_K_M.gguf</strong> (2.0 GB) → <code>~/Library/Application Support/@lisna/desktop/models/llm.gguf</code></li>
          </ul>
          <p className="mt-4 text-body-sm text-ink-700/70">
            {t('modelsFooterPrefix')}<a href="https://github.com/May1350/Lisna/releases" className="underline">{t('modelsFooterLink')}</a>{t('modelsFooterSuffix')}<code>models-latest</code>.
          </p>
        </section>

        <section className="mt-16">
          <h2 className="font-serif text-h2-sm text-ink-900">{t('troubleHeading')}</h2>
          <p className="mt-3 text-body text-ink-700">
            {t('troubleBody')}<Link href={`${prefix}/docs/troubleshooting`} className="underline">{t('troubleLink')}</Link>{t('troubleSuffix')}
          </p>
        </section>

        <section className="mt-16">
          <h2 className="font-serif text-h2-sm text-ink-900">{t('wlHeading')}</h2>
          <p className="mt-3 text-body text-ink-700 italic max-w-[52ch]">
            {t('wlBody')}
          </p>
          <form className="mt-4 flex gap-2 max-w-md">
            <input type="email" placeholder={t('wlEmailPlaceholder')} className="h-12 flex-1 rounded-md bg-cream-50 border border-ink-900/20 px-4" />
            <Button type="submit">{t('wlNotifyCta')}</Button>
          </form>
        </section>
      </section>
    </MarketingShell>
  );
}

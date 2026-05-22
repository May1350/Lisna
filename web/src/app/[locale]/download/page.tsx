import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { Locale } from '@/i18n/routing';

export default async function DownloadPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <MarketingShell locale={locale}>
      <section className="red-margin relative mx-auto max-w-5xl px-6 lg:px-12 py-16">
        <h1 className="font-serif text-h1 text-ink-900">Lisna for macOS</h1>
        <p className="mt-3 font-sans text-body text-ink-700">v0.1.0 · 158 MB · Apple Silicon</p>
        <p className="mt-1 text-hint text-ink-700/60 font-mono break-all">SHA256: d924684478db9437b96dab94f24a8947e4fd4a740505cdf0e915a830bac9bb01</p>
        <div className="mt-8">
          <Button asChild size="lg">
            <Link href="/dl/dmg/latest">Download .dmg →</Link>
          </Button>
        </div>

        <div id="system-requirements" className="mt-20 grid lg:grid-cols-2 gap-6">
          <Card>
            <h2 className="font-serif text-h2-sm text-ink-900">System requirements</h2>
            <ul className="mt-4 space-y-2 text-body text-ink-700">
              <li>· macOS 13 Ventura or later</li>
              <li>· Apple Silicon (M1/M2/M3/M4) — Intel Macs not supported in alpha</li>
              <li>· 8 GB RAM minimum (16 GB recommended)</li>
              <li>· 5 GB free disk space for models</li>
            </ul>
          </Card>
          <Card>
            <h2 className="font-serif text-h2-sm text-ink-900">Install in 3 steps</h2>
            <ol className="mt-4 space-y-2 text-body text-ink-700 list-decimal list-inside">
              <li>Open the .dmg</li>
              <li>Drag Lisna.app to /Applications</li>
              <li>Launch — first-run fetches Whisper + Llama (~3.5 GB, one-time)</li>
            </ol>
          </Card>
        </div>

        <section id="model-files-advanced" className="mt-20">
          <h2 className="font-serif text-h2-sm text-ink-900">Model files (advanced)</h2>
          <p className="mt-4 text-body text-ink-700 max-w-[60ch]">
            For offline install or on a metered connection, place the models at the paths below before first launch:
          </p>
          <ul className="mt-4 space-y-3 text-body-sm text-ink-700 font-mono bg-cream-50 p-6 rounded-md border border-ink-900/10">
            <li>· Whisper STT: <strong>ggml-large-v3-q5_0.bin</strong> (1.5 GB) → <code>~/Library/Application Support/@lisna/desktop/models/whisper.bin</code></li>
            <li>· Llama LLM: <strong>Llama-3.2-3B-Instruct-Q4_K_M.gguf</strong> (2.0 GB) → <code>~/Library/Application Support/@lisna/desktop/models/llm.gguf</code></li>
          </ul>
          <p className="mt-4 text-body-sm text-ink-700/70">
            Files attached to the <a href="https://github.com/May1350/Lisna/releases" className="underline">GitHub release</a> tagged <code>models-latest</code>.
          </p>
        </section>

        <section className="mt-16">
          <h2 className="font-serif text-h2-sm text-ink-900">Trouble?</h2>
          <p className="mt-3 text-body text-ink-700">See <Link href={`/${locale === 'en' ? '' : locale + '/'}docs/troubleshooting`} className="underline">troubleshooting</Link>.</p>
        </section>

        <section className="mt-16">
          <h2 className="font-serif text-h2-sm text-ink-900">Windows / Linux</h2>
          <p className="mt-3 text-body text-ink-700 italic max-w-[52ch]">
            Coming after macOS alpha stabilizes. Drop your email below to get notified.
          </p>
          <form className="mt-4 flex gap-2 max-w-md">
            <input type="email" placeholder="you@example.com" className="h-12 flex-1 rounded-md bg-cream-50 border border-ink-900/20 px-4" />
            <Button type="submit">Notify me</Button>
          </form>
        </section>
      </section>
    </MarketingShell>
  );
}

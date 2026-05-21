// web/src/app/[locale]/compare/page.tsx
import { setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import type { Locale } from '@/i18n/routing';

const ROWS: { feature: string; cells: [string, string, string, string] }[] = [
  { feature: 'On-device transcription',     cells: ['✓', '✗', '✗', '✗'] },
  { feature: 'Notes stay on device',         cells: ['✓', '✗', '✗', '✗'] },
  { feature: 'No data sent to LLM provider', cells: ['✓', '✗', '✗', '✗'] },
  { feature: 'Real-time captions',           cells: ['✓', '✓', '✓', '✗'] },
  { feature: 'Markdown / Obsidian export',   cells: ['✓', '✗', '✗', 'partial'] },
  { feature: 'Works offline',                cells: ['✓', '✗', '✗', '✗'] },
  { feature: 'Lecture-aware structuring',    cells: ['✓', 'partial', 'partial', '✗'] },
  { feature: 'Free tier',                    cells: ['✓', '✓', '✓', '✗'] },
  { feature: 'Price',                        cells: ['$0 (alpha) / $? Pro', '$8.33/mo', '$10/mo', '$10/mo'] },
];

export default async function ComparePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <MarketingShell locale={locale}>
      <section className="mx-auto max-w-5xl px-6 lg:px-12 py-16">
        <h1 className="font-serif text-h1 text-ink-900">Lisna vs cloud-based tools</h1>
        <p className="mt-4 font-sans text-body text-ink-700 max-w-[60ch]">
          What you get when transcription, structuring, and storage all run on your Mac.
        </p>

        <div className="mt-12 overflow-x-auto rounded-md border border-ink-900/10">
          <table className="w-full text-body text-ink-900">
            <thead className="bg-cream-50 border-b border-ink-900/10">
              <tr>
                <th className="text-left py-3 px-4 font-serif">Feature</th>
                <th className="py-3 px-4 font-serif">Lisna</th>
                <th className="py-3 px-4 font-serif text-ink-700">Otter</th>
                <th className="py-3 px-4 font-serif text-ink-700">Fireflies</th>
                <th className="py-3 px-4 font-serif text-ink-700">Notion AI</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr key={i} className="border-b border-ink-900/5 last:border-b-0">
                  <td className="py-3 px-4">{row.feature}</td>
                  {row.cells.map((cell, j) => (
                    <td key={j} className="py-3 px-4 text-center">
                      {cell === '✓' ? (
                        <span className="text-accent-sage" aria-label="Yes">
                          <span aria-hidden="true">✓</span>
                        </span>
                      ) : cell === '✗' ? (
                        <span className="text-ink-700/40" aria-label="No">
                          <span aria-hidden="true">✗</span>
                        </span>
                      ) : (
                        <span className="text-ink-700">{cell}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="mt-16 prose prose-stone max-w-none text-body text-ink-700 leading-[1.7] font-sans space-y-5">
          <h2 className="font-serif text-h2-sm text-ink-900 mt-0">Why we built Lisna differently</h2>
          <p>Cloud transcription is fast to build but loud about your data. Audio is uploaded to a vendor, transcribed on their GPUs, structured by their LLM, and stored on their servers. For students and researchers handling lectures, drafts, and unpublished ideas, that flow is wrong.</p>
          <p>Lisna inverts it. Whisper runs on your Mac's Neural Engine. Llama 3.2 runs in your Mac's RAM. Notes write to your filesystem in Markdown — sync them with Obsidian or iCloud or no one if you prefer.</p>
          <p>This means Lisna is slower on first launch (model downloads). It means we can't ship feature parity with cloud-only tools on day one. We think the trade is worth it.</p>
        </section>
      </section>
    </MarketingShell>
  );
}

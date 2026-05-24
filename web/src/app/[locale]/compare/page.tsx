// web/src/app/[locale]/compare/page.tsx
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { BRAND } from '@/i18n/brand-vocabulary';
import type { Locale } from '@/i18n/routing';

export default async function ComparePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('comparePage');

  const rows: { feature: string; cells: [string, string, string, string] }[] = [
    { feature: t('row1'), cells: ['✓', '✗', '✗', '✗'] },
    { feature: t('row2'), cells: ['✓', '✗', '✗', '✗'] },
    { feature: t('row3'), cells: ['✓', '✗', '✗', '✗'] },
    { feature: t('row4'), cells: ['✓', '✓', '✓', '✗'] },
    { feature: t('row5'), cells: ['✓', '✗', '✗', t('cellPartial')] },
    { feature: t('row6'), cells: ['✓', '✗', '✗', '✗'] },
    { feature: t('row7'), cells: ['✓', t('cellPartial'), t('cellPartial'), '✗'] },
    { feature: t('row8'), cells: ['✓', '✓', '✓', '✗'] },
    { feature: t('row9'), cells: [t('cellLisnaPrice'), t('cellOtterPrice'), t('cellFirefliesPrice'), t('cellNotionAiPrice')] },
  ];

  return (
    <MarketingShell locale={locale}>
      <section className="mx-auto max-w-5xl px-6 lg:px-12 py-16">
        <h1 className="font-serif text-h1 text-ink-900">{t('title')}</h1>
        <p className="mt-4 font-sans text-body text-ink-700 max-w-[60ch]">
          {t('intro')}
        </p>

        <div className="mt-12 overflow-x-auto rounded-md border border-ink-900/10">
          <table className="w-full text-body text-ink-900">
            <thead className="bg-cream-50 border-b border-ink-900/10">
              <tr>
                <th className="text-left py-3 px-4 font-serif">{t('thFeature')}</th>
                <th className="py-3 px-4 font-serif">{BRAND.appName}</th>
                <th className="py-3 px-4 font-serif text-ink-700">{BRAND.otter}</th>
                <th className="py-3 px-4 font-serif text-ink-700">{BRAND.fireflies}</th>
                <th className="py-3 px-4 font-serif text-ink-700">{BRAND.notionAi}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-ink-900/5 last:border-b-0">
                  <td className="py-3 px-4">{row.feature}</td>
                  {row.cells.map((cell, j) => (
                    <td key={j} className="py-3 px-4 text-center">
                      {cell === '✓' ? (
                        <span className="text-accent-sage" aria-label={t('ariaYes')}>
                          <span aria-hidden="true">✓</span>
                        </span>
                      ) : cell === '✗' ? (
                        <span className="text-ink-700/40" aria-label={t('ariaNo')}>
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
          <h2 className="font-serif text-h2-sm text-ink-900 mt-0">{t('whyHeading')}</h2>
          <p>{t('whyP1')}</p>
          <p>{t('whyP2')}</p>
          <p>{t('whyP3')}</p>
        </section>
      </section>
    </MarketingShell>
  );
}

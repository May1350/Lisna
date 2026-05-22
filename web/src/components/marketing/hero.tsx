// web/src/components/marketing/hero.tsx
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ScreenshotFrame } from '@/components/ui/screenshot-frame';

export function Hero() {
  const t = useTranslations('hero');
  return (
    <section className="red-margin relative mx-auto max-w-7xl px-6 lg:px-24 py-24 lg:py-32">
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-12 lg:gap-20 items-center">
        <div>
          <h1 className="font-serif text-display-1 text-ink-900 leading-[1.05]">
            {t('h1Line1')}<br />
            {t('h1Line2Prefix')}
            <em className="font-serif italic text-accent-tan text-[1.05em]">{t('h1Line2Emphasis')}</em>
            {t('h1Line2Suffix')}
          </h1>
          <p className="mt-6 font-sans text-sub text-ink-700 max-w-[42ch]">{t('sub')}</p>
          <div className="mt-10">
            <Button asChild size="md">
              <Link href="/dl/dmg/latest" className="plausible-event-name=download_click">{t('cta')}</Link>
            </Button>
          </div>
          <p className="mt-3 text-hint text-ink-700/60">{t('hint')}</p>
        </div>
        <div aria-hidden="true">
          <ScreenshotFrame title="Real Analysis · Lecture 3">
            <div className="font-sans text-body-sm text-ink-700 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-margin-red animate-pulse" />
                <span className="text-meta uppercase">Live</span>
                <span className="ml-auto text-hint">04:32</span>
              </div>
              <div className="flex gap-px h-10 items-end">
                {Array.from({ length: 20 }).map((_, i) => (
                  <span
                    key={i}
                    className={i >= 8 && i <= 10 ? 'w-1.5 bg-margin-red rounded-sm' : 'w-1.5 bg-ink-700/30 rounded-sm'}
                    style={{ height: `${30 + Math.sin(i) * 20 + (i % 3) * 8}%` }}
                  />
                ))}
              </div>
              <div className="border-t border-dashed border-ink-900/15 pt-3">
                <p className="text-body-sm"><span className="text-hint text-accent-tan mr-2">04:25</span>The Bolzano-Weierstrass theorem states that…</p>
              </div>
              <div className="border-t border-dashed border-ink-900/15 pt-3">
                <p className="text-meta uppercase text-accent-tan">Note · auto-generated</p>
                <h4 className="font-serif text-grid-title mt-1">§ Compactness</h4>
                <ul className="mt-2 space-y-1 text-body-sm">
                  <li>· Bolzano-Weierstrass</li>
                  <li>· Heine-Cantor</li>
                </ul>
              </div>
            </div>
          </ScreenshotFrame>
        </div>
      </div>
    </section>
  );
}

// web/src/components/marketing/cta-strip.tsx
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export function CTAStrip() {
  const t = useTranslations('ctaStrip');
  const tHero = useTranslations('hero');
  return (
    <section className="bg-cream-300 border-t-[1px] border-margin-red/30">
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <p className="text-meta uppercase tracking-[0.18em] text-accent-tan">{t('eyebrow')}</p>
        <h2 className="mt-3 font-serif text-h1 text-ink-900">
          {t('headlineBefore')}<em className="italic text-accent-tan">{t('headlineEm')}</em>{t('headlineAfter')}
        </h2>
        <p className="mt-5 font-sans text-body text-ink-700 max-w-[52ch] mx-auto">
          {t('sub')}
        </p>
        <div className="mt-10">
          <Button asChild size="lg">
            <Link href="/dl/dmg/latest">{tHero('cta')}</Link>
          </Button>
        </div>
        <p className="mt-3 text-hint text-ink-700/60">{t('hint')}</p>
      </div>
    </section>
  );
}

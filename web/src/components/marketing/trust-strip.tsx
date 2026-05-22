// web/src/components/marketing/trust-strip.tsx
import { useTranslations } from 'next-intl';

export function TrustStrip() {
  const t = useTranslations('trust');
  return (
    <section className="border-y border-ink-900/8 bg-cream-50/50 py-10">
      <div className="mx-auto max-w-7xl px-6 lg:px-24 text-center">
        <p className="text-meta uppercase tracking-[0.18em] text-ink-700/55">{t('label')}</p>
        <p className="mt-4 font-serif italic text-[22px] text-ink-900/88">{t('keio')}</p>
      </div>
    </section>
  );
}

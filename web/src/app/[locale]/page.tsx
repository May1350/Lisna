// web/src/app/[locale]/page.tsx
import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { Hero } from '@/components/marketing/hero';
import { TrustStrip } from '@/components/marketing/trust-strip';
import { FeatureBlock } from '@/components/marketing/feature-block';
import { Marginalia } from '@/components/marketing/marginalia';
import { PrivacyEmphasis } from '@/components/marketing/privacy-emphasis';
import { PricingCards } from '@/components/marketing/pricing-cards';
import { FAQAccordion } from '@/components/marketing/faq-accordion';
import { CTAStrip } from '@/components/marketing/cta-strip';
import { Postit } from '@/components/ui/postit';
import type { Locale } from '@/i18n/routing';

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const titles: Record<Locale, string> = {
    en: 'Lisna — Your lectures, in your notes (100% on-device)',
    ja: 'Lisna — 講義を、あなたのノートに（100% オンデバイス）',
    ko: 'Lisna — 강의를 노트로 (100% 온디바이스)',
  };
  const descs: Record<Locale, string> = {
    en: 'Real-time transcription + structured summaries. 100% on-device — your audio never leaves your Mac.',
    ja: 'リアルタイム文字起こし + 構造化されたサマリー。100% オンデバイス — 音声が Mac から出ることはありません。',
    ko: '실시간 전사 + 구조화된 요약. 100% 온디바이스 — 음성이 Mac 을 떠나지 않습니다.',
  };
  return {
    title: titles[locale],
    description: descs[locale],
    openGraph: {
      title: titles[locale],
      description: descs[locale],
      url: `https://lisna.jp/${locale === 'en' ? '' : locale}`,
      siteName: 'Lisna',
      locale: locale === 'en' ? 'en_US' : locale === 'ja' ? 'ja_JP' : 'ko_KR',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: titles[locale],
      description: descs[locale],
    },
    alternates: {
      canonical: `https://lisna.jp/${locale === 'en' ? '' : locale}`,
      languages: { 'x-default': '/', en: '/', ja: '/ja', ko: '/ko' },
    },
  };
}

export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tF = await getTranslations('features');
  const tP = await getTranslations('privacyEmphasis');
  const tPr = await getTranslations('pricingSection');
  const tFaq = await getTranslations('faq');

  const stockImage = (label: string, reverse = false) => (
    <Postit caption={label} variant={reverse ? 'reverse' : 'default'}>
      <div className="h-full grid place-items-center text-body-sm text-ink-700/40 italic font-serif">
        [ screenshot ]
      </div>
    </Postit>
  );

  return (
    <MarketingShell locale={locale}>
      <Hero />
      <TrustStrip />

      <div id="features">
        <FeatureBlock
          eyebrow={tF('stt.eyebrow')}
          headline={<>{tF('stt.headlineBefore')}<em className="italic text-accent-tan">{tF('stt.headlineEm')}</em>{tF('stt.headlineAfter')}</>}
          body={tF('stt.body')}
          meta={[tF('stt.metaA'), tF('stt.metaB'), tF('stt.metaC')]}
          image={stockImage('Live captions')}
        />

        <FeatureBlock
          variant="primary"
          eyebrow={tF('privacy.eyebrow')}
          headline={<>{tF('privacy.headlineBefore')}<em className="italic text-accent-tan">{tF('privacy.headlineEm')}</em>{tF('privacy.headlineAfter')}</>}
          body={tF('privacy.body')}
          meta={[tF('privacy.metaA'), tF('privacy.metaB'), tF('privacy.metaC')]}
          image={stockImage('Local-only diagram')}
        />
      </div>

      <Marginalia>{tF('marginalia')}</Marginalia>

      <FeatureBlock
        eyebrow={tF('notes.eyebrow')}
        headline={<>{tF('notes.headlineBefore')}<em className="italic text-accent-tan">{tF('notes.headlineEm')}</em>{tF('notes.headlineAfter')}</>}
        body={tF('notes.body')}
        meta={[tF('notes.metaA'), tF('notes.metaB'), tF('notes.metaC')]}
        image={stockImage('Note preview')}
      />

      <FeatureBlock
        variant="reverse"
        eyebrow={tF('export.eyebrow')}
        headline={<>{tF('export.headlineBefore')}<em className="italic text-accent-tan">{tF('export.headlineEm')}</em>{tF('export.headlineAfter')}</>}
        body={tF('export.body')}
        meta={[tF('export.metaA'), tF('export.metaB'), tF('export.metaC')]}
        image={stockImage('Markdown export', true)}
      />

      <PrivacyEmphasis
        eyebrow={tP('eyebrow')}
        headline={<>{tP('headlineBefore')}<em className="italic text-accent-tan">{tP('headlineEm')}</em>{tP('headlineAfter')}</>}
        statValue={tP('statValue')}
        statSub={tP('statSub')}
        items={[
          { title: tP('item1Title'), body: tP('item1Body') },
          { title: tP('item2Title'), body: tP('item2Body') },
          { title: tP('item3Title'), body: tP('item3Body') },
          { title: tP('item4Title'), body: tP('item4Body') },
          { title: tP('item5Title'), body: tP('item5Body') },
          { title: tP('item6Title'), body: tP('item6Body') },
        ]}
      />

      <PricingCards
        heading={tPr('heading')}
        sub={tPr('sub')}
        plans={[
          {
            name: tPr('alphaName'),
            amount: tPr('alphaAmount'),
            period: tPr('alphaPeriod'),
            badge: { label: tPr('alphaBadge'), tone: 'free' },
            features: [tPr('alphaFeature1'), tPr('alphaFeature2'), tPr('alphaFeature3'), tPr('alphaFeature4')],
            cta: { label: tPr('alphaCta'), href: '/dl/dmg/latest' },
            highlighted: true,
          },
          {
            name: tPr('proName'),
            amount: tPr('proAmount'),
            period: tPr('proPeriod'),
            badge: { label: tPr('proBadge'), tone: 'soon' },
            features: [tPr('proFeature1'), tPr('proFeature2'), tPr('proFeature3'), tPr('proFeature4')],
          },
        ]}
      />

      <FAQAccordion
        eyebrow={tFaq('eyebrow')}
        heading={<>{tFaq('headlineBefore')}<em className="italic text-accent-tan">{tFaq('headlineEm')}</em>{tFaq('headlineAfter')}</>}
        entries={[1, 2, 3, 4, 5, 6].map((n) => ({
          q: tFaq(`q${n}` as 'q1'),
          a: tFaq(`a${n}` as 'a1'),
        }))}
      />

      <CTAStrip />
    </MarketingShell>
  );
}

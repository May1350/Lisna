import { setRequestLocale, getTranslations } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { Link } from '@/i18n/navigation';
import { BRAND } from '@/i18n/brand-vocabulary';
import type { Locale } from '@/i18n/routing';

const ENGLISH_LOCALES: ReadonlyArray<Locale> = ['en', 'ko'];

const META_TITLE: Record<'ja' | 'en', string> = {
  ja: '返金ポリシー - Lisna',
  en: 'Refund Policy - Lisna',
};
const META_DESC: Record<'ja' | 'en', string> = {
  ja: 'Lisna の返金ポリシーと解約方法について。',
  en: 'Lisna refund policy and cancellation instructions.',
};

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const lang = locale === 'ja' ? 'ja' : 'en';
  return {
    title: META_TITLE[lang],
    description: META_DESC[lang],
    robots: { index: true, follow: true },
  };
}

export default async function Refunds({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tL = await getTranslations('legalLinks');
  const showEnglish = ENGLISH_LOCALES.includes(locale);
  return (
    <MarketingShell locale={locale}>
      {showEnglish ? <RefundsEn tL={tL} /> : <RefundsJa tL={tL} />}
    </MarketingShell>
  );
}

function RefundsJa({ tL }: { tL: (key: string) => string }) {
  return (
    <article lang="ja" className="mx-auto max-w-3xl pad-x py-16 prose prose-stone font-sans text-body text-ink-700 leading-[1.7]">
      <h1 className="font-serif text-h1 text-ink-900">返金ポリシー</h1>
      <p className="text-body-sm text-ink-700/70 mt-2">最終更新日: 2026年5月10日</p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-12">1. 解約について</h2>
      <p>
        Pro プランはいつでも解約いただけます。解約手続きは Lisna Chrome 拡張機能の
        「設定」 → 「プラン」セクション内、または{' '}
        <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a> 宛にメールでも
        承ります。
      </p>
      <p>
        解約手続き完了後、当月末日までは Pro 機能をご利用いただけます。
        翌月 1 日以降は自動的に Free プランへ移行し、それ以降の課金は発生しません。
      </p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-8">2. 返金について</h2>
      <p>
        サブスクリプション課金後、原則として返金は行っておりません。
        ただし、以下の場合は個別にご対応いたします:
      </p>
      <ul>
        <li>サービス側の重大な不具合により Pro 機能が利用できなかった場合</li>
        <li>誤って二重課金が発生した場合</li>
        <li>解約手続きが完了していたにもかかわらず課金が発生した場合</li>
      </ul>
      <p>
        該当する場合は、お支払いから <strong>14 日以内</strong> に
        サポート (<a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>) まで
        ご連絡ください。確認のうえ、Stripe 経由で全額または一部を返金いたします。
      </p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-8">3. 無料トライアルについて</h2>
      <p>
        無料トライアル (追加 2 時間枠) は事前のカード情報登録が必要ですが、
        体験期間中の請求は発生しません。トライアル終了時に Pro 加入へ進まなかった場合、
        登録されたカード情報は Stripe より自動的に削除されます。
        Lisna 側では一切のカード情報を保有しません。
      </p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-8">4. 払い戻しのタイミング</h2>
      <p>
        Stripe 経由の返金は通常、返金処理完了から <strong>5〜10 営業日以内</strong>に
        ご利用のクレジットカードへ反映されます (カード会社による反映タイミングは異なります)。
      </p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-8">5. お問い合わせ</h2>
      <p>
        返金・解約に関するご質問は{' '}
        <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>{' '}
        までお気軽にご連絡ください。通常 1〜2 営業日以内に返信いたします。
      </p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-12">v2 (デスクトップアプリ) について</h2>
      <p>
        v2 デスクトップアプリのアルファ版は無料でご提供しています。課金が発生しないため、
        返金の対象外となります。アルファ期間終了後の有料プラン提供時期および返金ポリシーに
        ついては、決定次第本ページに掲載します。
      </p>

      <p className="mt-10 text-body-sm text-ink-700/70">
        <Link href="/">{tL('homeShort')}</Link> ・{' '}
        <Link href="/pricing">{tL('pricingShort')}</Link> ・{' '}
        <Link href="/terms">{tL('termsShort')}</Link> ・{' '}
        <Link href="/privacy">{tL('privacyShort')}</Link>
      </p>
    </article>
  );
}

function RefundsEn({ tL }: { tL: (key: string) => string }) {
  return (
    <article lang="en" className="mx-auto max-w-3xl pad-x py-16 prose prose-stone font-sans text-body text-ink-700 leading-[1.7]">
      <h1 className="font-serif text-h1 text-ink-900">Refund Policy</h1>
      <p className="text-body-sm text-ink-700/70 mt-2">Last updated: May 10, 2026</p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-12">1. Cancellation</h2>
      <p>
        You may cancel the Pro plan at any time. Cancellation can be done from
        the Lisna Chrome extension under Settings → Plan, or by emailing{' '}
        <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
      </p>
      <p>
        After cancellation, Pro features remain available through the last day of
        the current billing month. From the 1st of the following month your
        account automatically reverts to the Free plan and no further charges occur.
      </p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-8">2. Refunds</h2>
      <p>
        After a subscription charge, refunds are generally not provided. However,
        we will address the following cases individually:
      </p>
      <ul>
        <li>Pro features were unavailable due to a major service-side defect</li>
        <li>A duplicate charge was issued in error</li>
        <li>A charge was issued after cancellation had been completed</li>
      </ul>
      <p>
        If you believe one of the above applies, please contact support
        (<a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>) within{' '}
        <strong>14 days</strong> of the charge. After verification we will issue
        a full or partial refund via Stripe.
      </p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-8">3. Free trial</h2>
      <p>
        The free trial (extra 2-hour quota) requires card registration up front,
        but no charge is issued during the trial period. If you do not convert to
        Pro at the end of the trial, the registered card information is
        automatically removed by Stripe. Lisna does not hold any card
        information.
      </p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-8">4. Refund timing</h2>
      <p>
        Refunds via Stripe normally appear on your credit card within{' '}
        <strong>5–10 business days</strong> of the refund being processed
        (the exact timing depends on your card issuer).
      </p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-8">5. Contact</h2>
      <p>
        For questions about refunds or cancellation, contact{' '}
        <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>. We
        normally respond within 1–2 business days.
      </p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-12">v2 (desktop app)</h2>
      <p>
        The v2 desktop alpha is provided free of charge. Because no payment
        occurs, refunds do not apply. The schedule for post-alpha paid plans and
        their refund policy will be posted on this page once decided.
      </p>

      <p className="mt-10 text-body-sm text-ink-700/70">
        <Link href="/">{tL('homeShort')}</Link> ・{' '}
        <Link href="/pricing">{tL('pricingShort')}</Link> ・{' '}
        <Link href="/terms">{tL('termsShort')}</Link> ・{' '}
        <Link href="/privacy">{tL('privacyShort')}</Link>
      </p>
    </article>
  );
}

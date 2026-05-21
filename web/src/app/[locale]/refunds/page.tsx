import { setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';

export const metadata = {
  title: '返金ポリシー - Lisna',
  description: 'Lisna の返金ポリシーと解約方法について。',
  robots: { index: true, follow: true },
}

export default async function Refunds({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <MarketingShell locale={locale}>
      <article className="mx-auto max-w-3xl px-6 py-16 prose prose-stone font-sans text-body text-ink-700 leading-[1.7]">
        <h1 className="font-serif text-h1 text-ink-900">返金ポリシー</h1>
        <p className="text-body-sm text-ink-700/70 mt-2">最終更新日: 2026年5月10日</p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-12">1. 解約について</h2>
        <p>
          Pro プランはいつでも解約いただけます。解約手続きは Lisna Chrome 拡張機能の
          「設定」 → 「プラン」セクション内、または{' '}
          <a href="mailto:takgun.jr@gmail.com">takgun.jr@gmail.com</a> 宛にメールでも
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
          サポート (<a href="mailto:takgun.jr@gmail.com">takgun.jr@gmail.com</a>) まで
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
          <a href="mailto:takgun.jr@gmail.com">takgun.jr@gmail.com</a>{' '}
          までお気軽にご連絡ください。通常 1〜2 営業日以内に返信いたします。
        </p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-12">v2 (デスクトップアプリ) について</h2>
        <p>
          v2 デスクトップアプリのアルファ版は無料でご提供しています。課金が発生しないため、
          返金の対象外となります。アルファ期間終了後の有料プラン提供時期および返金ポリシーに
          ついては、決定次第本ページに掲載します。
        </p>

        <p className="mt-10 text-body-sm text-ink-700/70">
          <Link href="/">トップに戻る</Link> ・{' '}
          <Link href="/pricing">料金プラン</Link> ・{' '}
          <Link href="/terms">利用規約</Link> ・{' '}
          <Link href="/privacy">プライバシーポリシー</Link>
        </p>
      </article>
    </MarketingShell>
  )
}

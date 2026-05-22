import { setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';

export const metadata = {
  title: 'プライバシーポリシー - Lisna',
  description: 'Lisna が取得・利用する情報の取り扱いについて。',
  robots: { index: true, follow: true },
}

export default async function Privacy({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <MarketingShell locale={locale}>
      <article lang="ja" className="mx-auto max-w-3xl px-6 py-16 prose prose-stone font-sans text-body text-ink-700 leading-[1.7]">
        <h1 className="font-serif text-h1 text-ink-900">プライバシーポリシー</h1>
        <p className="text-body-sm text-ink-700/70 mt-2">最終更新日: 2026年5月9日</p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-12">1. 取得する情報</h2>
        <ul>
          <li>Google アカウントの ID、メールアドレス、表示名</li>
          <li>ユーザーが要約処理を開始した動画の URL、要約結果テキスト、スライド画像</li>
          <li>使用時間 (利用上限の計算のため)</li>
          <li>ユーザーが任意で送信したフィードバック内容、送信元 URL、拡張機能のバージョン</li>
        </ul>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">2. データの処理</h2>
        <p>
          音声データは文字起こしのため Groq (Whisper Large-v3) に、
          要約・構造化のため OpenAI (GPT-4o mini) に送信されます。
          利用状況に応じて Anthropic (Claude Haiku) を併用する場合があります。
          スライド画像は AWS S3 (東京リージョン) に保存され、
          画像認識処理を行う場合は Google (Gemini) に送信されます。
          いずれの外部 AI サービスにおいても、送信データはモデルの再学習に
          使用されない設定で連携しており、処理完了後の生データは即座に
          削除されます。要約テキストとスライド画像のみがユーザーアカウントに
          保存されます。
        </p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">3. データの保管場所</h2>
        <p>AWS 東京リージョン (ap-northeast-1)</p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">4. 第三者提供</h2>
        <p>法令に基づく開示請求を除き、第三者には提供しません。</p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">4-2. フィードバックの取り扱い</h2>
        <p>
          オプション画面のフィードバックフォームから送信された内容は、
          運営者への通知メール (AWS SNS 経由) と当社データベース (AWS 東京リージョン)
          に保存されます。送信時には拡張機能のバージョンと送信元 URL も同時に記録され、
          運営者がバグ調査・機能改善のために利用します。第三者には提供しません。
        </p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">5. データの削除</h2>
        <p>
          ユーザーはアカウント設定画面からいつでもログアウト・データ削除リクエストが可能です。
          削除リクエスト後 30 日以内にすべてのデータを完全削除します。
        </p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">6. 変更</h2>
        <p>本ポリシーは予告なく変更される場合があります。重要な変更がある場合は本ページにて告知します。</p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">7. お問い合わせ</h2>
        <p>本ポリシーに関するご質問は以下までご連絡ください。</p>
        <p><a href="mailto:takgun.jr@gmail.com">takgun.jr@gmail.com</a></p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-12">v2 (デスクトップアプリ) のデータ処理</h2>

        <h3 className="font-serif text-h2-sm text-ink-900 mt-8">音声処理</h3>
        <p>
          v2 デスクトップアプリは、音声の処理を 100% お使いの Mac 上で完結させます。
          音声データが Lisna または外部の AI サービスへ送信されることはありません。
        </p>

        <h3 className="font-serif text-h2-sm text-ink-900 mt-8">Web 解析 (Plausible)</h3>
        <p>
          本ウェブサイトのアクセス解析には Plausible を利用しています。Plausible は
          Cookie を使用せず、個人を識別可能な情報を収集しません。すべての計測は
          匿名化された集計データに限られます。
        </p>

        <h3 className="font-serif text-h2-sm text-ink-900 mt-8">アカウントデータ</h3>
        <p>
          v2 ではメールアドレスとサインインメタデータ (プロバイダ、タイムスタンプ等) のみを
          保存します。データ削除のご要望は Discord またはサポートメール
          (<a href="mailto:takgun.jr@gmail.com">takgun.jr@gmail.com</a>) までご連絡ください。
        </p>

        <p className="mt-10 text-body-sm"><Link href="/">← トップへ戻る</Link></p>
      </article>
    </MarketingShell>
  )
}

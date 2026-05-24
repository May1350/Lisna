import { setRequestLocale, getTranslations } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { Link } from '@/i18n/navigation';
import { BRAND } from '@/i18n/brand-vocabulary';
import type { Locale } from '@/i18n/routing';

// Korean route renders the English version per design decision (2026-05-24).
// Pending Korean legal review, KO falls back to EN here; tokusho remains JA-only.
const ENGLISH_LOCALES: ReadonlyArray<Locale> = ['en', 'ko'];

const META_TITLE: Record<'ja' | 'en', string> = {
  ja: 'プライバシーポリシー - Lisna',
  en: 'Privacy Policy - Lisna',
};
const META_DESC: Record<'ja' | 'en', string> = {
  ja: 'Lisna が取得・利用する情報の取り扱いについて。',
  en: 'How Lisna collects, uses, and stores information.',
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

export default async function Privacy({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tL = await getTranslations('legalLinks');
  const showEnglish = ENGLISH_LOCALES.includes(locale);
  return (
    <MarketingShell locale={locale}>
      {showEnglish ? <PrivacyEn homeLabel={tL('home')} /> : <PrivacyJa homeLabel={tL('home')} />}
    </MarketingShell>
  );
}

function PrivacyJa({ homeLabel }: { homeLabel: string }) {
  return (
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
      <p><a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a></p>

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
        (<a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>) までご連絡ください。
      </p>

      <p className="mt-10 text-body-sm"><Link href="/">{homeLabel}</Link></p>
    </article>
  );
}

function PrivacyEn({ homeLabel }: { homeLabel: string }) {
  return (
    <article lang="en" className="mx-auto max-w-3xl px-6 py-16 prose prose-stone font-sans text-body text-ink-700 leading-[1.7]">
      <h1 className="font-serif text-h1 text-ink-900">Privacy Policy</h1>
      <p className="text-body-sm text-ink-700/70 mt-2">Last updated: May 9, 2026</p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-12">1. Information we collect</h2>
      <ul>
        <li>Google account ID, email address, and display name</li>
        <li>URL of any video you start a summarization on, the summarized text, and slide images</li>
        <li>Usage time (for quota calculation)</li>
        <li>Any feedback you optionally submit, plus the source URL and extension version</li>
      </ul>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-8">2. How we process data</h2>
      <p>
        Audio is sent to Groq (Whisper Large-v3) for transcription and to OpenAI
        (GPT-4o mini) for summarization and structuring. Depending on usage we may
        also call Anthropic (Claude Haiku). Slide images are stored in AWS S3 (Tokyo
        region); when image understanding is needed we may send them to Google (Gemini).
        All third-party AI integrations are configured so that submitted data is NOT
        used to retrain models, and raw data is deleted immediately after processing.
        Only the summary text and slide images persist on your account.
      </p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-8">3. Where data is stored</h2>
      <p>AWS Tokyo region (ap-northeast-1).</p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-8">4. Sharing with third parties</h2>
      <p>We do not share your data with third parties except as required by law.</p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-8">4-2. Feedback handling</h2>
      <p>
        Feedback submitted through the Options page is stored in our database
        (AWS Tokyo region) and forwarded to the operator via notification email
        (AWS SNS). The extension version and source URL are recorded alongside,
        and used only for bug investigation and product improvement. Not shared
        with third parties.
      </p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-8">5. Deletion</h2>
      <p>
        You may sign out or request data deletion from the account settings screen
        at any time. We fully delete all data within 30 days of a deletion request.
      </p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-8">6. Changes</h2>
      <p>This policy may be updated without prior notice. Material changes will be announced on this page.</p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-8">7. Contact</h2>
      <p>For questions about this policy, please contact:</p>
      <p><a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a></p>

      <h2 className="font-serif text-h2-sm text-ink-900 mt-12">v2 (desktop app) data handling</h2>

      <h3 className="font-serif text-h2-sm text-ink-900 mt-8">Audio processing</h3>
      <p>
        The v2 desktop app processes audio 100% on your Mac. Audio data is never
        sent to Lisna or any third-party AI service.
      </p>

      <h3 className="font-serif text-h2-sm text-ink-900 mt-8">Web analytics (Plausible)</h3>
      <p>
        We use Plausible for website analytics. Plausible does not use cookies and
        does not collect personally identifiable information. All measurements are
        limited to anonymized aggregate data.
      </p>

      <h3 className="font-serif text-h2-sm text-ink-900 mt-8">Account data</h3>
      <p>
        For v2 we store only your email address and sign-in metadata (provider,
        timestamp, etc.). To request data deletion, contact us on Discord or via
        support email (<a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>).
      </p>

      <p className="mt-10 text-body-sm"><Link href="/">{homeLabel}</Link></p>
    </article>
  );
}

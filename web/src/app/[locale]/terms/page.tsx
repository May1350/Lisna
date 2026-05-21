import { setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';

export const metadata = {
  title: '利用規約 - Lisna',
  description: 'Lisna サービスの利用規約。',
  robots: { index: true, follow: true },
}

export default async function Terms({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <MarketingShell locale={locale}>
      <article className="mx-auto max-w-3xl px-6 py-16 prose prose-stone font-sans text-body text-ink-700 leading-[1.7]">
        <h1 className="font-serif text-h1 text-ink-900">利用規約</h1>
        <p className="text-body-sm text-ink-700/70 mt-2">最終更新日: 2026年5月8日</p>

        <p>
          本利用規約 (以下「本規約」) は、Lisna (以下「本サービス」) の利用条件を定めるものです。
          本サービスの利用にあたり、本規約に同意いただいたものとみなします。
        </p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-12">第1条 (本サービスの目的)</h2>
        <p>
          本サービスは、ユーザーが視聴中の動画から音声・映像情報を取得し、
          AI で要約・構造化することで学習や業務を支援するツールです。
        </p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">第2条 (ユーザーの責任)</h2>
        <p>ユーザーは以下を確認・遵守する責任を負います。</p>
        <ol>
          <li>所属機関 (大学、企業等) の利用規約および学則・社則</li>
          <li>視聴対象コンテンツの利用規約</li>
          <li>著作権法その他関連法令</li>
        </ol>
        <p>本サービスの利用により上記に違反する結果が生じた場合、ユーザー自身がその責任を負います。</p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">第3条 (禁止事項)</h2>
        <ol>
          <li>第三者の権利を侵害する行為</li>
          <li>本サービスを商業目的で再販・再配布する行為</li>
          <li>本サービスの動作を妨害する行為</li>
          <li>過度なリクエストにより本サービスの運用に支障を与える行為</li>
        </ol>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">第4条 (免責)</h2>
        <p>
          本サービスの使用により発生したいかなる紛争・損害についても、運営者は一切の責任を負いません。
          AI による要約結果の正確性については保証いたしません。
        </p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">第5条 (アカウント停止)</h2>
        <p>
          運営者は、本サービスが法令違反、所属機関規定違反、過度な使用に関与していると合理的に判断した場合、
          予告なくアカウントを停止する権利を有します。
        </p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">第6条 (規約の変更)</h2>
        <p>
          運営者は、必要に応じて本規約を変更できるものとします。
          変更後の規約は本ページにて告知します。
        </p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">第7条 (お問い合わせ)</h2>
        <p><a href="mailto:takgun.jr@gmail.com">takgun.jr@gmail.com</a></p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-12">v2 (デスクトップアプリ) について</h2>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">第8条 (デバイス上での処理)</h2>
        <p>
          Lisna のデスクトップアプリケーションは、音声の処理および文字起こし・ノートの生成を
          すべてユーザーのデバイス上で行います。通常運用において、音声・文字起こし・生成された
          ノートが Lisna のサーバーや第三者のデータ処理事業者へ送信されることはありません。
        </p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">第9条 (アカウントのスコープ)</h2>
        <p>
          Lisna のバックエンドが保存する情報は、メールアドレス、サインインメタデータ (プロバイダ、
          タイムスタンプ等)、デバイス識別子、およびアカウント設定に限定されます。録音内容、
          文字起こし、生成されたノート、その他ユーザーの録音から派生したコンテンツは Lisna の
          バックエンドに保存されません。
        </p>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-8">第10条 (オープンソースモデル)</h2>
        <p>
          Lisna は初回起動時に Whisper (MIT ライセンス) および Llama 3.2 (Meta Llama 3.2
          Community License Agreement) を同梱配布します。本アプリケーションのご利用にあたり、
          これらのライセンス条項に同意いただいたものとみなします。同梱されるモデルファイルは
          改変されずに実行されます。
        </p>

        <p className="mt-10 text-body-sm"><Link href="/">← トップへ戻る</Link></p>
      </article>
    </MarketingShell>
  )
}

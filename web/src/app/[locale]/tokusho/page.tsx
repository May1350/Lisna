import type { CSSProperties } from 'react'
import { setRequestLocale } from 'next-intl/server';
import { MarketingShell } from '@/components/layout/marketing-shell';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';

export const metadata = { title: '特定商取引法に基づく表記 - Lisna' }

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  marginTop: 24,
  fontSize: 14,
}

// v2 table follows an <h2 className="mt-12"> (48 px). The 24 px marginTop
// from tableStyle would stack onto that gap because there's no preceding
// <p> to absorb the margin collapse (unlike the v1 table). Override to 0.
const v2TableStyle: CSSProperties = { ...tableStyle, marginTop: 0 }

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '12px 16px',
  background: '#f8fafc',
  borderBottom: '1px solid #e2e8f0',
  fontWeight: 600,
  width: '32%',
  verticalAlign: 'top',
}

const tdStyle: CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #e2e8f0',
  verticalAlign: 'top',
}

export default async function Tokusho({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <MarketingShell locale={locale}>
      <article lang="ja" className="mx-auto max-w-3xl px-6 py-16 prose prose-stone font-sans text-body text-ink-700 leading-[1.7]">
        <h1 className="font-serif text-h1 text-ink-900">特定商取引法に基づく表記</h1>
        <p className="text-body-sm text-ink-700/70 mt-2">最終更新日: 2026年5月8日</p>

        <table style={tableStyle}>
          <tbody>
            <tr>
              <th style={thStyle}>販売事業者</th>
              <td style={tdStyle}>Takgun Jr (個人事業主)</td>
            </tr>
            <tr>
              <th style={thStyle}>運営統括責任者</th>
              <td style={tdStyle}>Takgun Jr</td>
            </tr>
            <tr>
              <th style={thStyle}>所在地</th>
              <td style={tdStyle}>
                請求があった場合、遅滞なく開示します。<br />
                下記お問い合わせ先までご連絡ください。
              </td>
            </tr>
            <tr>
              <th style={thStyle}>電話番号</th>
              <td style={tdStyle}>
                請求があった場合、遅滞なく開示します。<br />
                下記お問い合わせ先までご連絡ください。
              </td>
            </tr>
            <tr>
              <th style={thStyle}>メールアドレス</th>
              <td style={tdStyle}><a href="mailto:takgun.jr@gmail.com">takgun.jr@gmail.com</a></td>
            </tr>
            <tr>
              <th style={thStyle}>販売価格</th>
              <td style={tdStyle}>
                <strong>Free プラン</strong>: 無料 (月 30 分まで)<br />
                <strong>Pro プラン</strong>: 月額 ¥980 (税込) / 月 30 時間まで
                <br />
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  ※ 価格は予告なく変更される場合があります。最新の価格は決済画面でご確認ください。
                </span>
              </td>
            </tr>
            <tr>
              <th style={thStyle}>商品代金以外の必要料金</th>
              <td style={tdStyle}>本サービスのご利用に伴う通信費はお客様のご負担となります。</td>
            </tr>
            <tr>
              <th style={thStyle}>支払方法</th>
              <td style={tdStyle}>クレジットカード (Stripe を介した決済)</td>
            </tr>
            <tr>
              <th style={thStyle}>支払時期</th>
              <td style={tdStyle}>
                プラン申込時に初回課金、以降は毎月同日に自動更新されます。
              </td>
            </tr>
            <tr>
              <th style={thStyle}>商品の引渡時期</th>
              <td style={tdStyle}>決済完了後、即時にPro プラン機能をご利用いただけます。</td>
            </tr>
            <tr>
              <th style={thStyle}>返品・キャンセル</th>
              <td style={tdStyle}>
                本サービスの性質上、決済済みの料金については原則として返金いたしません。
                <br />
                ただし、当方の責に帰すべき重大な不具合により本サービスを利用できなかった場合は、
                個別にご相談に応じます。
                <br /><br />
                <strong>解約方法</strong>: アカウント設定画面または
                <a href="mailto:takgun.jr@gmail.com">takgun.jr@gmail.com</a>
                までご連絡ください。次回更新日以降の課金は停止されます。
                <br />
                既に決済済みの当月分は、解約後も期間終了まで Pro 機能をご利用いただけます。
              </td>
            </tr>
            <tr>
              <th style={thStyle}>動作環境</th>
              <td style={tdStyle}>
                Google Chrome (最新版を推奨) のインストールされたパソコン<br />
                安定したインターネット接続環境
              </td>
            </tr>
          </tbody>
        </table>

        <h2 className="font-serif text-h2-sm text-ink-900 mt-12">v2 アルファ版 (デスクトップアプリ) に関する表記</h2>

        <table style={v2TableStyle}>
          <tbody>
            <tr>
              <th style={thStyle}>販売価格</th>
              <td style={tdStyle}>
                アルファ版: 無料<br />
                アルファ期間終了後: 未定 (決定次第本ページに掲載します)
              </td>
            </tr>
            <tr>
              <th style={thStyle}>商品の引渡時期</th>
              <td style={tdStyle}>アプリのダウンロード完了後、即時にご利用いただけます。</td>
            </tr>
            <tr>
              <th style={thStyle}>返品・キャンセル</th>
              <td style={tdStyle}>アルファ版は無料のため、返品・キャンセルの対象外です。</td>
            </tr>
            <tr>
              <th style={thStyle}>動作環境</th>
              <td style={tdStyle}>
                macOS 13 以降 / Apple Silicon / 8 GB 以上の RAM / 5 GB 以上のディスク空き容量
              </td>
            </tr>
          </tbody>
        </table>

        <p className="text-body-sm text-ink-700/70 mt-4">
          ※ v2 アルファ版に関する記載は今後変更される可能性があります。
        </p>

        <p className="mt-10 text-body-sm"><Link href="/">← トップへ戻る</Link></p>
      </article>
    </MarketingShell>
  )
}

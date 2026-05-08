export const metadata = { title: '特定商取引法に基づく表記 - Lisna' }

const containerStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '40px 24px',
  fontFamily: 'system-ui, sans-serif',
  lineHeight: 1.7,
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  marginTop: 24,
  fontSize: 14,
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 16px',
  background: '#f8fafc',
  borderBottom: '1px solid #e2e8f0',
  fontWeight: 600,
  width: '32%',
  verticalAlign: 'top',
}

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #e2e8f0',
  verticalAlign: 'top',
}

export default function Tokusho() {
  return (
    <main style={containerStyle}>
      <h1>特定商取引法に基づく表記</h1>
      <p style={{ color: '#64748b', fontSize: 14 }}>最終更新日: 2026年5月8日</p>

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

      <p style={{ marginTop: 40, fontSize: 14 }}><a href="/">← トップへ戻る</a></p>
    </main>
  )
}

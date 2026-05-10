export const metadata = {
  title: '料金プラン - Lisna',
  description: 'Lisna の料金プラン。Free 月 30 分、Pro ¥980/月で月 30 時間。Stripe による安全な決済、いつでも解約可。',
  robots: { index: true, follow: true },
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: 24,
  marginTop: 24,
}

const h3Style: React.CSSProperties = {
  marginTop: 0,
  marginBottom: 8,
  fontSize: 22,
}

const priceStyle: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 700,
  margin: '8px 0',
}

const subStyle: React.CSSProperties = {
  fontSize: 14,
  color: '#64748b',
  marginBottom: 16,
}

const ulStyle: React.CSSProperties = {
  paddingLeft: 20,
  margin: 0,
}

export default function Pricing() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px', fontFamily: 'system-ui, sans-serif', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 32 }}>料金プラン</h1>
      <p style={{ color: '#475569' }}>
        Lisna は学習用途を想定した個人向けサブスクリプションサービスです。
        決済は <strong>Stripe</strong> を通じて行われ、カード情報は Lisna のサーバーには保存されません。
      </p>

      <section style={cardStyle}>
        <h2 style={h3Style}>Free プラン</h2>
        <p style={priceStyle}>¥0 / 月</p>
        <p style={subStyle}>登録不要 (Google アカウントでサインインのみ)</p>
        <ul style={ulStyle}>
          <li>月 <strong>30 分</strong> まで音声収録可能</li>
          <li>ノート自動生成 (要点 / 重要ポイント / クイズ)</li>
          <li>PDF / Markdown / HTML でエクスポート</li>
          <li>過去のノートはいつでも閲覧・再生成可能</li>
        </ul>
      </section>

      <section style={{ ...cardStyle, borderColor: '#1c1815' }}>
        <h2 style={h3Style}>Pro プラン</h2>
        <p style={priceStyle}>¥980 / 月</p>
        <p style={subStyle}>月額・税込・いつでも解約可</p>
        <ul style={ulStyle}>
          <li>月 <strong>30 時間</strong> 音声収録可能 (Free の 60 倍)</li>
          <li>長時間講義 (90 分超) も安心して録音</li>
          <li>Obsidian REST API への直接連携</li>
          <li>Free プランの全機能を含む</li>
        </ul>
      </section>

      <h2 style={{ marginTop: 32 }}>お支払いについて</h2>
      <ul>
        <li>決済は Stripe を通じてクレジットカードで行います (Visa / MasterCard / JCB / American Express)</li>
        <li>初回登録から毎月同日に自動で課金されます</li>
        <li>解約は Lisna 拡張機能内のオプションページから即時可能です</li>
        <li>解約後も当月末までは Pro 機能をご利用いただけます</li>
        <li>カード情報は Stripe にて PCI DSS Level 1 準拠で保管されます</li>
      </ul>

      <h2>無料トライアル (招待制)</h2>
      <p>
        Free プランで月の 30 分上限に達したお客様には、追加 2 時間分の体験枠を
        無料でご提供します。クレジットカード情報の事前登録が必要ですが、
        体験期間中の請求は発生しません。2 時間ぶんの利用後、ワンクリックで Pro
        加入へ進むか、お申し込みいただかない選択もできます (お申し込みいただかない場合、登録カード情報は Stripe から削除されます)。
      </p>

      <h2>返金について</h2>
      <p>
        詳細は <a href="/refunds">返金ポリシー</a> をご確認ください。
      </p>

      <h2>その他</h2>
      <p>
        ご不明点・サポートのお問い合わせ:{' '}
        <a href="mailto:takgun.jr@gmail.com">takgun.jr@gmail.com</a>
      </p>

      <p style={{ marginTop: 40, fontSize: 14, color: '#64748b' }}>
        <a href="/">トップに戻る</a> ・{' '}
        <a href="/terms">利用規約</a> ・{' '}
        <a href="/privacy">プライバシーポリシー</a> ・{' '}
        <a href="/tokusho">特定商取引法に基づく表記</a>
      </p>
    </main>
  )
}

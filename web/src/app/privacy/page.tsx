export const metadata = { title: 'プライバシーポリシー - Lisna' }

const containerStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '40px 24px',
  fontFamily: 'system-ui, sans-serif',
  lineHeight: 1.7,
}

export default function Privacy() {
  return (
    <main style={containerStyle}>
      <h1>プライバシーポリシー</h1>
      <p style={{ color: '#64748b', fontSize: 14 }}>最終更新日: 2026年5月8日</p>

      <h2>1. 取得する情報</h2>
      <ul>
        <li>Google アカウントの ID、メールアドレス、表示名</li>
        <li>ユーザーが要約処理を開始した動画の URL、要約結果テキスト、スライド画像</li>
        <li>使用時間 (利用上限の計算のため)</li>
      </ul>

      <h2>2. データの処理</h2>
      <p>
        音声・映像データは要約処理のため一時的に外部 AI サービス
        (OpenAI、Google) に送信されます。処理完了後、生データは即座に削除され、
        要約テキストとスライド画像のみがユーザーアカウントに保存されます。
      </p>

      <h2>3. データの保管場所</h2>
      <p>AWS 東京リージョン (ap-northeast-1)</p>

      <h2>4. 第三者提供</h2>
      <p>法令に基づく開示請求を除き、第三者には提供しません。</p>

      <h2>5. データの削除</h2>
      <p>
        ユーザーはアカウント設定画面からいつでもログアウト・データ削除リクエストが可能です。
        削除リクエスト後 30 日以内にすべてのデータを完全削除します。
      </p>

      <h2>6. 変更</h2>
      <p>本ポリシーは予告なく変更される場合があります。重要な変更がある場合は本ページにて告知します。</p>

      <h2>7. お問い合わせ</h2>
      <p>本ポリシーに関するご質問は以下までご連絡ください。</p>
      <p><a href="mailto:takgun.jr@gmail.com">takgun.jr@gmail.com</a></p>

      <p style={{ marginTop: 40, fontSize: 14 }}><a href="/">← トップへ戻る</a></p>
    </main>
  )
}

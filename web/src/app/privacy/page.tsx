export const metadata = { title: 'プライバシーポリシー - Study-Helper' }

export default function Privacy() {
  return (
    <main>
      <h1>プライバシーポリシー</h1>
      <h2>取得する情報</h2>
      <ul>
        <li>Google アカウントの ID、メールアドレス、表示名</li>
        <li>ユーザーが要約処理を開始した動画 URL、要約結果テキスト、スライド画像</li>
        <li>使用時間 (quota 計算のため)</li>
      </ul>
      <h2>データ処理</h2>
      <p>音声・映像データは要約処理のため一時的に外部 AI サービス(OpenAI / Google) に送信されます。処理完了後、生データは即座に削除され、要約テキストとスライド画像のみがユーザーアカウントに保存されます。</p>
      <h2>データ保管場所</h2>
      <p>AWS 東京リージョン (ap-northeast-1)</p>
      <h2>第三者提供</h2>
      <p>法令に基づく開示請求を除き、第三者には提供しません。</p>
      <h2>お問い合わせ</h2>
      <p>support@study-helper.example.com</p>
    </main>
  )
}

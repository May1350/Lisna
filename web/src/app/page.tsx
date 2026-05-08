export const metadata = { title: 'Lisna - 講義・会議をリアルタイムでノートに' }

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px', fontFamily: 'system-ui, sans-serif', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Lisna</h1>
      <p style={{ fontSize: 18, color: '#475569', marginBottom: 32 }}>
        講義や会議をリアルタイムで聴き取り、構造化されたノートを自動生成するAIアシスタント
      </p>

      <h2>主な機能</h2>
      <ul>
        <li>動画を再生するだけで、要点ノートが自動生成</li>
        <li>スライドも自動でキャプチャ</li>
        <li>視聴後に PDF / Markdown でダウンロード</li>
        <li>YouTube・各大学のLMS・会議ツールに対応</li>
      </ul>

      <h2>料金</h2>
      <ul>
        <li><strong>Free</strong>: 月 30 分まで</li>
        <li><strong>Pro</strong>: 月 30 時間まで</li>
      </ul>

      <p style={{ marginTop: 40, fontSize: 14, color: '#64748b' }}>
        <a href="/terms">利用規約</a> ・{' '}
        <a href="/privacy">プライバシーポリシー</a> ・{' '}
        <a href="/tokusho">特定商取引法に基づく表記</a>
      </p>
    </main>
  )
}

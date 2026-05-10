export const metadata = {
  title: 'Lisna — AI lecture notes for university students',
  description: 'Real-time AI summaries for lecture videos. Auto-generates structured notes, captures slides, exports to PDF / Markdown / Obsidian. Free 30 min/month, Pro ¥980/month for 30 hours.',
  // Explicit indexing — overrides Vercel's preview-deployment default
  // and tells crawlers (Stripe verification bot included) that this
  // page is a legitimate public business surface.
  robots: { index: true, follow: true },
}

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px', fontFamily: 'system-ui, sans-serif', lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Lisna</h1>
      <p style={{ fontSize: 18, color: '#475569', marginBottom: 32 }}>
        講義や会議をリアルタイムで聴き取り、構造化されたノートを自動生成するAIアシスタント
      </p>

      <h2>サービス概要</h2>
      <p>
        Lisna は大学生・研究者向けの Chrome 拡張機能です。視聴中の講義動画から
        音声と画面情報を取得し、AI が要点を抽出してノートとして整理します。
        YouTube / 各大学の LMS / 会議ツール (Zoom録画、Teams) などに対応しています。
      </p>

      <h2>主な機能</h2>
      <ul>
        <li>動画を再生するだけで、要点ノートが自動生成</li>
        <li>スライドも自動でキャプチャ</li>
        <li>視聴後に PDF / Markdown でダウンロード</li>
        <li>Obsidian REST API への直接連携</li>
      </ul>

      <h2>料金プラン</h2>
      <ul>
        <li><strong>Free</strong>: 月 30 分まで無料</li>
        <li><strong>Pro</strong>: ¥980 / 月 — 月 30 時間 (Free の 60 倍)</li>
      </ul>
      <p style={{ marginTop: 8 }}>
        <a href="/pricing">→ 料金プランの詳細</a>
      </p>

      <h2>お問い合わせ</h2>
      <p>
        サポート・お問い合わせ:{' '}
        <a href="mailto:takgun.jr@gmail.com">takgun.jr@gmail.com</a>
      </p>

      <p style={{ marginTop: 40, fontSize: 14, color: '#64748b' }}>
        <a href="/pricing">料金</a> ・{' '}
        <a href="/refunds">返金ポリシー</a> ・{' '}
        <a href="/terms">利用規約</a> ・{' '}
        <a href="/privacy">プライバシーポリシー</a> ・{' '}
        <a href="/tokusho">特定商取引法に基づく表記</a>
      </p>
    </main>
  )
}

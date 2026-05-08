// Public landing page. Plain Japanese, no marketing fluff. Focus on
// the three things prospective users actually want to know:
// (1) what does this do, (2) is it safe, (3) how much.
// Heavy / animated marketing additions can come later — at this
// stage the page mostly serves as the destination from Chrome
// Web Store + the legal-pages anchor.

export default function Home() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12 leading-relaxed">
      <header className="mb-12">
        <h1 className="text-4xl font-bold mb-3 tracking-tight">Study-Helper</h1>
        <p className="text-lg text-gray-700 leading-snug">
          ダウンロード不可な日本の大学講義動画を、<br className="hidden sm:inline" />
          リアルタイムで要約・整理する Chrome 拡張機能
        </p>
      </header>

      <section className="mb-12">
        <h2 className="text-xl font-semibold mb-4">できること</h2>
        <ul className="space-y-3 text-base">
          <Bullet emoji="🎙️" title="講義音声を自動で文字起こし">
            動画を再生するだけ。マイク不要。動画ページで星アイコンを押すと録音が始まります。
          </Bullet>
          <Bullet emoji="🤖" title="AI が要点ノートを自動生成">
            重要事項、用語の定義、自己確認の質問を含むノートが、講義中・視聴後にいつでも更新できます。
          </Bullet>
          <Bullet emoji="📷" title="スライドを自動キャプチャ">
            画面が変わった瞬間にスライドを保存。ノートに該当時間で挿入されます。
          </Bullet>
          <Bullet emoji="📁" title="Obsidian にそのまま送信">
            zip ダウンロード、ブラウザで開ける単一 HTML、Obsidian REST API への直接書き込みなど、
            お好みの形式でエクスポート。
          </Bullet>
          <Bullet emoji="⚡" title="動画タイムスタンプにジャンプ">
            ノートの各時刻リンクをクリックすると、動画の該当箇所にジャンプ。復習が劇的に早くなります。
          </Bullet>
        </ul>
      </section>

      <section className="mb-12">
        <h2 className="text-xl font-semibold mb-4">対応プラットフォーム</h2>
        <p className="text-sm text-gray-700 mb-3">
          ブラウザ内で動画として再生されるあらゆるプラットフォームで動作します。
        </p>
        <ul className="text-sm text-gray-700 space-y-1 list-disc pl-5">
          <li>慶應義塾 LMS(K-LMS / video-portal)、Canvas Studio</li>
          <li>YouTube、Vimeo</li>
          <li>その他、HTML5 video 要素を使った動画ページ</li>
        </ul>
      </section>

      <section className="mb-12">
        <h2 className="text-xl font-semibold mb-4">プラン</h2>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div className="border border-gray-200 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Free</h3>
            <p className="text-2xl font-bold mb-3">¥0<span className="text-sm font-normal text-gray-500">/月</span></p>
            <ul className="space-y-1 text-gray-700">
              <li>・ 月 30 分まで</li>
              <li>・ すべてのコア機能</li>
              <li>・ Obsidian 連携</li>
            </ul>
          </div>
          <div className="border-2 border-indigo-300 rounded-lg p-5 bg-indigo-50/30">
            <h3 className="font-semibold mb-2">Pro</h3>
            <p className="text-2xl font-bold mb-3">[TODO: ¥XXX]<span className="text-sm font-normal text-gray-500">/月 (税込)</span></p>
            <ul className="space-y-1 text-gray-700">
              <li>・ 月 30 時間まで(Free の 60 倍)</li>
              <li>・ 長時間講義に対応</li>
              <li>・ ノート再生成のクールダウン短縮</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-xl font-semibold mb-4">プライバシーと安全性</h2>
        <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5">
          <li>音声データは文字起こし完了後に即座に破棄(永続保存しません)。</li>
          <li>外部 AI への送信データは AI モデルの再学習に使用されません(API no-train)。</li>
          <li>すべての通信は TLS で暗号化。データは AWS 東京リージョンに保管。</li>
          <li>カード情報は Stripe が直接処理し、本サービスは保存しません。</li>
          <li>詳細は <a href="/privacy" className="underline text-blue-600">プライバシーポリシー</a> をご覧ください。</li>
        </ul>
      </section>

      <hr className="my-12 border-gray-200" />

      <footer className="text-sm text-gray-500 space-x-3">
        <a href="/terms" className="underline">利用規約</a>
        <span>·</span>
        <a href="/privacy" className="underline">プライバシーポリシー</a>
        <span>·</span>
        <a href="/tokushoho" className="underline">特定商取引法に基づく表記</a>
      </footer>
    </main>
  )
}

function Bullet({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="text-2xl shrink-0 leading-none mt-0.5" aria-hidden="true">{emoji}</span>
      <div>
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <p className="text-gray-700 text-sm">{children}</p>
      </div>
    </li>
  )
}

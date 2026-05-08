export const metadata = { title: '特定商取引法に基づく表記 - Study-Helper' }

// Required for Japan-based paid SaaS services per 特定商取引法
// (Specified Commercial Transactions Act). The user (operator)
// MUST replace the [TODO:...] placeholders with their real
// business / individual seller details before going live to
// paying customers — Stripe will require this URL during
// account verification too.

export default function Tokushoho() {
  return (
    <main className="prose prose-sm max-w-2xl mx-auto px-6 py-10 leading-relaxed">
      <h1 className="text-2xl font-bold mb-4">特定商取引法に基づく表記</h1>
      <p className="text-xs text-gray-500 mb-6">最終更新日: 2026-05-01</p>

      <p className="text-sm">
        本ページは、特定商取引に関する法律(特定商取引法)第 11 条に基づき、
        Study-Helper(以下「本サービス」)の運営者情報を表示するものです。
      </p>

      <table className="w-full mt-6 border-collapse text-sm">
        <tbody>
          <Row label="販売事業者">[TODO: 事業者名 / 個人事業主の場合は氏名]</Row>
          <Row label="運営責任者">[TODO: 代表者氏名]</Row>
          <Row label="所在地">
            [TODO: 所在地 — 法令に基づき要請があれば遅延なく開示します]
            <span className="block text-xs text-gray-500 mt-1">
              ※ 個人事業主の場合、購入予定者からの開示請求に応じて遅延なく提供します。
            </span>
          </Row>
          <Row label="電話番号">
            [TODO: 連絡可能な電話番号]
            <span className="block text-xs text-gray-500 mt-1">
              ※ 開示請求に応じて遅延なく提供します。
            </span>
          </Row>
          <Row label="メールアドレス">support@study-helper.app(仮)</Row>
          <Row label="販売価格">
            プランごとに本サービス内および公式サイトに表示します。
            <ul className="list-disc pl-5 mt-1">
              <li>Free プラン: 無料(月 30 分まで)</li>
              <li>Pro プラン: [TODO: 月額 ¥XXX (税込)] (月 30 時間)</li>
            </ul>
          </Row>
          <Row label="価格以外の必要料金">
            本サービスの利用には、ユーザー側のインターネット通信料が別途発生します。
          </Row>
          <Row label="支払方法">クレジットカード(Stripe による決済)</Row>
          <Row label="支払時期">毎月の課金日に自動課金</Row>
          <Row label="サービス提供時期">
            決済完了後、即時に Pro プランへ切り替わります。
          </Row>
          <Row label="返金・解約">
            <ul className="list-disc pl-5">
              <li>サブスクリプションはいつでも解約可能です。次回課金日以降の支払いは発生しません。</li>
              <li>すでに支払われた月額料金は、原則として返金しません。
                ただし、サービス側の重大な不具合により実質的に利用できなかった場合を除きます。</li>
            </ul>
          </Row>
          <Row label="動作環境">
            <ul className="list-disc pl-5">
              <li>Google Chrome 最新版(Chromium 系の派生ブラウザ含む)</li>
              <li>Chrome 拡張機能のインストール権限</li>
              <li>Google アカウント</li>
            </ul>
          </Row>
        </tbody>
      </table>

      <hr className="my-8" />
      <p className="text-xs text-gray-500">
        <a href="/" className="underline">トップへ戻る</a> ・
        <a href="/terms" className="underline ml-2">利用規約</a> ・
        <a href="/privacy" className="underline ml-2">プライバシーポリシー</a>
      </p>
    </main>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-gray-200">
      <th className="text-left align-top py-2 pr-4 font-medium text-gray-700 w-36 whitespace-nowrap">
        {label}
      </th>
      <td className="py-2 text-gray-900">{children}</td>
    </tr>
  )
}

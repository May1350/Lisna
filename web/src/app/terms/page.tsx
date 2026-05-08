export const metadata = { title: '利用規約 - Study-Helper' }

// Comprehensive Japanese terms of service. Tightened from the
// placeholder version: explicit AI-generated-content disclaimers,
// payment / refund clauses, jurisdiction (Japan), and user
// responsibility regarding source material licensing — the latter
// is the highest-risk area for an "extract from any video" tool.

export default function Terms() {
  return (
    <main className="prose prose-sm max-w-2xl mx-auto px-6 py-10 leading-relaxed">
      <h1 className="text-2xl font-bold mb-4">利用規約</h1>
      <p className="text-xs text-gray-500 mb-6">最終更新日: 2026-05-01</p>

      <p>
        本利用規約(以下「本規約」)は、Study-Helper(以下「本サービス」)の
        利用条件を定めるものです。ユーザーは本サービスを利用することで、本規約に
        同意したものとみなされます。
      </p>

      <h2 className="font-semibold text-lg mt-6 mb-2">第1条 (本サービスの目的)</h2>
      <p>
        本サービスは、ユーザーが視聴中の動画から音声・映像情報を取得し、
        AI を用いて要約・整理することで個人学習を支援するツールです。
      </p>

      <h2 className="font-semibold text-lg mt-6 mb-2">第2条 (ユーザーの責任)</h2>
      <p>ユーザーは以下の事項を確認・遵守する責任を負います:</p>
      <ol className="list-decimal pl-6 space-y-1">
        <li>所属機関(大学・専門学校・予備校等)の利用規約および学則</li>
        <li>視聴対象コンテンツ(動画プラットフォーム等)の利用規約</li>
        <li>著作権法その他関連法令の遵守</li>
        <li>本サービスで生成された要約・スライドの個人学習以外への流用禁止</li>
        <li>第三者への配布・公開の禁止(著作権侵害となる可能性があるため)</li>
      </ol>

      <h2 className="font-semibold text-lg mt-6 mb-2">第3条 (生成コンテンツの正確性に関する免責)</h2>
      <p>
        本サービスは AI(大規模言語モデル)による自動生成ツールであり、
        生成された要約テキスト、用語定義、重要事項等の内容について、その正確性・
        完全性・最新性・特定目的への適合性をいかなる意味でも保証しません。
      </p>
      <p>
        ユーザーは、本サービスの生成結果を試験対策・学術論文・業務判断等の
        重要な目的に使用する場合、必ず原本資料(講義動画・教科書・公式テキスト等)で
        内容を確認するものとし、生成結果のみを根拠とすることに起因する損害について、
        当社は一切責任を負いません。
      </p>

      <h2 className="font-semibold text-lg mt-6 mb-2">第4条 (料金プラン)</h2>
      <p>
        本サービスは無料プランと有料プラン(Pro)を提供します。
        各プランの内容と料金は本サービス内に明示します。
        有料プランへのアップグレードは、決済代行サービス
        Stripe を通じて行います。
      </p>

      <h2 className="font-semibold text-lg mt-6 mb-2">第5条 (返金・解約)</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>サブスクリプションはいつでも解約できます。解約は次回課金日から有効となります。</li>
        <li>すでに支払われた料金については、原則として返金しません。
          ただし、サービス側の重大な不具合により実質的に利用できなかった場合はこの限りではありません。</li>
        <li>未使用分の使用時間(クォータ)は、解約・プラン変更時に金銭的価値を持ちません。</li>
      </ul>

      <h2 className="font-semibold text-lg mt-6 mb-2">第6条 (禁止事項)</h2>
      <p>ユーザーは以下の行為を行ってはなりません:</p>
      <ol className="list-decimal pl-6 space-y-1">
        <li>本サービスを利用して取得した音声・スライド・要約テキストを第三者へ無断で配布、公開、販売する行為</li>
        <li>所属機関の規定で禁止されている動画コンテンツに対して本サービスを使用する行為</li>
        <li>著作権法に違反する形での本サービスの使用</li>
        <li>API への過剰なアクセス、リバースエンジニアリング、不正利用</li>
        <li>他のユーザーや第三者になりすます行為</li>
        <li>本サービスの運営を妨害する行為</li>
      </ol>

      <h2 className="font-semibold text-lg mt-6 mb-2">第7条 (アカウント停止・解除)</h2>
      <p>
        当社は、ユーザーが本規約に違反したと合理的に判断した場合、
        事前の通知なくアカウントを停止または削除する権利を有します。
        この場合、すでに支払われた料金は返金しません。
      </p>

      <h2 className="font-semibold text-lg mt-6 mb-2">第8条 (サービス変更・終了)</h2>
      <p>
        当社は、本サービスの内容を予告なく変更、または終了することがあります。
        サービス終了時は可能な限り事前に告知し、ユーザーがデータをエクスポートできる猶予期間を設けます。
      </p>

      <h2 className="font-semibold text-lg mt-6 mb-2">第9条 (免責事項)</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>本サービスの稼働率、応答速度、正確性について保証しません。</li>
        <li>外部 AI サービス(OpenAI、Groq 等)の障害・変更によりサービスが一時的に利用できない場合があります。</li>
        <li>ユーザーが本サービスを使用したことに起因または関連する一切の損害(直接損害、間接損害、特別損害、結果的損害、機会損失を含みます)について、当社は責任を負いません。</li>
        <li>ただし、当社の故意または重大な過失による損害についてはこの限りではありません。</li>
      </ul>

      <h2 className="font-semibold text-lg mt-6 mb-2">第10条 (知的財産権)</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>本サービス自体(ソフトウェア、UI、ロゴ等)の知的財産権は当社に帰属します。</li>
        <li>ユーザーが視聴する動画コンテンツの著作権は元の権利者に帰属します。本サービスはこれを取得・主張しません。</li>
        <li>本サービスが生成した要約テキストは、原典の著作物を編集・要約した二次的著作物の性質を持つため、その利用には原典の著作権が及ぶ可能性があります。ユーザーは個人学習目的に限り利用できます。</li>
      </ul>

      <h2 className="font-semibold text-lg mt-6 mb-2">第11条 (準拠法および管轄裁判所)</h2>
      <p>
        本規約は日本法を準拠法とします。本サービスに関する一切の紛争については、
        東京地方裁判所を第一審の専属的合意管轄裁判所とします。
      </p>

      <h2 className="font-semibold text-lg mt-6 mb-2">第12条 (規約の変更)</h2>
      <p>
        当社は、必要に応じて本規約を変更できます。変更後の規約は、
        本サービス内またはウェブサイト上での告知をもって効力を生じます。
        重要な変更を伴う場合は、合理的な事前通知期間を設けます。
      </p>

      <h2 className="font-semibold text-lg mt-6 mb-2">第13条 (お問い合わせ)</h2>
      <p>本規約に関するお問い合わせは以下のメールアドレスまで:</p>
      <p className="font-mono mt-2">support@study-helper.app(仮)</p>

      <hr className="my-8" />
      <p className="text-xs text-gray-500">
        <a href="/" className="underline">トップへ戻る</a> ・
        <a href="/privacy" className="underline ml-2">プライバシーポリシー</a> ・
        <a href="/tokushoho" className="underline ml-2">特定商取引法に基づく表記</a>
      </p>
    </main>
  )
}

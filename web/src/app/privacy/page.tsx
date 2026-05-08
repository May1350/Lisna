export const metadata = { title: 'プライバシーポリシー - Study-Helper' }

// Comprehensive Japanese privacy policy compliant with APPI (個人情報
// 保護法). Covers data collection, AI provider transparency, retention,
// user rights, and security. Date placeholders use the canonical format
// expected by Chrome Web Store reviewers.

export default function Privacy() {
  return (
    <main className="prose prose-sm max-w-2xl mx-auto px-6 py-10 leading-relaxed">
      <h1 className="text-2xl font-bold mb-4">プライバシーポリシー</h1>
      <p className="text-xs text-gray-500 mb-6">最終更新日: 2026-05-01</p>

      <p>
        Study-Helper(以下「本サービス」)は、ユーザーのプライバシーを尊重し、
        個人情報の保護に関する法律(個人情報保護法)を遵守して個人情報を取り扱います。
      </p>

      <h2 className="font-semibold text-lg mt-6 mb-2">1. 取得する情報</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>Google アカウントの sub ID、メールアドレス、表示名(Google OAuth ログイン時)</li>
        <li>ユーザーが録音を開始した動画ページの URL</li>
        <li>動画から抽出した音声データ(一時的、後述)</li>
        <li>動画から抽出したスライド画像</li>
        <li>AI が生成した要約テキスト、用語定義、重要事項</li>
        <li>使用時間(月間クォータ計算のため、秒単位)</li>
        <li>サブスクリプション利用時は Stripe を通じた決済情報(本サービスはカード番号自体を保存しません)</li>
      </ul>

      <h2 className="font-semibold text-lg mt-6 mb-2">2. 利用目的</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>動画音声の文字起こし(Speech-to-Text)処理</li>
        <li>文字起こしを基にした学習ノートの自動生成</li>
        <li>スライド画像の保管とノートへの埋め込み</li>
        <li>ユーザーアカウントの認証・本人確認</li>
        <li>料金プランのクォータ管理および請求</li>
        <li>サービス品質の改善(集計後の匿名統計のみ)</li>
      </ul>

      <h2 className="font-semibold text-lg mt-6 mb-2">3. 外部 AI サービスへのデータ提供</h2>
      <p>
        本サービスは、要約処理のため以下の外部 AI サービスを利用しています。
        各サービスへ送信される音声・テキストは AI モデルの再学習には使用されません
        (各社の API 利用規約に基づく no-train 設定済み)。
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          <strong>Groq</strong>(Whisper Large-v3 による音声文字起こし) ―
          送信内容: 10 秒単位の音声データ。送信後は即座に破棄。
        </li>
        <li>
          <strong>OpenAI</strong>(GPT-4o-mini による要約生成) ―
          送信内容: 文字起こしテキスト。送信後は OpenAI の API ログ
          ポリシー(現行 30 日)に基づき同社サーバー上で管理。
        </li>
        <li>
          <strong>Stripe</strong>(サブスクリプション決済) ―
          送信内容: メールアドレス、決済情報。Stripe のプライバシーポリシーに準拠。
        </li>
      </ul>
      <p className="text-xs text-gray-600 mt-2">
        いずれのサービスも、本サービスのオーナーは API 経由でのみアクセスし、
        各社の独立したプライバシーポリシーが別途適用されます。
      </p>

      <h2 className="font-semibold text-lg mt-6 mb-2">4. データ保管場所</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>音声データ: 文字起こし完了後に即座に破棄(永続保存しません)</li>
        <li>スライド画像: AWS S3(東京リージョン ap-northeast-1)に暗号化保管</li>
        <li>要約テキスト・用語定義: AWS RDS PostgreSQL(同リージョン)に暗号化保管</li>
        <li>セッション管理用 JWT: ユーザーのブラウザ chrome.storage.local に保管(ローカル端末のみ)</li>
      </ul>

      <h2 className="font-semibold text-lg mt-6 mb-2">5. 保存期間</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>スライド画像: 90 日間(自動削除)</li>
        <li>要約・用語データ: ユーザーがアカウントを削除するまで</li>
        <li>使用時間ログ: 直近 13 か月分</li>
        <li>音声データ: 0 秒(処理後即座に破棄)</li>
      </ul>

      <h2 className="font-semibold text-lg mt-6 mb-2">6. 第三者提供</h2>
      <p>
        以下の場合を除き、第三者には提供しません:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>ユーザーの同意がある場合</li>
        <li>法令に基づく開示請求がある場合</li>
        <li>第3条に記載の AI サービス提供者(処理委託として)</li>
      </ul>

      <h2 className="font-semibold text-lg mt-6 mb-2">7. ユーザーの権利</h2>
      <p>
        ユーザーは以下の権利を行使できます。お問い合わせ先までご連絡ください。
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>個人情報の開示請求</li>
        <li>個人情報の訂正・追加・削除請求</li>
        <li>利用停止・消去・第三者提供の停止請求</li>
        <li>アカウント全体の削除請求(関連データすべての削除を含みます)</li>
      </ul>

      <h2 className="font-semibold text-lg mt-6 mb-2">8. 安全管理措置</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>通信は TLS 1.2 以上で暗号化</li>
        <li>保管データは AWS の暗号化機能(at-rest)で保護</li>
        <li>JWT トークンは HS256 で署名、有効期限付き</li>
        <li>API への認証されていないアクセスは拒否</li>
      </ul>

      <h2 className="font-semibold text-lg mt-6 mb-2">9. Cookie および類似技術</h2>
      <p>
        本サービスは Cookie を使用しません。認証トークンは Chrome Extension の
        chrome.storage.local API を使用してローカル保存されます。
      </p>

      <h2 className="font-semibold text-lg mt-6 mb-2">10. 著作権について</h2>
      <p>
        本サービスは、ユーザーが視聴中の動画コンテンツの著作権を取得・主張しません。
        生成された要約テキストおよびスライド画像は、ユーザー自身の個人学習目的での使用に限ります。
        所属機関(大学等)の規定や対象コンテンツの利用規約を遵守する責任はユーザーに帰属します。
      </p>

      <h2 className="font-semibold text-lg mt-6 mb-2">11. 未成年の利用</h2>
      <p>
        18 歳未満の方が本サービスを利用する場合、保護者の同意を得てください。
      </p>

      <h2 className="font-semibold text-lg mt-6 mb-2">12. プライバシーポリシーの変更</h2>
      <p>
        本ポリシーは必要に応じて変更します。変更時は本ページの最終更新日を更新し、
        重要な変更がある場合はサービス内通知またはメールで告知します。
      </p>

      <h2 className="font-semibold text-lg mt-6 mb-2">13. お問い合わせ</h2>
      <p>
        個人情報の取扱いに関するお問い合わせは、以下のメールアドレスまでお願いします。
      </p>
      <p className="font-mono mt-2">support@study-helper.app(仮)</p>

      <hr className="my-8" />
      <p className="text-xs text-gray-500">
        <a href="/" className="underline">トップへ戻る</a> ・
        <a href="/terms" className="underline ml-2">利用規約</a> ・
        <a href="/tokushoho" className="underline ml-2">特定商取引法に基づく表記</a>
      </p>
    </main>
  )
}

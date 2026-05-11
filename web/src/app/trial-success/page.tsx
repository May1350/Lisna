import { AutoCloseTab } from '../_components/AutoCloseTab'

// Stripe redirected the user here from a Checkout Session (mode=setup)
// the extension opened in a NEW tab. The extension's visibilitychange
// handler picks up `chrome.storage.local["sh.pendingTrialSession"]` and
// calls /v1/trial/confirm as soon as the user returns to the extension.
// We auto-close after 1.5 s (faster than the other variants — the user
// is mid-flow and shouldn't sit here).
export default function TrialSuccess() {
  return (
    <AutoCloseTab
      variant="success"
      title="準備完了です"
      body={
        <>
          2 時間の無料トライアルが有効になりました。<br />
          このタブを閉じて、Lisna に戻ってください。
        </>
      }
      subBody="今すぐ請求はありません ・ 2 時間後に Pro 加入の選択肢が表示されます"
      footer="このページは自動で閉じます。閉じない場合は手動で閉じてください。"
      closeAfterMs={1500}
    />
  )
}

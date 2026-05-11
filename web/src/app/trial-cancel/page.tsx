import { AutoCloseTab } from '../_components/AutoCloseTab'

export default function TrialCancel() {
  return (
    <AutoCloseTab
      variant="cancel"
      title="トライアルは開始されませんでした"
      body={
        <>
          カード情報の登録がキャンセルされました。<br />
          Lisna に戻って、いつでもやり直せます。
        </>
      }
    />
  )
}

import { AutoCloseTab } from '../_components/AutoCloseTab'

export default function PaymentCancel() {
  return (
    <AutoCloseTab
      variant="cancel"
      title="キャンセルしました"
      body={
        <>
          登録は完了していません。<br />
          Lisna に戻って、いつでもやり直せます。
        </>
      }
    />
  )
}

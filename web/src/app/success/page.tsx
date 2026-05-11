import { AutoCloseTab } from '../_components/AutoCloseTab'

export default function PaymentSuccess() {
  return (
    <AutoCloseTab
      variant="success"
      title="Pro へようこそ"
      body={
        <>
          ご登録ありがとうございます。<br />
          Lisna に戻ると、月 30 時間の収録枠がご利用いただけます。
        </>
      }
    />
  )
}

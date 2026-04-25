import type { User } from '../../shared/types'

export function QuotaBanner({ user, onUpgrade }: { user: User | null; onUpgrade: () => void }) {
  if (!user) return null
  if (user.plan === 'pro') return <div className="text-xs text-emerald-600 px-3 py-1">Pro プラン</div>
  return (
    <div className="bg-amber-50 border-amber-200 border text-sm text-amber-900 px-3 py-2 rounded m-2 flex items-center justify-between">
      <span>Free プラン (月 30 分まで)</span>
      <button onClick={onUpgrade} className="text-blue-700 underline text-xs">Pro にアップグレード</button>
    </div>
  )
}

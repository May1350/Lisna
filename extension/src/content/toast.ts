const TOAST_ID = '__sh_toast_root__'

export function showToast(opts: { onActivate: () => void; onDismiss?: () => void }): void {
  hideToast()
  const root = document.createElement('div')
  root.id = TOAST_ID
  root.style.cssText = `
    position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
    background: #1f2937; color: white; padding: 14px 18px; border-radius: 12px;
    font-family: system-ui, -apple-system, sans-serif; font-size: 14px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3); display: flex; gap: 12px; align-items: center;
  `
  root.innerHTML = `
    <span>📚 この動画を要約しますか?</span>
    <button id="__sh_yes" style="background:#3b82f6;border:0;color:white;padding:6px 12px;border-radius:6px;cursor:pointer;">はい</button>
    <button id="__sh_no" style="background:transparent;border:0;color:#9ca3af;cursor:pointer;">×</button>
  `
  document.body.appendChild(root)
  document.getElementById('__sh_yes')!.addEventListener('click', () => {
    hideToast(); opts.onActivate()
  })
  document.getElementById('__sh_no')!.addEventListener('click', () => {
    hideToast(); opts.onDismiss?.()
  })
}

export function hideToast(): void {
  document.getElementById(TOAST_ID)?.remove()
}

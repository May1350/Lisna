// Floating in-page modal for the session view.
//
// An iframe pinned to the top-right of the page (NOT a separate Chrome window
// — the previous chrome.windows.create approach rendered fullscreen on macOS,
// which was wrong). The modal floats over the page so the user can keep
// watching the video underneath.
//
// The iframe sources `src/side-panel/index.html?embed=1&parentUrl=<url>`. The
// React app inside detects `?embed=1` and renders the session view. If the
// user is not yet authed, it renders LoginScreen — auth happens INSIDE the
// modal, so the user doesn't bounce out to the side panel.
//
// The modal communicates back via window.postMessage. Closing posts
// { type: 'SH_CLOSE_MODAL' } which the content script handles by unmounting.

const MODAL_ID = '__sh_modal_iframe__'

let messageListener: ((e: MessageEvent) => void) | null = null

export function mountModal(): void {
  if (document.getElementById(MODAL_ID)) {
    const existing = document.getElementById(MODAL_ID) as HTMLIFrameElement
    existing.style.transform = 'translateX(0)'
    existing.style.opacity = '1'
    return
  }
  const iframe = document.createElement('iframe')
  iframe.id = MODAL_ID
  const url = chrome.runtime.getURL('src/side-panel/index.html')
    + `?embed=1&parentUrl=${encodeURIComponent(location.href)}`
  iframe.src = url
  iframe.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: min(400px, calc(100vw - 40px));
    height: min(600px, calc(100vh - 40px));
    border: 0;
    border-radius: 12px;
    z-index: 999998;
    background: white;
    box-shadow: 0 20px 60px rgba(0,0,0,0.28), 0 4px 12px rgba(0,0,0,0.14);
    transform: translateX(20px);
    opacity: 0;
    transition: transform 240ms cubic-bezier(0.16, 1, 0.3, 1),
                opacity 240ms cubic-bezier(0.16, 1, 0.3, 1);
    color-scheme: light;
    overflow: hidden;
  `
  document.body.appendChild(iframe)
  requestAnimationFrame(() => {
    iframe.style.transform = 'translateX(0)'
    iframe.style.opacity = '1'
  })

  if (!messageListener) {
    messageListener = handleMessage
    window.addEventListener('message', messageListener)
  }
}

export function unmountModal(): void {
  const iframe = document.getElementById(MODAL_ID) as HTMLIFrameElement | null
  if (!iframe) return
  iframe.style.transform = 'translateX(20px)'
  iframe.style.opacity = '0'
  window.setTimeout(() => iframe.remove(), 260)
}

function handleMessage(e: MessageEvent): void {
  const data = e.data
  if (!data || typeof data !== 'object') return
  if (data.type === 'SH_CLOSE_MODAL') {
    unmountModal()
  }
}

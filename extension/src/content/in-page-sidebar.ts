// In-page sidebar: an iframe pinned to the right edge of the page that loads
// the existing side-panel React app. Mounting the sidebar via a normal HTML
// iframe sidesteps Chrome's sidePanel.open() user-gesture restriction (which
// trips when the side panel is opened in response to anything other than a
// direct user click on a Chrome-managed surface).
//
// Communication: parent ↔ iframe via window.postMessage. The iframe app
// continues to talk to the service worker via chrome.runtime.sendMessage.

const IFRAME_ID = '__sh_sidebar_iframe__'

let messageListener: ((e: MessageEvent) => void) | null = null

export function mountSidebar(): void {
  const existing = document.getElementById(IFRAME_ID) as HTMLIFrameElement | null
  if (existing) {
    // Already mounted — just ensure visible.
    existing.style.transform = 'translateX(0)'
    return
  }

  const iframe = document.createElement('iframe')
  iframe.id = IFRAME_ID
  const url = chrome.runtime.getURL('src/side-panel/index.html')
    + `?embed=1&parentUrl=${encodeURIComponent(location.href)}`
  iframe.src = url
  iframe.style.cssText = `
    position: fixed; top: 0; right: 0;
    width: min(380px, 100vw);
    height: 100vh;
    border: 0;
    z-index: 999998;
    background: white;
    box-shadow: -8px 0 32px rgba(0,0,0,0.18);
    transform: translateX(100%);
    transition: transform 240ms cubic-bezier(0.16, 1, 0.3, 1);
    color-scheme: light;
  `
  document.body.appendChild(iframe)
  requestAnimationFrame(() => {
    iframe.style.transform = 'translateX(0)'
  })

  if (!messageListener) {
    messageListener = handleMessage
    window.addEventListener('message', messageListener)
  }
}

export function unmountSidebar(): void {
  const iframe = document.getElementById(IFRAME_ID) as HTMLIFrameElement | null
  if (!iframe) return
  iframe.style.transform = 'translateX(100%)'
  window.setTimeout(() => iframe.remove(), 260)
}

function handleMessage(e: MessageEvent): void {
  const data = e.data
  if (!data || typeof data !== 'object') return
  if (data.type === 'SH_CLOSE_SIDEBAR') {
    unmountSidebar()
  } else if (data.type === 'SH_SWITCH_TO_POPOUT') {
    // SW will open the popout; we just close the iframe.
    chrome.runtime.sendMessage({ type: 'OPEN_VIEW' })
    unmountSidebar()
  }
}

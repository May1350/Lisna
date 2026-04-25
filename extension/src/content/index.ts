import { showToast } from './toast'

let detected = false
let activeVideo: HTMLVideoElement | null = null

function findBestVideo(): HTMLVideoElement | null {
  const all = Array.from(document.querySelectorAll<HTMLVideoElement>('video'))
  // pick the largest by area
  let best: HTMLVideoElement | null = null
  let bestArea = 0
  for (const v of all) {
    const r = v.getBoundingClientRect()
    const area = r.width * r.height
    if (area > bestArea && r.width > 200) { best = v; bestArea = area }
  }
  return best
}

function checkAndOffer(): void {
  if (detected) return
  const v = findBestVideo()
  if (!v) return
  detected = true
  activeVideo = v
  showToast({
    onActivate: () => {
      chrome.runtime.sendMessage({ type: 'SESSION_START', tabId: -1, url: location.href })
    },
  })
}

// initial check + observe DOM mutations
checkAndOffer()
const obs = new MutationObserver(() => checkAndOffer())
obs.observe(document.documentElement, { childList: true, subtree: true })

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_VIDEO_INFO') {
    if (activeVideo) {
      sendResponse({ ok: true, info: { duration: activeVideo.duration, paused: activeVideo.paused } })
    } else sendResponse({ ok: false })
    return true
  }
  return false
})

export {}  // module marker

chrome.runtime.onInstalled.addListener(() => {
  console.log('[SW] installed')
})

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId !== undefined) {
    await chrome.sidePanel.open({ windowId: tab.windowId })
  }
})

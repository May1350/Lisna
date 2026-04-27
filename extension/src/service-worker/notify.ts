/**
 * Toolbar badge + cross-tab notifications for the global ON/OFF flag.
 * Lives in its own module so both index.ts (lifecycle listeners) and
 * messaging.ts (TOGGLE_ENABLED handler) can import without a circular dep.
 */

/**
 * - enabled  → clear the badge (default UI)
 * - disabled → red 'OFF' chip
 */
export async function updateBadge(enabled: boolean): Promise<void> {
  if (enabled) {
    await chrome.action.setBadgeText({ text: '' })
  } else {
    await chrome.action.setBadgeText({ text: 'OFF' })
    await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' })
  }
}

/**
 * Tell every tab's content script the global enabled flag flipped, so they can
 * mount or unmount the inline 📚 button. Per-tab errors (chrome:// pages, tabs
 * with no content script, discarded tabs) are swallowed.
 */
export async function broadcastEnabledChange(enabled: boolean): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({})
    for (const t of tabs) {
      if (t.id === undefined) continue
      try {
        await chrome.tabs.sendMessage(t.id, { type: 'SH_ENABLED_CHANGED', enabled })
      } catch {
        // many tabs won't have content script (chrome:// pages, etc.)
      }
    }
  } catch { /* ignore */ }
}

// Cross-context prefill for the Options page Feedback form.
//
// Used when the user clicks a "報告する" link on an error banner in the
// side panel / in-page modal: we want the Options page to open with
// the form already populated (category=bug, message containing the
// error code + context, contextUrl when available).
//
// Why chrome.storage.session and not chrome.storage.local:
//   - session is wiped when the browser session ends, so a stale
//     prefill from yesterday can't bleed into a fresh visit to the
//     Options page (which would otherwise inject a half-typed error
//     report into a totally unrelated future feedback).
//   - It's also wiped automatically across extension reloads, which
//     matches the "this is a single-shot handoff" semantics.
//
// We do NOT pass the prefill through query string. Two reasons:
//   1. Putting an arbitrary error message into the URL bar leaks it
//      into history/typeahead in confusing ways.
//   2. URL parsing in Options.tsx would have to coexist with future
//      query params (deep-links, marketing utm, etc); a single
//      session-storage key is simpler and forward-compatible.
//
// Lifecycle: consumeFeedbackPrefill() reads + deletes in one go so
// the form only auto-populates once. A second visit to Options
// shows an empty form unless a fresh prefill was written.

const KEY = 'sh.feedbackPrefill'

export type FeedbackCategory = 'bug' | 'feature_request' | 'other'

export interface FeedbackPrefill {
  category: FeedbackCategory
  message: string
  contextUrl?: string
}

export async function setFeedbackPrefill(p: FeedbackPrefill): Promise<void> {
  await chrome.storage.session.set({ [KEY]: p })
}

export async function consumeFeedbackPrefill(): Promise<FeedbackPrefill | null> {
  const r = await chrome.storage.session.get(KEY)
  await chrome.storage.session.remove(KEY)
  const v = r[KEY]
  if (!v || typeof v !== 'object') return null
  const cat = (v as { category?: unknown }).category
  const msg = (v as { message?: unknown }).message
  const url = (v as { contextUrl?: unknown }).contextUrl
  if (cat !== 'bug' && cat !== 'feature_request' && cat !== 'other') return null
  if (typeof msg !== 'string') return null
  return {
    category: cat,
    message: msg,
    contextUrl: typeof url === 'string' ? url : undefined,
  }
}

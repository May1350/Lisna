import { createRoot } from 'react-dom/client'
import { Options } from './Options'
import { bootstrap as bootstrapI18n, t } from '../shared/i18n'
import { installGlobalErrorHandlers } from '../shared/errors'
import '../side-panel/index.css'

installGlobalErrorHandlers('options')

// Hydrate i18n from chrome.storage BEFORE first render so the page
// lands in the user's preferred language without a flash. Also sync
// the tab <title> — the static index.html title hardcodes Japanese,
// which is wrong for ko/en/zh users.
void bootstrapI18n().finally(() => {
  document.title = t().options.pageTitle
  createRoot(document.getElementById('root')!).render(<Options />)
})

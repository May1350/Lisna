import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { bootstrap as bootstrapI18n } from '../shared/i18n'
import './index.css'

// Hydrate the i18n module from chrome.storage BEFORE the first render
// so the modal lands in the user's preferred language without a flash.
// bootstrap() is defensive — it never throws, so we always proceed to
// render even if storage is briefly unavailable.
void bootstrapI18n().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
})

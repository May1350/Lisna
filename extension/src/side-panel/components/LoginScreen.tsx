import { useState } from 'react'
import { login, type LoginResult } from '../api-client'
import { useT } from '../../shared/i18n'

interface Props {
  /** Optional: when present (embed mode), the SW exchanges Google OAuth + the
   * existing-session lookup in a single backend round-trip so the parent can
   * hydrate notes immediately. */
  currentUrl?: string
  onSuccess: (result: LoginResult) => void
}

// Resolve the Lisna brand icon at module-load time. Same artwork as
// the toolbar action / chrome://extensions tile (declared once in
// manifest.config.ts at `icons/icon128.png` — Vite's publicDir
// flatten emits the file at the dist root). Module-level constant
// instead of useMemo avoids a per-mount chrome.runtime call when
// the modal opens; the URL is stable for the lifetime of the
// extension install.
const LOGO_URL = chrome.runtime.getURL('icons/icon128.png')

// Centered welcome screen shown when the user is unauthed. Vertically
// centered in the viewport (was top-aligned with vast empty space
// below) and the Google login button uses the official multicolour
// "G" mark + a softer, more refined visual — the previous flat blue
// rectangle felt out-of-place inside an Obsidian-grade workflow tool.
export function LoginScreen({ currentUrl, onSuccess }: Props) {
  const T = useT()
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const handle = async () => {
    setLoading(true); setErr(null)
    try {
      const result = await login(currentUrl)
      onSuccess(result)
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'unknown') }
    finally { setLoading(false) }
  }
  // Tagline can contain a literal "\n" — render it on two lines using
  // <br/>. Splitting on \n preserves the locale-defined break point.
  const taglineLines = T.login.tagline.split('\n')
  const privacyLines = T.login.privacyNote.split('\n')
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 py-10 text-center bg-gradient-to-b from-white to-paper-200">
      <img
        src={LOGO_URL}
        alt={T.login.title}
        width={56}
        height={56}
        className="w-14 h-14 mb-5 rounded-2xl shadow-lg"
      />
      <h1 className="text-xl font-bold text-ink-900 mb-1.5">{T.login.title}</h1>
      <p className="text-sm text-ink-700 mb-7 leading-relaxed max-w-[260px]">
        {taglineLines.map((line, i) => (
          <span key={i}>
            {line}
            {i < taglineLines.length - 1 && <br />}
          </span>
        ))}
      </p>
      <button
        onClick={handle}
        disabled={loading}
        className="group inline-flex items-center justify-center gap-3 px-5 py-2.5 bg-paper-100 border border-paper-edge rounded-full text-sm font-medium text-ink-900 shadow-sm hover:shadow-md hover:border-ink-300 disabled:opacity-50 transition-all"
        aria-label={T.login.button}
      >
        {loading ? (
          <>
            <span className="inline-block w-4 h-4 border-2 border-paper-edge border-t-gray-700 rounded-full animate-spin" />
            <span>{T.login.busy}</span>
          </>
        ) : (
          <>
            <GoogleGlyph />
            <span>{T.login.button}</span>
          </>
        )}
      </button>
      {err && (
        <p className="text-warn-red text-xs mt-4 max-w-[280px] leading-relaxed">
          {T.login.failPrefix}{err}
        </p>
      )}
      <p className="text-[10px] text-ink-300 mt-8 leading-relaxed max-w-[260px]">
        {privacyLines.map((line, i) => (
          <span key={i}>
            {line}
            {i < privacyLines.length - 1 && <br />}
          </span>
        ))}
      </p>
    </div>
  )
}

// Official Google "G" multi-colour mark. Inline SVG so the file is
// self-contained (no font-awesome / external icon library), and so
// the colours don't shift with system theme.
function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.79 2.71v2.26h2.9c1.7-1.57 2.69-3.88 2.69-6.62z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.9-2.26c-.81.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.95 10.7c-.18-.54-.28-1.12-.28-1.7s.1-1.16.28-1.7V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l2.99-2.34z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.96L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"/>
    </svg>
  )
}

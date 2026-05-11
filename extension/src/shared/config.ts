export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001'
// Lambda Function URL for /v1/session/curate — bypasses API Gateway HTTP
// API's hard 30 s integration timeout (curator runs can hit 50–90 s).
// When unset, the SW falls back to API_BASE_URL/v1/session/curate so dev
// builds and the existing API GW route still work.
export const CURATE_URL = import.meta.env.VITE_CURATE_URL || ''
// WEB-type Google OAuth client id (vs. the manifest's Chrome-extension
// type client). Used by `chrome.identity.launchWebAuthFlow` to force a
// Google-hosted account chooser even when the user's Chrome profile
// only has one account linked. Backend's GOOGLE_OAUTH_CLIENT_ID secret
// is a comma-separated list that includes BOTH the Chrome-ext + Web
// client ids, so the resulting access token's `aud` passes
// verifyGoogleAccessToken regardless of which client minted it.
// Empty in dev builds — the picker call site throws a clear error
// instead of launching with client_id=undefined.
export const WEB_OAUTH_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || ''

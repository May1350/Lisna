# App ↔ web handshake smoke checklist

Prereqs: Phase M desktop integration complete (URL scheme registered, sign-in button wired).

## Web side check (Phase K only)

1. Sign in via browser:
   - `http://localhost:3000/signin?source=app&app_callback=lisna%3A%2F%2Fcallback`
2. After magic-link or OAuth completes, the browser is redirected to `/api/auth/exchange-code/issue?app_callback=lisna%3A%2F%2Fcallback`.
3. Inspect the response — it should contain a `<meta http-equiv="refresh">` and a script redirecting to `lisna://callback?code=<64-hex>`.
4. Without the desktop app running, the browser prints "site can't be reached." Verify the URL bar shows `lisna://callback?code=...`.

## End-to-end (Phase M + K together)

1. Launch Lisna.app (Phase M build with URL scheme registered).
2. On first launch, click "Sign in to start."
3. Default browser opens to `/signin?source=app&app_callback=lisna%3A%2F%2Fcallback`.
4. Complete magic link / OAuth.
5. Browser shows the meta-refresh page momentarily, then macOS routes the `lisna://callback?code=...` URL to Lisna.app.
6. Lisna.app posts to `/api/auth/exchange-code/redeem` with the code and stores the returned token in Keychain.
7. App UI mounts (recording view).
8. Browser navigates to `/auth/success` with auto-close countdown.

## Security headers to verify

- `/api/auth/exchange-code/issue` response:
  - `Cache-Control: no-store` (response embeds a one-time code; must never be cached)
  - `Content-Type: text/html; charset=utf-8`
  - The `meta http-equiv="refresh"` `content` attribute value is HTML-escaped (no raw `<` `>` `"` characters from the callback parameter)
- `/api/auth/exchange-code/redeem` response (all status codes):
  - `Cache-Control: no-store` (response carries a long-lived device token; must never be cached)
  - `Content-Type: application/json`

## Failure cases to verify

- Code used twice → second redeem returns 401 with body `{"error":"invalid_or_consumed"}`.
- Code older than 10 minutes → redeem returns 401 with body `{"error":"invalid_or_consumed"}`.
- App callback scheme not `lisna://` → issue returns 400 with body `invalid scheme or contains fragment`.
- App callback containing `#` fragment (e.g. `lisna://callback#x`) → issue returns 400 (HTML-escape attack vector via fragment is blocked at route AND in `buildCallbackUrl`).
- Auth.js redirect callback with a cross-origin URL (e.g. `callbackUrl=https://lisna.jp.evil.com/x`) → after auth completes, browser lands on `/dashboard` (origin mismatch, attacker URL is silently dropped). Verify the response 302 `Location` header is `${baseUrl}/dashboard`, NOT the attacker URL.
- POST `/api/auth/exchange-code/redeem` with malformed JSON body → 400 with `{"error":"invalid_json"}`.
- POST `/api/auth/exchange-code/redeem` with `{}` (no code field) → 400 with `{"error":"missing_code"}`.

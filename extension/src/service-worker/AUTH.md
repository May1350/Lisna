# Service Worker Auth — Operator Orientation

This extension uses **two different Google OAuth 2.0 clients in the same
GCP project**. They are not interchangeable. Picking the wrong one,
forgetting to register a redirect URI, or rotating the wrong extension
ID will fail in two distinct ways depending on which flow the user
clicked.

## The two OAuth clients

| | Primary "Login with Google" | Secondary "Use a different Google account" |
|---|---|---|
| API | `chrome.identity.getAuthToken` | `chrome.identity.launchWebAuthFlow` |
| Source | `loginWithGoogle()` | `loginWithGoogleAccountPicker()` |
| GCP client type | **Chrome Extension** | **Web application** |
| `client_id` lives in | `manifest.json` → `oauth2.client_id` | `import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID` (compiled into the bundle) |
| Bound to | The extension ID registered on the GCP client | The redirect URI registered on the GCP client |
| User flow | Chrome's native account chooser (limited to accounts already in the Chrome profile) | Google's hosted account chooser (any Google account) |
| Failure when GCP is wrong | `getAuthToken` returns `null` → "Google sign-in cancelled or failed" (thrown by `getGoogleAccessToken` in `auth.ts`) — **indistinguishable from a genuine user cancel** | Google shows `Error 400: redirect_uri_mismatch` inside the popup, user closes it, callback fires with the same "User did not approve access" lastError (handled by `loginWithGoogleAccountPicker` in `auth.ts`) — **also indistinguishable from a cancel by JS** |

## What has to be registered where

For each environment (= each distinct `chrome.runtime.id`):

1. **Chrome Extension OAuth client** in GCP Console → set the
   "Application ID" field to the extension ID.
2. **Web OAuth client** in GCP Console → add
   `https://<extension-id>.chromiumapp.org/` (trailing slash matters,
   `chrome.identity.getRedirectURL()` returns it that way) to
   "Authorized redirect URIs".

Both need updating whenever a new extension ID is introduced (CWS
publish, a new dev's unpacked load, a CI build).

### Known extension IDs

| ID | Where it lives | Maintainer step |
|---|---|---|
| `liaklanhjcbhnmgnegmkehidilodmahh` | CWS-published (stable, assigned at first publish) | Register on **both** clients |
| `idbgminbpkbiippdncoooeelijagfggp` | Local dev unpacked, derived from `manifest.key` baked in by `pnpm build` (without `CWS_BUILD=1`) | Register on **both** clients |

Anything else (e.g. a CI ephemeral ID, a new contributor's unpacked
load without the shared `key`) needs the same two registrations
before either flow will work.

## Diagnosing a login failure (the 60-second drill)

The SW console (chrome://extensions → Lisna → "Inspect views: service
worker") logs a structured `[loginWithGoogleAccountPicker]
launchWebAuthFlow failed` block on the picker path. It includes
`extensionId`, `redirectUri`, and `webClientId`. Compare those three
values against GCP Console; whichever side doesn't match is the bug.

The primary `getAuthToken` path has no equivalent structured log
because Chrome surfaces no diagnostic when the OAuth client and
extension ID disagree — the call simply returns `null`. To rule out a
GCP misconfiguration on that path, manually compare
`chrome.runtime.id` (from the SW console) against the "Application ID"
field on the Chrome Extension OAuth client in GCP.

## Why both flows exist (don't delete one)

The primary `getAuthToken` flow is ~5× faster (~0.2 s silent token
return when Chrome already has the cached token vs ~5 s for the
hosted-page popup) and is the path 95% of users hit. The secondary
`launchWebAuthFlow` flow is the only way a user can authenticate
against a Google account that is **not** linked into their Chrome
profile, which is a real case for users who keep work + personal
Google accounts in separate browsers. Both stay.

The backend's `verifyGoogleAccessToken` accepts both client_ids via a
comma-separated `GOOGLE_OAUTH_CLIENT_ID` env var, so the JWT issuance
path is identical regardless of which extension flow produced the
access token. No backend change is needed when adding/removing a flow.

## Build-time gate

`pickerAvailable = WEB_OAUTH_CLIENT_ID.length > 0` hides the secondary
button when `VITE_GOOGLE_OAUTH_CLIENT_ID` is empty at build time. This
is deliberate — it prevents a build that lacks the env value from
showing a button that would always throw the "VITE_…_CLIENT_ID is
unset" error. The corollary: introducing the env value to a build
that previously omitted it **activates** a code path that requires
the redirect URI to be registered. CWS rejected v0.1.39 because the
URI registration step was missed when the env value was first added
to the production build.

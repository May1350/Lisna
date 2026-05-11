import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

// CWS rejects manifests that include the `key` field — it assigns its
// own extension ID at publish time. For local dev we want a stable ID
// so the chrome-extension:// origin matches the GCP OAuth client's
// authorized origins. The CWS_BUILD env var lets us build a
// store-ready bundle that omits `key` while keeping dev builds
// reproducible.
const isCwsBuild = process.env.CWS_BUILD === '1'

export default defineManifest({
  manifest_version: 3,
  name: 'Lisna',
  // Fixed extension ID key — ensures identical ID across all machines/installs.
  // Derived ID: idbgminbpkbiippdncoooeelijagfggp
  // Register this ID in GCP → OAuth 클라이언트 → 승인된 원본:
  //   chrome-extension://idbgminbpkbiippdncoooeelijagfggp
  // OMITTED for CWS_BUILD=1 — store assigns its own ID, and the OAuth
  // client's authorized origins must be updated post-publish to include
  // the CWS-assigned chrome-extension:// origin.
  ...(isCwsBuild ? {} : {
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtWMU1uIh/76E+yqhOl4JanGQdasyOFJ7SFLgHjnX2qCnFj7pd9/m6vKklEN4JlqRY+ZQrRPYDNI2GwTIlqM7hjsQ+voT+Z4si0xhvvUtEtNW1JM5gldi52Krme25TIyEQ6lenbSA/LUwnKuRsfyXNileyWhiM+AEYPbM5DUJ0cX3ynt47+d8UhQ2l6B8XZmKMbQXkKRV7FqENq1eNIblmjijwRUxpD2SUkKbDhQbhPjsH/OswftoHeUAEGKl0AXUZKAod6skHVHlwjEDj6gE6TU+5lK2185mH12s0DwEXZZwbu6XyG5agpxCjNY4aa3QLISDXiYWiDrKvRhx6AYadQIDAQAB',
  }),
  description: '講義や会議をリアルタイムで聴き取り、構造化されたノートを自動生成するAIアシスタント',
  version: pkg.version,
  // Chrome Web Store requires homepage_url. Used as Privacy/Terms link in
  // store listing and the extension's chrome://extensions detail page.
  // TODO: replace with custom domain (lisna.ai etc.) once acquired.
  homepage_url: 'https://lisna.jp',
  // No `default_locale` — we don't use chrome.i18n / __MSG_*__ message references
  // (all UI strings are inline plain Japanese). Setting default_locale without a
  // matching `_locales/<lang>/messages.json` makes Chrome reject the extension.
  // NOTE: no 'tabs' permission. The three chrome.tabs APIs we use
  // (create, sendMessage, query) all work without it:
  //   - tabs.create({url, active}): never requires `tabs`.
  //   - tabs.sendMessage(tabId, …): satisfied by host_permissions
  //     below (<all_urls> matches every tab origin).
  //   - tabs.query({...}): without `tabs`, the returned Tab objects
  //     strip url/title/favIconUrl. Audited every call site
  //     (sw/messaging.ts, sw/notify.ts, side-panel/App.tsx) — all
  //     consume only `id`/`windowId`, which stay populated regardless.
  // Dropping `tabs` removes the "this extension can access your tabs"
  // install warning on CWS — a real conversion win.
  permissions: ['storage', 'sidePanel', 'identity', 'alarms'],
  host_permissions: ['<all_urls>'],
  // OAuth2 client used by chrome.identity.getAuthToken — Chrome Extension
  // type credential pointed at this extension's ID. Lets us skip the
  // launchWebAuthFlow popup entirely when the user is already signed into
  // Chrome with their Google account, cutting ~3-5 s off first login.
  oauth2: {
    client_id: '820197116751-p3bgg6nac677qkfq6tmi6j7afnnca4ak.apps.googleusercontent.com',
    scopes: ['openid', 'email', 'profile'],
  },
  icons: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  action: { default_title: 'Lisna', default_icon: 'icons/icon128.png' },
  side_panel: { default_path: 'src/side-panel/index.html' },
  options_ui: { page: 'src/options/index.html', open_in_tab: true },
  background: {
    // NOTE: file is `main.ts` not `index.ts` to disambiguate from
    // src/content/index.ts. CRX plugin had a hash collision when both
    // entries were named index.ts, causing the content-script loader
    // to import the SW bundle (chrome.windows undefined → crash).
    service_worker: 'src/service-worker/main.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      all_frames: true,
      run_at: 'document_idle',
    },
  ],
  web_accessible_resources: [
    {
      resources: ['src/side-panel/index.html'],
      matches: ['<all_urls>'],
    },
  ],
})

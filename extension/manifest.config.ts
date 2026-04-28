import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Study-Helper',
  description: '日本の大学生のための、ダウンロード不可な講義動画専用のリアルタイム学習アシスタント',
  version: pkg.version,
  // No `default_locale` — we don't use chrome.i18n / __MSG_*__ message references
  // (all UI strings are inline plain Japanese). Setting default_locale without a
  // matching `_locales/<lang>/messages.json` makes Chrome reject the extension.
  permissions: ['storage', 'sidePanel', 'identity', 'tabs'],
  host_permissions: ['<all_urls>'],
  // OAuth2 client used by chrome.identity.getAuthToken — Chrome Extension
  // type credential pointed at this extension's ID. Lets us skip the
  // launchWebAuthFlow popup entirely when the user is already signed into
  // Chrome with their Google account, cutting ~3-5 s off first login.
  oauth2: {
    client_id: '820197116751-p3bgg6nac677qkfq6tmi6j7afnnca4ak.apps.googleusercontent.com',
    scopes: ['openid', 'email', 'profile'],
  },
  action: { default_title: 'Study-Helper' },
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

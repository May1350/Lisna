import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Study-Helper',
  description: '日本の大学生のための、ダウンロード不可な講義動画専用のリアルタイム学習アシスタント',
  version: pkg.version,
  default_locale: 'ja',
  permissions: ['storage', 'sidePanel', 'identity', 'tabs', 'scripting'],
  host_permissions: ['<all_urls>'],
  action: { default_title: 'Study-Helper' },
  side_panel: { default_path: 'src/side-panel/index.html' },
  background: {
    service_worker: 'src/service-worker/index.ts',
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

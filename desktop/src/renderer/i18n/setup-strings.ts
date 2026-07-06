/**
 * Step 5 §5.1 — setup UI strings (JA-only for v2.0, polite desu/masu per ADR §3).
 * Tone matches `error-message-map.ts` — diagnosis + recovery clause, no Latin
 * model jargon in user-facing copy (uses founder's prod nouns 「文字起こしモデル」
 * / 「ノート生成モデル」 as established in STT_TIMEOUT / LLM_LOAD_TIMEOUT).
 */

export const SETUP_STRINGS_JA = {
  stepIndicator: (current: 1 | 2, total: 2): string => `ステップ ${current} / ${total}`,
  ready: '準備が完了しました',
  // In-app first-run model downloader (Task 3) — dark centered-hero flow.
  // idle → checking → downloading → done/error. The manual picker fallback
  // (ModelPickerStep) was removed from this flow entirely in Task 5 — auto-
  // detect + in-app download now covers every needs-setup case.
  retryButton: '再試行',
  usePickerLink: 'すでにファイルがある場合は選択',
  downloadingStt: '文字起こしモデル',
  downloadingLlm: 'ノート生成モデル',
  wordmark: 'Lisna',
  startButton: 'はじめる',
  startBody: '文字起こしとノート生成のモデルを確認します。必要な場合のみダウンロードします。',
  sizeDisclosure: (gb: string | number): string => `初回のみ・最大 約${gb}GB`,
  checkingTitle: 'モデルを確認しています',
  checkingBody: 'すでにお使いのモデルがないか調べています…',
  downloadTitle: 'ダウンロードしています',
  downloadBody2: '初回のみ数分かかります。このままお待ちください。',
  doneTitle: '準備が完了しました',
  doneBody: '録音をはじめられます。',
} as const;

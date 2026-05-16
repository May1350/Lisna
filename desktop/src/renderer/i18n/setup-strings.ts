/**
 * Step 5 §5.1 — picker UI strings (JA-only for v2.0, polite desu/masu per ADR §3).
 * Tone matches `error-message-map.ts` — diagnosis + recovery clause, no Latin
 * model jargon in user-facing copy (uses founder's prod nouns 「文字起こしモデル」
 * / 「ノート生成モデル」 as established in STT_TIMEOUT / LLM_LOAD_TIMEOUT).
 */

export const SETUP_STRINGS_JA = {
  stepIndicator: (current: 1 | 2, total: 2): string => `ステップ ${current} / ${total}`,
  sttTitle: '文字起こしモデル (.bin) の選択',
  llmTitle: 'ノート生成モデル (.gguf) の選択',
  body: 'Discord #lisna-alpha チャンネルから届いたファイルを選択してください。',
  pickButton: 'ファイルを選択',
  discordButton: 'Discord で受け取る',
  ready: '準備が完了しました',
} as const;

/**
 * Discord deep-link. Founder fills <server>/<channel> before alpha merge.
 * If still placeholder, isDiscordUrlConfigured() returns false and the
 * picker UI hides the Discord button — prevents shipping a broken
 * shell.openExternal call to a hallucinated URL.
 */
export const DISCORD_CHANNEL_URL = 'https://discord.com/channels/<server>/<channel>';

export function isDiscordUrlConfigured(): boolean {
  return !DISCORD_CHANNEL_URL.includes('<');
}

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
 * Discord server invite URL. Used by the picker's "Discord で受け取る" button
 * (shell.openExternal). The invite form (discord.gg/...) is intentional rather
 * than a deep-link to a specific channel — alpha onboarding flow expects new
 * users to join the server first, then find the #lisna-alpha channel for the
 * model files. Once joined, subsequent picker visits still show the same
 * invite link, but Discord short-circuits to the server view for members —
 * functionally equivalent to a channel link for repeat users.
 *
 * Runtime guard: isDiscordUrlConfigured() returns false if the URL still
 * contains '<' (placeholder shape) — the picker UI hides the Discord button
 * in that case to prevent shipping a broken shell.openExternal call.
 */
export const DISCORD_CHANNEL_URL = 'https://discord.gg/69NkqBTbS';

export function isDiscordUrlConfigured(): boolean {
  return !DISCORD_CHANNEL_URL.includes('<');
}

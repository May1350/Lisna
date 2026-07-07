import type { NoteOrigin } from '@shared/note-schema';

/**
 * LLM Connector Notes (spec 2026-07-07 §7) — Claude連携 disclosure + connect UX
 * strings (JA-only for v2, polite desu/masu per ADR §3, tone matches
 * disclosure-strings.ts / error-message-map.ts: plain, honest, founder's prod
 * nouns (「録音」「文字起こし」「ノート」), no Latin jargon, no `§` marker).
 *
 * The four disclosure claims (locked by spec §7, order matters — the block is
 * ALWAYS visible ABOVE the API-key input, never behind a click):
 *   1. transcriptOnly — only the selected recording's TRANSCRIPT (not audio)
 *      is sent, directly, to the user's OWN Anthropic account; billed to
 *      their own API key.
 *   2. audioStaysLocal — the audio itself never leaves the Mac.
 *   3. noLisnaServerAccess — Lisna's own servers never see the content.
 *   4. disconnectAnytime — the connection can be revoked at any time.
 */
export const CONNECTOR_STRINGS_JA = {
  title: 'Claude連携',
  backLabel: '← 戻る',
  statusLabel: '状態',
  statusConnected: '接続済み',
  statusDisconnected: '未接続',
  disclosure: [
    '① 選んだ録音の文字起こしテキストだけが、あなた自身のAnthropicアカウントに直接送信されます（利用料はご自身のAPIキーに課金されます・ノート1件あたり数円〜十数円程度）。',
    '② 音声がMacの外に出ることはありません。',
    '③ Lisnaのサーバーが内容を見ることはありません。',
    '④ 接続はいつでも解除できます。',
  ],
  apiKeyLabel: 'Anthropic APIキー',
  apiKeyPlaceholder: 'sk-ant-...',
  connectButton: '接続',
  connectingButton: '接続しています…',
  disconnectButton: '解除',
  disconnectingButton: '解除しています…',
} as const;

/**
 * Task 10 — per-note "how was this made" origin label, shown next to a note's
 * generation metadata (mirrors `generatedBy.model` display elsewhere).
 */
export const ORIGIN_LABEL_JA: Record<NoteOrigin, string> = {
  ondevice: 'オンデバイス',
  claude: 'Claude',
};

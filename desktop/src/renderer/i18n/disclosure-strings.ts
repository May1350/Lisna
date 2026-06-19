/**
 * Group G1 §5.7/§13 — first-run on-device audio-retention disclosure strings
 * (JA-only for v2.0, polite desu/masu per ADR §3). Tone matches
 * setup-strings.ts / error-message-map.ts: plain, honest, founder's prod nouns
 * (「録音」「文字起こし」「ノート」), no Latin jargon.
 *
 * The three disclosure claims (locked by spec §5.7 / §13):
 *   1. deviceOnly  — saved on THIS device only; never uploaded.
 *   2. retained    — kept until you delete them yourself; not auto-deleted.
 *   3. deleteScope — deleting a recording also removes its transcript, but the
 *                    generated note remains.
 * Phrased as capabilities, NOT buttons (the delete UI is a later phase). Must
 * NOT claim "we keep nothing", auto-purge, or a capture on/off toggle — capture
 * is always-on; the only control is after-the-fact deletion.
 */

export const AUDIO_DISCLOSURE_JA = {
  title: '録音の保存について',
  deviceOnly:
    '録音した音声は、このデバイスの中だけに保存されます。インターネットにアップロードされることはありません。',
  retained:
    '保存された録音は、ご自身で削除するまで残ります。自動的に消えることはありません。',
  deleteScope:
    '録音を削除すると、その文字起こしもあわせて削除されます。生成されたノートはそのまま残ります。',
  ackButton: '確認しました',
} as const;

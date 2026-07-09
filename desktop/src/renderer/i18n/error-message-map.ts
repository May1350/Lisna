/**
 * Step 5 §3.2 — JA error message map (concept-locked: JA-only for v2.0).
 *
 * **Style guide** (ADR `2026-05-15-step-5-section-9-decisions.md` §3):
 * - Polite desu/masu form (です・ます調)
 * - NOT casual (だ/である) — too blunt for an in-app error
 * - NOT formal-keigo (お〜になります) — feels servile for a personal tool
 * - End sentences with 「。」
 * - Where the recovery path is to retry: include 「もう一度」 or 「再度」
 * - SIDECAR_GAVE_UP must explicitly mention 「再起動」 (only recovery path)
 *
 * Adding a new code:
 *   1. Add it to `ALL_ERROR_CODES` below (the order is unstable; alphabetical-
 *      by-domain for readability).
 *   2. Add the JA string to `ERROR_MESSAGE_MAP_JA`. The unit tests pin the
 *      polite-form, terminator, and length invariants — they will fail until
 *      you finish the copy.
 *   3. Confirm the corresponding `Error(code)` throw site exists in main/.
 */

/** Closed set of error codes the renderer renders friendly copy for. */
export const ALL_ERROR_CODES = [
  // Session lifecycle
  'MODELS_NOT_CONFIGURED',
  'SIDECAR_DOWN',
  'SIDECAR_GAVE_UP',
  'NO_ACTIVE_SESSION',
  'SESSION_NOT_READY',
  'SESSION_ACTIVE',
  'UNSUPPORTED_LANGUAGE',
  'EMPTY_TRANSCRIPT',
  // Fabrication guard (2026-06-12) — note content not in the session language
  'NOTE_LANGUAGE_MISMATCH',
  // Step 5 §3.5 operation timeouts
  'STT_TIMEOUT',
  'LLM_LOAD_TIMEOUT',
  'LLM_UNLOAD_TIMEOUT',
  'GENERATE_TIMEOUT',
  // H1 — whole-WAV transcribe stall: the sidecar wedged mid-transcribe and a
  // process restart + single re-issue still did not produce progress.
  'STT_STALLED',
  // Step 5 §5.1 — first-run model resolver
  'MODEL_FILE_MISSING_STT',
  'MODEL_FILE_MISSING_LLM',
  'INVALID_MAGIC_BYTES_STT',
  'INVALID_MAGIC_BYTES_LLM',
  'MODEL_SAVE_FAILED',
  // F2 history viewer (2026-06-12) — loadDump contract (session-dump-reader.ts)
  'INVALID_DUMP_ID',
  'DUMP_NOT_FOUND',
  'DUMP_UNREADABLE',
  // Ko-STT Task 3 — note generation not yet supported for this language
  'NOTES_NOT_SUPPORTED_FOR_LANGUAGE',
  // In-app first-run model downloader Task 1 — downloadModel core
  'INSUFFICIENT_DISK',
  'CHECKSUM_MISMATCH',
  'NETWORK_FAILED',
  // LLM Connector Phase 0 (Task 5-6) — cloud note generation errors
  'CONNECTOR_NO_KEY',
  'CONNECTOR_AUTH_INVALID',
  'CONNECTOR_RATE_LIMITED',
  'CONNECTOR_NO_CREDIT',
  'CONNECTOR_OFFLINE',
  'CONNECTOR_TIMEOUT',
  'CONNECTOR_BAD_RESPONSE',
  'CONNECTOR_TRANSCRIPT_TOO_LONG',
  // FIX-A (audit 2026-07-09 H1/H2/M13) — server-busy classification +
  // truncation-aware retry
  'CONNECTOR_SERVER_BUSY',
  'CONNECTOR_OUTPUT_TRUNCATED',
] as const;

export type ErrorCode = (typeof ALL_ERROR_CODES)[number];

/**
 * Fallback shown when the raw error message does not match any known code.
 * Polite desu/masu form per ADR §3.
 */
export const UNKNOWN_ERROR_FALLBACK_JA =
  '予期しないエラーが発生しました。もう一度お試しください。';

/**
 * Mapping from error code → JA copy. Each string is 1-2 sentences. Tone
 * sample: explanatory clause + actionable next step.
 */
export const ERROR_MESSAGE_MAP_JA: Record<ErrorCode, string> = {
  MODELS_NOT_CONFIGURED:
    '録音用のモデルが設定されていません。初期設定からモデルファイルを指定してください。',
  SIDECAR_DOWN:
    '録音エンジンを再起動しています。数秒待ってからもう一度お試しください。',
  SIDECAR_GAVE_UP:
    '録音エンジンを復旧できませんでした。Lisna を再起動してください。',
  NO_ACTIVE_SESSION:
    '録音セッションが見つかりませんでした。最初からやり直してください。',
  SESSION_NOT_READY:
    '録音エンジンを準備中です。少しお待ちください。',
  SESSION_ACTIVE:
    'すでに録音セッションが進行中です。完了してからもう一度お試しください。',
  UNSUPPORTED_LANGUAGE:
    'この言語はまだサポートされていません。',
  EMPTY_TRANSCRIPT:
    '音声を検出できませんでした。もう一度録音してください。',
  NOTE_LANGUAGE_MISMATCH:
    'ノートを録音の言語で生成できなかったため、破棄しました。もう一度試すか、別のノート形式をお試しください。',
  STT_TIMEOUT:
    '文字起こしモデルの応答に時間がかかりすぎています。もう一度お試しください。',
  LLM_LOAD_TIMEOUT:
    'ノート生成モデルの読み込みに時間がかかりすぎています。もう一度お試しください。',
  LLM_UNLOAD_TIMEOUT:
    'ノート生成モデルの解放に時間がかかりすぎています。もう一度お試しください。',
  GENERATE_TIMEOUT:
    'ノート生成が停滞しました。もう一度お試しください。',
  STT_STALLED:
    '音声の文字起こしが応答しなくなりました。もう一度お試しください。',
  MODEL_FILE_MISSING_STT:
    '文字起こしモデルのファイルが見つかりません。もう一度選択してください。',
  MODEL_FILE_MISSING_LLM:
    'ノート生成モデルのファイルが見つかりません。もう一度選択してください。',
  INVALID_MAGIC_BYTES_STT:
    'このファイルは文字起こしモデルとして読み込めませんでした。Discord で配布されたファイルを再度選択してください。',
  INVALID_MAGIC_BYTES_LLM:
    'このファイルはノート生成モデルとして読み込めませんでした。Discord で配布されたファイルを再度選択してください。',
  MODEL_SAVE_FAILED:
    'モデル情報の保存に失敗しました。ディスクの空き容量とアクセス権限をご確認ください。',
  INVALID_DUMP_ID:
    'この録音履歴を開けませんでした。一覧から選び直してください。',
  DUMP_NOT_FOUND:
    'この録音履歴は見つかりませんでした。削除された可能性があります。',
  DUMP_UNREADABLE:
    'この録音履歴のデータが破損していて読み込めませんでした。',
  NOTES_NOT_SUPPORTED_FOR_LANGUAGE:
    'この言語ではノート生成にまだ対応していません。文字起こしをご利用ください。',
  INSUFFICIENT_DISK:
    'ディスクの空き容量が足りません。約3GBの空きを確保して再試行してください。',
  CHECKSUM_MISMATCH:
    'ダウンロードしたファイルが破損しています。もう一度お試しください。',
  NETWORK_FAILED:
    'ダウンロードに失敗しました。接続を確認して再試行してください。',
  CONNECTOR_NO_KEY:
    'Claudeが接続されていません。設定から接続してください。',
  CONNECTOR_AUTH_INVALID:
    'APIキーが無効です。Anthropicコンソールで確認し、接続し直してください。',
  CONNECTOR_RATE_LIMITED:
    'リクエストが混み合っています。しばらくしてからもう一度お試しください。',
  CONNECTOR_NO_CREDIT:
    'Anthropicアカウントのクレジット残高が不足しています。チャージ後にもう一度お試しください。',
  CONNECTOR_OFFLINE:
    'ネットワークに接続できません。接続を確認してからもう一度お試しください。',
  CONNECTOR_TIMEOUT:
    'Claudeの応答がタイムアウトしました。もう一度お試しください。',
  CONNECTOR_BAD_RESPONSE:
    'ノートの生成結果を読み取れませんでした。もう一度お試しいただくか、オンデバイス生成をご利用ください。',
  CONNECTOR_TRANSCRIPT_TOO_LONG:
    '文字起こしが長すぎるため、クラウド生成できません。オンデバイス生成をご利用ください。',
  CONNECTOR_SERVER_BUSY:
    'Anthropicのサーバーが混み合っています。しばらくしてからもう一度お試しください。',
  CONNECTOR_OUTPUT_TRUNCATED:
    'ノートが長すぎて生成しきれませんでした。オンデバイス生成をご利用いただくか、録音を分けてお試しください。',
};

/**
 * Resolve an `Error.message` (or any raw string) to a JA-friendly message.
 *
 * Resolution order:
 *   1. Exact match: `raw === '<CODE>'` → mapped copy.
 *   2. Substring match: any known code embedded in `raw` → mapped copy.
 *      Handles real-world wrapping like `'Error: STT_TIMEOUT at orchestrator.ts:42'`.
 *   3. Fallback: `UNKNOWN_ERROR_FALLBACK_JA`.
 *
 * Note: ErrorView's `permanent` prop OVERRIDES this resolution to always
 * show the SIDECAR_GAVE_UP copy. See ErrorView.tsx for that branch — the
 * map here is the substrate; the permanent flag is the view-level upgrade.
 */
export function toFriendlyJa(raw: string): string {
  if (ALL_ERROR_CODES.includes(raw as ErrorCode)) {
    return ERROR_MESSAGE_MAP_JA[raw as ErrorCode];
  }
  for (const code of ALL_ERROR_CODES) {
    if (raw.includes(code)) return ERROR_MESSAGE_MAP_JA[code];
  }
  return UNKNOWN_ERROR_FALLBACK_JA;
}

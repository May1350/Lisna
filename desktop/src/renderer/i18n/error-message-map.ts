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
  'APP_QUIT',
  'UNSUPPORTED_LANGUAGE',
  'EMPTY_TRANSCRIPT',
  // Step 5 §3.5 operation timeouts
  'STT_TIMEOUT',
  'LLM_LOAD_TIMEOUT',
  'LLM_UNLOAD_TIMEOUT',
  'GENERATE_TIMEOUT',
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
  APP_QUIT:
    'アプリを終了しています。',
  UNSUPPORTED_LANGUAGE:
    'この言語はまだサポートされていません。',
  EMPTY_TRANSCRIPT:
    '音声を検出できませんでした。もう一度録音してください。',
  STT_TIMEOUT:
    '文字起こしモデルの応答に時間がかかりすぎています。もう一度お試しください。',
  LLM_LOAD_TIMEOUT:
    'ノート生成モデルの読み込みに時間がかかりすぎています。もう一度お試しください。',
  LLM_UNLOAD_TIMEOUT:
    'ノート生成モデルの解放に時間がかかりすぎています。もう一度お試しください。',
  GENERATE_TIMEOUT:
    'ノート生成が停滞しました。もう一度お試しください。',
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

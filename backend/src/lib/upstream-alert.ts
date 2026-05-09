// Classify upstream LLM failures and ping the operator over SNS.
//
// Distinct from the per-user quota path (lib/quota.ts):
//   - quota.ts gates the user's monthly audio-second budget. 402.
//   - this module catches the OPERATOR-side failure modes — Anthropic
//     billing exhausted, Groq key invalid, OpenAI rate-limited, etc.
//     The user can do nothing about these; the operator must rotate /
//     top up / wait. So we classify, alert, and tell the user it's a
//     server-side issue rather than letting them think their plan is
//     broken.
//
// Dedup: one alert per (provider, kind) per ALERT_WINDOW_MS. Keyed in
// the alert_dedup table (migration 006) so concurrent Lambda invocations
// during an outage don't all publish their own copy.
//
// Failure of the alert path itself is intentionally non-fatal. If SNS
// is also broken or the dedup INSERT fails, we log and continue —
// returning a 503 to the user is more important than a perfectly
// delivered notification.

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { query } from './db.js'

export type UpstreamProvider = 'anthropic' | 'openai' | 'groq'
export type UpstreamFailureKind =
  | 'auth_failed'        // 401 / 403 — key invalid, billing inactive
  | 'quota_exhausted'    // billing-wise out of credits / model budget
  | 'rate_limit'         // 429 — likely transient but operator should know if sustained
  | 'unknown_4xx'        // catch-all for upstream client errors we can't pin

export interface UpstreamFailure {
  provider: UpstreamProvider
  kind: UpstreamFailureKind
  detail: string         // raw error message for the SNS body
}

const ALERT_WINDOW_MS = 60 * 60 * 1000  // 1 hour

let _sns: SNSClient | undefined
function snsClient(): SNSClient {
  if (!_sns) _sns = new SNSClient({})
  return _sns
}

// Best-effort classifier. Returns null when the error doesn't look
// like a definitive upstream-blame failure (e.g. plain network
// timeout, malformed payload thrown in our own code) — caller should
// fall back to the existing transient-error handling for those.
export function classifyUpstreamError(e: unknown, providerHint?: UpstreamProvider): UpstreamFailure | null {
  if (!e) return null
  // SDK errors usually expose .status (Anthropic) or .response.status
  // (older OpenAI shapes). Try a few common shapes without depending
  // on importing every SDK's type.
  const errAny = e as {
    status?: number
    response?: { status?: number }
    message?: string
    error?: { type?: string; message?: string; code?: string }
  }
  const status =
    typeof errAny.status === 'number' ? errAny.status :
    typeof errAny.response?.status === 'number' ? errAny.response.status :
    undefined
  const message = (errAny.message ?? errAny.error?.message ?? '').toString()
  const errType = (errAny.error?.type ?? errAny.error?.code ?? '').toString()

  // Provider inference. Most callers pass providerHint; if not, sniff
  // the message for SDK-specific wording.
  const provider: UpstreamProvider = providerHint ??
    (message.includes('anthropic') || errType.startsWith('anthropic') ? 'anthropic' :
     message.includes('groq') ? 'groq' :
     'openai')

  // Strong signals: insufficient_quota / billing_hard_limit_reached are
  // quota exhaustion. invalid_api_key / authentication_error are auth.
  const lower = (message + ' ' + errType).toLowerCase()
  if (lower.includes('insufficient_quota') || lower.includes('billing_hard_limit') || lower.includes('quota')) {
    return { provider, kind: 'quota_exhausted', detail: message.slice(0, 500) }
  }
  if (status === 401 || status === 403 || lower.includes('invalid_api_key') || lower.includes('authentication')) {
    return { provider, kind: 'auth_failed', detail: message.slice(0, 500) }
  }
  if (status === 429 || lower.includes('rate_limit') || lower.includes('rate limit')) {
    return { provider, kind: 'rate_limit', detail: message.slice(0, 500) }
  }
  // Unknown 4xx — could be a transient bug on our side, but worth
  // flagging once an hour anyway so a sustained problem surfaces.
  if (status && status >= 400 && status < 500) {
    return { provider, kind: 'unknown_4xx', detail: `status=${status} ${message}`.slice(0, 500) }
  }
  return null
}

// Acquire dedup slot. Returns true if THIS caller has the right to
// publish this alert (no recent send, OR the previous send is older
// than the dedup window). false means "another container already
// alerted recently — skip your publish".
async function acquireAlertSlot(key: string): Promise<boolean> {
  // The WHERE clause inside ON CONFLICT must compare against the
  // existing row's value, hence `alert_dedup.last_sent_at`. EXCLUDED
  // refers to the candidate (about-to-be-written) row.
  const rows = await query<{ key: string }>(
    `INSERT INTO alert_dedup (key, last_sent_at)
       VALUES ($1, NOW())
     ON CONFLICT (key) DO UPDATE
       SET last_sent_at = NOW()
       WHERE alert_dedup.last_sent_at < NOW() - ($2 || ' milliseconds')::interval
     RETURNING key`,
    [key, String(ALERT_WINDOW_MS)],
  )
  return rows.length > 0
}

export async function publishUpstreamAlert(failure: UpstreamFailure, surface: 'curate' | 'stt'): Promise<void> {
  const topicArn = process.env.ALERTS_TOPIC_ARN
  if (!topicArn) {
    // eslint-disable-next-line no-console
    console.warn('[upstream-alert] ALERTS_TOPIC_ARN not set — skipping notification', failure)
    return
  }
  const dedupKey = `upstream:${failure.provider}:${failure.kind}:${surface}`
  let canSend: boolean
  try {
    canSend = await acquireAlertSlot(dedupKey)
  } catch (e) {
    // Don't let a dedup-table failure block alerting. Better one
    // alert too many than none. If the table is consistently
    // unreachable that itself is a separate problem worth seeing.
    // eslint-disable-next-line no-console
    console.warn('[upstream-alert] dedup acquire failed; sending anyway', e instanceof Error ? e.message : e)
    canSend = true
  }
  if (!canSend) {
    // eslint-disable-next-line no-console
    console.log('[upstream-alert] dedup-suppressed within window', { dedupKey })
    return
  }
  const subject = `[URGENT] Lisna ${failure.provider} ${failure.kind} (${surface})`.slice(0, 100)
  const body = [
    `🚨 Upstream LLM failure detected — user-facing functionality blocked.`,
    ``,
    `Surface:  ${surface}      (curate = note generation; stt = audio transcription)`,
    `Provider: ${failure.provider}`,
    `Kind:     ${failure.kind}`,
    `Window:   1 hour dedup (further failures of this exact (provider,kind,surface) suppressed for ~1h)`,
    ``,
    `Error detail (truncated):`,
    failure.detail || '(no message)',
    ``,
    `Suggested action:`,
    failure.kind === 'auth_failed'      ? '  → Rotate / re-issue the API key in AWS Secrets Manager (studyhelper/app), then redeploy or wait for next Lambda cold-start.' :
    failure.kind === 'quota_exhausted'  ? '  → Top up billing on the provider dashboard. Until then, every user is blocked from this surface.' :
    failure.kind === 'rate_limit'       ? '  → Check provider dashboard / alarm board. Often transient — escalate only if sustained for >10 min.' :
                                          '  → Check provider status page. Verify Lambda env, recent deploys.',
  ].join('\n')
  try {
    await snsClient().send(new PublishCommand({ TopicArn: topicArn, Subject: subject, Message: body }))
  } catch (e) {
    // Same philosophy as feedback.ts — don't 5xx the user just because
    // SNS is broken too. Log and let the handler keep going.
    // eslint-disable-next-line no-console
    console.warn('[upstream-alert] SNS publish failed:', e instanceof Error ? e.message : e)
  }
}

import { z } from 'zod'
import type { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { withAuth } from '../lib/with-auth.js'
import { loadModelDownloadSecrets, Env } from '../lib/env.js'
import { query, getPool } from '../lib/db.js'
import { parseLisnaUserAgent, compareSemver } from '../lib/user-agent.js'
import { evaluateModelDownloadFlag } from '../lib/feature-flag.js'
import { insertDownloadEvent } from '../lib/telemetry-models.js'
import { isWarmup, warmupResponse } from '../lib/warmup.js'

function json(status: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// ── Request body schema ───────────────────────────────────────────────────────

const ALLOWED_EVENT_TYPES = z.enum([
  'manifest.fetch.success', 'manifest.fetch.fail',
  'download.start', 'download.progress.tick', 'download.complete', 'download.fail', 'download.cancel',
  'sha.mismatch', 'recording_active_block',
  'license.accept', 'license.decline',
  'picker.fallback',
  'update_banner.show', 'update_banner.dismiss', 'update_banner.click',
  'vault_callout.show', 'vault_callout.set_now', 'vault_callout.later', 'vault_callout.auto_dismiss_14d',
  'models.sidecar.reload',
])

const EventBody = z.object({
  event: ALLOWED_EVENT_TYPES,
  event_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  device_id: z.string().uuid(),
  app_version: z.string(),
  os_family: z.string(),
  arch: z.enum(['arm64', 'x64']),
  source_intent: z.enum(['meeting', 'lecture', 'unset']).default('unset'),
  // Zod v4 z.record(valueType) is broken — must pass explicit key type.
  payload: z.record(z.string(), z.unknown()).default({}),
})

// ── Handler ───────────────────────────────────────────────────────────────────

const authed = withAuth(
  'models-download-event',
  async (event, payload): Promise<APIGatewayProxyResultV2> => {
    // Load the CDK-managed ModelDownloadSecret so ALLOWLIST_EMAILS is in
    // process.env before Env.parse() reads it. loadAppSecrets() already
    // ran inside withAuth for the operator-managed keys.
    await loadModelDownloadSecrets()
    const env = Env.parse(process.env)

    // 1. User-Agent parse — strict (no silent v1 fallback)
    const uaHeader = event.headers['user-agent'] ?? event.headers['User-Agent'] ?? ''
    const parsed = parseLisnaUserAgent(uaHeader)
    if (!parsed) {
      return json(400, { code: 'INVALID_USER_AGENT' })
    }

    // 2. App-version EOL gate
    const minParsed = parseLisnaUserAgent(`Lisna/v${env.MIN_SUPPORTED_APP_VERSION}`)
    if (minParsed && compareSemver(parsed, minParsed) < 0) {
      return json(410, {
        code: 'APP_VERSION_UNSUPPORTED',
        minimum: env.MIN_SUPPORTED_APP_VERSION,
      })
    }

    // 3. Resolve user email from DB for the feature-flag gate.
    const rows = await query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [payload.sub],
    )
    if (rows.length === 0) {
      return json(401, { error: 'user not found' })
    }
    const userEmail = rows[0].email

    // 4. Feature-flag gate
    const allowlistRaw = env.ALLOWLIST_EMAILS ?? ''
    const allowlistEmails = new Set(
      allowlistRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    const gate = evaluateModelDownloadFlag({
      flag: env.MODEL_DOWNLOAD_ENABLED,
      rolloutPct: env.MODEL_DOWNLOAD_ROLLOUT_PCT,
      userId: payload.sub,
      userEmail,
      allowlistEmails,
    })
    if (!gate.allowed) {
      return json(503, { code: gate.reason })
    }

    // 5. Parse + validate request body
    let rawBody: unknown
    try {
      rawBody = JSON.parse(event.body ?? '{}')
    } catch {
      return json(400, { code: 'INVALID_EVENT_BODY', detail: 'body is not valid JSON' })
    }

    const parseResult = EventBody.safeParse(rawBody)
    if (!parseResult.success) {
      return json(400, {
        code: 'INVALID_EVENT_BODY',
        detail: parseResult.error.issues,
      })
    }
    const body = parseResult.data

    // 6. Identity model (P2.2): resolve user_id if identify header present
    //    Header lookup is case-insensitive because API Gateway normalises to lowercase.
    const identifyHeader =
      event.headers['x-lisna-telemetry-identify'] ??
      event.headers['X-Lisna-Telemetry-Identify'] ??
      ''
    const userId = identifyHeader === '1' ? payload.sub : null

    // 7. Insert event
    const pool = await getPool()
    await insertDownloadEvent(pool, {
      event_id: body.event_id,
      device_id: body.device_id,
      user_id: userId,
      timestamp: new Date(body.timestamp),
      event_type: body.event,
      app_version: body.app_version,
      os_family: body.os_family,
      arch: body.arch,
      source_intent: body.source_intent,
      payload: body.payload,
    })

    // 8. 204 No Content
    return { statusCode: 204, body: '' }
  },
)

export const handler: APIGatewayProxyHandlerV2 = async (event, ctx, cb) => {
  if (isWarmup(event)) return warmupResponse()
  return (await authed(event, ctx, cb)) as APIGatewayProxyResultV2
}

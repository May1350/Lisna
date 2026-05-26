import type { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { withAuth } from '../lib/with-auth.js'
import { loadAppSecrets, Env } from '../lib/env.js'
import { query } from '../lib/db.js'
import { parseLisnaUserAgent, compareSemver } from '../lib/user-agent.js'
import { evaluateModelDownloadFlag } from '../lib/feature-flag.js'
import { loadAndSignManifest } from '../lib/manifest-loader.js'
import { isWarmup, warmupResponse } from '../lib/warmup.js'

function json(status: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

const authed = withAuth(
  'models-manifest',
  async (event, payload): Promise<APIGatewayProxyResultV2> => {
    // Read typed env — loadAppSecrets() already ran inside withAuth.
    const env = Env.parse(process.env)

    // 1. User-Agent parse — strict (no silent v1 fallback per spec §2.2.1)
    const uaHeader = event.headers['user-agent'] ?? event.headers['User-Agent'] ?? ''
    const parsed = parseLisnaUserAgent(uaHeader)
    if (!parsed) {
      return json(400, { code: 'INVALID_USER_AGENT' })
    }

    // 2. App-version EOL gate: client major.minor.patch < MIN_SUPPORTED → 410
    const minParsed = parseLisnaUserAgent(`Lisna/v${env.MIN_SUPPORTED_APP_VERSION}`)
    if (minParsed && compareSemver(parsed, minParsed) < 0) {
      return json(410, {
        code: 'APP_VERSION_UNSUPPORTED',
        minimum: env.MIN_SUPPORTED_APP_VERSION,
      })
    }

    // 3. Resolve user email from DB (JWT only carries sub + plan; email lives in users table).
    //    Same pattern as auth-me: single row lookup by users.id.
    const rows = await query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [payload.sub],
    )
    if (rows.length === 0) {
      // Shouldn't happen for a valid JWT, but guard against deleted accounts.
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

    // 5. Build and return signed manifest
    const manifest = await loadAndSignManifest({
      r2: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
        bucket: env.R2_BUCKET!,
        endpoint: env.R2_ENDPOINT_URL!,
      },
      urlTtlSec: 3600,
    })
    return json(200, manifest)
  },
)

export const handler: APIGatewayProxyHandlerV2 = async (event, ctx, cb) => {
  if (isWarmup(event)) return warmupResponse()
  return (await authed(event, ctx, cb)) as APIGatewayProxyResultV2
}

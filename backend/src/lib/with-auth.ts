import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { verifyJwt, type JwtPayload } from './auth.js'
import { loadAppSecrets } from './env.js'

export type AuthedHandler = (
  event: APIGatewayProxyEventV2,
  payload: JwtPayload,
) => Promise<APIGatewayProxyResultV2>

/**
 * Centralises the 5-line Bearer/verifyJwt boilerplate that every JWT-
 * authed Lambda used to hand-roll. Pre-Phase-5e each handler
 * duplicated:
 *
 *     await loadAppSecrets()
 *     const auth = event.headers.authorization || event.headers.Authorization
 *     if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: '…' }
 *     let payload
 *     try { payload = await verifyJwt(auth.slice(7)) }
 *     catch { return { statusCode: 401, body: '…' } }
 *
 * Twelve copies of those five lines was the largest drift surface in
 * the handlers/ directory — one copy quietly diverged (auth-me added
 * richer diagnostic warns, others stayed sparse), and the next JWT
 * rotation would have re-incurred the same per-handler debug cost.
 *
 * Diagnostic logging — TWO distinct console.warns, keyed on the
 * caller-supplied `name`. We KEEP both lines (rather than silencing)
 * because Phase 4's GOOGLE_OAUTH_CLIENT_ID multi-aud rollout was
 * bisected from CloudWatch specifically because path-1 (no Bearer)
 * and path-2 (verifyJwt threw) had distinct log keys. The next
 * secret rotation will need the same split.
 *
 * `await loadAppSecrets()` runs INSIDE the wrapper because verifyJwt
 * reads `JWT_SECRET` from process.env, which is populated only after
 * the secret bundle loads. loadAppSecrets is idempotent + module-
 * scope-cached (lib/env.ts), so calling it once per invocation
 * (even on warm containers) is a single cache-hit check.
 *
 * Error body shape — always JSON `{ error: 'unauthorized' | 'invalid token' }`.
 * Matches auth-me's pre-5e shape; the SW unwrapper at
 * extension/src/service-worker/messaging.ts already accepts both JSON
 * and plain text via a try/catch JSON.parse fall-through.
 *
 * NOT in scope: ws-connect.ts uses a `?token=` query param (WS upgrade
 * flow can't carry custom Authorization headers reliably). That auth
 * path stays hand-rolled.
 */
export function withAuth(name: string, fn: AuthedHandler): APIGatewayProxyHandlerV2 {
  return async (event) => {
    await loadAppSecrets()
    const auth = event.headers.authorization || event.headers.Authorization
    if (!auth?.startsWith('Bearer ')) {
      // eslint-disable-next-line no-console
      console.warn(`[withAuth/${name}] 401 unauthorized: no Bearer header`, {
        hasAuth: !!auth,
        authPrefix: auth?.slice(0, 16),
        hostHeader: event.headers.host,
      })
      return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) }
    }
    let payload: JwtPayload
    try {
      payload = await verifyJwt(auth.slice(7))
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[withAuth/${name}] 401 invalid: verifyJwt threw`, {
        err: e instanceof Error ? e.message : String(e),
        tokenLen: auth.slice(7).length,
      })
      return { statusCode: 401, body: JSON.stringify({ error: 'invalid token' }) }
    }
    return fn(event, payload)
  }
}

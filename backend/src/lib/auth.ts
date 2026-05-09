import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { SignJWT, jwtVerify } from 'jose'
import { ZodError } from 'zod'
import { isWarmup, warmupResponse } from './warmup.js'
import { loadAppSecrets } from './env.js'

export interface JwtPayload {
  sub: string         // user_id
  plan: 'free' | 'pro'
  iat?: number
  exp?: number
}

function getSecret(): Uint8Array {
  const s = process.env.JWT_SECRET
  if (!s || s.length < 32) throw new Error('JWT_SECRET missing or too short')
  return new TextEncoder().encode(s)
}

export async function signJwt(
  payload: Pick<JwtPayload, 'sub' | 'plan'>,
  ttlSeconds: number
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(getSecret())
}

export async function verifyJwt(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
  if (typeof payload.sub !== 'string') throw new Error('Invalid token: missing sub')
  return payload as unknown as JwtPayload
}

export async function verifyGoogleIdToken(idToken: string): Promise<{
  sub: string
  email: string
  name?: string
  email_verified?: boolean
}> {
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken))
  if (!res.ok) throw new Error('Google tokeninfo failed: ' + res.status)
  const data = await res.json() as Record<string, string>
  if (data.aud !== process.env.GOOGLE_OAUTH_CLIENT_ID) {
    throw new Error('Token aud mismatch')
  }
  if (data.email_verified !== 'true') {
    throw new Error('Google email not verified')
  }
  return {
    sub: data.sub,
    email: data.email,
    name: data.name,
    email_verified: data.email_verified === 'true',
  }
}

/**
 * Verify a Google OAuth access token (the format chrome.identity.getAuthToken
 * returns). Two checks:
 *   1. tokeninfo confirms the access token is real and tells us its `aud`
 *      (the OAuth client it was issued for). Reject if it's not our client.
 *   2. userinfo gives us the actual user identity. tokeninfo doesn't return
 *      sub/email/name for access tokens, so we need this second call.
 * Both Google endpoints are independent — fired in parallel to halve
 * latency (~150 ms serial → ~75 ms).
 */
export async function verifyGoogleAccessToken(accessToken: string): Promise<{
  sub: string
  email: string
  name?: string
  email_verified?: boolean
}> {
  const [tokenInfo, userInfo] = await Promise.all([
    fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(accessToken)),
    fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  ])
  if (!tokenInfo.ok) throw new Error('Google tokeninfo failed: ' + tokenInfo.status)
  const ti = await tokenInfo.json() as Record<string, string>
  const expectedClient = process.env.GOOGLE_OAUTH_CLIENT_ID
  // Chrome's getAuthToken issues against the manifest's oauth2.client_id,
  // which is a Chrome-extension-type client — this MUST be the same client
  // ID we configured in the backend. If you see a "client mismatch" error in
  // production it means the operator forgot to add the Chrome ext client to
  // GOOGLE_OAUTH_CLIENT_ID (it can be a comma-separated list of accepted aud).
  if (expectedClient && !expectedClient.split(',').includes(ti.aud)) {
    throw new Error('Token aud mismatch')
  }
  if (!userInfo.ok) throw new Error('Google userinfo failed: ' + userInfo.status)
  const ui = await userInfo.json() as Record<string, string | boolean>
  if (ui.email_verified !== true && ui.email_verified !== 'true') {
    throw new Error('Google email not verified')
  }
  return {
    sub: ui.sub as string,
    email: ui.email as string,
    name: ui.name as string | undefined,
    email_verified: true,
  }
}

// =============================================================
// withAuth — handler wrapper that consolidates the boilerplate
// every authenticated route was repeating verbatim:
//   1. warmup short-circuit
//   2. loadAppSecrets() so env-from-secrets is materialised
//   3. extract Authorization: Bearer
//   4. verify JWT
//   5. on failure return 401 (uniform error shape)
//
// The wrapped handler receives `payload` as a third arg so it
// doesn't need to repeat the auth dance. Returning the inner
// handler's value is unchanged — it's still a normal Lambda
// proxy result. Routes that don't need auth (health, auth-google,
// stripe-webhook) keep their plain handler signatures.
//
// Adopting this in every authed handler removed ~6 lines of
// boilerplate × 7 handlers = ~40 lines of duplicated code, and
// it guarantees a consistent 401 response shape across the API.
// =============================================================
// Generic over the inner handler's return so each consumer's return
// statements aren't unified into a too-strict shape — TS would
// otherwise produce `headers?: undefined` slots from branches that
// omit `headers`, which conflict with APIGatewayProxyStructuredResultV2's
// `[header: string]: string | number | boolean` index signature.
// Letting the inner type be `T extends APIGatewayProxyResultV2` keeps
// the structural typing while matching whatever the handler returns.
export function withAuth<T extends APIGatewayProxyResultV2>(
  inner: (event: APIGatewayProxyEventV2, payload: JwtPayload) => Promise<T>,
): APIGatewayProxyHandlerV2 {
  return async (event) => {
    if (isWarmup(event)) return warmupResponse()
    await loadAppSecrets()
    const auth = event.headers.authorization || event.headers.Authorization
    if (!auth?.startsWith('Bearer ')) {
      // JSON body so the SW's API_FETCH consumer (which JSON.parses
      // every response and exposes the parsed object as `data`) sees
      // a structured error rather than the raw string. Keeps the
      // 401 shape consistent with auth-google's 400/401 returns.
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'unauthorized' }),
      }
    }
    let payload: JwtPayload
    try { payload = await verifyJwt(auth.slice(7)) }
    catch {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'invalid_token' }),
      }
    }
    try {
      return await inner(event, payload)
    } catch (e) {
      // ZodError — body validation failed. Surface as 400 with the
      // first issue's message so the client can fix the request.
      // The previous behaviour (raw throw) returned 500 "Internal
      // Server Error" via Lambda's default error wrapper, which made
      // misshaped client requests look like backend bugs.
      if (e instanceof ZodError) {
        const issue = e.issues[0]
        // eslint-disable-next-line no-console
        console.warn('[withAuth] zod validation failed:', issue?.path, issue?.message)
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'invalid_request',
            field: issue?.path?.join('.'),
            message: issue?.message,
          }),
        }
      }
      // Any other error — re-throw so Lambda's runtime captures the
      // stack trace in CloudWatch and API Gateway returns 502.
      throw e
    }
  }
}

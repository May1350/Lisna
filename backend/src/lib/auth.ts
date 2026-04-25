import { SignJWT, jwtVerify } from 'jose'

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

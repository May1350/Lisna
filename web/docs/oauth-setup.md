# OAuth provider setup runbook

## Google

1. Go to https://console.cloud.google.com/apis/credentials
2. Create OAuth 2.0 Client ID — Application type: Web application
3. Name: "Lisna web (production)"
4. **Authorized JavaScript origins:**
   - `https://lisna.jp`
   - `http://localhost:3000` (development)
5. **Authorized redirect URIs:**
   - `https://lisna.jp/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`
6. Copy Client ID → `GOOGLE_CLIENT_ID`
7. Copy Client secret → `GOOGLE_CLIENT_SECRET`

## GitHub

1. Go to https://github.com/settings/developers → OAuth Apps → New OAuth App
2. Name: "Lisna"
3. Homepage URL: `https://lisna.jp`
4. Authorization callback URL: `https://lisna.jp/api/auth/callback/github`
5. Generate a client secret
6. Copy Client ID → `GITHUB_CLIENT_ID`
7. Copy Client secret → `GITHUB_CLIENT_SECRET`

(Create a separate OAuth app for development with `http://localhost:3000` URLs if you want local OAuth smoke.)

## Apple

Apple Sign-In requires:
- Apple Developer Program enrollment (separate side track)
- App ID with "Sign in with Apple" capability
- Services ID with `lisna.jp` and `https://lisna.jp/api/auth/callback/apple` configured
- A signing key (.p8) for generating the client secret JWT

This is deferred until Apple Developer Program enrollment lands. See Apple's docs: https://developer.apple.com/documentation/sign_in_with_apple

Once provisioned:
- `APPLE_CLIENT_ID` = Services ID identifier (e.g., `jp.lisna.signin`)
- `APPLE_CLIENT_SECRET` = JWT generated from the .p8 key (script: `web/scripts/generate-apple-secret.ts` — to be added when Apple enrollment lands)

## Vercel env wiring

Once values are in hand, set them in Vercel:

```bash
vercel env add GOOGLE_CLIENT_ID production
vercel env add GOOGLE_CLIENT_SECRET production
vercel env add GITHUB_CLIENT_ID production
vercel env add GITHUB_CLIENT_SECRET production
# Apple deferred
```

Pull to `.env.local` for local dev:

```bash
vercel env pull web/.env.local
```

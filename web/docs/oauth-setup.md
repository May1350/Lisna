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

## Resend domain verification (lisna.jp)

Required so transactional email (magic-link sign-in via Auth.js EmailProvider) can send from `auth@lisna.jp` without landing in spam folders. Founder-operational; the doc below is the runbook future-you (or another maintainer) needs.

### 1. Add the domain in the Resend dashboard

1. Go to https://resend.com/domains
2. Click **Add Domain** → enter `lisna.jp`
3. Resend generates a set of DNS records:
   - **SPF** (TXT on `@`)
   - **DKIM** (3 × CNAME — record names look like `resend._domainkey.lisna.jp` and two more numbered ones)
   - **DMARC** (TXT on `_dmarc`)

Leave the Resend dashboard tab open — you'll come back to verify.

### 2. Add the DNS records on お名前.com

1. Sign in to https://www.onamae.com/ → ドメイン → DNS設定/転送設定 → select `lisna.jp` → DNSレコード設定を利用する
2. For each record Resend provided, add a row:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| TXT  | `@`  | `v=spf1 include:resend.dev ~all` | 3600 |
| CNAME | `resend._domainkey` | (value from Resend dashboard) | 3600 |
| CNAME | (Resend's 2nd selector) | (value from Resend dashboard) | 3600 |
| CNAME | (Resend's 3rd selector) | (value from Resend dashboard) | 3600 |
| TXT  | `_dmarc` | `v=DMARC1; p=none;` | 3600 |

Click **確認画面へ進む** → **設定する**. Propagation usually completes within a few minutes; Resend's verification badge can take 5-30 min.

**NOTE on existing SPF:** if `lisna.jp` already has an SPF TXT record (e.g. for Google Workspace), do NOT add a second SPF record — merge into one. SPF policy says a domain can have only one SPF TXT record; multiple records result in a `permerror` at the receiving server. Example merge: `v=spf1 include:_spf.google.com include:resend.dev ~all`.

### 3. Verify + send a test

Once Resend's dashboard shows the domain as **Verified**:

```bash
cd /Users/guntak/Lisna/.claude/worktrees/web-redesign/web
# Make sure RESEND_API_KEY is in .env.local (from Task 75 vercel env pull)
pnpm exec tsx -e "
import { Resend } from 'resend';
const r = new Resend(process.env.RESEND_API_KEY);
const { data, error } = await r.emails.send({
  from: 'auth@lisna.jp',
  to: 'YOUR_REAL_INBOX@example.com',  // replace
  subject: 'Lisna Resend smoke',
  text: 'verification smoke',
});
console.log({ data, error });
"
```

Expected: `data` has an email id, `error` is null. Email arrives within seconds at the target inbox.

If the email lands in spam: re-check DMARC alignment + DKIM signing. Resend's dashboard "Activity → click the message" view shows the raw headers; the `Authentication-Results` line at the recipient end should show `spf=pass`, `dkim=pass`, `dmarc=pass`.

### 4. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Resend dashboard never flips to "Verified" | Wrong record value pasted | Compare DNS record values against Resend dashboard char-by-char |
| Test email returns `error: { name: 'validation_error', message: 'lisna.jp is not verified' }` | Domain not yet verified | Wait 5-30 min and retry |
| Test email returns 200 but never arrives | SPF mismatch or DMARC reject | Check spam folder; if not there, inspect `Authentication-Results` in raw headers |
| `permerror` in receiving server's SPF check | Two SPF TXT records on `lisna.jp` | Merge into one record (see NOTE in step 2) |

### 5. Production wiring

Once verified, set `RESEND_API_KEY` in Vercel (Task 75 Step 2 if not already done):

```bash
cd web && vercel env add RESEND_API_KEY production
# paste the API key from https://resend.com/api-keys
```

Auth.js's EmailProvider then sends magic-link emails through Resend's transactional API at `auth@lisna.jp`. The full sign-in smoke covers this end-to-end (Phase O Task 78).

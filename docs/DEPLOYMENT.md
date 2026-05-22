# Study-Helper — Deployment Checklist

**Last updated**: 2026-05-01
**Status**: Pre-launch (private beta)

This is the operator-facing pre-launch checklist. Items grouped by
**owner** so the human (you) can do A in parallel with whatever
software changes I queue up.

---

## A. Operator-only (you do these)

### A1. Stripe live keys

The current backend is wired to Stripe **test** keys (`rk_test_...`).
Before charging real users:

1. Activate the Stripe account: <https://dashboard.stripe.com/settings/account>
2. Create the **production** product + price for the Pro plan.
3. Copy the live secret key (`sk_live_...`) and webhook secret.
4. Update both in AWS Secrets Manager (`studyhelper/app`):
   - `STRIPE_SECRET_KEY` → `sk_live_...`
   - `STRIPE_WEBHOOK_SECRET` → `whsec_live_...`
   - `STRIPE_PRICE_PRO` → `price_<live id>`
5. Verify: a test purchase in production using a real card flips
   `users.plan` to `pro` in the DB.

> ⚠️ The current AppSecret has `STRIPE_WEBHOOK_SECRET: TEMP_PLACEHOLDER_TO_BE_UPDATED` — webhooks WILL FAIL until this is replaced.

### A2. Chrome Web Store registration

1. Pay the one-time $5 developer fee.
   <https://chrome.google.com/webstore/devconsole>
2. Verify identity (Google).
3. Create a new item, upload `extension/dist/` zipped.
4. Fill listing:
   - Short description (current `manifest.config.ts` value)
   - Detailed description (lecture-note + Obsidian integration story)
   - Screenshots (5 recommended, 1280×800):
     - Idle inline button on a video page
     - Modal with live transcript
     - Modal with curated outline + slides
     - Export menu (.zip / .html / Obsidian)
     - Options page (with Obsidian section)
   - Promo tile (440×280) and marquee (1400×560) — optional but recommended
   - Privacy policy URL: `https://<your-domain>/privacy`
   - Support email
5. Privacy practices form: declare data collection (PII = email,
   non-PII = audio for processing only).
6. Submit for review (typically 3-7 business days).

### A3. CORS lockdown post-publish

Once the published extension has its stable ID:

```bash
cd backend
pnpm cdk deploy StudyHelperApi -c allowedCorsOrigins=chrome-extension://<published-id>
```

This narrows API access from `*` to your extension only — closes a
token-replay vector where a stolen JWT could be used from a third-
party page.

Also update the S3 bucket CORS allow-origins similarly via
`StudyHelperData` redeploy with a new prop, OR via the AWS console
manually.

### A4. Operator info for legal pages

The legal pages use `[TODO:...]` placeholders for your business info.
Edit these files with real values before public launch:

- `web/src/app/[locale]/tokusho/page.tsx` (operator name, address, phone)
- `web/src/app/[locale]/page.tsx` (Pro plan price)

`所在地` and `電話番号` can be left as "請求に応じて開示" if you don't
have a public business address yet — the law allows this for
individual sellers.

### A5. Support email + domain

Decide:
- Use `takgun.jr@gmail.com` for now and update later, OR
- Buy a domain (e.g. `study-helper.app`), set up email at it.

Update all `[support@study-helper.app(仮)]` references in:
- `web/src/app/[locale]/privacy/page.tsx`
- `web/src/app/[locale]/terms/page.tsx`
- `web/src/app/[locale]/tokusho/page.tsx`

### A6. (Optional) Custom domain for API

The current backend lives at `https://p53z148cv5.execute-api.ap-northeast-1.amazonaws.com`.
That works but is unmemorable. If you want `api.study-helper.app`:
1. Register the domain (Route 53 or external).
2. Request an ACM certificate (us-east-1 for CloudFront, ap-northeast-1
   for API Gateway).
3. Add a custom-domain mapping in API Gateway pointing to the HTTP API.
4. Update extension's `API_BASE_URL` in `extension/.env.production`.

Defer until post-launch unless required for branding.

---

## B. Software-side (I've done / can do)

### Done in this round

- ✅ Privacy policy expanded (APPI compliant, AI provider transparency)
- ✅ Terms of service expanded (AI disclaimer, refunds, jurisdiction)
- ✅ 特定商取引法に基づく表記 page added (Japan paid-service requirement)
- ✅ Landing page rewritten (features, plans, privacy summary)
- ✅ React ErrorBoundary wraps modal — no more silent crashes
- ✅ Slide-detector verbose log gated (was 3600 lines/hour, now <50)
- ✅ Manifest description tightened for Web Store search
- ✅ Obsidian REST API integration shipped
- ✅ Session history (side-panel)
- ✅ Real-time quota counter in modal header (Free plan)
- ✅ Slide replay-dedup (no more duplicate slides on re-watch)

### Recommended before public launch

- [ ] Bundle-size pass — split or trim the 200 KB `side-panel-*.js` if it grows further
- [ ] Add health-check Lambda alarm in CloudWatch (5xx rate, p99 latency)
- [ ] Add Stripe webhook idempotency guard (prevent double plan upgrades)
- [ ] Soak-test a 2-hour lecture end-to-end (verify quota tick, slide
      dedup, curate cooldown, WS stability)

### Nice-to-have post-launch

- [ ] E2E test with Playwright (login → capture → curate → export)
- [ ] Sentry error reporting (right now we only have console logs)
- [ ] Anki integration (card-deck export)
- [ ] Custom Obsidian plugin (renders modal inside Obsidian itself)

---

## Pre-deploy verification

Before each `cdk deploy`:

```bash
# Backend tests (5 files, ~17 tests)
cd backend && pnpm test

# Extension build (verify bundle clean)
cd ../extension && pnpm build

# Web build
cd ../web && pnpm build

# CDK synth (catches IAM / config drift)
cd ../backend && pnpm cdk synth StudyHelperApi >/dev/null
```

If all green: `pnpm cdk deploy --all --require-approval never` from
`backend/`.

For extension, reload `dist/` in `chrome://extensions` for local
testing; full Web Store re-publish for production users.

---

## Rollback

CDK stacks: `pnpm cdk deploy <Stack> --rollback` reverts to last
known-good state in CloudFormation.

Extension: Web Store publishing is one-way per version, but
unpublishing the listing immediately stops new installs. Existing
users keep the version they installed until the next update.

DB: 7-day automated backup retention on RDS. Point-in-time restore
via AWS console if needed.

---

## Post-launch monitoring (first 30 days)

Daily check:
- CloudWatch error rate (target < 1% of requests)
- Stripe successful checkouts (target > 0 once you have users)
- DB connection pool health (max:2 — investigate if exhausted)

Weekly:
- Quota usage distribution (if Free hits 100% en masse, consider raising)
- LLM cost per active user (target < ¥50/month for free tier)

Monthly:
- Curator quality eval (run `pnpm tsx scripts/eval-curator.ts` against
  the saved fixtures, compare against previous month's baseline)

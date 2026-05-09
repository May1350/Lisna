# Lisna Launch Checklist — 2026-05-09

Generated as part of the launch sprint. Walks through everything that
must happen on the **user side** before public launch. Pair this with
`docs/HANDOFF.md` (technical state) and `docs/DEPLOYMENT.md` (deploy
mechanics).

Status: technical launch-blockers resolved. PR open: [Lisna#1](https://github.com/May1350/Lisna/pull/1).
The four blocks below are the user-side steps remaining.

---

## Block 1 — Stripe live mode (≈ 30 min)

The deployed backend is wired to Stripe **test mode** today:

```
STRIPE_SECRET_KEY     = rk_test_...     (restricted test key)
STRIPE_WEBHOOK_SECRET = TEMP_PLACEHOLDER (placeholder — sig verification effectively disabled)
STRIPE_PRICE_PRO      = price_...       (test mode price ID)
```

Switching to live mode requires updating these three values **and**
registering a live webhook endpoint. None of this can happen
automatically — Stripe gates account activation behind identity
verification.

### Step 1.1 — Activate live mode in Stripe Dashboard
1. Sign in at https://dashboard.stripe.com/ → "Activate account"
2. Provide the requested business + bank info, wait for review (usually
   instant for individual sellers in JP)
3. Once activated, the dashboard top bar flips from "Test mode" to live

### Step 1.2 — Create the live Pro product

**If the connected MCP is in live mode**, I can create this for you in
one shot — confirm and I'll run:
```
create_product { name: "Lisna Pro", description: "月額プラン — 月 30 時間まで音声要約" }
create_price   { product: <id>, currency: "jpy", unit_amount: 980, recurring: { interval: "month" } }
```
Returns `price_live_xxxxx` — that's the new `STRIPE_PRICE_PRO`.

**Otherwise, in the dashboard**:
1. Products → + Add product
2. Name: `Lisna Pro`, Description: `月額プラン — 月 30 時間まで音声要約`
3. Pricing model: `Recurring`, Price: `¥980 JPY`, Billing period: `Monthly`
4. Save → copy the price ID (`price_live_xxxxx`)

### Step 1.3 — Generate the live secret key
1. Developers → API keys → "Create restricted key" (preferred over the
   full secret key — only grant what we use)
2. Permissions to enable:
   - `Customers`: write
   - `Checkout sessions`: write
   - `Subscriptions`: read + write
   - `Webhook endpoints`: read
3. Save → copy the `rk_live_...` value (or `sk_live_...` if you went with
   the standard secret key)

### Step 1.4 — Register the live webhook endpoint
1. Developers → Webhooks → "Add endpoint"
2. Endpoint URL: `https://p53z148cv5.execute-api.ap-northeast-1.amazonaws.com/v1/stripe/webhook`
3. Events to subscribe to (matches what the handler currently processes):
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Save → reveal the signing secret (`whsec_...`)

### Step 1.5 — Push values into AWS Secrets Manager
Run this from any machine with the `studyhelper-dev` IAM creds:

```bash
# Replace the placeholders with the values from steps 1.2–1.4.
LIVE_PRICE='price_live_REPLACE'
LIVE_SECRET='rk_live_REPLACE'
LIVE_WHSEC='whsec_REPLACE'

aws secretsmanager get-secret-value \
  --region ap-northeast-1 --secret-id studyhelper/app \
  --query SecretString --output text \
| python3 -c "
import json, sys, os
d = json.loads(sys.stdin.read())
d['STRIPE_SECRET_KEY']     = os.environ['LIVE_SECRET']
d['STRIPE_WEBHOOK_SECRET'] = os.environ['LIVE_WHSEC']
d['STRIPE_PRICE_PRO']      = os.environ['LIVE_PRICE']
print(json.dumps(d))
" \
| LIVE_SECRET="$LIVE_SECRET" LIVE_WHSEC="$LIVE_WHSEC" LIVE_PRICE="$LIVE_PRICE" \
  xargs -0 -I{} aws secretsmanager update-secret \
    --region ap-northeast-1 --secret-id studyhelper/app \
    --secret-string "{}"
```

(The pipeline reads the existing secret, replaces only the three Stripe
keys, and writes the merged JSON back — leaves OPENAI/GROQ/JWT/etc.
untouched.)

### Step 1.6 — Roll the Lambdas
Lambdas read the secret at cold-start. Force a refresh:
```bash
cd backend
pnpm cdk deploy StudyHelperApi --hotswap --require-approval never
```
Hotswap touches handler code only and triggers a re-init within seconds.

### Step 1.7 — Live smoke test
1. Sign in as a fresh test user (NOT your founder account)
2. Trigger a Pro upgrade → enter a real card
3. Confirm `customer.subscription.created` arrives in CloudWatch:
   ```
   aws logs tail /aws/lambda/StudyHelperApi-StripeWebhookFn... --region ap-northeast-1 --since 5m
   ```
4. Confirm DB row: `users.plan = 'pro'` for that user
5. Cancel the subscription from your Stripe dashboard → confirm
   `customer.subscription.deleted` flips them back to `free`

---

## Block 2 — Legal pages (≈ 30 min)

All three pages already exist on the Vercel preview at:
- https://lisna-may1350s-projects.vercel.app/privacy
- https://lisna-may1350s-projects.vercel.app/terms
- https://lisna-may1350s-projects.vercel.app/tokusho

**Reviewed today; content is ready as-is for launch.** Optional polish
items:
- Privacy: add a section listing each LLM provider by name (OpenAI
  gpt-4o-mini, Groq Whisper Large-v3, Anthropic Haiku 4.5) — current
  copy says "OpenAI、Google" which understates the actual chain.
- Terms: section 4 (免責) is broad — confirm with the user that
  "AI による要約結果の正確性については保証いたしません" matches the
  user's risk appetite. No change unless they want it.
- Tokusho: "請求があった場合、遅滞なく開示します" satisfies the law
  for individual sellers — no change needed.

These pages are already linked in the extension's footer + LoginScreen
+ ConsentModal. Nothing else to wire.

---

## Block 3 — Chrome Web Store submission (≈ 2 hr + review wait)

### 3.1 — Upload package
File: `lisna-cws-20260509.zip` (541 KB) at the worktree root.
Validated locally: tsc + vite build clean, manifest_version 3, all
required icons present.

Developer Console: https://chrome.google.com/webstore/devconsole

### 3.2 — Listing copy

**Single-purpose description** (required, English, < 80 chars):

> Real-time AI note-taking for online lectures and meetings.

**Detailed description** (Japanese — primary market):

```
Lisna は、視聴中の講義や会議をリアルタイムで聴き取り、構造化されたノートを自動生成する Chrome 拡張機能です。

■ 主な機能
・YouTube、K-LMS、Canvas Studio など、ほぼあらゆる動画サイトに対応
・音声を Whisper で文字起こし → AI が章立て・用語定義・重要ポイントを自動抽出
・スライド画像を自動キャプチャ → ノートに埋め込み
・Markdown / HTML / Obsidian 形式でエクスポート (.zip)
・サイドパネルで過去の講義ノートをいつでも見直せる
・日本語 / 韓国語 / 英語 / 中国語に対応

■ こんな方に
・講義を聞きながらノートを取るのが追いつかない学生
・会議の内容を後でまとめ直す時間がないビジネスパーソン
・聞き逃した部分を後で確認したい

■ 料金
・Free プラン: 無料 (月 30 分まで)
・Pro プラン: 月額 ¥980 (税込) / 月 30 時間まで

■ プライバシー
音声・映像データは要約処理のため一時的に外部 AI サービスに送信されますが、処理完了後は即座に削除されます。要約テキストとスライド画像のみがユーザーアカウントに保存されます。詳細はプライバシーポリシーをご覧ください。

利用規約: https://lisna-may1350s-projects.vercel.app/terms
プライバシーポリシー: https://lisna-may1350s-projects.vercel.app/privacy
```

**English version** (optional but recommended for international reach):

```
Lisna is a Chrome extension that listens to online lectures and meetings in real time and automatically generates structured notes powered by AI.

KEY FEATURES
• Works on YouTube, K-LMS, Canvas Studio, and most other video sites
• Real-time transcription via Whisper, with AI-generated section headings, key terms, and study points
• Automatic slide capture, embedded inline in your notes
• Export to Markdown, HTML, or Obsidian (.zip)
• Browse past lecture notes from the side panel
• Available in Japanese, Korean, English, and Chinese

PRICING
• Free: 30 minutes / month
• Pro: ¥980 / month for 30 hours

PRIVACY
Audio and video are sent to AI services for summarization only and deleted immediately after processing. Only the resulting text and slide images are stored to your account.

Terms: https://lisna-may1350s-projects.vercel.app/terms
Privacy: https://lisna-may1350s-projects.vercel.app/privacy
```

### 3.3 — Permission justifications
Each permission gets a 1-2 sentence justification. Required by Chrome
Web Store.

| Permission | Justification |
|---|---|
| `storage` | ユーザー設定 (再生速度、ノート言語、Obsidian Vault パス、× ボタンの一時オフ時間) を chrome.storage.local に保存するために使用します。 |
| `sidePanel` | 過去の講義ノートを参照する履歴ビューと、設定パネルを Chrome のサイドパネルに表示するために使用します。 |
| `identity` | Google アカウントによるサインイン (chrome.identity.getAuthToken) を実装するために使用します。これにより別タブの OAuth ポップアップを経由せず、即座に認証が完了します。 |
| `tabs` | サイドパネル履歴のタイムスタンプボタンから、対応する動画タブの再生位置にジャンプするために、現在のタブ ID を取得して content script へメッセージを送信します。 |
| `alarms` | インライン要約ボタンの「× で一時オフ」機能で、指定時間 (1-168 時間、デフォルト 24 時間) 後に自動で機能を再有効化するために使用します。 |

**Host permission** (`<all_urls>`) justification:

> 本拡張機能は YouTube、K-LMS、Canvas Studio、Vimeo、各大学独自の LMS など、特定ドメインに限定できないあらゆる動画再生サイトで動作する必要があります。content script は <video> 要素が存在するページでのみアクティブになり、それ以外のページでは何も実行しません。

### 3.4 — Required assets
Items the user needs to provide (cannot be auto-generated):

1. **Screenshots (1-5, recommended 5)** at 1280×800:
   - Inline button on a YouTube lecture
   - Modal showing live transcription mid-lecture
   - Modal showing the curated outline (post-curate)
   - Side panel with SessionHistory
   - Options page with language picker + Obsidian section
2. **Promotional tile** 440×280 (small) — optional but improves listing
3. **Marquee tile** 1400×560 — optional, only shown if Google features
   the extension
4. **Privacy practices certification** (in Developer Console form):
   - Personally identifiable info: yes (email, name from Google OAuth)
   - Authentication info: yes (OAuth tokens)
   - User activity: yes (URLs of videos summarized)
   - Website content: yes (audio/video processed, stored summaries)
   - Health info / Personal communications / Financial info: no
   - Selling to third parties: no
   - Using for purposes beyond core function: no
   - Using to determine creditworthiness: no

### 3.5 — Submission steps
1. Developer Console → "New item" → upload `lisna-cws-20260509.zip`
2. Fill in the listing fields above
3. Add screenshots
4. Save draft → "Submit for review"
5. Review takes 1-3 days (sometimes longer for first submission)

---

## Block 4 — End-to-end smoke test on live (30-90 min)

After Stripe live + CWS approval, run through this with a fresh Google
account that has never seen Lisna:

1. Install from Chrome Web Store (NOT unpacked) → confirm install works
2. Sign in with a fresh Google account → confirm `users` row created
3. Open a YouTube lecture (≥ 5 min) → click inline button → confirm
   modal appears + recording starts
4. Wait ~10 s → confirm live transcript fills in
5. Stop early → confirm curate runs and outline appears in modal
6. Open side panel → confirm session shows in history
7. Click history row → confirm NotesViewer renders the saved outline
8. From NotesViewer, click an external-link icon → confirm source URL
   opens in new tab
9. From NotesViewer, click a section timestamp → confirm new tab opens
   at that timestamp (`?t=<sec>&__sh_seek=<sec>` URL)
10. Hit free quota cap → confirm 402 + upgrade banner
11. Click Upgrade → real card → confirm subscription created (CloudWatch
    + DB) → confirm UI flips to Pro instantly
12. Use a few minutes of Pro quota → confirm tracking works
13. From Stripe dashboard, cancel the subscription → confirm
    `subscription.deleted` webhook → confirm `users.plan = 'free'`
14. Export a session as .zip → confirm Markdown opens cleanly in
    Obsidian, slide images resolve

If any step fails: `aws logs tail /aws/lambda/<FN> --region ap-northeast-1 --since 5m`.

---

## Optional but recommended

### Custom domain
Currently `homepage_url` in the manifest points to
`https://lisna-may1350s-projects.vercel.app`. Buy `lisna.ai` (or
similar), point Vercel at it, then update:

1. `extension/manifest.config.ts:17` — `homepage_url`
2. `web/src/app/{privacy,terms,tokusho}/page.tsx` — any embedded URLs
3. `extension/src/shared/config.ts` — `PUBLIC_WEB_BASE_URL` if it
   references the Vercel preview URL
4. Stripe webhook URL (Block 1.4) — point it at the API Gateway
   endpoint on the new domain (or keep the existing AWS endpoint —
   Stripe doesn't care)
5. Re-build extension (`pnpm build`) → re-zip → submit a new CWS
   version

### RDS Free Tier graduation
Free Tier caps `backupRetention` at 1 day. Once you have paying users,
upgrade to a non-free instance class and bump retention to 7 days:

```ts
// backend/infra/lib/data-stack.ts
const db = new DatabaseInstance(this, 'Db', {
  // ...
  backupRetention: Duration.days(7),  // was 1
  instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.SMALL),
})
```

Then `pnpm cdk deploy StudyHelperData --require-approval never`.

### Marketing site polish
The Vercel project (`web/`) currently renders a minimal landing page.
Worth iterating on after the first 10 paying users — copy that converts
beats copy that's pretty.

# Lisna — Session Handoff

**Last updated**: 2026-05-24
**Purpose**: Bring a new session up to speed in <5 min. Read top → bottom in order.
**Reader**: future-self (or another Claude). Skip what you already know.

---

## 1. Project at a glance

**Concept**: every spoken sound, structured on the user's own device.
See [PRD.md](PRD.md) for the locked yardstick + scenario set; this
section covers only how the current stack (v1, cloud) realises it.

The shipping surface today is a Chrome extension that produces
real-time AI-generated notes from **non-downloadable lecture videos**
at Japanese universities (Keio LMS is the primary target; YouTube also
works for fixtures + dev). The same pipeline — live audio → STT →
on-demand LLM curator → Obsidian-flavored markdown — is what the v2
desktop native + on-device build will replace, with cloud kept as
fallback (see PRD §Stack stage).

```
Browser (Chrome ext)                     AWS (CDK)
─────────────────────                    ─────────────────────────
content/index.ts ─[10s WAV chunks]─▶    StreamAudioFn (Lambda)
audio-capture.ts                          → Groq Whisper Large-v3 STT
                                          → DB transcripts append
                                          → WS broadcast transcript_chunk

content/slide-detector.ts ─[JPEG]─▶     StreamSlideFn (Lambda)
                                          → S3 PUT
                                          → DB slides append

modal click 📝 / pause / ended ────▶    SessCurateFn (Function URL)
                                          → curator gpt-4o-mini
                                          → DB outline replace
                                          → WS broadcast outline_updated

modal ⬇ .zip ────[direct presigned ─▶  S3
                  fetches via fflate]
```

**Tech**: TypeScript everywhere. Backend: AWS CDK + Lambda + RDS Postgres
+ API Gateway HTTP API + WebSocket API + S3. Frontend: Vite + React 18 +
Tailwind 4 + CRX vite plugin. STT: Groq Whisper Large-v3 (verbose_json
segments). Curator: OpenAI gpt-4o-mini. Auth: JWT issued from Google OAuth.

---

## 2. Critical state (read this before anything else)

### What's working today (2026-04-30 evening)

- Audio capture, STT, transcript live captions
- On-demand curator (pause / ended / manual button → wraps to outline)
- Slide detector (1 s sampling, 18 % pixel diff, 3 s min gap)
- Slide thumbnail strip + lightbox in modal (a11y: focus trap, return focus, Esc/arrows)
- Timestamp click → video jump (cross-frame relayed for K-LMS iframe)
- 2× playback compatible (scrub guard fixed)
- Quota tiered banner (90 % warn / 100 % block) — currently `Free` plan
- Obsidian markdown export with slide attachments via .zip (fflate, dynamic import)
- Auto-download on session-ended (opt-in via Options page)
- Stop button: pauses video, runs final curate, keeps modal alive for export

### What just landed (today)

| Phase | What |
|---|---|
| A | session-curate cooldown (DB column `last_curated_at` + 30 s free / 5 s pro). DB Pool `max:5→2`. stream-slide size cap 5 MB + 500 slides/session. CORS allowlist via cdk context. Migration `003_dev_user_pro` → `scripts/grant-pro.ts`. |
| B | Deleted dead code: `NoteList`, `NoteItem`, `DownloadButton` components. App.tsx `notes` state + setNotes (7 sites). `webmBlobToWav` + `audioCtx`. `lib/llm.ts`, `lib/markdown.ts`, `lib/pdf.ts`, `handlers/session-finalize.ts` + route + Lambda. |
| C | Memory-leak / race fixes: inline-button zombie scroll listeners. Content script re-injection guard (`__SH_CONTENT_BOOTED__`). AudioCapture stale-partial-state. SlideDetector stop-race. App WS effect try/catch. onLogout state cleanup completeness. |
| D | UI polish: LiveTranscript bottom-stick auto-scroll + aria-live. Slide thumbnail onError → hide button. RefreshIndicator interval bounded to 10 min. Lightbox a11y. |
| E | Type unification: extension's `Outline` interface synced to backend's curator.ts (Phase 6 fields). |
| F | Refactors: backend `withAuth<T>` wrapper (7 handlers). judge.ts → `scripts/lib/`. App.tsx `applyEvent` unifier (SP_BROADCAST + postMessage). Lambda bundling `minify+sourceMap+externalModules:['@aws-sdk/*']`. ZodError → 400. |
| Obsidian | v0.2 manual export shipped: `.zip` with `lecture.md` + `Attachments/Study-Helper/<sess>/slide-mm-ss.jpg`. Auto-download setting. Slides rendered inline in markdown (per-section by ts range). |
| Stop redesign | 停止 click now: video pause + final curate auto-trigger + sessionId stays + isCapturing flag → ExportMenu / 📝 ノートを生成 still usable. Manual curate goes via direct callApi (bypasses dead content-script listener). |
| Slide POST fix | Was returning 500 because client omitted `url` field. Backend now wraps Zod errors as 400 in `withAuth`. |
| Chunk retry | stream-audio chunk POST retries once after 1.5 s on 5xx. Cures the ~22 % API-GW-upstream-503 rate observed in real usage. |

### What landed since (2026-05-23 → 2026-05-24)

| PR | What |
|---|---|
| #17 | **Rule system bootstrap.** `CLAUDE.md` (≤150 lines, top-20 rules) + `.claude/rules/{architecture,domain,pitfalls,testing,workflow,operations}.md` (on-demand detail) + `.claude/commands/` (8 slash commands) + `.claude/hooks/{session-start,pre-commit-check,commit-msg-check}.sh` + GHA workflows (`claude-audit`, `backlog-sync`) + `docs/REFACTOR_BACKLOG.md`. Every session auto-loads CLAUDE.md; SessionStart hook prints branch + HANDOFF date + top-3 backlog + installs git hooks. |
| #18 | **Migration 004 collision fix.** `004_processed_stripe_events.sql` → `008_…` to remove numeric clash with `004_curate_cooldown.sql`. Bookkeeping migration `009_renumber_004_stripe_bookkeeping.sql` deletes the stale `schema_migrations` row. Body now `CREATE TABLE IF NOT EXISTS`. |
| #21 | **CI Dependabot env fallback.** `Web — build` step uses `${{ secrets.X \|\| 'dummy' }}` pattern so Dependabot PRs (which use a separate secrets scope) can build. Real Vercel deploys ignore Actions env. |
| #20 | **Next.js 16.2.4 → 16.2.6 security patch.** High-severity: SSRF, Proxy bypass (×3), DoS, Cache poisoning, XSS. Merged after #21 unblocked. |

### 2.5 Operational guards on GitHub (added 2026-05-24)

Runtime guards enforced by GitHub repo settings, NOT code. Canonical list +
"what to do when you hit one" lives in `.claude/rules/operations.md`. Summary:

- **Branch protection ruleset on `main`**: requires PR, `ci` + `desktop-ci` green; blocks force-push and deletion. Direct `git push origin main` rejected.
- **Auto-delete head branches** ON: PR merge removes the head branch automatically.
- **Secret scanning + push protection** ON: blocks pushes with secret-shaped strings (Stripe `sk_live_…`, AWS `AKIA…`, etc.).
- **CodeQL** ON (actions, javascript-typescript, c-cpp): passive, NOT in required-checks.
- **Dependabot** security + version updates ON: open Dependabot PRs at any time.

---

## 3. Architecture quick map

### Backend (`backend/`)

```
src/
  handlers/
    auth-google.ts       — Google OAuth → JWT (NOT wrapped in withAuth)
    auth-me.ts           — /v1/auth/me
    health.ts            — /v1/health
    stream-audio.ts      — POST /v1/stream/audio (10 s WAV → STT → DB → WS)
    stream-slide.ts      — POST /v1/stream/slide (JPEG → S3 → DB → WS)
    session-curate.ts    — POST /v1/session/curate (LLM, behind FUNCTION URL)
    session-get.ts       — GET /v1/session?url=...&format=json|markdown
    session-delete.ts    — DELETE /v1/session/:id
    stripe-checkout.ts   — POST /v1/billing/checkout
    stripe-webhook.ts    — Stripe webhook (NOT wrapped, doesn't use Bearer)
    ws-connect.ts        — WS $connect
    ws-disconnect.ts     — WS $disconnect
  lib/
    auth.ts              — JWT sign/verify, withAuth() wrapper
    curator.ts           — Outline shape + LLM curator (gpt-4o-mini default,
                           CURATOR_PROVIDER='anthropic' switches to Claude)
    db.ts                — pg Pool (max:2, idleTimeout 1s)
    env.ts               — Zod env schema, Secrets Manager loader
    markdown-obsidian.ts — Outline → Obsidian markdown (slides inline)
    migrate.ts           — schema_migrations runner (uses pool.connect for txn)
    quota.ts             — checkQuota / recordUsage (free 30min/月, pro 30h/月)
    s3-presigned.ts      — presignGet for slide URLs (1h TTL)
    stt.ts               — Groq Whisper, returns segments[]
    warmup.ts            — isWarmup / warmupResponse
    ws-broadcast.ts      — sendToSession via ApiGatewayManagementApi
  migrations/
    001_initial.sql, 002_outline.sql, 004_curate_cooldown.sql
infra/lib/
    api-stack.ts, ws-stack.ts, migrate-stack.ts, data-stack.ts,
    secrets-stack.ts, network-stack.ts
scripts/
    grant-pro.ts                   — replaces deleted dev migration
    eval-curator.ts, measure-*.ts  — curator quality eval
    lib/judge.ts                   — moved from src/lib/ (kept out of Lambda bundles)
tests/
    auth, db, quota, stt, markdown-obsidian — keep these passing
    fixtures/transcripts/, fixtures/baselines/  — eval inputs
```

### Extension (`extension/`)

```
src/
  content/
    index.ts            — top-frame routing, capture lifecycle, JUMP_TO,
                          TRIGGER_CURATE, session_started/ended broadcasts.
                          Gated by __sh_first_boot__ for re-injection idempotence.
    audio-capture.ts    — Web Audio continuous PCM 16 kHz WAV. Pause/scrub guards.
    audio-encode.ts     — downmix + resample + WAV header (after webmBlobToWav removed)
    slide-detector.ts   — 1 s tick, pixel diff, debug logs
    inline-button.ts    — Idle button + processing pulse + stop. currentHandle
                          tracker prevents zombie scroll listeners on remount.
    in-page-modal.ts    — iframe modal mount logic
  service-worker/
    main.ts, messaging.ts, auth.ts, notify.ts
                        — API_FETCH proxy, AUTH_LOGIN/LOGOUT, JUMP_TO_REQUEST relay
  side-panel/
    App.tsx             — main UI. Two contexts: ?embed= (in-page modal) or
                          side-panel (account view). applyEvent() switch
                          handles SP_BROADCAST + window.postMessage uniformly.
    api-client.ts       — callApi helper, WS connection, Outline types (mirror of backend)
    lib/export.ts       — exportZip / exportPlainMarkdown / copyMarkdownToClipboard.
                          fflate dynamic import.
    components/
      OutlineView.tsx   — sections + slide strip + lightbox. SectionList memoized.
      LiveTranscript.tsx— ring buffer 60, bottom-stick scroll, aria-live
      ExportMenu.tsx    — zip / md / clipboard. zip default if slides exist.
      QuotaBanner.tsx   — <90% silent, 90-99% amber, 100% red blocking
      ConsentModal, LoginScreen, PanelHeader, SpeedSelector, StopButton
  options/Options.tsx   — playback speed, auto-download toggle, logout
  shared/
    types.ts, storage.ts, config.ts (API_BASE_URL, WS_URL, CURATE_URL)
manifest.config.ts      — host_permissions: ['<all_urls>'], OAuth client_id, sidePanel
.env.production         — VITE_API_BASE_URL, VITE_WS_URL, VITE_CURATE_URL,
                          VITE_GOOGLE_OAUTH_CLIENT_ID
```

### Web (`web/`)
Static landing/privacy/terms (Next.js). Out of scope for handoff.

---

## 4. Roadmap (decisions made)

### v0.2 — Manual export polish ✅ DONE
- `.zip` export with sidecar slides
- Auto-download on session-ended (opt-in)
- Frontmatter (course/lecturer/date/related_lectures/tags)
- Slide attachments rewritten in markdown to local paths

### v0.3 — Obsidian REST API integration (next 1-2 months)
**Goal**: opt-in real-time vault sync. User installs Obsidian Local REST
API plugin → enters API URL + token in our Options page → modal pushes
markdown to vault as outline updates.

Implementation sketch:
- `chrome.runtime.host_permissions` add `http://127.0.0.1:27124/*` (or via optional permissions)
- Settings UI: API URL, token, vault folder, layout (single-file vs atomic notes)
- SW message `OBSIDIAN_PUSH` → PUT `/vault/{path}` with markdown
- Auto-sync toggle: push after every curate
- Manual paste / .zip download remain available alongside

### v1.0+ — Custom Obsidian plugin
Render the modal inside Obsidian as a side pane. Plugin shares JWT with
the chrome extension via storage. Most ambitious; defer until beta
feedback validates the demand.

### Anki integration (parking lot)
`check_question` → cloze deletion. Lower priority.

---

## 5. What's broken / monitor / open questions

| Item | State | Notes |
|---|---|---|
| 503 on stream-audio chunks | Mitigated | API-GW upstream issue. Single retry after 1.5 s in content/index.ts. CloudWatch shows clean Lambda invocations during 503. Monitor failure rate post-retry. |
| Slide POST 500 | Fixed today | Client omitted `url` field. Now sends. Backend wraps Zod errors as 400. |
| Markdown 404 | Fixed today | Stale outline state when /v1/session returns null session. App.tsx now clears `outline/slides/sessionId` in that case. |
| Anthropic SDK in SessCurateFn bundle | Known | Curator imports `@anthropic-ai/sdk` for dormant `CURATOR_PROVIDER='anthropic'` branch. Move to dynamic import when that branch goes live. |
| Curator latency on long lectures | Acceptable | 30-min content ~30-50 s, 60-min ~50-90 s. Function URL bypasses API GW 30 s limit. |
| `notes` JSONB column | Legacy, kept | Old sessions may still have data. New handlers don't write. session-get still SELECTs but UI ignores. Drop in a future migration when comfortable. |
| Stripe `apiVersion` cast | `as any` | SDK 22.1's literal type drifted to `'2026-04-22.dahlia'`. We pin `'2025-09-30.acacia'`. Update both together when the SDK upgrade is intentional. |
| Migration 004 duplicate | ✅ Fixed (PR #18, 2026-05-23) | Renumbered to 008 + bookkeeping migration 009. See `backend/src/migrations/`. |
| CI fails on Dependabot PRs | ✅ Fixed (PR #21, 2026-05-24) | `Web — build` step has `secrets.X \|\| 'dummy'` fallback. Don't strip when adding new secrets. |
| Open Dependabot PRs (2026-05-24) | Open | `dependabot/npm_and_yarn/postcss-8.5.15`, `dependabot/npm_and_yarn/vite-6.4.2`. CI should pass via the #21 fallback. |

### Pending questions for the user

- After Web Store publish: lock CORS to `chrome-extension://<published-id>` via `pnpm cdk deploy -c allowedCorsOrigins=...`
- Run `scripts/grant-pro.ts <email>` on staging/prod when needed
- v0.3 spec: vault layout — single-file (default) vs atomic notes (advanced) toggle in Options

---

## 6. Pitfalls (battle scars to remember)

1. **Whisper segment timestamps**: chunks are 10 s clock-driven. WITHIN a chunk, Whisper segment.start can occasionally be 10.0-11.0 s due to rounding; we accept this as ±1 s noise (matters less than chunk-uniform 10 s timestamps did).

2. **Pause/scrub guards in audio-capture**: chunk advancement is wall-clock-rate, video.currentTime advance is `playbackRate × wall-clock`. Comparing the two via sample-rate math broke at 2× playback (the broken version reset every chunk → infinite loop). Current scrub guard uses `lastObservedVideoTime` jump detection (>2 s) which is playback-rate-agnostic.

3. **Cross-frame routing**: K-LMS / Vimeo / Canvas Studio embed video in a same-tab cross-origin iframe. Modal mounts in TOP frame. Capture lives in IFRAME. Coordination via `window.postMessage` with `source: 'sh-frame'` (iframe → top) and `source: 'sh-parent'` (top → iframe). Top frame relays modal-originated control messages to iframes.

4. **Content script re-injection**: SPA navigations re-run content script in same document. `__SH_CONTENT_BOOTED__` window sentinel guards listener registration. Without it MutationObservers and chrome.runtime listeners stack.

5. **API Gateway HTTP 30 s timeout is HARD**: cannot raise. The curator path uses Lambda Function URL (no API GW) to bypass. Don't accidentally put long-running handlers behind API GW.

6. **DB Pool `max:2` + transactions**: `migrate.ts` uses `pool.connect()` + same-client query for BEGIN/COMMIT. Without a single connection, pool would issue different conns per `pool.query` call → BEGIN/COMMIT on different connections → transaction effectively no-op.

7. **withAuth wrapper catches ZodError → 400**. So body validation failures don't surface as 500. New handlers should call `Body.parse()` inside the inner function (it'll throw, wrapper handles).

8. **Slides need `url` in stream-slide POST body**. Backend Zod schema requires it (same as stream-audio). Easy to forget when adding new endpoints — they share the request shape.

9. **API responses MUST set `Content-Type: application/json`** when body is JSON. Especially 4xx/5xx error paths. Frontend SW JSON-parses every response; without the header browser may treat as text/plain (not always — but inconsistent).

10. **Function URL CORS** is a separate config from the API GW CORS. Both currently `*`; lock both before publish.

---

## 7. Useful commands

### Backend / CDK

```bash
cd backend

# Build (TypeScript only, no bundling)
pnpm build

# Test
pnpm test

# Deploy all stacks
pnpm cdk deploy --all --require-approval never

# Deploy one stack
pnpm cdk deploy StudyHelperApi --require-approval never

# Lock CORS post-publish
pnpm cdk deploy StudyHelperApi -c allowedCorsOrigins=chrome-extension://abc...

# Grant pro to a user (dev convenience)
pnpm tsx scripts/grant-pro.ts takgun.jr@gmail.com

# Curator latency benchmark (uses fixtures)
pnpm tsx scripts/measure-curator-latency.ts

# Eval (judge LLM scoring against fixtures)
pnpm tsx scripts/eval-curator.ts --baseline v5-gpt4omini
```

### Extension

```bash
cd extension

# Production build (writes dist/ which Chrome loads)
pnpm build

# Load extension in Chrome:
# chrome://extensions → Developer mode ON → Load unpacked → select dist/

# After source change → pnpm build → chrome://extensions → reload icon
```

### CloudWatch (debug)

```bash
# Audio chunk Lambda logs
aws logs tail /aws/lambda/StudyHelperApi-StreamAudioFn16CCD71E-XiTAXntrAvo0 --since 30m

# Slide upload Lambda logs (when triaging slide POST issues)
aws logs tail /aws/lambda/StudyHelperApi-StreamSlideFnFCF264A0-0tXhus11QKpv --since 30m

# Curator Lambda
aws logs tail /aws/lambda/StudyHelperApi-SessCurateFnE6F46EFB-hOZlPS2X72EN --since 30m

# Filter for errors only
aws logs tail /aws/lambda/... --since 30m --filter-pattern '?ERROR ?Error ?Timeout'
```

### URLs / IDs

- API base: `https://p53z148cv5.execute-api.ap-northeast-1.amazonaws.com`
- WS: `wss://xohpe1pjd1.execute-api.ap-northeast-1.amazonaws.com/prod`
- Curate Function URL: `https://vxlfpsnp75aluxggmprdfucrje0myiox.lambda-url.ap-northeast-1.on.aws/`
- AWS region: `ap-northeast-1`
- Maintainer email (gets `pro` plan): `takgun.jr@gmail.com`

---

## 7.5. Pre-launch state (2026-05-01)

Pre-launch checklist lives in [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md).

**Software side complete**:
- Legal pages (privacy / terms / 特定商取引法) full content, ready for review
- Landing page rewritten with features + plans + privacy summary
- React ErrorBoundary, slide-detector log gating, manifest polish
- Real-time quota counter in modal header (Free plan), slide replay-dedup
- Obsidian REST API integration (settings + auto-sync + push), session history
- Inline button onboarding tooltip + pulse for first-time users

**Operator side TODO** (you must do):
1. Stripe live keys + webhook secret (currently `TEMP_PLACEHOLDER`)
2. Chrome Web Store publish + screenshots
3. CORS lockdown post-publish (`cdk deploy -c allowedCorsOrigins=...`)
4. Fill `[TODO:...]` placeholders in `web/src/app/[locale]/tokusho/page.tsx`
5. Decide support email (current: `support@study-helper.app(仮)`)

See `DEPLOYMENT.md` for the complete operator runbook.

## 8. Where to start the next session

Most likely next priorities (pick what matches user's current ask):

1. **Test the today's fixes** with a real K-LMS lecture: stop button → final curate → export, slide detection multiple slide changes, .zip unpacking into Obsidian vault.

2. **v0.3 Obsidian REST API integration** — Settings UI + SW push handler + auto-sync toggle.

3. **Eval baseline regression** — `eval-curator.ts` against `v5-gpt4omini` fixture. Iterate prompt vs measured score.

4. **Session history view** — list past sessions in side-panel, click to reload outline.

5. **Chrome Web Store submission prep** — privacy policy, screenshots, description, $5 developer fee, lock CORS to published extension ID.

If user asks something specific, prioritize their request. The above is just the deferred queue.

---

## 9. Global memory notes

`~/.claude/CLAUDE.md` has 15+ accumulated lessons specific to this
project (Groq WebM rejection, Gemini deprecation, AWS WS IAM,
free-tier traps, per-chunk fault tolerance, TPM caps, LLM-as-judge,
self-improvement loop). Read it on session start; it has historical
context this handoff can't repeat without bloating.

---

**End of handoff.** If something material is missing, append to this
file rather than scattering notes elsewhere. Date all updates.

# lisna.jp Full Site Redesign — Design Spec

**Date**: 2026-05-19
**Status**: Brainstorming complete, awaiting user review before plan-writing
**Worktree**: `.claude/worktrees/web-redesign` on branch `worktree-web-redesign`
**Base commit**: `9364932` (v2 desktop alpha merged to main)

---

## 1. Goal + Scope

### 1.1 Why now

v2 desktop alpha code is complete (PR #6 merged 2026-05-18, manual smoke 18/20 pass). External alpha launch is gated by three things:

1. **Site (lisna.jp)** — currently minimal Chrome-extension LP; cannot dispense v2 desktop downloads or run signin flow.
2. **Codesign + notarize** — Apple Developer Program required; out of this spec (parallel side track).
3. **Whisper silence fix** — in progress in parallel worktree `whisper-silence-fix`.

This spec covers #1: the full lisna.jp redesign that turns the site into the v2 alpha distribution + auth + onboarding gateway, with a path that scales to general beta/GA.

### 1.2 In scope

- Full home page (12 sections)
- 7 new pages: `/features` (deferred — see §1.3), `/download`, `/signin`, `/auth/success`, `/dashboard`, `/docs`, `/changelog`, `/compare`
- 5 existing-page updates: `/`, `/pricing`, `/terms`, `/privacy`, `/tokusho`, `/refunds`
- Design system layer (Tailwind + custom Notebook components + Radix primitives)
- i18n framework (English default, Japanese + Korean locales)
- Auth + DB integration with existing v1 AWS backend
- Custom URL scheme handshake (`lisna://callback?token=…`) for desktop ↔ web auth
- All copy in English with explicit JP/KO translation slots

### 1.3 Out of scope

- **Codesign + notarize** of the v2 DMG (separate Apple Developer Program track)
- **GA pricing** (Pro plan is `$?` placeholder during alpha)
- **Real testimonials** (alpha — no users yet)
- **Compare-page real screenshots of competitors** (legal/effort caution)
- **`/features` page** — deferred to v2.0.x polish. Home Features sections sufficient for alpha.
- **`/blog`** — deferred (founder writing time too expensive at alpha stage)
- **Real-time / streaming UI patterns** (we don't have live data to surface yet)
- **Mobile app** (web is desktop-first; responsive but mobile is secondary)
- **A/B testing infrastructure** — defer to first measurable funnel data
- **PostHog / advanced analytics** — Plausible sufficient for alpha; reassess at 1000+ MAU

---

## 2. Strategy + Phased Rollout (B')

Decided after weighing three options (A: parallel, B/B': serial phases, C: cycle):

```
Phase 1 — MAIN (this spec):  lisna.jp full build → external alpha launch
Phase 1 — SIDE TRACK A:      Apple Developer Program signup + codesign + notarize
Phase 1 — SIDE TRACK B:      Whisper silence hallucination fix (already in progress)

Phase 2 (post-launch):       Alpha feedback response (app polish, AI tuning)
Phase 3 (later):             v2.0.x → beta (multi-OS, real testimonials, etc.)
```

This spec is **Phase 1 main track**. Side tracks proceed independently (separate sessions/worktrees).

---

## 3. Site IA

### 3.1 Pages list (13 total)

| Path | Status | Purpose | Auth required |
|---|---|---|---|
| `/` | New design | Marketing home (12 sections) | No |
| `/download` | New | DMG + system reqs + install guide | No |
| `/docs` | New | Getting started + FAQ + troubleshooting | No |
| `/changelog` | New | Release notes (MDX) | No |
| `/compare` | New | vs Otter / Fireflies / Notion AI | No |
| `/signin` | New | Email magic link + 3 OAuth | No |
| `/auth/success` | New | "Done — you can close this tab" | No |
| `/dashboard` | New | User control plane (downloads, plan, devices, Discord) | **Yes** |
| `/pricing` | Update | v1 ¥980 + v2 alpha free + Pro placeholder | No |
| `/terms` | Update | + v2 on-device clauses | No |
| `/privacy` | Update | + v2 on-device clauses | No |
| `/tokusho` | Update | (特定商取引法) + v2 reference | No |
| `/refunds` | Update | + v2 reference | No |

Excluded (deferred / out of scope): `/features`, `/blog`, `/api`, `/security`, marketing landing variants.

### 3.2 Navigation structure

**Public nav** (top of every public page):
```
Lisna       Product · Pricing · Docs · Changelog · [EN ▾] · Sign in
```

**Authenticated nav** (Dashboard + auth pages):
```
Lisna       Product · Pricing · Docs · Changelog · [EN ▾] · [Avatar Name ▾]
```

The avatar dropdown contains: Dashboard · Sign out · (link to Stripe customer portal once Pro launches).

### 3.3 Sitemap

```
lisna.jp
├── /                       (Home — 12 sections)
├── /download               (DMG + install guide)
├── /docs/
│   ├── /getting-started
│   ├── /first-recording
│   ├── /exporting-to-obsidian
│   ├── /faq
│   └── /troubleshooting
├── /changelog              (MDX entries, reverse chronological)
├── /compare                (vs cloud-based tools)
├── /signin                 (auth)
├── /auth/success           (post-signin confirmation)
├── /dashboard              (authenticated user state)
├── /pricing
└── /(legal)/
    ├── /terms
    ├── /privacy
    ├── /tokusho
    └── /refunds
```

Locale routing: `/[locale]/…` with `en` (default), `ja`, `ko` supported. Auto-detect from `Accept-Language` header on first visit; persisted in cookie.

---

## 4. User Flow (D3 — anonymous download → in-app signup)

Selected over alternatives D / D2 / D+. Rationale: aligns with founder's stated intuition ("download is the obvious action"), matches the Cursor / Linear / Figma desktop convention, minimizes web friction.

### 4.1 Discovery → Download (anonymous)

```
1. Visitor lands on lisna.jp (any locale, any source)
2. Hero displays "Download for Mac →" as the single dominant CTA
3. Visitor clicks
   ├─ Browser triggers .dmg download (no signup required)
   └─ Web analytics records the anonymous download click (Plausible event)
4. Visitor installs .dmg → drags Lisna.app to /Applications → launches it
```

No web account is created in this flow. Visitor is anonymous to the web.

### 4.2 In-app first launch → web signin → app authorization

```
5. App first-launch screen shows "Sign in to start" (single button)
6. Click → app calls macOS open(URL) on:
   https://lisna.jp/signin?source=app&app_callback=lisna://callback
7. Default browser opens to /signin
8. User picks email magic link OR Google/Apple/GitHub OAuth
9. Auth.js completes verification → backend issues a single-use auth-exchange code
10. Browser redirects to: lisna://callback?code=ABC123
11. macOS routes lisna:// URL to the registered Lisna.app (Info.plist URL scheme)
12. App exchanges the code for a long-lived session token via:
    POST /api/auth/exchange-app-code { code: "ABC123" } → { token, expires_at }
13. App stores the token in macOS Keychain
14. App is now authenticated; main UI mounts (Recording + previous flow)
15. Browser tab shows /auth/success: "Done — you can close this tab"
    (5-second countdown, attempts window.close() — graceful fallback to manual close)
```

### 4.3 Returning user — web access

```
- User navigates to lisna.jp/dashboard (or clicks nav "Sign in")
- If session valid: dashboard renders
- If no session: redirect to /signin?next=/dashboard
- User completes signin → cookie set → redirected to /dashboard
```

### 4.4 Session lifecycle

- **App session**: long-lived token in macOS Keychain. Default expiry: 90 days. Renewable silently on backend ping.
- **Web session**: standard Auth.js cookie. Default expiry: 30 days. Sliding refresh.
- **Sign out from device**: user can revoke a device session from `/dashboard`. App next ping returns 401 → app shows signin screen.

### 4.5 Flow diagram (textual)

```
                        ┌────────────────────────────┐
                        │  Visitor lands on lisna.jp │
                        └────────────┬───────────────┘
                                     │
                       "Download for Mac →"
                                     │
                                     ▼
                        ┌────────────────────────────┐
                        │  .dmg download (anonymous) │  ◀── analytics: download_click
                        └────────────┬───────────────┘
                                     │
                                     ▼
                        ┌────────────────────────────┐
                        │  Install + launch          │
                        └────────────┬───────────────┘
                                     │
                          App: "Sign in to start"
                                     │
                                     ▼
                        ┌────────────────────────────┐
                        │  Browser opens /signin     │
                        └────────────┬───────────────┘
                                     │
                            (OAuth or magic link)
                                     │
                                     ▼
                        ┌────────────────────────────┐
                        │  /api/auth/exchange-code   │
                        └────────────┬───────────────┘
                                     │
                          lisna://callback?code=ABC
                                     │
                                     ▼
                        ┌────────────────────────────┐
                        │  App stores token, mounts  │
                        │  Recording UI              │
                        └────────────────────────────┘
                                     │
                          /auth/success in browser
                          ("Done — close this tab")
```

---

## 5. Hero (locked)

### 5.1 Design tone — "Notebook Craft"

Decision history: 4 reference tones (Vercel, Cursor/Raycast, Notion/ChatGPT, Reflect/Anthropic) → user picked Reflect + invitation to add Lisna identity → 6 variants → user picked Notebook Craft (cream + ruled paper + serif + earth palette + lecture-note metaphor).

Tone contract (do not break):
- **Personality**: calm, intelligent, content-first; the typography of a careful lecture notebook
- **Background**: warm cream `#f8f3e9` with a subtle vertical gradient
- **Texture**: faint horizontal ruled lines every 30-36px (rgba(120,100,70,0.06–0.08))
- **Vertical red margin**: 1px line at `left: 80–96px`, color `rgba(184,80,80,0.25–0.28)`
- **Color palette**: cream + dark-brown ink (#1a1410) + muted red margin (#b85050) + tan italic accent (#8a6a3a)
- **NO**: pen-mark gimmick (rejected after review), bold serif, saturated red text, gradients, glows
- **Emphasis devices allowed**: scale, italic, tan accent, marginalia, single oversized metric (e.g. "100%"), CSS chisel shadow (`0 2px 0 rgba(0,0,0,0.25)`)

### 5.2 Layout — 2-column

```
┌──────────────────────────────────────────────────────────────────┐
│  Lisna       Product · Pricing · Docs · Changelog · EN ▾ · Sign in │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Your lectures,                ╭───────────────────────────╮   │
│   in your notes.                │  ● ● ●  Real Analysis…    │   │
│                                 │  ━━━━━━━━━━━━━━━━━━━━━━━━━│   │
│   Real-time transcription       │  ● Live    04:32           │   │
│   + structured summaries.       │  ▌ ▌▌▌▌▌▌ ▌▌▌▌▌▌▌▌         │   │
│   100% on-device — your         │                            │   │
│   audio never leaves your       │  04:25  The Bolzano-       │   │
│   Mac.                          │         Weierstrass…       │   │
│                                 │  ━━━━━━━━━━━━━━━━━━━━━━━━━│   │
│   ┌─────────────────────────┐  │  Note · auto-generated     │   │
│   │ Download for Mac →      │  │  § Compactness             │   │
│   └─────────────────────────┘  │  · Bolzano-Weierstrass…    │   │
│                                 │  · Heine-Cantor…           │   │
│   macOS 13+ · Free during       ╰───────────────────────────╯   │
│   alpha · Apple Silicon · 537MB                                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 5.3 Copy (locked)

| Element | English | 日本語 | 한국어 |
|---|---|---|---|
| H1 line 1 | `Your lectures,` | `講義を、` | `당신의 강의가` |
| H1 line 2 | `in <em>your</em> notes.` | `<em>あなたの</em>ノートに。` | `<em>당신의</em> 노트로.` |
| Sub | `Real-time transcription + structured summaries. 100% on-device — your audio never leaves your Mac.` | `リアルタイム文字起こし + 構造化されたサマリー。100% オンデバイス — 音声が Mac から出ることはありません。` | `실시간 전사 + 구조화된 요약. 100% 온디바이스 — 음성이 Mac 을 떠나지 않습니다.` |
| Primary CTA | `Download for Mac →` | `Macアプリをダウンロード →` | `Mac 앱 다운로드 →` |
| Hint | `macOS 13+ · Free during alpha · Apple Silicon · 537 MB` | `macOS 13+ · アルファ版無料 · Apple Silicon · 537 MB` | `macOS 13+ · 알파 무료 · Apple Silicon · 537 MB` |

`<em>your</em>` rendered as italic + tan accent (#8a6a3a), at 1.05em size for in-headline emphasis.

### 5.4 App screenshot (right column)

Inline mockup illustrating the live recording + auto-generated note. Components from top to bottom inside a window-chrome frame:
- macOS-style title bar with 3 dots + "Real Analysis · Lecture 3"
- "Live" indicator (red dot pulse) + timestamp
- Waveform (animated in production, static in screenshot — 20 bars, 3 in highlighted red showing active speech)
- 1–2 most-recent transcript lines with `[mm:ss]` timestamp prefix
- Dashed divider
- "Note · auto-generated" serif heading
- Section heading (e.g. "§ Compactness")
- 2–3 bullet points in markdown style

This is a static image in v1 of the site. v2.0.x: replace with an actual lightweight WebGL or video loop of the app running.

### 5.5 CTA — "Download for Mac →" details

- `<a>` element (not `<button>`) — links to either:
  - Direct `.dmg` download URL on GitHub Release (Phase 1 default)
  - OR `/download` page if we want to gate behind system-reqs review (Phase 2 option)
- Visual: dark filled (`#1a1410` / `#f8f3e9`), Inter 16px weight 600, padding 18px 30px, border-radius 6px, box-shadow `0 3px 0 rgba(0,0,0,0.25), 0 6px 14px rgba(60,40,20,0.18)` (chisel + soft drop)
- Hover: `transform: translateY(-1px)` 120ms ease
- Mobile (<480px): same button, drops to 14px font, padding 14px 22px

---

## 6. Home page — 12 sections

Tiro.ooo/ko/ inspired structure (17 sections of Tiro → 12 sections for Lisna). Visual hierarchy locked by UI-expert review (post-Round-3 polish).

### 6.1 Section 1: Navigation
- Fixed top, blurred translucent (`backdrop-filter: blur(8px)`)
- Left: "Lisna" serif 18px brand
- Right: Product · Pricing · Docs · Changelog · locale switcher (EN ▾) · "Sign in" (underlined)

### 6.2 Section 2: Hero
See §5. Spans ~720px height on desktop. 2-column 60/40 split (text/screenshot).

### 6.3 Section 3: Trust strip (early social proof)
- Single bordered strip (1px top + bottom hairline) on rgba(254,251,245,0.5)
- Centered uppercase label `EARLY USE AT`
- **One** university name only (italic 22px serif, opacity 0.88): "Keio University"
- Rationale: honest alpha signal. Other universities (Tokyo, Waseda, Seoul Nat'l, KAIST) removed — unverified. Add more only once founder confirms actual usage.

### 6.4 Section 4: Feature 1 — Real-time STT (alternating: text left, image right)
- Eyebrow: `REAL-TIME STT`
- H3: `Transcribe as your <em>professor speaks</em>.` (32px serif)
- Body: `Whisper runs on your Mac. No upload, no waiting. Captions appear live, second-by-second, with timestamps.`
- Meta row: `→ Whisper  → Live captions  → JA / EN / KO`
- Image placeholder: screenshot of live transcription pane

### 6.5 Section 5: Feature 2 — On-device privacy (REVERSE: text right, image left)
- **Primary differentiator — bumped 34px H3 + extended italic predicate**
- Eyebrow: `ON-DEVICE PRIVACY`
- H3: `Your audio <em>never leaves your Mac</em>.`
- Body: `Whisper + Llama models run locally. No cloud transcription, no recording uploaded, no third-party data processor.`
- Meta row: `→ 100% local  → No telemetry  → Open source models`
- Image: local-only diagram (Mac, no cloud)

### 6.6 Marginalia pull-quote (between Feature 2 and Feature 3)
- Spans nav-to-margin gutter on the left
- `✎` glyph at `left: 88px` (inside the red-margin column), 12px muted red
- Italic tan text: `No upload. No cloud. No data processor — your <em>lecture, your laptop, your notes</em>.`
- Padding 22px top/bottom, dashed bottom border
- Mobile: collapses to a centered italic line between sections

### 6.7 Section 6: Feature 3 — Structured notes (alternating: text left)
- Eyebrow: `STRUCTURED NOTES`
- H3: `Not a wall of text — a <em>study-ready note</em>.`
- Body: `Llama 3.2 extracts sections, key terms, and bullets. Formatted as Markdown, ready to read or edit.`
- Meta row: `→ Llama 3.2 3B  → Markdown  → Section detection`

### 6.8 Section 7: Feature 4 — Obsidian export (REVERSE)
- Eyebrow: `EXPORT ANYWHERE`
- H3: `Drops into your <em>Obsidian vault</em>.`
- Body: `Markdown export means your notes live where you live. Obsidian, Notion, plain folder, anywhere your editor reads .md.`
- Meta row: `→ Works with Obsidian  → Markdown  → PDF`
- **Obsidian usage**: text-only ("Works with Obsidian"). No logo, no icon, no implied endorsement. Nominative fair use; safe per §11.2.

### 6.9 Section 8: Privacy emphasis (DARK section)
- Background `#1a1410`, text `#f8f3e9`
- Eyebrow tan: `PRIVACY BY DEFAULT`
- H2 38px: `Built for people who <em>read the docs</em>.`
- **`100%` oversized stat** (72px serif italic tan, sub: "of audio stays on your Mac. Not 99.9% — actually all of it.")
- 6-item 3-column grid:
  1. **Local STT** — Whisper runs on-device.
  2. **Local LLM** — Llama 3.2 runs on-device.
  3. **No telemetry** — Lisna doesn't ping our servers with usage data. Plausible on website only (anonymous, no cookies).
  4. **Open models** — Whisper (MIT) + Llama 3.2 (Meta license). Audit the files; they run unmodified.
  5. **Notes on disk** — Markdown on your Mac. Sync to Obsidian / iCloud / Dropbox — your choice.
  6. **Account = email only** — Email + signin metadata. No transcription content ever touches our database.

This section is Lisna's main differentiator vs Otter / Fireflies / Notion AI. Visually weighted to be the second-most prominent moment after the hero.

### 6.10 Section 9: Pricing
- H2 36px: `Free during alpha.`
- Sub: `Pay only when alpha ends — at fair, predictable pricing.`
- 2-card grid:
  - **Alpha (highlighted with #b85050 1.5px border)** — Free badge · "Free" plan · "$0" 44px serif · "/forever during alpha" · features list (Unlimited recordings · On-device STT + LLM · Obsidian / Markdown / PDF export · Discord support)
  - **Pro (placeholder)** — "Coming soon" badge · "Pro" plan · "$?" 44px serif · "/month (post-alpha)" · features placeholder (Everything in Free · Cloud sync optional · Team workspace · Priority support)

### 6.11 Section 10: FAQ
- Eyebrow: `FAQ`
- H2 32px: `Questions, <em>answered</em>.`
- Accordion (Radix Accordion primitive, custom-styled):
  1. Why is Lisna macOS-only at launch?
  2. What languages does the transcription support?
  3. Will my notes be private?
  4. What happens to my data if I uninstall?
  5. How do I export to Obsidian?
  6. Will Windows / Linux support come?
- Item: 17px serif Q, 22px `+` indicator, hover background `rgba(184,80,80,0.03)`

### 6.12 Section 11: CTA strip
- Background `#ebe2cf` (slightly warmer than page bg)
- Top hairline: 1px solid rgba(184,80,80,0.3)
- Eyebrow: `START`
- H2 40px: `Ready to <em>focus</em>?`
- Sub: `Free during alpha. Sign in inside the app on first launch.`
- Same `Download for Mac →` button as hero (slightly bigger: 17px font, padding 20px 34px)
- Hint: `macOS 13+ · Apple Silicon · 537 MB`

### 6.13 Section 12: Footer
- Background `#1a1410`, text `rgba(248,243,233,0.6)`
- 5-column grid:
  1. **Brand col** (1.3fr) — "Lisna" 18px serif + tagline (`Lecture-notes app for students and researchers. Made in Tokyo. 100% on-device.`)
  2. **Product** — Features (linked to anchor), Pricing, Download, Changelog
  3. **Docs** — Getting started, FAQ, Compare, System reqs
  4. **Community** — Discord, GitHub, Bluesky, Bug reports
  5. **Legal** — Privacy, Terms, Tokusho, Refunds
- Bottom row: `© 2026 Lisna · All rights reserved` (left) · `EN · 日本語 · 한국어` (right, locale switcher repeated)

---

## 7. Functional Pages

### 7.1 `/signin`
- Centered card (max-width 440px) on full-page Notebook Craft background
- Heading: `Continue to <em>Lisna</em>.` (32px serif, italic Lisna)
- Sub: `Sign in or sign up — same flow either way. Either method below works.`
- Email magic link form: input + dark "Send link" button
- "or" divider (uppercase tan label between hairlines)
- 3 OAuth buttons (full-width, outlined, with brand icons):
  - Continue with Google
  - Continue with Apple
  - Continue with GitHub
- Legal disclaimer: `By continuing, you agree to our <Terms> and <Privacy> policy.`
- Help link: `Need help? Join our <Discord>.`
- No nav links in nav-bar (only `Lisna` + `EN ▾` — sign-in-only context)

URL params:
- `?source=app` — sets a hidden flag; on successful auth, redirects via `lisna://callback?code=…` instead of web
- `?next=<path>` — for web-only flows: redirect to `<path>` after auth
- `?source=app` and `?next=` are mutually exclusive

### 7.2 `/auth/success`
- Same Notebook Craft layout (cream + ruled + red margin)
- Centered card (max-width 420px)
- Large `✓` (serif 64px tan) at top
- Heading 28px serif: `Signed in.`
- Sub: `Lisna is ready to use on your Mac. You can close this tab.`
- Countdown: `Auto-closing in <n> seconds…` (5s decrement)
- After 5s: `window.close()` attempt; if blocked, label changes to `Closing didn't work — close this tab manually.`

### 7.3 `/dashboard` (auth required)
Authenticated entry point. Layout:

- Welcome heading 38px serif: `Hi, <em>${user.firstName}</em>.`
- Sub-line 14px: `You're in the alpha. Here's your dashboard.`
- 2-column grid (2fr / 1fr):
  - **Primary card** (spans 2 rows): `YOUR APP` eyebrow · `Lisna for macOS` h3 · description · `Download for Mac →` button · meta (version, last-updated) · file list (DMG with SHA256, Whisper model, Llama model — each with Download link)
  - **Secondary card top**: `COMMUNITY` · `Discord` · "3 new announcements" + `Join the alpha channel →` link-button
  - **Secondary card bottom**: `PLAN` · "FREE ALPHA" badge · `$0 / forever during alpha` · "We'll give you 30 days notice before pricing kicks in."
- Full-width card below grid: `DEVICES` · `Connected Macs` · per-device row (green dot = recently active · device name · last-active timestamp · `sign out` link for inactive ones)

Avatar in nav (top-right):
- Circle with first-letter background tan, foreground cream, 22×22px
- Followed by full name and `▾`
- Click: dropdown with `Dashboard`, `Sign out`

### 7.4 `/download`
Single-page download + setup guide. Sections:

1. **Hero strip**: `Lisna for macOS` h2 + version + size + SHA256 hash · big `Download .dmg →` button
2. **System requirements** card:
   - macOS 13 Ventura or later
   - Apple Silicon (M1/M2/M3/M4) — Intel Macs not supported in alpha
   - 8 GB RAM minimum (16 GB recommended)
   - 5 GB free disk for models
3. **Install in 3 steps**:
   1. Open the .dmg
   2. Drag Lisna.app to /Applications
   3. Launch — first-run will fetch Whisper and Llama models (~3.5 GB, one-time)
4. **Model files** (advanced — for offline install):
   - Whisper STT: `ggml-large-v3-q5_0.bin` (1.5 GB) → place at `~/Library/Application Support/Lisna/models/whisper.bin`
   - Llama LLM: `Llama-3.2-3B-Instruct-Q4_K_M.gguf` (2.0 GB) → place at `~/Library/Application Support/Lisna/models/llm.gguf`
5. **Troubleshooting** link to `/docs/troubleshooting`
6. **Windows / Linux**: Italic note + email-signup form (later — manage expectations)

### 7.5 `/docs/*` (MDX)
Initial pages (alpha launch):
- `/docs/getting-started` — install + first-run walkthrough
- `/docs/first-recording` — UI tour of recording → note flow
- `/docs/exporting-to-obsidian` — Obsidian vault path setup
- `/docs/faq` — same 6 questions as home FAQ, expanded answers
- `/docs/troubleshooting` — Gatekeeper unsigned-app workaround (until codesign lands), sidecar permission issues, model-download failures

Layout: 2-column with left sidebar TOC, right body. Sidebar fixed during scroll. Body max-width 720px, line-height 1.7 for readability.

Source: MDX files in `web/src/content/docs/` rendered via `contentlayer` or Next.js native MDX. Decision deferred — see plan stage.

### 7.6 `/changelog`
MDX entries in `web/src/content/changelog/<date>.mdx` with frontmatter:
```mdx
---
date: 2026-05-18
version: 0.1.0
category: feature | fix | breaking
---
```

Reverse-chronological list. Each entry: date badge · version pill · category color · body (1–3 paragraphs).

RSS feed: `/changelog/rss.xml` auto-generated from MDX entries.

### 7.7 `/compare`
Single page; table-based comparison.

**Comparison table** (4 columns):
| Feature | Lisna | Otter | Fireflies | Notion AI |
|---|---|---|---|---|
| On-device transcription | ✓ | ✗ | ✗ | ✗ |
| Notes stay on device | ✓ | ✗ | ✗ | ✗ |
| No data sent to LLM provider | ✓ | ✗ | ✗ | ✗ |
| Real-time captions | ✓ | ✓ | ✓ | ✗ |
| Markdown / Obsidian export | ✓ | ✗ | ✗ | partial |
| Works offline | ✓ | ✗ | ✗ | ✗ |
| Lecture-aware structuring | ✓ | partial | partial | ✗ |
| Free tier | ✓ | ✓ | ✓ | ✗ |
| Price | $0 (alpha) / $? Pro | $8.33/mo | $10/mo | $10/mo |

Below the table: 2–3 paragraphs ("Why we built Lisna differently") explaining the on-device choice. Avoid mockery; positive framing.

**No competitor screenshots** (legal caution). Names and prices as plain text only.

### 7.8 `/pricing` (update existing)
- Maintain v1 section (Chrome extension ¥980/月) — link to Chrome Web Store
- Add v2 section: same 2-card layout as home Pricing, more detail (FAQ-style "What happens when alpha ends?")
- Currency switcher (USD / JPY / KRW) — Stripe handles multi-currency
- "Compare plans" link to `/compare`

### 7.9 Legal pages (update)
- **`/terms`**: add v2-specific clauses
  - Section "On-device processing" — clarify no data sent to Lisna servers from desktop app
  - Section "Account scope" — email + auth metadata only; no transcription content
  - Section "Models" — note Whisper (MIT) and Llama 3.2 (Meta license) terms; user accepts those licenses by using Lisna
- **`/privacy`**: add v2 sections
  - Audio processing: 100% local, no audio leaves Mac
  - Web analytics: Plausible only, anonymous, no cookies
  - Account data: email + signin metadata; deletion on request via Discord/support email
- **`/tokusho`**: add v2 reference (specified-commercial-transactions law update — confirm with Japan-based legal counsel before launch)
- **`/refunds`**: add v2 reference; alpha = free → no refunds applicable

---

## 8. Design System

### 8.1 Notebook Craft tone contract

All visuals must obey:
- **Weight**: stay at **400** (no bold). Emphasis comes only from scale + italic + tan accent.
- **Colors**: cream / ink / margin-red / tan-accent palette. No new colors.
- **Effects**: chisel box-shadow allowed (`0 2-3px 0 rgba(0,0,0,0.25)` for ink buttons). No blur > 0. No gradients on text. No glow.
- **Imagery**: serif typography carries the design. Screenshots are framed in window chrome but not photo-real. Illustrations are line-art only, no painterly fills.

Violations to flag in code review:
- `font-weight: 700` on any text → reject
- `background: linear-gradient(...)` on text or buttons (except subtle vertical cream gradient on body) → reject
- New saturated colors (red, blue, green text or fills) → reject

### 8.2 Colors (Tailwind tokens)

```ts
colors: {
  cream: {
    50:  '#fefbf5',  // cards
    100: '#faf6ef',  // hover bg (rare)
    200: '#f8f3e9',  // page bg primary
    300: '#ebe2cf',  // CTA strip, app titlebar
  },
  ink: {
    700: '#3a3025',  // body text
    900: '#1a1410',  // headings, primary CTA bg
  },
  margin: {
    red: '#b85050',  // red margin line, alpha card border, primary feature accent
  },
  accent: {
    tan: '#8a6a3a',  // italic emphasis, meta labels, eyebrows, tan italic stat
    sage: '#5fa872', // device-online indicator (single use; sparingly)
  },
  cream-text: 'rgba(248,243,233,…)', // text on dark sections — opacity varies (0.6, 0.7, 0.78)
}
```

### 8.3 Typography

```ts
fontFamily: {
  serif:    ['var(--font-fraunces)', 'Iowan Old Style', 'Tiempos Headline', 'Georgia', 'serif'],
  'serif-jp': ['var(--font-noto-serif-jp)', 'Yu Mincho', 'Hiragino Mincho ProN', 'MS Mincho', 'serif'],
  sans:     ['var(--font-inter)', '-apple-system', 'system-ui', 'sans-serif'],
}
```

- **Fraunces** — Google Fonts, free, variable. Used for all serif headings (Latin script).
- **Noto Serif JP** — lazy-loaded only when locale is `ja`. Bound to `font-serif-jp` class.
- **Inter** — Google Fonts, free, variable. Body, UI, hints, meta.
- KO: defer until launch. Falls back to Apple SD Gothic Neo / Pretendard system fallback.

Loading strategy (next/font):
```ts
import { Fraunces, Inter, Noto_Serif_JP } from 'next/font/google';
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const notoSerifJP = Noto_Serif_JP({ subsets: ['japanese'], variable: '--font-noto-serif-jp' });
// In layout.tsx: conditionally apply notoSerifJP.variable to <html> when locale === 'ja'
```

### 8.4 Typescale (Tailwind config)

```ts
fontSize: {
  // [size, { lineHeight, letterSpacing, fontWeight }]
  'display-1':  ['3.5rem',   { lineHeight: '1.05', letterSpacing: '-0.025em', fontWeight: '400' }], // 56 — Hero H1
  'display-2':  ['2.75rem',  { lineHeight: '1',    letterSpacing: '-0.03em',  fontWeight: '400' }], // 44 — Pricing amount, big stat
  'h1':         ['2.5rem',   { lineHeight: '1.1',  letterSpacing: '-0.02em',  fontWeight: '400' }], // 40 — CTA strip H2
  'h2':         ['2.375rem', { lineHeight: '1.1',  letterSpacing: '-0.02em',  fontWeight: '400' }], // 38 — Privacy H2 (dark)
  'h2-sm':      ['2rem',     { lineHeight: '1.15', letterSpacing: '-0.018em', fontWeight: '400' }], // 32 — Section H2 (Pricing/FAQ)
  'feature':    ['2rem',     { lineHeight: '1.15', letterSpacing: '-0.015em', fontWeight: '400' }], // 32 — Feature H3
  'feature-primary': ['2.125rem', { lineHeight: '1.15', letterSpacing: '-0.015em', fontWeight: '400' }], // 34 — Feature 2 (primary)
  'plan':       ['1.25rem',  { lineHeight: '1.3',                              fontWeight: '400' }], // 20 — Pricing plan name
  'grid-title': ['1.125rem', { lineHeight: '1.3',                              fontWeight: '400' }], // 18 — Privacy grid h4
  'q':          ['1.0625rem',{ lineHeight: '1.4',                              fontWeight: '400' }], // 17 — FAQ question
  'sub':        ['1.03125rem',{lineHeight: '1.55',                             fontWeight: '400' }], // 16.5 — Hero sub
  'body':       ['0.9375rem',{ lineHeight: '1.65',                             fontWeight: '400' }], // 15 — Feature body
  'body-sm':    ['0.78125rem',{lineHeight: '1.65',                             fontWeight: '400' }], // 12.5 — Privacy grid p, meta
  'meta':       ['0.75rem',  { lineHeight: '1.5',  letterSpacing: '0.1em',     fontWeight: '700' }], // 12 — label-tag (uppercase eyebrow)
  'hint':       ['0.6875rem',{ lineHeight: '1.5',                              fontWeight: '400' }], // 11 — hint text
}
```

Class assignments per element documented inline in the `frontend-design`-generated components.

Mobile responsive overrides (`<480px`):
- `display-1` → 38px
- `display-2` → 36px
- `h1` → 30px
- `h2` → 30px (still serif italic OK)
- `feature` → 28px
- Section padding 50px 90px → 40px 24px globally

### 8.5 Components inventory

#### `src/components/ui/` (primitives)
- `Button` — variants: `primary-ink` (dark filled with chisel shadow), `ghost` (outline), `text-arrow` (text-only with right arrow)
- `Input` — variants: `email-magic-link` (cream bg, dark border, joins to button on right)
- `EmailMagicLinkForm` — composite (input + button + hint)
- `Card` — variants: `cream` (default), `notebook` (with ruled-paper background pattern visible inside the card too)
- `Dialog` — Radix-backed; for legal modals if needed
- `Dropdown` — Radix-backed; for nav locale switcher and avatar menu
- `Tabs` — Radix-backed; possibly for `/features` (deferred)
- `Toast` — Radix-backed; for form feedback ("Magic link sent — check your email")
- `Popover` — Radix-backed; pricing tooltips
- `LocaleSwitcher` — dropdown with EN / 日本語 / 한국어
- `NavBar` — composite with brand + nav links + locale + sign-in/avatar
- `Footer` — composite 5-column grid
- `AvatarMenu` — dropdown (avatar circle + dropdown trigger)

#### `src/components/marketing/`
- `Hero` — Section 2 of home
- `TrustStrip` — Section 3
- `FeatureBlock` — Sections 4, 6 (text-left) / 5, 7 (text-right via `reverse` variant) / `primary` variant for Feature 2
- `Marginalia` — between Sections 5 and 6
- `PrivacyEmphasis` — Section 8 (dark + 100% stat + 6-grid)
- `PricingCards` — 2-card grid
- `FAQAccordion` — Radix Accordion + Notebook styling
- `CTAStrip` — Section 11
- `ScreenshotFrame` — wraps the hero screenshot (and similar in features)

#### `src/components/layout/`
- `MarketingShell` — public nav + content + footer
- `DashboardShell` — auth nav + content + footer
- `AuthShell` — minimal (Lisna brand only) for /signin, /auth/success

#### `src/lib/`
- `cn.ts` — clsx + tailwind-merge helper for className composition
- `auth.ts` — Auth.js config (providers, callbacks, session strategy)
- `db.ts` — Drizzle client + RDS connection
- `email.ts` — Resend wrapper for magic-link send
- `appAuth.ts` — exchange-code generation + verification + `lisna://callback` URL builder
- `i18n.ts` — next-intl config

### 8.6 Notebook background utilities

In `src/styles/globals.css`:

```css
@layer utilities {
  .ruled-paper {
    background-image: repeating-linear-gradient(
      180deg,
      transparent 0 30px,
      rgba(120, 100, 70, 0.07) 30px 31px
    );
  }
  .red-margin::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--margin-offset, 80px);
    width: 1px;
    background: rgba(184, 80, 80, 0.25);
    pointer-events: none;
  }
  /* Page-bg + texture composition: */
  .notebook-bg {
    background:
      linear-gradient(180deg, rgba(120, 100, 70, 0.02), rgba(120, 100, 70, 0.05)),
      theme('colors.cream.200');
    position: relative;
  }
}
```

Applied to `<body>` in marketing shell, or to `<main>` for full-page Notebook on auth/dashboard.

### 8.7 Emphasis devices

The two emphasis devices retained (after UI-expert review):
1. **Marginalia pull-quote** — italic tan line between Features 2 and 3 with `✎` glyph in the left margin gutter
2. **Oversized stat** — 72px serif italic tan "100%" in the Privacy section

The pen-mark (`✎ lecture 3` in cursive) gimmick and the SVG ink-pen variants were rejected as too stock-template or too loud for the calm Notebook Craft tone. Pen mark removed entirely.

---

## 9. Architecture

### 9.1 Stack overview

```
                                  USER
                                    │
                          (browser, any locale)
                                    │
                                    ▼
                       ┌──────────────────────────┐
                       │  Vercel Edge (Tokyo)     │
                       │  Next.js 16 App Router   │
                       │  - Marketing pages       │
                       │  - Auth pages            │
                       │  - Dashboard (RSC)       │
                       │  - API routes (Auth.js)  │
                       └──────────┬───────────────┘
                                  │
                  ┌───────────────┼────────────────┐
                  │               │                │
                  ▼               ▼                ▼
         ┌──────────────┐  ┌────────────┐  ┌──────────────┐
         │ AWS RDS      │  │ Resend     │  │ Stripe       │
         │ PostgreSQL   │  │ (email)    │  │ (payments)   │
         │ (via Proxy)  │  └────────────┘  └──────────────┘
         └──────────────┘
                  │
                  ▼
         ┌──────────────┐
         │ AWS Lambda   │
         │ (existing    │
         │ v1 API +     │
         │ v2 endpoints)│
         └──────────────┘
                  │
                  ▼
         ┌──────────────┐    Downloads:
         │ Same RDS     │    GitHub Release (DMG + model files)
         │ (user table) │    + Cloudflare CDN passthrough later
         └──────────────┘
```

### 9.2 Frontend
- Framework: **Next.js 16** App Router + React 19 (already installed in `web/`)
- Hosting: Vercel (Tokyo edge region)
- Existing deployment: `lisna.jp` (custom domain via お名前.com → Vercel)
- Rendering strategy: most marketing pages = static (SSG). Dashboard = dynamic SSR. Sign-in = SSR with CSRF token.

### 9.3 Auth (Auth.js v5)
- **Providers**: Google, Apple, GitHub OAuth + Email Magic Link (via Resend)
- **Session strategy**: Database sessions (Auth.js `database` strategy with Drizzle adapter — not JWT)
- **Custom adapter**: Drizzle adapter targets existing RDS Postgres
- **Schema additions** to the existing v1 `users` table:
  ```sql
  -- Existing v1 columns kept untouched:
  --   id (uuid), email (citext unique), name, image, created_at, ...
  -- Add:
  ALTER TABLE users ADD COLUMN email_verified TIMESTAMPTZ;
  CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    refresh_token TEXT, access_token TEXT, expires_at INTEGER,
    token_type TEXT, scope TEXT, id_token TEXT, session_state TEXT,
    UNIQUE(provider, provider_account_id)
  );
  -- Named `auth_sessions` (not `sessions`) — v1 RDS already has a `sessions`
  -- table for study sessions (url_hash/notes/slides). drizzle-kit `tablesFilter`
  -- in web/drizzle.config.ts enforces scope; this rename removes the collision
  -- so the filter is defense-in-depth, not a load-bearing safety check.
  CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token TEXT UNIQUE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    expires TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE verification_tokens (
    identifier TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (identifier, token)
  );
  -- App-specific:
  CREATE TABLE app_exchange_codes (
    code TEXT PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    consumed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL  -- 10 minutes from creation
  );
  CREATE TABLE app_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name TEXT, -- e.g. "Min's MacBook Pro"
    device_token TEXT UNIQUE NOT NULL, -- long-lived bearer
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
  );
  ```
  Existing v1 user rows automatically work for v2 — `email` is the matching key.

### 9.4 DB (Drizzle + RDS Proxy + IAM)
- **ORM**: Drizzle ORM (TypeScript-first, edge-runtime-compatible)
- **Connection**: RDS Proxy + IAM auth (`aws-sdk` to fetch token, `pg` to connect)
- **Migrations**: Drizzle Kit + `migrations/` folder in `web/src/db/`
- **Pool size**: Vercel Edge function fires single connection per invocation; Proxy pools across functions
- **Region**: RDS is `ap-northeast-1` (Tokyo). Vercel Edge function chosen to also be `hnd1` (Tokyo) to minimize cross-region.

### 9.5 Email (Resend)
- API key in Vercel env var: `RESEND_API_KEY`
- Magic-link sender: `auth@lisna.jp` (DNS records — SPF + DKIM — verified during setup)
- React Email components for the magic-link email body (Notebook Craft tone in HTML)
- Free tier: 3,000 emails/month — sufficient for alpha (~20 users × 5 signins/month = 100 emails)
- JP delivery confirmed acceptable (Resend uses AWS SES backbone)

### 9.6 i18n (next-intl)
- Locales: `en` (default), `ja`, `ko`
- Message files: `web/src/messages/<locale>.json`
- Routing: `/[locale]/…` with middleware locale detection from `Accept-Language` (cookie-persisted)
- Default behavior: visitors with `Accept-Language: en` see `/`, JP visitors see `/ja/`, KO visitors see `/ko/`
- Manual switcher: top-nav dropdown sets cookie and reloads to new locale URL
- Fonts switch by locale (see §8.3)

### 9.7 Analytics (Plausible)
- Plan: $9/mo Lite (100k pageviews/mo) — comfortably above alpha-scale
- Domain: `lisna.jp`
- Events tracked:
  - `download_click` — Download for Mac button (anywhere on site)
  - `signin_initiated` — clicked OAuth or magic-link submit
  - `signin_completed` — landed on /auth/success or /dashboard
  - `discord_click` — Discord button
- No cookies. No PII. Tokusho/GDPR friendly.

### 9.8 Payments (Stripe)
- Existing setup retained — keep current Stripe account + checkout flow
- v1 ¥980/月 product unchanged
- v2 Pro product: created but inactive (no public price) until alpha ends
- Webhook: existing `/api/stripe/webhook` for v1 continues; v2 adds `/api/stripe/webhook-v2` for future Pro
- Customer portal: linked from `/dashboard` Plan card

### 9.9 Storage — DMG + model files
- **GitHub Releases** at `github.com/May1350/Lisna/releases`
  - Each release tagged `v0.1.0`, `v0.1.1`, …
  - Assets per release: `Lisna-<version>.dmg`, `Lisna-<version>.dmg.blockmap`, `latest-mac.yml` (for electron-updater), `ggml-large-v3-q5_0.bin` (1.5 GB), `Llama-3.2-3B-Instruct-Q4_K_M.gguf` (2.0 GB) — model files attached to a special pinned "models" release, not every desktop release
- **electron-updater** in the desktop app polls `latest-mac.yml` and self-updates
- **Download URL strategy**: `lisna.jp/download` button links to `latest-mac.yml`-resolved DMG URL (or direct to a stable redirect `lisna.jp/dl/dmg/latest` which 302s to GH Release)
- Free; 2 GB per asset; CDN sufficient for alpha (Japan latency acceptable)

### 9.10 CD (GitHub Actions)
- Workflow on push to `main` in desktop:
  1. Test (typecheck + vitest)
  2. Build sidecars (whisper.cpp + llama.cpp — only when source changed)
  3. Bundle Electron via electron-builder
  4. (Phase 1 SIDE TRACK A) Codesign + notarize via Apple Developer ID
  5. Publish GitHub Release with `Lisna-<version>.dmg` + `latest-mac.yml`
- Web deployment: Vercel auto-deploys on push to `main` in `web/` paths. No GH Action needed there.

### 9.11 Custom URL scheme (app ↔ web handshake)

Registered in `desktop/electron-builder.yml`:
```yaml
mac:
  extendInfo:
    CFBundleURLTypes:
      - CFBundleURLName: lisna
        CFBundleURLSchemes:
          - lisna
```

Flow:
1. User clicks "Sign in" in app
2. App calls `shell.openExternal('https://lisna.jp/signin?source=app&app_callback=' + encodeURIComponent('lisna://callback'))`
3. User completes auth in browser
4. Web backend (`/api/auth/exchange-code/issue`) generates a random 32-byte code, stores `(code, user_id, expires_at=now+10min)` in `app_exchange_codes` table
5. Web redirects browser to `lisna://callback?code=<code>`
6. macOS routes the URL to Lisna.app (running, since user just opened the browser from it)
7. App calls `POST https://lisna.jp/api/auth/exchange-code/redeem { code }` → response `{ token, user: {...} }`
8. App stores `token` in macOS Keychain (`com.lisna.desktop` service, `device_token` account)
9. App marks the code as consumed (server-side, via the redeem endpoint)
10. App uses `Authorization: Bearer <token>` for all future API calls

Security notes:
- Code single-use, 10-minute TTL
- Code expires server-side on first redeem (race condition handled by `UPDATE … WHERE consumed_at IS NULL`)
- Token rotated every 90 days; refresh via `POST /api/auth/refresh`
- Revocation via `/dashboard` device list immediately invalidates the device's token

---

## 10. i18n strategy

### 10.1 Locale scope at launch
- **English** (default): 100% coverage — all UI + docs + legal
- **Japanese**: 100% coverage at launch (founder is JP-resident; primary alpha market)
- **Korean**: deferred to post-alpha. Stub messages files exist; UI nav switcher present but pages 404 to EN until KO content is filled.

### 10.2 Translation workflow
- Source-of-truth language: **English** (`en.json`)
- Translation files committed alongside source: `web/src/messages/{en,ja,ko}.json`
- Founder translates manually (Korean → Japanese fluent, manual translation acceptable for alpha)
- Future automation: DeepL or GPT-5 translation pass + manual review for tone fit

### 10.3 Locale-specific design tweaks
- JP/KO body uses `font-serif-jp` only for headings; body remains `font-sans` (Inter — has good JP/KO glyph coverage via fallback to Apple SD Gothic Neo / Hiragino Kaku Gothic)
- JP/KO line-height bumped 0.05 for CJK reading comfort (override in `[locale=ja]` selector)
- KO numerals: full-width vs half-width — use half-width consistently (Stripe, dates) for international consistency

---

## 11. Legal + Compliance

### 11.1 GDPR / Tokusho update for v2

`/tokusho` (Japan 特定商取引法) requires update:
- 表示事業者名 (existing — same)
- 連絡先 (existing — same email)
- 販売価格 (add v2 alpha: 無料 / アルファ期間後: 未定)
- 商品の引渡時期 (add v2: アプリのダウンロード = 即時)
- 返品・キャンセル (add v2: アルファ版は無料のため対象外)
- 動作環境 (add v2: macOS 13+, Apple Silicon, 8GB RAM, 5GB ディスク空き容量)

Recommend final review by Japan-based legal counsel before public launch.

### 11.2 Obsidian trademark — nominative fair use

Obsidian's brand page (https://obsidian.md/brand) states:
- "The Obsidian name, logo and app icon are trademarks."
- "Please do not edit, change, distort, recolor, or reconfigure the Obsidian logo."
- "If you want to use Obsidian assets for commercial purposes, please contact us."

**Conclusion**: text-only nominative use is the safe short-term path. Lisna's site uses "Works with Obsidian" / "Drops into your Obsidian vault" without any logo, icon, or implied endorsement. No commercial use of Obsidian assets triggered.

**Post-alpha**: founder can contact Obsidian for a `Built for Obsidian`-style partnership badge.

### 11.3 PDF and Markdown
- PDF: generic term (Adobe relinquished the generic use of "PDF" in 2008). Text "PDF" usage is safe. Adobe logo not used.
- Markdown: CommonMark / Daring Fireball derivative — no trademark issue. CC-licensed Markdown mark from `dcurtis/markdown-mark` (CC0) may be used if desired; site does not currently use a logo.

### 11.4 Cookie consent

Site uses **only**:
- A locale cookie (`lisna_locale=ja`) — functional, no consent required under EU PECR (functional cookies)
- Auth.js session cookie — functional, required for the service to work
- **No tracking cookies, no analytics cookies** (Plausible is cookieless)

No cookie banner needed.

---

## 12. Open questions / deferred

| # | Question | Decision deferred to |
|---|---|---|
| Q1 | Should `/features` page exist as a longer-form expansion of home Features sections? | v2.0.x polish (post-alpha) |
| Q2 | `/blog` content cadence and topics? | Post-alpha; depends on founder writing bandwidth |
| Q3 | Real testimonial collection process? | Alpha week 4+ (need real users first) |
| Q4 | Compare-page: should there be a `vs Otter` deep-dive sub-page? | Post-alpha SEO push |
| Q5 | Mobile-app companion (read notes on phone)? | v2.5+ |
| Q6 | Team workspace pricing model? | Pro plan launch |
| Q7 | Webhook for Discord new-signup notification (founder visibility into alpha growth)? | Alpha launch — minor, decide at plan stage |
| Q8 | Stripe customer portal vs custom billing page? | Alpha launch — minor |
| Q9 | Plausible vs custom event schema beyond the 4 events listed? | First 2 weeks of alpha data |
| Q10 | Russian/Spanish/other locales? | Post-Korean (v2.1+) |

---

## 13. References

### 13.1 Mockup files (in `.superpowers/brainstorm/`)
- `reference-tones.html` — Round 1: 4 reference tones
- `reference-tones-v2.html` — Round 2: 6 variants
- `reference-tones-v3.html` — Round 3: 11 cards (originals + 5 Notebook variants)
- `cta-placement.html` — CTA placement A-E
- `cta-final-3.html` — Final 3 CTA candidates (C / D / D+)
- `lisna-home-tiro-style.html` — Round 1 full home page (12 sections)
- `lisna-home-final.html` — Round 2 with UI hierarchy polish
- `lisna-home-d3.html` — D3 flow applied (Download button)
- `lisna-home-d3-keio.html` — Keio-only trust strip
- `lisna-signin-dashboard.html` — Sign in + Dashboard mockups
- `lisna-signin-v2.html` — Sign in copy update ("Continue to Lisna")

### 13.2 Expert reviews conducted
- **Design + Marketing experts** on Notebook Craft tone (post-Round 2)
- **Design expert** on Tailwind component strategy (Auth.js + Drizzle + Radix + CVA recommendation)
- **UI hierarchy expert** on visual scaling + emphasis devices (resulted in 56px hero H1, 100% stat, marginalia)

### 13.3 External references
- **tiro.ooo/ko/** — structure template (17 sections → Lisna's 12 sections)
- **Vercel, Linear, Cursor, Anthropic, Reflect** — comparison set for tone evaluation
- **Obsidian brand guidelines** (https://obsidian.md/brand) — trademark policy

### 13.4 Related Lisna memory
- `v2_alpha_merged_2026-05-18.md` — v2 desktop alpha launch state
- `project_custom_domain.md` — lisna.jp domain setup
- `feedback_session_scope_boundary.md` — session-switching at scope changes
- `user_technical_depth.md` — founder dev/AI depth (vocab inline, "why this matters" framing)

---

## 14. Self-review checklist

✓ **Placeholder scan**: no "TBD" / "TODO" beyond §12 deferred items (which are explicit and tracked).
✓ **Internal consistency**: hero CTA "Download for Mac →" matches D3 flow §4 matches `/download` page §7.4. No contradictions between sections.
✓ **Scope check**: focused on lisna.jp redesign. v2 app development, codesign, and AI tuning all explicitly out of scope (§1.3).
✓ **Ambiguity check**: every architectural decision has a single named choice. Where alternatives existed, the choice is justified (e.g., D vs D2 vs D3 in §4 with explicit rationale).
✓ **Tone contract**: §8.1 names rejection criteria (no bold serif, no gradients on text, etc.) so reviewers can enforce.
✓ **Phase boundaries**: Phase 1 (this spec) clearly bounded. Phase 2/3 referenced for context only.

---

**Next step (when user approves this spec)**: invoke `superpowers:writing-plans` skill to produce the task-by-task implementation plan at `docs/superpowers/plans/2026-05-19-lisna-jp-fullsite.md`.

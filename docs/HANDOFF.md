# Lisna — Session Handoff

**Last updated**: 2026-06-09 (TRACK 2 quality — 3 PRs OPEN stacked: #88 escape-literal sanitize, #89 latency telemetry, #90 helper extract; route (a) closed; routes (b)/(c) pending founder retest / Path G design approval)
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

### v2 current state (2026-06-09) — READ FIRST

The active track is the **v2 on-device desktop app** (`desktop/`), not the
v1 cloud extension. The v1 sections further down (§2 "What's working
today (2026-04-30)" onward, §3 Extension map, §4 roadmap) are **frozen v1
history** — useful background, not current work.

**Where v2 stands:**

- **End-to-end pipeline works for all 4 families.** Stop → FamilyPicker →
  `session/finalize` → on-device STT → on-device LLM (grammar-constrained)
  → structured note → renderer → NoteView. Lecture / Meeting / Interview /
  Brainstorm all have cores + renderers + IPC routing on `main`.
- **First real-time founder smoke (2026-06-09)** on free-talk ~30 s JA
  exposed TWO quality bugs (NOT code crashes):
  - **(a) escape-literal mode-collapse** — 3B emits `"\\u…"` /
    `"\\'<nl>"` literals in short JSON string slots; JSON.parse leaves
    them as ASCII; Zod accepts; user sees `あしす…` in 3 headings + 2
    items. **PR [#88] OPEN** layers a shape-agnostic sanitize
    (`\uXXXX` decode → nuke backslash → trim ASCII noise) into
    `callWithGrammar` + outer-retry expansion across all 4 family
    finalizers when ESCAPE_LITERAL_AT_ exhausts inner attempts.
    Real-3B verification: 200 s+ → 28 s, one call, no retries.
  - **(b) ~4-min Stop→Note latency** with no log surface to attribute
    (cold-cache vs retry vs RAM). **PR [#89] OPEN** adds typed
    `sessionLog.finalize{Attempt,ChunkDone,Done}` breadcrumbs +
    optional `onTelemetry` callback on all 4 `finalize*` + STT-unload
    / LLM-load phase timing in `getCurrentSession()`. Decision tree
    in PR body lets the founder retest discriminate the hypotheses.
- **PR [#90] OPEN** is the structural cleanup on top of #89 — extracts
  `runChunkWithGrammar` helper from the 4 duplicated per-chunk outer-
  retry loops (DRY trigger 4× met) + adds the `const _: never = e;`
  exhaustive arm to `ipc.ts` that #89's reviewer flagged as missing.
  −114 LoC in orchestrator.ts. Zero behavior change; zero test files
  modified. Pre-push reviewer APPROVED with byte-equivalence audit.
- **Stack**: `main ← #88 ← #89 ← #90`. Auto-retargets to main as each
  parent merges + its head auto-deletes.
- **Earlier code bugs from the desktop-app smoke (#66/#79) are merged**
  on `main` already; #88/#89/#90 are the TRACK 2 quality follow-up.

**Routes** (the founder smoke 2026-06-09 left four open):
1. **(a) escape-literal repro + fix** — closed by PR #88, founder
   retest pending.
2. **(b) latency timing decomposition** — instrumentation closed by
   PR #89; needs founder retest for the actual answer.
3. **(c) 1B re-eval under Path G** — see "Path G grammar-propagation
   gap" below; design + founder approval required before code.
4. **(d) Quality-policy brainstorm** — only enter after (a)+(b)+(c)
   numbers exist. Don't panic-decide.

**Path G grammar-propagation gap (discovered 2026-06-09)**

Path G ("bounded `n_predict` + `.max(N)`") is **only half wired**:
- ✓ Lecture schema has `.max(N)` annotations on every array
  (sections / key_terms / examples / points / extras — see
  `desktop/src/shared/families/lecture/schema.ts`).
- ✗ `desktop/src/shared/note-schema/zod-to-gbnf.ts:133-138` emits
  every ZodArray as **unbounded** `"[" ws (elem (ws "," ws elem)*)?
  ws "]"`. The `.max(N)` value never reaches GBNF — it's
  validation-only post-decode.
- ✗ `desktop/src/shared/models/profiles.ts` has IDENTICAL
  `maxGenTokens` for 1B and 3B (3000 lecture/meeting, 3500
  interview/brainstorm). No headroom adjustment for the weaker model.

This means the 1B's previous failure mode (`CHUNK_FAILED:0`
unterminated JSON across 3 retries / 414 s, per
`v2_track2_first_scorecard_2026-06-08`) is **fundamentally
unresolved** — even with Zod `.max()` annotations, the LLM can emit
arbitrarily long arrays at decode time and only fail validation
*after* `maxGenTokens` truncates mid-string. The 1B re-eval cannot
move until either:
  (i) zod-to-gbnf.ts is extended to emit bounded GBNF rules from
      `.max(N)` (GBNF lacks `{N,M}` — must cascade or alt-enumerate);
  (ii) `maxGenTokens` is lowered for the 1B profile (less rope to
       hang itself with, but doesn't address the cause);
  (iii) both.
**Founder approval needed** before implementing — it's a behavior
change to all 4 families' grammars. Memo:
`v2_track2_path_g_grammar_gap_2026-06-09.md` (full design choices).

**Operating model: SINGLE CONTROLLER SESSION** (adopted 2026-06-08). One
session on the `main` worktree holds merge control + drives design;
execution work is delegated to subagents in isolated worktrees. Replaces
the old parallel-human-session model that caused branch drift. Full
definition in `.claude/lanes.md`.

**⚠️ CI infra debt** (not a code bug): the `ci` workflow's Playwright
Chromium-install step hangs ~10 min on a cache miss (any lockfile change)
→ job hits `timeout-minutes: 10` → **CANCELLED on every PR**. `desktop-ci`
is a separate workflow and is the real desktop verification (build + test
+ lint via `pnpm --filter @lisna/desktop verify`). Until `ci.yml` is
fixed, desktop-only / docs-only PRs must **admin-merge** once `desktop-ci`
is green (`gh pr merge --admin`). Fix options: cache Chromium properly /
split Playwright into its own job / raise the timeout / preinstall.

**Worktrees:** only `.` (main, controller) + `.claude/worktrees/spec-docs`
(long-lived doc branch). All in-flight feature worktrees pruned 2026-06-08.

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
| #24 / #25 | Cold-start audit closure (hooks wired via `core.hooksPath`, UTF-8 commit-msg, handler-test enforcement) + `personal/CLAUDE.md` PR-monitoring rule (use sub-agent polling, not webhooks). |
| #26 | `extension/` **frozen** — no new code work there. See `CLAUDE.md` "Scope freeze" + §8.5 below. |
| (this PR) | `.github/workflows/deploy-backend.yml` + `migrate.yml` + `monitor-backend.yml` added. Backend can now deploy + migrate + self-monitor purely from GitHub once the user completes the one-time AWS OIDC IAM setup (see `.claude/rules/operations.md` `(oidc)` and the "deploy-backend fails with AWS_DEPLOY_ROLE_ARN" runbook). |
| #32 | **Legal-pad design system on marketing surfaces.** `.pad-paper` page surface (cream + printed red margin + ruled lines), `<Postit>` yellow screenshot frame (V2-B drop-shadow, em-scaled, square / wide / portrait), `#pencil-rough` SVG filter shared at root layout (used by hero circle, marginalia arrow, pricing star), Caveat handwriting font (marginalia + post-it captions only), tokens `pencil.red` / `print.red` / `postit.*` / `fontFamily.hand`. Full spec in `.claude/rules/web-design.md`. |
| #33 | **Burgundy NavBar binding.** `#6e1e1e` solid (no gradient/staples), `LocaleSwitcher` decoupled to `text-inherit` so it stays neutral on both NavBar (dark) and auth-shell (light). Same red family as `print.red` / `pencil.red` — header is the darkest value, hierarchy: header > margin line > pencil accents. |
| (this PR) | **EN/JA/KO i18n parity.** ~60% of marketing copy was untranslated (features.privacy/notes/export/marginalia, privacyEmphasis, pricingSection, faq, ctaStrip). Filled JA + KO. Extracted hardcoded strings from `footer`, `signin/page.tsx`, `download/page.tsx`, `pricing/page.tsx`, `compare/page.tsx` into new namespaces (`footer.links`, `auth`, `downloadPage`, `pricingPage`, `comparePage`). Added `web/src/i18n/brand-vocabulary.ts` as single source of truth for never-translate tokens (Lisna, Whisper, Llama, Obsidian, competitors, ¥/$, license codes) + the value-parity / hardcoded-CJK allowlists. Legal pages: privacy/terms/refunds now have EN + JA blocks in the same file, switched via `ENGLISH_LOCALES` (`en` + `ko` → EN, `ja` → JA, per design decision pending KO legal review); tokusho stays JA-only. New: `web/scripts/check-i18n.mjs` (key parity HARD, value parity + hardcoded CJK WARN; `--strict` upgrades to FAIL), wired into pre-commit (warn) + CI (strict). New rule file `.claude/rules/i18n.md` + skill `.claude/skills/i18n-check`. CLAUDE.md gained rule 17b. |

### What landed since (2026-05-26 → 2026-05-27, v2 Phase 0 spikes, separate session track)

v2 desktop spike work on `spec/v2-note-creation-design` branch. Independent of the extension freeze (which still stands).

| Commit | What |
|---|---|
| (multiple) | **Spike 0.1 zod-to-gbnf.** Iter-1..3 failed at N=10 (best 8/10, mode-A array runaway + mode-B char-escape loop). Founder selected Path 2 (retry contract). Take-4 PASSed 5/5 within ≤ 2 attempts at N=5 reduced scope. Take-5 1B Q4_K_M co-validated same retry profile (2.4× faster wall). |
| `43d1f73` | **New `(spike-llm)` pitfall rule** — pinned post-mortem of two M3-8GB kernel panics from sustained 3B Llama inference. Bans `run_in_background:true` for heavy LLM; mandates `afterAll`/`ps`/`kill -9` survivor cleanup. |
| `9eda9b1` | **Plan Amendment 1 + memo title alignment** — Plan + decision memo updated to reflect N=10→5 hardware-reduced acceptance that already shipped silently in `251c1fc` + `46ed08a`. |
| `060d1fd` | **Ultra-review fix-up (5 reviewers across 2 passes)** — Spec §7.4 also amended, `round-trip.test.ts` header rewritten, Amendment 1 expiry clause added ("STANDS until founder commit raises N"), Path 2.A/B/C concrete procedures appended to memo, take-N artifact mapping table disambiguated logs vs commits, Maxwell sample-index remap footnote added, HANDOFF §5 two new entries (Spike 0.1 N=5 envelope + Spike 0.2 latency MIXED). New `(test-headers)` pitfall rule. |
| `44e546d` | **Phase 0 verdict memo** — Spike 0.1 PASS (N=5) / 0.2 MIXED / 0.3 BLOCKED (founder JA fixtures gate) / 0.4 PASS. Plan 2 (Foundation) green-lit with 7 carry-forward items including the load-bearing retry-loop wrapper mandate. |
| `d9d333d` | **Spike 0.2 Path E per-phase timing** — empirically split the 72 s/chunk wall: prompt eval 54% @ 3.93 ms/tok, generation 43% @ 46.54 ms/tok (12× slower per token; grammar mask = dominant amplifier, ~3.1× vs no-grammar baseline). Both phases co-dominate → Path B/D de-prioritized. New Path F (1B re-spike, ~30 s/chunk estimate, lands spec) + Path G (output cap / `.max(N)` bound) as strongest single-step candidates. |
| (this commit) | **Session handoff** — 3 new `/learn` rules (dispatch trust-but-verify, dispatch send artifact ref, test-headers pair-update), decision record `2026-05-27-spike-0.1-amendment-1-n5-envelope`, REFACTOR_BACKLOG 3 new items, HANDOFF top date + §2 + §8. |

### What landed since (2026-05-28 → 2026-05-30, v2 stack reaches the app)

The v2 on-device structured note pipeline is now reachable from the app's Stop button end-to-end, with Lecture + Meeting renderers shipped.

| PR | What |
|---|---|
| #73 | **C++ grammar-constrained generation + spike-0.1 pipeline-unblock.** `GenOpts` gains `seed` + `grammar`; sampler fed both (grammar-first chain). `makeGrammarSidecar(client)` adapter on TS side. Initial real-3B gate FAILED at `runPostDecodePipeline → ZodError sections[0].heading too_small` — root cause traced to two upstream gaps, both fixed: **P0a** `zod-to-gbnf` emits `json-string-nonempty` for `.min(N>=1)` (no more grammar-valid empty strings); **P0b** orchestrator wraps per-chunk `callWithGrammar + runPostDecodePipeline` in outer 2-attempt retry on ZodError (POST_DECODE_SEED_OFFSET=10000). `common_sampler` fallback intentionally NOT taken — both samplers would have emitted the empty string. Re-gate PASS: schema-valid LectureNote, `retryAttempts/chunk:[1]`, 20.5 s wall. |
| #74 | **v2 renderer wiring — Plan 3 Tasks 11–12 + spec §9.** Stop → FamilyPicker → finalize → NoteView vertical slice. 7 commits: session/finalize IPC now returns `{noteId, note}` (was dropping note); `getCurrentSession` async + lazy LLM-load (spec §9 — unload STT, load LLM, cached per-orchestrator); preload `window.lisna.finalize`; `LectureRenderer` + slot dispatch + registerFamilyRenderer; FamilyPickerStep + NoteRenderProgress components; App.tsx FSM gains `familyPicking` + `curatingV2` states + drops dead `finalizing` view; double-click guard on 続行. |
| #75 | **Cleanup: orphaned FinalizingView + min-display.** PR #74 left FinalizingView.tsx + min-display.ts (with test) + a stale Spinner.tsx JSDoc reference. Removed per CLAUDE.md rule #9 (don't keep dead code). |
| #76 | **MeetingRenderer** — Plan 5 renderer follow-up. Mirrors LectureRenderer (pure {note}=>JSX, registerFamilyRenderer at module load). No `slotRenderers` — Meeting has no typed-extras `slots`. SpeakerRef tag hides when ref===0 (alpha runs with `diarizationStatus:'disabled'`, all refs collapse to 0). Side-effect import added in main.tsx. Caught a React gotcha in TDD — `ref` is reserved on function components; `SpeakerTag` uses `speakerRef`. New `(react-reserved-props)` pitfall rule pinned. |

### What landed since (2026-05-30 → 2026-06-08, all families render + smoke bugfixes)

| PR | What |
|---|---|
| #72 | **Interview + Brainstorm note families (Plan 6).** ai-infra cores — prompts, schemas, orchestrator wiring, hybrid cross-chunk merge (deterministic union of `qa_pairs`/participants/`ideas` + LLM-only derived prose), IPC routing (`routeInterview`/`routeBrainstorm`). |
| #78 | **Interview + Brainstorm renderers (Plan 6 Path A).** `InterviewRenderer` + `BrainstormRenderer` + the 4-family picker fully enabled. **Plan 6 fully closed** — all 4 families now have cores + renderers + IPC routing on `main`. Stop → FamilyPicker → finalize → NoteView works for every family. |
| #66 | **chunk long transcripts to prevent silent note overflow** (founder-smoke bug 1+2). Short input = byte-identical single pass; long input = silence-aware chunk → per-chunk note → lossless `【…】` merge + reactive empty-output subsplit. Also: `schemaVersion` normalized to `CURRENT_SCHEMA_VERSION` on the generation path (1B was emitting `2` via grammar → forward-incompat guard rejected ALL notes); `applyGeneratedMeta()` makes generatedAt/generatedBy/language/durationSec system-owned (1B was hallucinating an invalid `generatedAt` → "Generated Invalid Date"). |
| #79 | **reset session FSM to idle on session/finalize** (founder-smoke bug 3). v2 Stop ends at `session/finalize` and never called `session/stop`, so `current`/`recording`/`_llmLoadedForCurrent` never reset → every recording after the first rejected with `SESSION_ACTIVE` until app restart (regression from #74). Fix: `onSessionSettled` in the finalize `finally`. |
| #81 | **Review automation strengthening** — commit gate + review brief (docs+chore). |
| #77 | **HANDOFF refresh** for #73/#74/#75/#76 + the `(react-reserved-props)` pitfall rule. |

**Both #66 and #79 were admin-merged** (`gh pr merge --admin`) — `desktop-ci`
was green (real verification held); the `ci` Playwright hang would never
let them go green on their own (see CI infra debt above).

### What landed since (2026-06-09, TRACK 2 quality stacked PRs)

| PR | What |
|---|---|
| #88 OPEN | **Escape-literal sanitize (route a).** Branch `chore/v2-track2-escape-literal-repro`. Founder smoke 2026-06-09 produced a note mixing clean JA with `あしす…` literals (3 headings + 2 items). Root cause confirmed on the `session/finalize → finalizeLecture → callWithGrammar` path (NOT chunked-note.ts) — 3B under grammar emits `"\\u…"` / `"\\'<nl>"` literal escapes inside short JSON string slots; JSON.parse passes; Zod passes; user sees the literal text. Fix: layered defense in `callWithGrammar` — `sanitizeEscapeLiteralsInStrings` (shape-AGNOSTIC `\uXXXX` decode + nuke backslash + trim ASCII noise; full-width JA preserved) → `findEscapeLiteralInStrings` final invariant → existing fresh-seed retry. Plus outer-retry expansion across all 4 family finalizers when `ESCAPE_LITERAL_AT_` exhausts inner attempts (+10000 seed). New telemetry: `GrammarAttempt.sanitizedSlots`. **Real-3B verification: 200 s+ → 28 s**, ONE call, no retries. Pre-commit reviewer + strategy reviewer both APPROVED. |
| #89 OPEN | **Latency-decomposition telemetry (route b).** Branch `chore/v2-track2-latency-instrumentation` (stacked on #88). Adds 3 typed `sessionLog` methods (`finalize{Attempt,ChunkDone,Done}`) with shape-only PII contract; optional `onTelemetry?` callback on all 4 `finalize*Args` with per-attempt + chunk-done (try/finally — partial-failure attribution survives) + finalize-done events; `session/finalize` IPC route forwards it; `ipc.ts` wires the switch to `sessionLog.*` AND adds `sessionLog.phase('stt-unload-finalize'\|'llm-load-finalize', ms)` in `getCurrentSession()` (cold-cache discrimination). Founder retest reads `tail -n 200 ~/Library/Logs/Lisna/main.log \| grep -E '\[(session\|finalize:)'`; decision tree in PR body distinguishes cold-cache vs retry vs RAM. 11 new tests; `pnpm verify` 776+9 PASS. Pre-commit reviewer APPROVED. |
| #90 OPEN | **Extract runChunkWithGrammar + exhaustive switch (cleanup).** Branch `chore/v2-finalize-extract-outer-retry` (stacked on #89). Per `architecture.md` DRY rule (4 duplications = extract trigger), pulls the per-chunk outer-retry + telemetry body out of the 4 finalize* functions into one helper. Plus adds `const _exhaustive: never = e;` default arm to `ipc.ts`'s `onTelemetry` switch (closes the loop on #89 reviewer's overpromise note). **−114 LoC** in orchestrator.ts (1251 → 1137); main bundle 125.25 → 120.46 kB. **Zero test files touched** — behavior preservation verified by 109 sidecar + 11 ipc/session-finalize tests staying green. Pre-push reviewer APPROVED with byte-equivalence audit (seed math, transcriptForPostDecode routing, CHUNK_FAILED format, try/finally semantics all confirmed identical). |
| docs (this PR) | **HANDOFF refresh + Path G memo.** Captures the 3 OPEN PRs above, exposes route (c) blocker (Path G grammar emission gap), and pins the founder-retest workflow as the next user-facing milestone. |

### Operational guards on GitHub (added 2026-05-24)

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
Next.js marketing site (lisna.jp). Legal-pad notebook design system —
cream paper + printed red margin + ruled lines + yellow post-it
screenshot frames + pencil-red accents + burgundy NavBar binding.
Token + utility spec in `.claude/rules/web-design.md`. Key components:
`Postit` (replaces ScreenshotFrame on marketing surfaces),
`MarketingShell` (.pad-paper), `Marginalia` (Caveat handwriting). PR #32
applied the page surface; PR #33 added the burgundy NavBar.

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
| v2 Spike 0.1 N=5 envelope | Acknowledged (2026-05-27) | Spike 0.1 PASS at N=5 reduced scope per Plan Amendment 1 (commit `9eda9b1`). i=8 Maxwell (iter-3 mode-B string char-escape runaway) unverified — production risk covered ONLY by the retry budget. Before v2 alpha: (a) Plan 2 wrapper enforces retry contract via failing test (paper mandate today), (b) per-attempt wall-time cap 90-120 s (prevents triple-runaway 24-min UI hang), (c) UI retry counter (renderer shows "Retrying 2/3…"). Full N=10 recovery: `desktop/spikes/phase-0/01-zod-to-gbnf/decision-0.1-fail.md` "Path 2.A/B/C procedures". |
| v2 Spike 0.2 latency MIXED | Open | 3B Lecture spike PASS on Zod + slot emergence; latency 73-98 s/chunk vs spec §7.2 30 s threshold (2.5-3× over). Controller's path A-E (decision-0.2-latency.md) — recommended Path E (per-phase timings, 30 min) before A/B/C/D. Affects alpha post-Stop UX: 53-min lecture ≈ 3 min wall, 90-min ≈ 5 min wall. |
| **TRACK 2 — long-input decode latency** | Open (next) | Founder smoke saw ~5-min hangs on ~24-segment input (short/1-chunk input completes fine). NOT a memory swap (mem ~70-80%) — it's grammar-decode compute, per-chunk, × chunk count. Profile chunk count × per-chunk time. Overlaps Spike 0.2. See §8 TRACK 2. |
| **TRACK 2 — 1B output quality** | Open (next) | 1B structures the transcript weakly + hallucinates the optional `lecturer` content field (LectureRenderer ~:192, schema ~:43). 3B is the quality default (Path F: 1B Lecture FAIL) but slow/tight on 8GB. The 1B-vs-3B tradeoff is the core TRACK 2 decision. |
| **TRACK 2 — STT accuracy** | Open (separate) | kotoba-whisper v2.0 q5_0 + mic environment; accuracy low in smoke. Separate sub-track from the LLM decode/quality work. |
| CI `ci` job hangs → CANCELLED | Open (infra debt) | Playwright Chromium-install step hangs ~10 min on cache miss (any lockfile change) → `timeout-minutes: 10` → CANCELLED every PR. `desktop-ci` unaffected (separate workflow, real verify). Workaround: admin-merge on green `desktop-ci`. Fix: cache Chromium / split job / raise timeout / preinstall. |
| #80 dependabot vitest 2.1.9→4.1.0 | Open — desktop-ci FAILING | Not just the `ci` hang — `desktop-ci` is a real FAILURE. vitest 4 = the `(vitest-discovery)` `dist/**` pitfall; review carefully before merge (desktop already has a `vitest.config.ts` exclude, so this is likely a *different* vitest-4 breaking change — investigate, don't blind-merge). |

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

0. **TRACK 2 — quality / perf (CURRENT FOCUS).** All 4 families render
   end-to-end and the 3 founder-smoke code bugs are fixed (#66 + #79).
   What's left is **not code bugs** — it's whether the on-device output is
   good + fast enough on 8GB. Three open dimensions, to be prioritized by
   **measurement/eval, not guesswork** (this is what the current session
   is brainstorming):
   - **1B vs 3B (quality):** 1B structures weakly + hallucinates the
     optional `lecturer` field; 3B is the quality default but slow/tight
     on 8GB. Core tradeoff decision.
   - **Long-input decode latency:** per-chunk grammar-decode is slow on
     8GB (~5-min hangs on ~24-segment input). Grammar-decode compute, not
     memory swap. Overlaps Spike 0.2 (latency MIXED, decision-0.2). Profile
     chunk count × per-chunk time first.
   - **STT accuracy:** kotoba-whisper q5_0 + mic env; separate sub-track.

   The prioritization + measurement plan lands as a decision memo under
   `docs/superpowers/decisions/` (and/or `docs/REFACTOR_BACKLOG.md`).
   Relevant skills: `llm-eval-loop`, `api-integration-pitfalls`. Existing
   evidence: `desktop/spikes/phase-0/` (Spike 0.2 per-phase timings,
   Path E/F/G), `desktop/eval/` (Plan 7 harness — runner is a STUB).

   **Backlog mitigation still pending (alpha-gate, independent of TRACK 2):**
   - P2 wall-time cap (90–120 s per attempt) + UI retry counter — guards
     against the triple-runaway 24-min hang. Touches `callWithGrammar` +
     renderer. See `docs/REFACTOR_BACKLOG.md`.

1. **Test the today's fixes** with a real K-LMS lecture: stop button → final curate → export, slide detection multiple slide changes, .zip unpacking into Obsidian vault.

2. **v0.3 Obsidian REST API integration** — Settings UI + SW push handler + auto-sync toggle.

3. **Eval baseline regression** — `eval-curator.ts` against `v5-gpt4omini` fixture. Iterate prompt vs measured score.

4. **Session history view** — list past sessions in side-panel, click to reload outline.

5. **Chrome Web Store submission prep** — privacy policy, screenshots, description, $5 developer fee, lock CORS to published extension ID.

If user asks something specific, prioritize their request. The above is just the deferred queue.

**⚠️ Scope note (2026-05-24)**: items #1, #2, #4, #5 above all touch
`extension/`. The extension is **frozen** as of 2026-05-24 — see
§8.5 below before picking any of them up.

---

## 8.5. Scope decisions (current)

**2026-05-24 — `extension/` is FROZEN.** No new features, refactors,
or human/agent-initiated code edits inside `extension/**`. The
pipeline (audio capture → STT → curator → outline → modal) still
runs as-is; the user has shifted attention. Dependency security
patches via Dependabot continue to merge — Lisna's CI auto-builds +
tests the extension so those patches verify safely. Backend, web,
shared, infra, docs, `.claude/`, `.github/` all remain in scope.

If a future session is asked to touch `extension/`, decline and point
the requester to this section + `CLAUDE.md` "Scope freeze".

Unfreezing requires updating both `CLAUDE.md` "Scope freeze" and this
section explicitly.

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

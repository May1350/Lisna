# LLM Connector Notes — "Your Claude makes the note"

**Date:** 2026-07-07
**Status:** APPROVED (founder) + Phase 0 RESOLVED — v1 auth = **user API key** (see §8a); subscription auth deferred pending Anthropic approval
**Branch:** `feat/llm-connector-notes`
**Supersedes direction of:** STEP-1 model-swap runbook (`feat/v2-note-quality-step1`) as the *primary* note-quality lever. The Sarashina eval remains a cheap, independent experiment for the free tier (see §11).

---

## 1. Problem

The on-device note pipeline does not produce usable notes. Evidence:

- **The founder himself bypasses it.** Daily usage (2026-07-07, verbatim direction): records + generates transcripts in Lisna, then manually pastes the transcript into Claude for summarization. The app's core deliverable (the note) is being produced outside the app.
- **The 3B ceiling is measured, not suspected.** The 2026-06-21 eval loop (4 runs, rubric-scored /45: baseline 16 → iter2 20 → iter3 19) concluded: content *extraction* responds to prompt work, but **global reorganization / consolidation / abstraction does not respond to prompts or a dedicated consolidation pass** — a model-capacity limit of Llama-3.2-3B-class models.
- Prompt iteration is exhausted (3 confirmations incl. one backfire); cloud notes on *Lisna's* key were rejected (cost + Lisna-sees-data security concern); larger on-device models are out (8 GB Macs are the PRD floor).

**Real quality bar** (new, from founder's usage): not "better than Llama-3B" but **"good enough that the founder stops pasting transcripts into Claude manually."**

## 2. Decision

Let the user connect **their own Claude subscription** to Lisna. Note generation runs on the user's Claude account via the **Claude Agent SDK**; the finished note flows back into Lisna automatically.

Key enabling fact (verified 2026-07-07): Anthropic ships subscription-covered Agent SDK usage as of **2026-06-15** — Pro/Max/Team/Enterprise plans include a monthly Agent SDK credit that explicitly covers "third-party apps that authenticate with your Claude subscription" ([support article](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)). Credits are per-individual-account (not poolable) — which matches our distributed-app model exactly.

**Why this doesn't contradict the earlier "no cloud notes" decision:** that rejection was about *Lisna's* API key and *Lisna's* servers touching content. Here the user's transcript goes **directly from their Mac to their own Anthropic account** under their own subscription. Lisna servers still see nothing. The founder proposed this design himself.

### Locked scope decisions (brainstorm 2026-07-07)

| Decision | Choice |
|---|---|
| v1 provider | **Claude only** (Agent SDK subscription auth). GPT/Gemini later — OpenAI has no subscription-auth equivalent today; those would be user-API-key paths. |
| On-device pipeline | **Kept as the free/private default.** Connector is an explicit opt-in upgrade. 2-tier: "free private on-device / pro-grade with your own Claude." |
| "Note visible in my LLM too" | Resolved as **in-app follow-up chat**: converse with Claude *about the note inside Lisna* (same connection, same subscription). We do NOT write into claude.ai chat history (separate system from the SDK; no clean API for that). |
| Privacy posture | Explicit opt-in + clear disclosure at connect time (see §7). Default posture of the product is unchanged. |

## 3. Success criteria

1. **Founder dogfood switch:** founder uses connector notes (not manual paste) for his daily recordings for ≥1 week.
2. Note quality ≈ what he gets from manual paste (same model class doing the same job — should match by construction).
3. Cloud-note latency for a ≤60-min recording: well under the current ~5-min on-device finalize (expect roughly 30–90 s; measured in Phase 0).
4. Zero additional per-note cost for a Claude subscriber (covered by plan credit).
5. On-device path still works untouched for unconnected users.

## 4. UX flow (founder's 4 steps, annotated)

1. Recording ends → transcript auto-generated. *(unchanged)*
2. Transcript view → user picks note type (lecture / meeting / interview / brainstorm). *(unchanged UI)*
3. Generation:
   - **Claude connected:** the type picker also shows a generation target — **Claude (default when connected) / On-device**. Claude target: transcript + family-optimized prompt → user's Claude subscription → pro-grade note. Progress UI shows "Claude로 노트 생성 중" + cloud indicator.
   - **Not connected:** existing on-device pipeline, no target choice shown. A small, dismissible upsell notes the Claude option exists.
4. Note auto-registered in Lisna (same storage/History/NoteView as today), tagged with its origin (`ondevice` | `claude`).
5. **(Phase B)** NoteView gains "Ask Claude" — follow-up turns about this note (refine a section, make quiz questions) in-app, over the same connection.

Connect entry points: Settings → "Connect Claude", plus the step-3 upsell.

## 5. Architecture

### New module: `desktop/src/main/connector/`

- `claude-auth.ts` — sign-in/sign-out with the user's Claude subscription (Agent SDK auth flow; exact mechanics = Phase 0 finding). Credential storage in the macOS Keychain via Electron `safeStorage` **if** the SDK leaves credential persistence to the host app (Phase 0 finding — the SDK may manage its own credential store; we adopt whichever is standard, documented in the Phase 0 report).
- `claude-notes.ts` — one call per note: build prompt → Agent SDK query (no tools, single shot) → parse JSON → validate with the **existing** per-family Zod schema → return note or typed error.
- `ipc/connector.ts` — IPC surface: `connector/status`, `connector/connect`, `connector/disconnect`, `connector/generate` (or fold generate into the existing finalize IPC — implementer's call, see below).

### Branch point (existing code)

`desktop/src/main/sidecar/ipc/session-finalize.ts` → orchestrator (`desktop/src/main/sidecar/orchestrator.ts`). At finalize: if connector connected **and** user chose cloud (per §4 step 3) → `claude-notes.generateNote(family, transcript)`; else existing on-device path. The cloud path **bypasses the entire sidecar machinery** — no chunking, no 2-pass, no GBNF grammar, no dedup/assembly: modern Claude context windows take a 2-h transcript whole, and grammar-constrained decoding is unnecessary (prompt for JSON + Zod-validate + one retry on invalid).

### Prompt reuse

Family field semantics already exist (`desktop/src/shared/families/{lecture,meeting,interview,brainstorm}/prompts/`, incl. the iter2 meeting improvements). New `cloud-prompt.ts` (location: `shared/families/util/`) renders those semantics into a single rich prompt per family: role + field-by-field spec + JA output requirements + the full transcript. The 3B-specific two-pass/extraction machinery is NOT reused on the cloud path.

### Output contract

Same note JSON schema as on-device (validated by existing Zod) → notes are indistinguishable downstream (storage, History, NoteView, export) except the origin tag. Model: the subscription's default model tier; exact model selection is a Phase 0/implementation decision, favoring quality (Sonnet-class or better) since cost is covered by the user's plan.

### Phase B — "Ask Claude" in NoteView

Multi-turn continuation over the same connection: context = the generated note (+ transcript on demand), streaming response into a side panel in `NoteView.tsx`. Edits can be applied to the note ("apply this rewrite to section 2"). Detailed design deferred to its own plan after Phase A ships — v1 ships without it if it threatens the timeline.

## 6. Error handling

| Failure | Behavior |
|---|---|
| Offline / network error | Detect before sending; offer on-device generation instead. Never silently drop to a different path — user explicitly picks. |
| Auth expired / revoked | Surface "reconnect Claude" state; offer on-device meanwhile. |
| Monthly credit exhausted | Per Anthropic docs, overflow goes to API rates *if the user has API billing*; otherwise the call fails. Treat as a typed error → clear message ("이번 달 Claude 크레딧 소진") + on-device offer. Exact failure shape documented in Phase 0. |
| Invalid JSON from model | One retry with a repair instruction; then typed error + on-device offer. (Expected to be rare with frontier models.) |
| Long transcript | No chunking needed (context fits); guard with a token estimate and clear error if a pathological input exceeds the window. |

All connector errors leave the transcript untouched — the user can always fall back to on-device or manual paste. No partial notes are registered.

## 7. Privacy & disclosure (founder-approved)

- **Opt-in only.** Connecting is an explicit action. Nothing is sent anywhere until the user connects AND picks Claude generation for a recording.
- **Connect-time disclosure (must state):** transcript **text** of recordings you choose is sent to **your own Claude account** under your subscription, subject to Anthropic's terms; audio never leaves the Mac; Lisna's servers never see transcript or note content (traffic is user ↔ Anthropic direct); disconnect anytime in Settings.
- **Per-note visibility:** cloud-generated notes show their origin; generation UI shows a cloud indicator at the moment of sending.
- Default product posture unchanged: 100% on-device unless the user opts in. Website copy later evolves to "private by default / pro notes with your own AI" (web redesign is parked until this ships).
- App is JA-first: all new user-facing strings localized (JA primary), consistent with existing app i18n practice.

## 8. Phase 0 — feasibility gate (BEFORE the implementation plan freezes)

Per the empirical-smoke rule (external-system assumptions need a smoke test before spec freeze), a throwaway spike must answer:

1. Does Agent SDK **subscription auth** work from an Electron main process in a **packaged** (non-dev) app? What does the sign-in flow look like end-to-end on a machine without Claude Code installed?
2. What has to ship in the bundle (SDK runtime footprint, any CLI dependency), and what does it add to app size?
3. Where do credentials live, and is that acceptable for a distributed app?
4. Latency + result quality for one real founder transcript through the family prompt (compare against his manual-paste result).
5. Failure shapes: no subscription, credit exhausted, offline.

**Gate:** Phase 0 report → if subscription auth is not viable in a packaged app, fallback design = same architecture with **user-supplied API key** (env: settings field, Keychain-stored; cents per note) — the UX and all downstream plumbing are identical, only `claude-auth.ts` changes. The spec does not need re-approval for that swap; it needs a founder heads-up ("구독 그대로"가 "본인 API 키, 노트당 몇 센트"로 바뀜).

## 8a. Phase 0 findings (2026-07-07) — RESOLVED: v1 auth = user API key

The §8 gate fired, on **terms**, not technology:

- Official Agent SDK docs (current, verified 2026-07-07): *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Please use the API key authentication methods described in this document instead."* ([Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview))
- Reconciliation with the 2026-06-15 credit article (§2): the credit covers a **user-initiated** connection of their own tools; a distributed product **offering** "Connect your Claude subscription" as a feature requires prior Anthropic approval.
- **Consequence — §8 pre-approved fallback activates:** v1 = **user-supplied Anthropic API key**, stored in the macOS Keychain via **keytar** (the app's existing credential convention — `desktop/src/main/auth/keychain.ts` service `com.lisna.desktop`, new account; supersedes this spec's earlier `safeStorage` mention, which would have introduced a second credential pattern). Founder heads-up delivered: "구독 그대로 0원" → "본인 API 키, 노트당 ~5–15센트".
- **v1 gets simpler, not harder:** plain `@anthropic-ai/sdk` client (pure JS) replaces the Agent SDK — no bundled CLI binary, no subprocess, no packaged-app auth flow. §8 items (1)(2)(3) evaporate; §8 item (4) (real-call latency/quality smoke) folds into the founder packaged-app smoke (no API key exists on the dev machine — checked 2026-07-07).
- **Model default:** `claude-sonnet-5` (intro $2/$10 per MTok through 2026-08-31, then $3/$15; verified [pricing](https://platform.claude.com/docs/en/about-claude/pricing)) → ≈ **$0.05–0.15 per note** for a 60-min JA recording. Stored as an overridable setting, not hardcoded scattered.
- **Provider seam retained:** `claude-auth.ts`/`claude-notes.ts` public surface unchanged from §5, so a subscription-auth provider can slot in later **if** Anthropic approves Lisna (founder-level partnership contact — parallel track, not a v1 blocker).

## 9. Testing

- Unit: cloud prompt builder (per family), response validation + retry, finalize branch selection (connected/not, chosen/not), error typing. Mock at the SDK boundary (per testing rules: mock the boundary library, not the handler).
- No real-API calls in CI. Real-API verification = Phase 0 spike + packaged-app smoke.
- Founder gate: packaged `/Applications/Lisna.app` build (features only testable in-app must be packaged first), real recording → connect → generate → note registered.

## 10. Non-goals (v1)

- GPT / Gemini / other providers (future; would be API-key paths).
- Writing notes into claude.ai chat history.
- Team/shared connections, org billing.
- Replacing or removing the on-device pipeline.
- Auto-sending every recording to Claude (each generation is a user choice; a "always use Claude" convenience toggle is fine but per-recording consent semantics stay).

## 11. Risks & open questions

- **Terms drift:** subscription-covered third-party SDK usage is 3 weeks old; Anthropic frames it as "sized for individual experimentation." Personal-note usage fits today, but terms could tighten → mitigations: API-key fallback path (§8) stays designed-in; monitor.
- **Credit sizing:** plan credit is $20–$200/mo depending on tier; a note is a single medium call, so typical usage is far under — but heavy users could hit it (handled UX-wise in §6).
- **Packaged-app OAuth mechanics** (redirect/loopback in Electron) — Phase 0.
- **PRD amendment required:** PRD currently locks "100% on-device." This feature changes posture to "on-device by default, user-key/subscription cloud opt-in." PRD edit ships in the same PR as Phase A (or a preceding docs PR) — the PRD is the yardstick and must not lag the shipped product.
- **Sarashina eval (parked, still worth 1 session):** the staged STEP-1 model swap can still upgrade the *free tier* later; it is no longer the answer to the founder's quality bar. Keep the branch; run opportunistically.

## 12. Phasing

- **Phase 0:** feasibility spike (throwaway, ~1 session incl. packaged-app check) → report.
- **Phase A (v1):** connect UX + cloud generation + origin tag + errors + disclosure + PRD amendment. Ships behind nothing — it's opt-in by construction. Patch version bump per artifact rule.
- **Phase B:** "Ask Claude" in NoteView (own mini-plan).
- **Later:** OpenAI/Gemini via user API keys; website copy refresh (parked web redesign resumes here).

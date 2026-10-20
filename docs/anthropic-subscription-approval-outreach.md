# Anthropic outreach — approval to offer Claude-subscription auth in Lisna

**Status:** DRAFT for founder to review + send. This is a business/partnership ask that must come from the founder's identity — Claude cannot send it.

**Why we need it:** The Agent SDK docs state (verified 2026-07-09): *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."* So letting Lisna users sign in with their own Claude Pro/Max subscription (the $0-marginal path) requires Anthropic's prior approval. The June-15 "separate capped credit" billing change was *paused* — once approved, subscription usage draws from the user's normal plan limits — but that pause did not open the permission gate.

**Where to send (candidate channels, in priority order):**
1. **Anthropic sales / partnerships contact form** — the Agent SDK docs point partner/branding/approval questions here: https://www.anthropic.com/contact-sales
2. **Claude partner waitlist** (Claude-powered products): https://claude.com/marketplace-partners — enterprise-leaning, but the intake team routes eligibility.
3. If you have any existing Anthropic contact (developer relations, an AE), that direct thread beats a cold form.

**Honest expectation:** the formal Claude Partner Network / Services tiers are enterprise-scale (10+ certified individuals, multiple production joint customers) and do NOT fit a solo/indie app — so this is a direct-ask, not a self-serve application, and the timeline is uncertain (partner intake is quoted at ~6–8 weeks; an app-login approval may differ). Treat it as a parallel track, not a release blocker.

---

## Draft message (edit freely, then send)

**Subject:** Approval request — offer Claude subscription sign-in in a third-party app (Lisna)

Hi Anthropic team,

I'm the founder of **Lisna** (https://lisna.jp), a privacy-first macOS app that records meetings/lectures and transcribes them fully on-device. It's live in the Japanese market.

I'd like to request approval to **let Lisna users authenticate with their own Claude subscription (Pro/Max) via the Claude Agent SDK**, so that the app can turn a user's transcript into a structured note using *their own* Claude plan — rather than requiring each user to create and pay for a separate Anthropic API key.

Context and why I'm asking:
- Our on-device model produces transcripts well, but note-quality (summarize/reorganize a long transcript) needs a frontier model. Today users copy their transcript into claude.ai by hand; we want to make that one seamless step inside the app.
- We've already **built the integration on API-key authentication** (using `@anthropic-ai/sdk`), and our auth layer is isolated so switching to subscription-based sign-in is a contained change. Transcript text is sent directly from the user's Mac to the user's own Anthropic account; our servers never see user content.
- The Agent SDK docs note that offering claude.ai login in a third-party product needs prior approval, which is why I'm reaching out.

We're an early, indie-scale product (not enterprise services). Could you point me to the right process, eligibility, and any terms for a third-party app to offer Claude-subscription sign-in? Happy to share our integration details, security posture, and disclosure UX.

Thank you,
[Founder name]
[contact email]
Lisna — https://lisna.jp

---

## Code readiness (so the "is your integration ready?" answer is yes)

- Auth seam isolated to **`desktop/src/main/connector/claude-auth.ts`** (credential) + **`claude-client.ts::defaultCreateClient`** (client construction). Subscription swap touches only these two.
- Everything downstream (prompt build, note validation, origin tag, error handling, disclosure UX, connect/disconnect flow) is auth-agnostic and shipped.
- Privacy posture for the pitch: on-device by default; opt-in only; transcript goes user→Anthropic direct; Lisna servers see nothing (matches PRD amendment + spec section 7).

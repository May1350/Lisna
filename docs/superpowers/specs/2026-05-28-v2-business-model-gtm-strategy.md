# Lisna v2 — Business Model & GTM Strategy (SETTLED v1)

**Date:** 2026-05-28
**Status:** SETTLED (v1). Brainstormed → independently reviewed (2 adversarial) →
Apple threat VERIFIED → **DEFEND-with-reframe CONFIRMED by founder**. Open only: the
beachhead segment (founder confirms by actual reach). Price points still provisional.
**Canonical copy of this analysis = memory `v2_bm_gtm_strategy_2026-05-28.md`** (this
in-repo file was git-clean'd once by a parallel session on shared `main`; if it
disappears again, restore from memory and commit on a dedicated branch/worktree).
**Concept yardstick (locked, PRD):** "every spoken sound, on the user's own device,
turned into structured text — an hour of audio readable in 5 minutes."

---

## 0. Why this doc exists

Business-review session. Core problem: **how to monetize an on-device,
zero-marginal-cost, privacy-first product.** v2 (Mac desktop, on-device) is THE real
launch; v1 (Chrome extension, cloud) is FROZEN — failed on reach/install-friction.
Founder = indie/bootstrap, B2C self-serve, **no enterprise sales**.

## 1. BM decisions (settled)

- **Buyer:** B2C self-serve — specifically the **solo professional** (see sec 5),
  not the consumer/salaryman and not the enterprise.
- **Monetization principle:** never gate on usage/minutes (zero marginal cost); gate
  on **capability/depth**. Transcription = commodity = free; note intelligence = paid.
  *(Both reviewers: strongest part of the strategy.)*
- **Pricing form:** lifetime-led (~$99–129) + subscription fallback (~$5.99–9/mo),
  free unlimited. *(Revised from the initial $9/mo-spine by review: privacy-buyers
  distrust subscriptions; indie has a trust deficit; lifetime aligns with the "runs
  on my machine, no account" story.)* Numbers provisional until pricing-finalize.

## 2. Competitive landscape (verified May 2026)

**On-device peers (the REAL competitors — same position):** MacWhisper (~$69 lifetime;
transcript-first + generic BYO-LLM summary; HAS meeting capture + diarization; NO
domain families/JA tuning). Superwhisper (free + $8.49/mo / $250 lifetime;
dictation-first BUT Meeting mode = on-device system-audio capture + LLM summary +
action items; ships **Qwen3-ASR** = on-device CJK; **Custom Modes** = user-authored
prompts → a 議事録 prompt-pack is hand-rollable). Aiko ($22), VoiceInk (OSS $25–49).
**Cloud incumbents:** Granola/Otter/Fireflies/Fathom/tl;dv/Notion AI — all require
account + upload; we beat them on privacy/no-upload.

## 3. Independent review findings (2 adversarial reviewers)

Both independently said "feature, not a business — as framed." Two near-fatal holes:
- **Hole A (existential): Apple Intelligence** may have commoditized the privacy wedge.
- **Hole B: the free/Pro line starves the paying segment** (meetings are multi-speaker;
  diarization behind Pro → meetings barely work free → payers gated, free-sufficient
  students evangelize but never pay → "adoption, no revenue").
Strengths kept: gate-on-capability-not-minutes; honest moat map; "own a verb" ambition.
Convergent fixes: re-draw free line (meetings must work free); lead with lifetime;
named JP distribution (Setapp). Proposed pivot: re-anchor on cumulative KB/synthesis +
regulated JP verticals. **Controller calibration:** "feature not a business" is a
VC-lens; for a bootstrapper the bar is sustainability, where soft-moat + tempo niches
are viable — so "no hard moat" is secondary; Apple + free-line are the must-address.

## 4. Apple Intelligence threat — VERIFIED (2026-05-28, 2 research agents)

R2's "Apple ate the privacy wedge" is HALF-right.
**Apple DOES** (free, M1+, Notes/Voice Memos): mic / Phone-call → live transcription →
one-tap **flat** summary; Japanese live since Apr 2025; more trusted than an indie.
→ **"on-device privacy" ALONE is no longer a wedge — drop it as the pitch.**
**Apple does NOT (verified gaps = Lisna's ground):**
- **System-audio capture** — CANNOT transcribe other apps' audio (Zoom/Teams/Meet,
  browser-played lecture). OS-level block (mic + Phone/FaceTime only). DURABLE moat
  (OS-policy gap, not a model-quality gap). = exactly PRD scenarios 1 + 2.
- **Diarization** — absent (the paying JP 議事録 market competes ON it).
- **Domain note-families + cumulative cross-recording KB** — Apple = flat per-recording.
- **Meeting-grade JA quality** — lossy, no diarization, worse than Whisper (erodes →
  wedge not moat).
Context: Japan's MSCA (Dec 2025) forces Siri-replacement → Apple AI not a locked JP
default. Apple also shipped SpeechAnalyzer/SpeechTranscriber (faster than Whisper) +
Foundation Models framework → possible "consume Apple STT for mic, own pipeline for
system-audio + structure" hedge (evaluate later).
**DECISION: DEFEND-with-REFRAME** (not pivot-away, not defend-unchanged).

## 5. Resulting strategy refinement (CONFIRMED by founder 2026-05-28)

- **Positioning reframe:** DROP "private/on-device" as the headline. New headline:
  **"captures what Apple can't (system audio — your remote meetings + streamed
  lectures), structured the way Apple won't (diarized + domain note families + a
  knowledge base that compounds)."** Privacy = feature/hygiene, not the pitch.
- **Free tier (also fixes Hole B):** free hook = **system-audio capture + basic
  structured note + light (2-speaker) diarization** — the Apple-can't territory, where
  meetings actually WORK on free. NOT mic + flat summary (Apple's free turf). Pro =
  all families, 3+ speakers, all languages, cumulative KB / cross-note synthesis,
  integrations.
- **Moat stack (evidence-based):** (1) system-audio = OS-policy gap, durable; (2) note
  families + cumulative KB = product-design gap, durable + compounds; (3) diarization
  = meeting table-stakes Apple lacks; (4) meeting-grade JA quality = beachhead wedge.
- **Distribution:** notarize + Setapp + JP-localized landing + JP Mac newsletters /
  note YouTubers.

**JP-payer tension — RESOLVED.** The paying self-serve buyer is the **SOLO
PROFESSIONAL** (their own buyer; no IT/procurement) — the gap between free-consumer
(Apple) and enterprise B2B (Notta/Sakura, which the founder won't chase). NOT the
salaryman. Keeps B2C self-serve + no-sales while capturing real WTP. **Privacy REVIVES
(precisely) for the confidentiality-bound subset** (士業 / medical / legal /
counselling) — on-device is a genuine requirement there, the only segment where the
privacy wedge survives Apple. Alignment: free = students (lectures); paid = solo
professionals (meetings / interviews / consultations) — maps 1:1 to note families.

**Product breadth vs GTM breadth — RESOLVED: build broad, launch narrow.** The
situation-adaptive note families ARE the product + the differentiation — build them
broad. But ENTER through ONE person+situation beachhead and make it undeniably great;
the rest are sequenced, not abandoned. Breadth = expansion roadmap; beachhead = entry
message. (Superhuman / Notion / Slack: general product, narrow wedge.)

**Beachhead (PROVISIONAL — founder confirms by actual reach).** Recommended entry =
**researchers / academics** (interview family first — already planned; reachable incl.
English; grant budgets; validation-friendly), expanding to **regulated solo pros**
(士業 / medical / legal — highest defensibility: privacy revives + domain-format moat).
Freelancers/consultants = volume but least defensible. **Decisive input = which
segment the founder can actually reach.**

## 6. Next step (execution phase)

Open only = founder's beachhead-reach confirmation. Then:
1. **Positioning/copy reframe** — marketing off "privacy" onto "captures what Apple
   can't + structures what Apple won't."
2. **Free/Pro feature spec** — free = system-audio + basic note + light 2-speaker
   diarization; Pro = families / 3+ speakers / languages / KB / integrations.
3. **GTM execution plan** — notarize (Apple Developer ID) + Setapp + JP-localized
   landing + named JP channels.
4. **Pricing finalize** — lock lifetime / sub / free numbers.

Recommend a FRESH session for execution (continuity: this session is long + sessions
have been lost repeatedly today; the shared `main` working tree is being clobbered by
parallel sessions — use a dedicated worktree/branch for any in-repo doc).

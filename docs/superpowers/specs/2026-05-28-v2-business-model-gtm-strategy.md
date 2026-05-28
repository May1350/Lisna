# Lisna v2 — Business Model & GTM Strategy (BRAINSTORM — DRAFT, NOT FINALIZED)

**Date:** 2026-05-28
**Status:** DRAFT. Strategy brainstormed + independently reviewed by 2 adversarial
reviewers. ONE load-bearing premise (Apple Intelligence commoditizing Japanese
on-device meeting/lecture notes) is being VERIFIED before the pivot-vs-defend
decision. **Do NOT treat any number or positioning here as locked.**
**Concept yardstick (locked, PRD):** "every spoken sound, on the user's own
device, turned into structured text — an hour of audio readable in 5 minutes."

---

## 0. Why this doc exists

Business-review session. Core problem the founder wants solved: **how to monetize
an on-device, zero-marginal-cost, privacy-first product** (the revenue-model vs
on-device conflict). v2 (Mac desktop, on-device) is THE real launch; v1 (Chrome
extension, cloud) is FROZEN — the founder believes it failed on **reach /
install-friction** (users didn't know how to install it, environment constraints
limited the pool). Founder = indie / bootstrap, B2C self-serve, **no enterprise
sales motion**.

## 1. Decisions reached in brainstorm (PROVISIONAL — some revised by review, sec 3)

- **Buyer:** B2C individual, self-serve, indie/bootstrap (sustainability +
  autonomy over hypergrowth).
- **Pricing form:** subscription + lifetime hybrid (Superwhisper-style). First
  guess ~$9/mo, ~$79/yr, lifetime ~$199, free unlimited. *(Review pushes toward
  lifetime-led + lower price — see sec 3.)*
- **Free/Pro line (option 가):** free *showcases* the differentiation (unlimited
  transcription + ONE basic structured note + 1 language + single-speaker +
  MD/Obsidian/PDF export). Pro = note families (lecture/meeting/interview),
  diarization, all languages, advanced integrations, power features.
  *(Review says this starves the paying segment — see Hole B.)*
- **Monetization principle:** never gate on usage/minutes (zero marginal cost);
  gate on **capability/depth**. Transcription = commodity = free; note
  intelligence = paid. *(Both reviewers: strongest part of the strategy.)*
- **Positioning/moat (brainstorm view):** two fronts — counter-positioning vs
  cloud incumbents; product-depth + domain-focus + iteration-speed vs on-device
  peers. Open-format/privacy design *kills* data lock-in → lock-in must be
  workflow habit + config sunk-cost + deep Obsidian integration + brand. JA =
  WEDGE (temporary, base models close it), NOT a moat; sell the workflow, not
  "JA-tuned AI." Spearhead = own the **"long-listen capture moment"** (reflex on
  entering a meeting/lecture to remember; distinct from Superwhisper's dictation
  moment).

## 2. Competitive landscape (verified May 2026)

**On-device peers (the REAL competitors — same position as us):**
- **MacWhisper** ~$69 lifetime / $30·yr — transcript-first + generic BYO-LLM
  summary; HAS system-audio meeting capture + diarization; NO domain note-families,
  NO JA-tuned summary, flat transcript library, post-hoc.
- **Superwhisper** free + $8.49/mo / $250 lifetime — dictation-first BUT has a
  **Meeting mode** = on-device system-audio capture + LLM summary + action items;
  ships **Qwen3-ASR** (purpose-built CJK/JA, on-device); **Custom Modes** =
  user-authored structured prompts.
- **Aiko** $22 one-time; **VoiceInk** OSS $25–49 one-time.

**Cloud incumbents (different position — we beat them on privacy):** Granola
($14–35/seat), Otter (gates MINUTES, $8.33–20), Fireflies, Fathom (very generous
free, gates AI depth + team), Notion AI ($20 bundled). All require account +
cloud upload.

**Stale facts corrected by review (my earlier teardown was wrong on these):**
- "Peers don't do JA tuning" → FALSE. Superwhisper's Qwen3-ASR is on-device CJK.
  The JA-ASR wedge is largely already closed.
- "Note families" is approximable as a **prompt-pack** — Superwhisper Custom Modes
  let a motivated JP user hand-roll a 議事録 mode today.

## 3. Independent review findings (2 adversarial reviewers, 2026-05-28)

**Both independently concluded: "feature, not a business — as currently framed."**

**Two near-fatal holes (convergent):**
- **Hole A (existential): Apple Intelligence may have already commoditized the
  privacy wedge.** Apple Notes does on-device record → transcribe → summarize,
  with lecture/meeting as named use cases, free, pre-installed, and trusted by JP
  IT/legal *because* it's Apple. If true, "audio never leaves your Mac" is now
  Apple's free default to our exact buyer. **THIS IS THE PREMISE BEING VERIFIED
  (sec 4).**
- **Hole B: the free/Pro line starves the paying segment.** Meetings are
  inherently multi-speaker; diarization behind Pro → meetings barely work on free
  → JP workplace (payers) gated while students (free-sufficient) evangelize but
  never pay → "adoption, no revenue."

**Strengths that survived:** gate-on-capability-not-minutes; clear-eyed honesty
about fake moats; "long-listen = own a verb" ambition.

**Controller calibration:** "feature not a business" is a VC-lens. Founder chose
bootstrap/sustainability, where a beloved niche tool + tempo advantage is a viable
business without a hard moat (the competitors themselves are proof). So "no hard
moat" is *less* damning for an indie. BUT Apple-commoditization threatens even the
bootstrap bar (beating "free + pre-installed" is a different order of problem).
→ Must-address = (A) Apple + (B) free-line. "No hard moat" is secondary.

**Convergent fixes proposed:**
- Re-draw free line so meetings WORK free (light 2-speaker diarization free; gate
  3+ speakers / all families / all languages / integrations).
- Lead with **LIFETIME** (~$99–129); subscription as fallback (~$5.99/mo).
  Privacy-buyers distrust recurring billing.
- **Named JP distribution:** notarize + **Setapp** (curated-store trust badge +
  JP-reachable paying audience without own checkout) + JP-localized landing +
  1–2 JP indie-Mac newsletters / note-taking YouTubers. ".dmg from a website" is
  not a channel.

**The pivot proposed (highest-leverage):** re-anchor the moat from "on-device
privacy" → **"the cumulative, synthesis-rich, domain-formatted note KNOWLEDGE BASE
over time"** — cross-note synthesis across months ("what did Tanaka commit to over
our last 6 syncs?"), topic-linked + speaker-attributed. Per-recording tools AND
Apple structurally won't build this. + possibly **regulated JP verticals**
(問診 / legal depositions / 士業 output formats) as self-serve. + consider being
the structuring layer **on top of** Apple's STT (hedge) rather than a parallel
stack.

## 4. Apple Intelligence threat — VERIFIED (2026-05-28, 2 research agents)

Apple is a REAL threat on ONE axis and ABSENT on the axes that matter. R2's
"Apple ate the privacy wedge" is HALF-right.

**What Apple DOES** (commoditized, free, M1+ / macOS 15.1+, in Notes/Voice Memos):
mic / Phone-call record → live transcription → one-tap **flat** summary. Japanese
has been live since **Apr 2025**. → "record my own voice / an in-room talk and get
a flat summary" is now free, and Apple is MORE trusted than an indie.
**Privacy / on-device ALONE is no longer a wedge.**

**What Apple does NOT do** (verified gaps — Lisna's ground):
- **System-audio capture** — Apple CANNOT transcribe other apps' audio (Zoom/Teams/
  Meet, browser-played lecture). OS-level design block; mic + Phone/FaceTime only.
  DURABLE moat (OS-policy gap, not a model-quality gap that closes over time). This
  is exactly PRD scenarios 1 (LMS browser playback) + 2 (video conferencing).
- **Diarization / speaker attribution** — absent. The paying JP "AI議事録" market
  (Notta, JAPAN AI SPEECH, Sakura AI) competes ON diarization + compliance + local
  processing; Apple's consumer feature lacks it.
- **Domain-structured note families + cumulative cross-recording KB** — Apple = one
  flat summary per recording, no templates, no knowledge base.
- **Meeting-grade JA quality** — JP reviews: misses, no diarization, lossy summaries,
  worse than Whisper/Gemini. (This gap erodes as Apple improves → wedge, not moat.)

Context: Japan's MSCA (Dec 2025) forces Apple to allow replacing Siri → Apple's
on-device AI is not a locked JP default. Apple's near-term trajectory = generic Siri
(delayed to spring 2026), not meeting-grade structured notes. Apple also shipped
SpeechAnalyzer/SpeechTranscriber (faster than Whisper) + a Foundation Models
framework → a possible "consume Apple STT for mic, build our own for system-audio +
structure" hedge (evaluate later).

**DECISION: DEFEND-with-REFRAME** (not pivot-away, not defend-unchanged).

## 5. Resulting strategy refinement (PROPOSED — pending founder confirm)

- **Positioning reframe:** DROP "private/on-device" as the headline (Apple owns it
  free + more trusted). New headline: **"captures what Apple can't (system audio —
  your remote meetings + streamed lectures), structured the way Apple won't (diarized
  + domain note families + a knowledge base that compounds)."** Privacy = feature/
  hygiene, not the pitch.
- **Free tier sharpened (also fixes Hole B):** free hook = **system-audio capture +
  basic structured note + light (2-speaker) diarization** — the Apple-can't
  territory, where meetings actually WORK on free. NOT mic + flat summary (Apple's
  free turf — free Lisna would be pointless there). Pro = all families, 3+ speakers,
  all languages, cumulative KB / cross-note synthesis, integrations.
- **Moat stack (evidence-based):** (1) system-audio capture = OS-policy gap, durable;
  (2) domain note-families + cumulative KB = product-design gap, durable + compounds
  (reviewers' validated pivot); (3) diarization = meeting table-stakes Apple lacks;
  (4) meeting-grade JA quality = beachhead wedge (erodes).
- **Pricing:** lifetime-led (~$99–129) + subscription fallback (~$5.99–9/mo), free
  unlimited.
- **Distribution:** notarize + Setapp + JP-localized landing + JP Mac newsletters /
  YouTubers.

**Unresolved tension surfaced by verification:** the *paying* JP meeting market
(Notta/Sakura) skews B2B (compliance certs, local-GPU, diarization) — colliding with
the founder's B2C self-serve / no-enterprise-sales choice. Open: is there a self-serve
prosumer slice for "serious meeting notes," or does that value pull toward B2B?

## 6. Next step

Founder confirms the reframe → finalize BM + positioning + free/Pro line → write GTM
plan. Then this doc graduates from DRAFT.

# Lisna v2 — Positioning & Copy Reframe (researcher beachhead)

**Date:** 2026-05-29
**Status:** DRAFT — pending founder review (brainstorm approved; spine + headlines locked in session)
**Type:** Positioning strategy / messaging spec (internal). Drives the web + app copy as a
follow-on implementation plan — this doc does NOT change live copy.
**Parents:**
- Strategy: `docs/superpowers/specs/2026-05-28-v2-business-model-gtm-strategy.md`
  (memory `v2_bm_gtm_strategy_2026-05-28.md`) — the settled DEFEND-with-reframe direction.
- Concept yardstick (locked, PRD): "every spoken sound, on the user's own device, turned into
  structured text — an hour of audio readable in 5 minutes."

---

## 한눈에 (plain-language TL;DR)

- 지금 사이트 첫 문장 = **"프라이버시(내 맥에서만 돌아감)"**. 문제: 이제 애플이 공짜로 해주고 더 믿음받음 → 더 이상 우리 무기 아님.
- 그래서 메인 메시지를 애플이 **못 하는** 두 가지로 바꿈:
  - **① 정리:** 1시간 강연 → 5분에 읽는 연구 노트 (애플은 밋밋한 요약만)
  - **② 녹음 범위:** 줌 세미나·스트리밍 강연 소리까지 (애플은 마이크만, 화면 너머 소리 못 잡음)
- **"로컬"은 안 버림** — 제목에서만 빼고, 부제 + 신뢰 표시로 유지 (연구자는 미공개 자료 다뤄서 오히려 잘 맞음).
- 비치헤드(첫 타겟) = **강연·세미나·발표를 듣는 연구자**.
- 제목: **"1시간 강연을, 5분 만에 읽다."** / 기능 제목: "받아쓰기가 아니라, 연구 노트."
- ⚠️ **정직성 주의:** 지금 알파(v0.1.1)는 위 기능 일부가 아직 안 됨(특히 시스템 오디오 캡처는 **빌드 확인 필요**). 광고가 앞서가면 안 됨 → "되는 것만 말하기" 표(section 5) 참고.

---

## 1. The positioning spine

**Core positioning statement** (internal north star — not literal copy):

> For researchers who sit through more lectures, seminars, and online talks than they can
> retain, Lisna turns any talk — including the streamed ones a Mac can't otherwise record —
> into a structured research note in minutes, and (over time) a knowledge base that compounds.
> **Apple summarizes the conversation in front of you; Lisna captures and structures the talk
> coming through your screen.**

**Message hierarchy** (what leads → what's demoted):

| Tier | Message | Role |
|---|---|---|
| **Primary** | *Structure* — "an hour of talk, read in five minutes" (the locked yardstick). Not a transcript, not a flat blob — a talk-aware research note. | Headline |
| **Secondary** | *Capture scope* — records Zoom seminars, streamed conferences, browser-played lectures: audio from **other apps** that on-device tools (Apple included) can't reach. | Differentiation punch, directly under the headline |
| **Tertiary** | *Compounding* — every talk can join a research knowledge base that gets more useful over time. | Pro / "gets better" promise — **roadmap-flagged, never the hero** |
| **Demoted → trust (KEPT, not cut)** | *Local* — it all runs locally, no upload. Stated as a trust pillar in the subhead + a trust label, **not** the headline. Genuine value for researchers handling unpublished data. | Supporting trust, not the pitch |

Why this order: structure is the moat *both* Apple (flat) and on-device peers (transcript +
generic summary) struggle to match, and it's scenario-agnostic (works for in-person AND online
talks). Capture is the sharpest Apple contrast but only covers the *online* subset, so it
supports rather than leads. KB is the most durable long-game moat but isn't shippable yet, so it
is a promise, never the headline.

## 2. Headlines, subhead, term (locked candidates)

Final wording is the copy-implementation step + native EN/JA review; these are the approved
directions. Term for the on-device idea is **"로컬 / local / ローカル"** (concise; fits the
tech-literate researcher audience) — not "네 맥 안에서".

**Hero H1** (primary — the yardstick outcome):
- KO: **"1시간 강연을, 5분 만에 읽다."**
- EN: "An hour of lecture, read in five minutes."
- JA: "1時間の講義を、5分で読む。"

**Hero subhead** (capture scope + local, in one line):
- KO: **"줌 세미나도, 스트리밍 강연도 — 전부 로컬에서 정리된 연구 노트로."**
- EN: "Zoom seminars, streamed lectures — all turned into structured research notes, locally."
- JA: "Zoomのセミナーも、配信される講義も — すべてローカルで、構造化された研究ノートに。"

**Features-section header** (the Apple-contrast restatement — secondary headline):
- KO: **"받아쓰기가 아니라, 연구 노트."**
- EN: "Not a transcript. A research note."
- JA: "文字起こしではなく、研究ノート。"

**Trust label** (the demoted-but-kept local line):
- KO: "100% 로컬 · 업로드 없음" / EN: "100% local · no upload" / JA: "100%ローカル・アップロードなし"

Both H1 directions from the brainstorm survive: candidate 1 ("1시간 강연을, 5분 만에 읽다") is the
main H1; candidate 2 ("받아쓰기가 아니라, 연구 노트") is reused as the features header. They can be
A/B tested at copy time.

## 3. Apple-contrast posture

Apple Intelligence is the existential competitor — handle it explicitly and respectfully.

- **Concede openly:** Apple is genuinely good at mic → live transcript → flat summary, free and
  trusted. We do NOT fight that ground, and we do NOT claim to be "more private than Apple."
- **Claim three durable gaps:**
  1. **System audio** — Apple can't record other apps' audio (Zoom / streamed talks). OS-policy
     gap = durable, not a model-quality gap. (= PRD scenarios 1+2.)
  2. **Structure** — Apple gives a flat summary, not a talk-aware structured note.
  3. **Cross-talk memory** — Apple is flat-per-recording; no knowledge base across sessions.
- **Tone:** complementary-then-superior, never Apple-bashing. Reference line:
  *"Apple covers the conversation in the room. Lisna covers the talk coming through your screen —
  and turns it into something you keep."*
- **Secondary competitors** (smaller mention, not the headline contrast):
  - On-device peers (MacWhisper, Superwhisper): transcript-first / generic or hand-rolled
    summary; no domain note families, no cumulative KB. Don't pretend they don't exist; win on
    structure-by-situation + compounding.
  - Cloud tools (Otter / Fireflies / Notion AI): require account + upload; we win on local + no
    upload. Keep this as the *cloud* comparison row, not the lead.

## 4. Stop-saying / Start-saying (vs current live copy)

Concrete map against the strings in `web/src/messages/en.json` today. (Execution = follow-on
plan, with EN/JA/KO parity per `.claude/rules/i18n.md`.)

| Surface | STOP (current) | START (reframed) |
|---|---|---|
| `hero.h1` | "Every conversation, stays on your Mac." (privacy-led) | "An hour of lecture, read in five minutes." (structure-led) |
| `hero.sub` | "...processed entirely on-device." (privacy-led) | capture scope + structure, with "locally" kept as trust |
| `features.privacy` (whole "ON-DEVICE PRIVACY" feature) | "Your audio never leaves your Mac." as a co-equal feature | **demote** to one trust line; free the slot for a **Capture (system audio)** feature + a **Diarization** feature |
| `privacyEmphasis` (whole "PRIVACY BY DEFAULT" section) | a full marquee section | **shrink** to a compact trust strip; keep "no telemetry / account = email only / notes on disk" as fine print |
| `features` order | STT · Privacy · Notes · Export | Capture (system audio) · Structure (research note) · Diarization (who said what) · Local (trust) · Export/KB |
| `comparePage` | compares only vs cloud tools, on privacy; **Apple absent** | **add an Apple Intelligence column**; add rows: "Captures Zoom/streamed audio", "Diarization", "Cumulative knowledge base" |
| `footer.tagline` | "Lecture-notes app... 100% on-device." | keep "researchers"; lead with structure, demote on-device |

## 5. Shipped-now vs in-flight vs roadmap — claim ledger (honesty gate)

The positioning targets the **v2 capability set**, but the **live site today sells the v0.1.1
alpha**. Copy must not write checks the shipped build can't cash — this is the audience
("reads-the-docs" researchers) most likely to punish over-claiming.

| Claim | Status | Can the live site say it now? |
|---|---|---|
| Real-time local STT (Whisper) | SHIPPED (v0.1.1) | Yes |
| Basic structured note (markdown sections) | SHIPPED (v0.1.x curator-style) | Yes — but as "structured note", not yet "domain note families" |
| Local / on-device / no upload | SHIPPED | Yes |
| Markdown / Obsidian / PDF export | SHIPPED | Yes |
| **System-audio capture (Zoom/streamed)** | **⚠️ MUST VERIFY in v2 desktop build** | **Blocker — do NOT headline until confirmed shipped** |
| Diarization ("who said what") | IN-FLIGHT (Plan 4 type-freeze; runtime gated on P0 grammar-gen) | No — frame as "coming" until it runs end-to-end |
| Domain note families (lecture/meeting/interview/…) | IN-FLIGHT (merged, but pipeline can't run end-to-end — P0 backlog) | No — roadmap framing only |
| Cumulative cross-talk knowledge base | ROADMAP | No — Pro/"gets better over time" promise only |

**Recommendation:** stage the copy rollout to shipping reality. Two honest options for the
founder to pick at implementation time:
- **(a) Lead with what ships now** (structure of single notes + local), tease capture/diarization/
  KB as "coming in v2" — safest, slightly weaker punch.
- **(b) Position on the v2 vision** with an explicit "v2 alpha — rolling out" frame, and gate the
  capture headline on verifying system-audio actually works in the desktop build first.
**Hard gate either way:** confirm system-audio capture status before any copy claims it. (This is
the single most load-bearing, currently-unverified claim in the whole reframe.)

## 6. Researcher beachhead — entry message

- **Build broad, launch narrow** (from strategy): the note families are the product (built
  broad); the **entry message is narrow** = the researcher who attends lectures / seminars /
  conference talks and can't retain them all.
- **Entry hook:** "You attend more talks than you can remember. Lisna makes each one a research
  note you'll actually reread — and captures the streamed ones nothing else on your Mac can."
- **Trust signals to keep/elevate:** the existing "EARLY USE AT Keio University" badge; the
  "students and researchers" framing. Add academic-credible proof as it accrues (lab adoption,
  citations of the workflow).
- **Expansion roadmap (sequenced, not abandoned):** interviews (qualitative research) → solo
  regulated pros (士業/medical/legal, where local privacy *revives* as a real requirement) →
  freelancers/meetings. Beachhead = entry; breadth = roadmap.

## 7. Language / market

- Site is EN/JA/KO with **hard parity** (`.claude/rules/i18n.md`): every reframed string lands in
  all three catalogs; no hardcoded copy in JSX; brand tokens via `BRAND`.
- **JP-distribution-led but English-capable:** researchers are reachable in English; named JP
  channels (Setapp / JP-localized landing / JP Mac newsletters) per strategy. Treat EN and JA as
  co-primary for the beachhead; KO follows parity.
- Term consistency: **로컬 / local / ローカル** everywhere for the on-device idea.

## 8. Success criteria & non-goals

**This reframe succeeds if:**
- The hero answers "why not just use Apple?" within the first screen (structure + capture).
- "Privacy/local" appears as trust, not as the headline, in every surface.
- No live-site claim outruns the shipped build (section 5 ledger respected).
- A researcher reading the page can name, unprompted, the one thing Apple can't do.

**Non-goals (explicitly out of scope for this doc):**
- Final per-language copy strings (that's the implementation plan + native review).
- Pricing numbers (separate "pricing-finalize" workstream).
- Visual / layout design (legal-pad system already locked in `.claude/rules/web-design.md`).
- The actual `web/` code changes (follow-on plan; web lane).
- App onboarding copy (can reuse this spine later; not specified here).

## 9. Next step

After founder review of this doc:
1. `writing-plans` → implementation plan for the **web copy** (web lane, EN/JA/KO parity, staged
   to the section-5 ledger), starting with the **system-audio capture verification gate**.
2. Pricing-finalize and GTM-execution remain separate workstreams (per strategy section 6).

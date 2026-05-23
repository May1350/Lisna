# Domain invariants

Things about Lisna's runtime that ARE true and must STAY true. Violating
these breaks users, not lint. Most have an underlying CloudWatch / bug
report. When you write code that interacts with one of these areas,
re-read the relevant rule.

## Audio capture / STT

- [2026-05-12] (audio) Chunks are 10-second WAV, wall-clock driven. Whisper segment.start can drift ±1s WITHIN a chunk; this is accepted noise. Don't try to reconcile sub-chunk timestamps. Reason: chunk-uniform timestamps were worse for users than ±1s within-chunk noise. last-cited: 2026-05-12
- [2026-05-12] (audio) Scrub guard in `audio-capture.ts` uses `lastObservedVideoTime` jump detection (>2s). Don't reintroduce sample-rate math — it broke at 2× playback (reset every chunk → infinite loop). Reason: playback-rate-agnostic detection is the only safe form. last-cited: 2026-05-12
- [2026-05-12] (audio) Groq Whisper REJECTS WebM input. Audio must be 16 kHz PCM WAV. `audio-encode.ts` enforces this. Don't pass through MediaRecorder output. Reason: silent 4xx loss. last-cited: 2026-05-12

## Curator / LLM

- [2026-05-12] (curator) `gpt-4o-mini` is default. `CURATOR_PROVIDER='anthropic'` switches; `@anthropic-ai/sdk` is currently a static import (lives in Lambda bundle). Convert to dynamic import before flipping the env. Reason: bundle bloat for a dormant branch. last-cited: 2026-05-12
- [2026-05-12] (curator) Long lectures (60 min) curate in 50-90s. This MUST stay behind a Function URL — API GW 30s ceiling. Reason: physics. last-cited: 2026-05-12
- [2026-05-12] (curator) Cooldown: 30s free / 5s pro, tracked in DB column `last_curated_at`. Don't lower without re-measuring per-user LLM cost. Reason: cost. last-cited: 2026-05-12

## Quota

- [2026-05-12] (quota) Free tier: 30 min/month. Pro: 30 hours/month. Banner thresholds: <90% silent, 90-99% amber, 100% red blocking. Don't change tier without updating PRD + Stripe products together. Reason: PRD locks pricing. last-cited: 2026-05-12

## Slides

- [2026-05-12] (slides) Detector tick = 1s, pixel diff threshold = 18%, min gap between detections = 3s. These were tuned against real K-LMS lectures. Don't tweak without an eval against `extension/fixtures/slides/`. Reason: false-positive slides confuse the curator. last-cited: 2026-05-12
- [2026-05-12] (slides) `stream-slide` body MUST include `url` field (same Zod schema as `stream-audio`). New endpoints copying this shape often forget. Reason: was a 500 for a week. last-cited: 2026-05-12
- [2026-05-12] (slides) Size cap: 5 MB per slide, 500 slides per session. Enforced server-side in `stream-slide.ts`. Don't bypass on client. Reason: S3 + DB cost ceiling. last-cited: 2026-05-12

## Sessions / persistence

- [2026-05-12] (sessions) `notes` JSONB column is LEGACY. Old sessions may have data; new handlers must NOT write. UI ignores. Will be dropped in a future migration. Reason: dual-write = future merge pain. last-cited: 2026-05-12
- [2026-05-12] (sessions) When `/v1/session` returns null, App.tsx clears `outline/slides/sessionId`. Don't leave stale state when session not found. Reason: caused markdown 404 on 2026-05-08. last-cited: 2026-05-12

## Auth / billing

- [2026-05-12] (auth) JWT issued from Google OAuth. `auth-google.ts` and `stripe-webhook.ts` are the two handlers NOT wrapped in `withAuth`. Don't wrap them. Reason: stripe-webhook verifies via signature, not Bearer. last-cited: 2026-05-12
- [2026-05-12] (stripe) `apiVersion` is pinned to `'2025-09-30.acacia'` with `as any` cast. SDK 22.1's literal type drifted. Update pin + cast together when intentionally upgrading. Reason: silent type drift. last-cited: 2026-05-12

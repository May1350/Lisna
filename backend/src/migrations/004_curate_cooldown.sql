-- Phase A1 (2026-04-30): per-session curator-call cooldown.
--
-- The /v1/session/curate endpoint runs an LLM call (gpt-4o-mini) costing
-- ~$0.003 per invocation on a 30-min transcript. Without throttling a
-- malicious or buggy client could fire the endpoint thousands of times
-- on the same session and rack up cost. JWT auth alone doesn't help —
-- a free user with a working token can spend our money.
--
-- We add a `last_curated_at` column populated on every successful
-- curate. The handler checks: if last_curated_at > NOW() - cooldown,
-- return 429 with the seconds remaining. Cooldown lives in handler
-- code so it can differ by plan (free: 30 s, pro: 5 s).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS makes re-running this migration
-- on already-migrated DBs a no-op.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_curated_at TIMESTAMPTZ;

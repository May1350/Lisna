-- User-submitted feedback (bug reports, feature requests, general comments).
-- Posted from extension Options page → POST /v1/feedback.
--
-- Why a separate table (vs. dropping into a generic events table):
--   triage UX is way easier when feedback rows have first-class columns
--   (category filter, full-text search on message, by-user joins).
--
-- The handler also publishes to the existing lisna-alerts SNS topic so
-- the operator gets an email the moment something lands. See
-- backend/src/handlers/feedback.ts.

CREATE TABLE IF NOT EXISTS feedbacks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    TEXT NOT NULL CHECK (category IN ('bug', 'feature_request', 'other')),
  -- Hard cap matches the extension form's maxLength (2000). Going bigger
  -- here would just allow API-direct callers to write longer rows than
  -- the UI allows, which adds operational noise without value.
  message     TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  -- The page URL the user was on when they submitted. Optional because
  -- the user may have triggered the form from Options (no relevant URL)
  -- or explicitly cleared it.
  context_url TEXT,
  ext_version TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Triage queries hit (created_at DESC) for the latest-first feed and
-- (user_id) for "all feedback from this user". One composite index
-- covers the latest-first feed; user_id gets its own.
CREATE INDEX IF NOT EXISTS feedbacks_created_at_idx ON feedbacks (created_at DESC);
CREATE INDEX IF NOT EXISTS feedbacks_user_id_idx ON feedbacks (user_id);

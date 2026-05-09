-- Cross-container dedup for upstream-LLM-failure alerts.
--
-- Without this, every Lambda warm container that hits a Groq /
-- Anthropic / OpenAI 401/429 publishes its own SNS notification → the
-- operator's inbox can flood with dozens of identical "Anthropic key
-- exhausted" emails during a single outage. We want one email per
-- (provider, kind) per ~hour.
--
-- The handler does an UPSERT with a WHERE clause that only updates
-- last_sent_at if the existing row is older than the dedup window;
-- the RETURNING clause tells us whether we acquired the right to
-- send this notification (1 row) or were preempted (0 rows). Keeps
-- the dedup atomic across concurrent Lambda invocations.

CREATE TABLE IF NOT EXISTS alert_dedup (
  key           TEXT        PRIMARY KEY,  -- e.g. "upstream:anthropic:auth_failed"
  last_sent_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cleanup index — lets a future "remove rows older than 7 days"
-- maintenance task scan efficiently. Not used by the dedup write
-- path (PK lookup is enough there).
CREATE INDEX IF NOT EXISTS alert_dedup_last_sent_idx
  ON alert_dedup (last_sent_at);

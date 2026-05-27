-- Migration 010: model download telemetry tables
-- See spec §2.2.3 for schema rationale.
-- user_id is intentionally nullable — anonymous callers omit it;
-- authenticated callers opt in for per-user correlation.

CREATE TABLE IF NOT EXISTS model_download_events (
  event_id      uuid PRIMARY KEY,
  device_id     uuid NOT NULL,
  user_id       uuid REFERENCES users(id),
  timestamp     timestamptz NOT NULL,
  event_type    text NOT NULL,
  app_version   text NOT NULL,
  os_family     text NOT NULL,
  arch          text NOT NULL,
  source_intent text NOT NULL DEFAULT 'unset',
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_mde_device_time ON model_download_events (device_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mde_user_time   ON model_download_events (user_id, timestamp DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mde_type_time   ON model_download_events (event_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mde_intent      ON model_download_events (source_intent, timestamp DESC);

-- Weekly aggregate for dashboard queries (avoids full-table scans on
-- the raw events table for time-series charts).
CREATE TABLE IF NOT EXISTS model_download_weekly_agg (
  device_id     uuid NOT NULL,
  user_id       uuid REFERENCES users(id),
  model_id      text NOT NULL,
  week_start    date NOT NULL,
  event_type    text NOT NULL,
  source_intent text NOT NULL DEFAULT 'unset',
  count         int  NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, model_id, week_start, event_type, source_intent)
);

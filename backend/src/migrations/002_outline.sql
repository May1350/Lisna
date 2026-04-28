-- Phase 4: Rolling outline curator.
--
-- Adds two columns to sessions:
--  - transcripts: append-only chunked transcript log. Each entry is
--    { ts (start_time_sec, integer), text }. The curator reads the full
--    array on each run to regenerate the outline with full context.
--  - outline: the current curated outline JSON (Outline shape — see
--    backend/src/lib/curator.ts). Replaced wholesale on each curator run.
--
-- We keep the existing notes column for back-compat (older rows still have
-- per-chunk bullets there) but new sessions populate outline instead.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS transcripts JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS outline JSONB;

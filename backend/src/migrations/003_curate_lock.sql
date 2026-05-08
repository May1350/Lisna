-- Phase 6.1+: per-session curate lock.
--
-- Prevents two concurrent /v1/session/curate calls from racing on
-- the same session — both reading the same `previousOutline`,
-- running the curator in parallel, and clobbering each other's
-- writes (last-writer-wins, with the loser's incremental context
-- silently lost).
--
-- Strategy: compare-and-swap on a timestamp column.
--   acquire: UPDATE … SET curate_lock_at = NOW()
--            WHERE curate_lock_at IS NULL OR
--                  curate_lock_at < NOW() - INTERVAL '5 minutes'
--   release: UPDATE … SET curate_lock_at = NULL  (in finally{})
--
-- The 5-minute TTL is the safety net: if the curator Lambda crashes
-- mid-run (OOM, hard timeout, throw before finally) the lock stays
-- in place but auto-expires, so the user is never permanently
-- locked out of curating their own session.
--
-- Why a column instead of pg_advisory_lock: Lambda + RDS use a
-- connection pool with no connection pinning. Postgres advisory
-- locks are bound to the session that took them; a release issued
-- on a different connection is a silent no-op, leaking the lock
-- until the original connection is reaped. Column-based CAS doesn't
-- depend on connection identity.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS curate_lock_at TIMESTAMPTZ;

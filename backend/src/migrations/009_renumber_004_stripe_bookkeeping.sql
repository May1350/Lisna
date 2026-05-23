-- Bookkeeping for the 004 → 008 rename of processed_stripe_events.
--
-- The original migration shipped as `004_processed_stripe_events.sql`,
-- colliding numerically with `004_curate_cooldown.sql`. Because
-- migrate.ts keys schema_migrations by FILENAME (not number), both
-- coexisted at runtime — alphabetic sort placed curate_cooldown first,
-- processed_stripe_events second, and both rows landed in
-- schema_migrations. The collision was a human-facing footgun (newcomers
-- assume numeric prefix = uniqueness; pre-commit-check.sh flags it).
--
-- The fix renames the file to 008_processed_stripe_events.sql. On
-- environments where the OLD filename was already applied:
--   1. Migration 008 runs (its name isn't in schema_migrations yet) and
--      no-ops via CREATE TABLE IF NOT EXISTS, then records '008_...'.
--   2. This migration (009) deletes the stale '004_processed_stripe_events.sql'
--      row so the table-of-truth no longer references the dead filename.
--
-- On fresh DBs the DELETE matches zero rows and is harmless.
-- On environments where 008 ran for the first time (table newly
-- created), the DELETE also matches zero rows. Same harmless no-op.
--
-- Safe to re-run: idempotent by construction (DELETE WHERE).

DELETE FROM schema_migrations
  WHERE name = '004_processed_stripe_events.sql';

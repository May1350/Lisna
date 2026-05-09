-- Phase 6.2: Stripe webhook idempotency.
--
-- Stripe redelivers webhook events whenever it can't confirm a 2xx —
-- including transient network blips, our 5xx, or even successful
-- handler runs whose response Stripe didn't receive in time. Some
-- events are naturally idempotent (UPDATE users SET plan='pro' applied
-- twice = same final state); others aren't (invoice.paid for usage,
-- future customer.subscription.updated for prorations). Rather than
-- audit per-case, we dedup at the handler entry on event_id.
--
-- Pattern: INSERT … ON CONFLICT (event_id) DO NOTHING RETURNING event_id.
-- - First delivery: row inserted, RETURNING yields 1 row → process.
-- - Redelivery: ON CONFLICT swallows, RETURNING yields 0 rows → 200 ok,
--   no side effects re-applied.
--
-- Critical ordering invariant: the INSERT must run BEFORE any side
-- effect (DB UPDATE, plan change). If a partial side-effect lands and
-- THEN we insert the dedup row, a subsequent retry would see the row,
-- skip the side-effect, and leave the user record half-applied.
-- Inserting first means: a crash between INSERT and side-effect just
-- means the row is there but the next retry will be deduped — at worst
-- a missed plan upgrade, which is recoverable manually. Inserting last
-- would mean silent data corruption, which isn't.
--
-- `type` is denormalised here for debugging convenience — "what kinds
-- of events have we seen lately?" without joining the Stripe dashboard.
-- We never query by it.
CREATE TABLE processed_stripe_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

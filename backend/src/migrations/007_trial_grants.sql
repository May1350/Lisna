-- 2-hour Pro-tier trial grant for one-time conversion play.
--
-- Flow: free user hits the 30-min monthly cap → "Get 2 free hours"
-- button on QuotaExhaustedIdle → Stripe Checkout in setup mode
-- collects a payment method WITHOUT a charge → on success we create
-- a row here. While the row is "active" (not declined, not converted,
-- not expired), checkQuota uses limit_secs=7200 instead of the free
-- 30-min cap. recordUsage increments used_secs in this table instead
-- of quota_usage so monthly free quota stays whole when the trial
-- ends.
--
-- Why a separate table (instead of a column on users):
--   - Multiple lifecycle states (granted / converted / declined /
--     expired) want explicit timestamps for analytics.
--   - One-row-per-user PK enforces "one trial per account, ever"
--     without an extra unique constraint.
--   - Future-proof: if we ever offer a second trial (different
--     reason, different cap), drop the PK constraint and add a
--     `trial_kind` column.
--
-- Lifecycle:
--   granted_at        — row created (card setup completed)
--   expires_at        — granted_at + 30 days; cron expires unused
--   used_secs         — incremented per stream-audio chunk
--   converted_at      — set when user clicks "Pro 가입 (원클릭)"
--                       and we create their subscription via the
--                       saved payment method
--   declined_at       — set when user clicks "가입 안함" at 100%
--                       used; payment method is detached at the
--                       same moment so the grant becomes inert
--
-- An "active" trial is: declined_at IS NULL AND converted_at IS NULL
-- AND expires_at > NOW() AND used_secs < limit_secs.

CREATE TABLE trial_grants (
  user_id                   UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at                TIMESTAMPTZ NOT NULL,
  used_secs                 INTEGER     NOT NULL DEFAULT 0,
  limit_secs                INTEGER     NOT NULL DEFAULT 7200,
  -- Stripe payment method ID attached during setup. Detached on
  -- decline; retained on conversion (the resulting subscription uses
  -- this PM as the default). Nullable because in some failure modes
  -- (Stripe webhook retry, etc.) we may insert the row before the PM
  -- is fully resolved.
  stripe_payment_method_id  TEXT,
  -- Stripe customer ID. Created during setup if the user didn't
  -- already have one. Persists into the users.stripe_customer_id
  -- column so subsequent paid actions reuse the same customer record
  -- (no duplicates).
  stripe_customer_id        TEXT,
  declined_at               TIMESTAMPTZ,
  converted_at              TIMESTAMPTZ
);

-- Cron-friendly index for the daily expiry sweep.
CREATE INDEX trial_grants_expires_idx ON trial_grants (expires_at)
  WHERE declined_at IS NULL AND converted_at IS NULL;

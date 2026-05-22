-- Create the Postgres role that Vercel's lisna.jp web app uses to connect
-- via the RDS Proxy. The role is IAM-authed (rds_iam grant) — clients
-- present an AWS-signed token instead of a static password.
--
-- This must run BEFORE the first Vercel→Proxy connection, otherwise the
-- proxy returns `password authentication failed for user "lisna_web"`
-- (the IAM grant on the proxy side, in data-stack.ts grantConnect(...),
-- only authorizes the AWS principal to PRESENT itself as lisna_web — the
-- Postgres role behind that ARN must actually exist for login to succeed).
--
-- Idempotent: re-running CREATE ROLE on an existing role would error, so
-- the DO block guards it. GRANT statements are inherently idempotent
-- (granting a permission already held is a no-op).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lisna_web') THEN
    CREATE ROLE lisna_web LOGIN;
  END IF;
END
$$;

-- Required so AWS Signer-issued tokens can be used as the password.
GRANT rds_iam TO lisna_web;

GRANT CONNECT ON DATABASE studyhelper TO lisna_web;
GRANT USAGE ON SCHEMA public TO lisna_web;

-- Grant on all current public-schema tables (mostly the v1 backend's
-- tables — users, sessions, etc.). The v2 Auth.js tables that will be
-- created by web/src/db/migrations are covered by the DEFAULT PRIVILEGES
-- statement below, which automatically grants the same permission set on
-- any future table created in the public schema.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lisna_web;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lisna_web;

-- IDENTITY / SERIAL columns need USAGE on the underlying sequence.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lisna_web;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO lisna_web;

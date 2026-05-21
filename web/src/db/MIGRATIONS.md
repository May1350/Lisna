# Migrations runbook

## Local dev

```bash
docker run --name lisna-pg-dev -e POSTGRES_PASSWORD=dev -p 5432:5432 -d postgres:16
export DATABASE_URL="postgresql://postgres:dev@localhost:5432/lisna"
createdb lisna || true
pnpm drizzle:push
```

## Production (RDS via SSM port-forward)

> **First-time apply — `users` already exists in prod.** `0000_*.sql` is
> the greenfield baseline drizzle-kit generated against an empty local
> DB, so it contains `CREATE TABLE users`. The prod RDS already has a
> `users` table (v1: `backend/src/migrations/001_initial.sql`).
> **Do NOT run `0000_*.sql` directly against prod** — psql will error at
> `CREATE TABLE users` and abort. Instead, prepare a delta SQL with:
>
> ```sql
> -- 1. Augment the v1 users table with v2 (Auth.js) columns.
> --    All ADDs are nullable and non-destructive, safe on populated tables.
> ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified TIMESTAMPTZ;
> ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;   -- v2 Auth.js writes here; v1 OAuth keeps writing display_name
> ALTER TABLE users ADD COLUMN IF NOT EXISTS image TEXT;  -- v2 Auth.js avatar URL; v1 has no equivalent
>
> -- 2. Relax google_sub NOT NULL so Auth.js (non-Google magic-link / Apple / GitHub) inserts succeed.
> --    Safe per backend/src/handlers/auth-google.ts:43 — v1 Google OAuth ALWAYS supplies google_sub,
> --    so the existing UNIQUE constraint stays usable (NULLs are distinct in Postgres UNIQUE indexes).
> ALTER TABLE users ALTER COLUMN google_sub DROP NOT NULL;
>
> -- 3. Auth.js looks up users by email. v1 declares `email NOT NULL` without UNIQUE.
> --    BEFORE running the ADD CONSTRAINT, confirm no duplicates exist:
> --      SELECT email, COUNT(*) FROM users GROUP BY email HAVING COUNT(*) > 1;
> --    If duplicates exist, decide a merge strategy (or rename one row's email) before proceeding.
> ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
>
> -- 4. Then copy from 0000_*.sql verbatim:
> --   CREATE TABLE accounts (…)
> --   CREATE TABLE auth_sessions (…)
> --   CREATE TABLE verification_tokens (…)
> --   CREATE TABLE app_exchange_codes (…)
> --   CREATE TABLE app_devices (…)
> -- 5. All 4 FK ALTERs (each child table → users):
> --      accounts_user_id_users_id_fk
> --      auth_sessions_user_id_users_id_fk
> --      app_exchange_codes_user_id_users_id_fk
> --      app_devices_user_id_users_id_fk
> --    No FK originates from users itself — copy all four.
> -- 6. The unique index:
> --   CREATE UNIQUE INDEX accounts_provider_account_id_unique (…)
> ```
>
> Future migrations (Phase J onward) that don't touch the v1 `users`
> table can be applied directly.

1. Confirm migration file is reviewed (`web/src/db/migrations/0000_*.sql`) AND the prepared delta SQL (see callout above) is reviewed.
2. SSM port-forward to RDS (direct, not the Proxy):
   ```bash
   aws ssm start-session --region ap-northeast-1 \
     --target i-<bastion-id> --document-name AWS-StartPortForwardingSessionToRemoteHost \
     --parameters '{"host":["<rds-endpoint>"],"portNumber":["5432"],"localPortNumber":["6432"]}'
   ```
3. Fetch admin password from Secrets Manager:
   ```bash
   aws secretsmanager get-secret-value --region ap-northeast-1 \
     --secret-id lisna/prod/rds/master --query SecretString --output text | jq -r .password
   ```
   CDK-managed RDS secrets usually have a `password` key; if `jq -r .password` returns `null`, inspect the raw SecretString and adjust the key name accordingly.
4. Apply the **prepared delta SQL** (not the raw `0000_*.sql`):
   ```bash
   PGPASSWORD=<password-from-step-3> psql -h localhost -p 6432 -U lisna_admin -d lisna -f <prepared-delta>.sql
   ```
5. Verify all tables and the new column:
   ```sql
   \dt
   \d users
   ```

## Rollback

> **Data-loss warning:** `DROP TABLE auth_sessions` and `DROP TABLE accounts` destroy all sign-in session and OAuth account rows. Confirm no live users have signed in before executing this rollback.

Drizzle does not auto-generate down migrations. Write reverse SQL by hand:

```sql
DROP TABLE app_devices, app_exchange_codes, verification_tokens, auth_sessions, accounts;
ALTER TABLE users DROP COLUMN email_verified;
```

## Notes

- The RDS Proxy IAM user (`lisna_web`) does **not** have CREATE TABLE privilege. Use admin role for schema migrations; the web app's runtime role is data-only.
- Never apply migrations via Drizzle Kit in production — always review SQL first.

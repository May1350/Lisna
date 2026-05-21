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
> ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified TIMESTAMPTZ;
> -- Then copy from 0000_*.sql:
> --   CREATE TABLE accounts (…)
> --   CREATE TABLE auth_sessions (…)
> --   CREATE TABLE verification_tokens (…)
> --   CREATE TABLE app_exchange_codes (…)
> --   CREATE TABLE app_devices (…)
> --   ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY … (4 FK statements, skip the one for users)
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

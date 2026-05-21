# Migrations runbook

## Local dev

```bash
docker run --name lisna-pg-dev -e POSTGRES_PASSWORD=dev -p 5432:5432 -d postgres:16
export DATABASE_URL="postgresql://postgres:dev@localhost:5432/lisna"
createdb lisna || true
pnpm drizzle:push
```

## Production (RDS via SSM port-forward)

1. Confirm migration file is reviewed (`web/src/db/migrations/0000_*.sql`).
2. SSM port-forward to RDS (direct, not the Proxy):
   ```bash
   aws ssm start-session --target i-<bastion-id> --document-name AWS-StartPortForwardingSessionToRemoteHost \
     --parameters '{"host":["<rds-endpoint>"],"portNumber":["5432"],"localPortNumber":["6432"]}'
   ```
3. Fetch admin password from Secrets Manager:
   ```bash
   aws secretsmanager get-secret-value --secret-id lisna/prod/rds/master --query SecretString --output text | jq -r .password
   ```
4. Apply the migration:
   ```bash
   PGPASSWORD=<above> psql -h localhost -p 6432 -U lisna_admin -d lisna -f web/src/db/migrations/0000_<name>.sql
   ```
5. Verify all tables:
   ```sql
   \dt
   ```

## Rollback

Drizzle does not auto-generate down migrations. Write reverse SQL by hand:

```sql
DROP TABLE app_devices, app_exchange_codes, verification_tokens, auth_sessions, accounts;
ALTER TABLE users DROP COLUMN email_verified;
```

## Notes

- The RDS Proxy IAM user (`lisna_web`) does **not** have CREATE TABLE privilege. Use admin role for schema migrations; the web app's runtime role is data-only.
- Never apply migrations via Drizzle Kit in production — always review SQL first.

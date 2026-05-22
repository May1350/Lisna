import { Pool, type PoolConfig } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Signer } from '@aws-sdk/rds-signer';
import { env } from './env';
import * as schema from '@/db/schema';

export async function getIamToken(): Promise<string> {
  if (!env.RDS_PROXY_ENDPOINT || !env.RDS_USERNAME) {
    throw new Error('RDS Proxy not configured — fall back to DATABASE_URL');
  }
  const signer = new Signer({
    hostname: env.RDS_PROXY_ENDPOINT,
    port: 5432,
    username: env.RDS_USERNAME,
    region: env.AWS_REGION,
  });
  return signer.getAuthToken();
}

function makePool(): Pool {
  if (env.DATABASE_URL) {
    return new Pool({ connectionString: env.DATABASE_URL });
  }
  if (env.RDS_PROXY_ENDPOINT && env.RDS_USERNAME) {
    const cfg: PoolConfig & { password: () => Promise<string> } = {
      host: env.RDS_PROXY_ENDPOINT,
      port: 5432,
      user: env.RDS_USERNAME,
      database: env.RDS_DB_NAME,
      ssl: { rejectUnauthorized: true },
      max: 1,
      // pg caches the resolved token on the Client after first auth; reconnects after
      // IAM token expiry (~15 min) re-invoke this fn only if the Client was evicted.
      // With max:1 + serverless, a single transient 401 on idle reconnect is possible — callers retry.
      password: async () => getIamToken(),
    };
    return new Pool(cfg);
  }
  throw new Error('Neither DATABASE_URL nor RDS_PROXY_ENDPOINT+RDS_USERNAME configured');
}

const pool = makePool();
export const db = drizzle(pool, { schema });

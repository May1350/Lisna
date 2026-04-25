import { Pool, type QueryResultRow } from 'pg'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

let pool: Pool | undefined

async function resolveConnectionString(): Promise<string> {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const arn = process.env.DB_SECRET_ARN
  if (!arn) throw new Error('Neither DATABASE_URL nor DB_SECRET_ARN set')
  const sm = new SecretsManagerClient({})
  const out = await sm.send(new GetSecretValueCommand({ SecretId: arn }))
  const s = JSON.parse(out.SecretString!)
  return `postgres://${s.username}:${s.password}@${s.host}:${s.port}/${s.dbname || 'studyhelper'}`
}

export async function getPool(): Promise<Pool> {
  if (!pool) {
    const url = await resolveConnectionString()
    pool = new Pool({
      connectionString: url,
      max: 5,
      idleTimeoutMillis: 30_000,
      ssl: { rejectUnauthorized: false },
    })
  }
  return pool
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const p = await getPool()
  const r = await p.query<T>(sql, params)
  return r.rows
}

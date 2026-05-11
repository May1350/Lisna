import { Pool, type QueryResultRow } from 'pg'
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { getSecretsManager } from './aws-clients.js'

let pool: Pool | undefined

async function resolveConnectionString(): Promise<string> {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const arn = process.env.DB_SECRET_ARN
  if (!arn) throw new Error('Neither DATABASE_URL nor DB_SECRET_ARN set')
  const out = await getSecretsManager().send(new GetSecretValueCommand({ SecretId: arn }))
  const s = JSON.parse(out.SecretString!)
  return `postgres://${s.username}:${s.password}@${s.host}:${s.port}/${s.dbname || 'studyhelper'}`
}

export async function getPool(): Promise<Pool> {
  if (!pool) {
    const url = await resolveConnectionString()
    // Lambda containers handle ONE request at a time; idle pool slots
    // beyond the actively-running request are pure waste, and they
    // count against the Postgres `max_connections` ceiling. RDS
    // db.t3.micro caps at ~85 connections — at the old `max: 5` we'd
    // exhaust it with just 17 warm Lambda containers, which is well
    // within normal "after a single page load" territory.
    //
    // Set max: 2 to give us one connection for the active request plus
    // one spare for an in-flight follow-up query (common in handlers
    // that fetch then UPDATE). Drop idleTimeoutMillis to 1 s so idle
    // connections die fast and don't sit holding a slot across the
    // ~5-15 min Lambda warm window.
    //
    // For higher concurrency in the future the right answer is RDS
    // Proxy (handles connection multiplexing) — not bumping max here.
    pool = new Pool({
      connectionString: url,
      max: 2,
      idleTimeoutMillis: 1_000,
      // TODO: bundle the AWS RDS root CA so we can verify the cert
      // (currently rejectUnauthorized:false leaves us open to MITM
      // inside the VPC).
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

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPool } from './db.js'

function resolveMigrationsDir(): string {
  if (process.env.LAMBDA_TASK_ROOT) {
    return join(process.env.LAMBDA_TASK_ROOT, 'migrations')
  }
  const __dirname = dirname(fileURLToPath(import.meta.url))
  return join(__dirname, '..', 'migrations')
}
const MIGRATIONS_DIR = resolveMigrationsDir()

export async function migrate(): Promise<void> {
  const pool = await getPool()
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
  for (const f of files) {
    const r = await pool.query<{ name: string }>(
      'SELECT name FROM schema_migrations WHERE name = $1', [f]
    )
    if (r.rows.length > 0) continue
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8')
    // Check out a single connection and run BEGIN / SQL / INSERT /
    // COMMIT on IT. Using `pool.query` for each step would check out a
    // fresh connection per call — `BEGIN` would land on connection A,
    // the migration on connection B, and `COMMIT` on connection C —
    // making the transaction a no-op. With Pool max > 1 (we now ship
    // max:2 — see db.ts) this is no longer hypothetical.
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f])
      await client.query('COMMIT')
      console.log(`Applied migration: ${f}`)
    } catch (e) {
      try { await client.query('ROLLBACK') } catch { /* conn may be broken */ }
      throw e
    } finally {
      client.release()
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
}

export const handler = async () => {
  await migrate()
  return { ok: true }
}

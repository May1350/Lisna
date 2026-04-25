import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPool } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations')

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
    await pool.query('BEGIN')
    try {
      await pool.query(sql)
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f])
      await pool.query('COMMIT')
      console.log(`Applied migration: ${f}`)
    } catch (e) {
      await pool.query('ROLLBACK')
      throw e
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
}

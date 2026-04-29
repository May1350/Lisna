// One-off ops script: pulls a session's transcripts from RDS and writes
// them as a JSON fixture under tests/fixtures/transcripts/. Run from the
// repo root via `pnpm tsx backend/scripts/dump-transcript-fixture.ts <session_id>`.
//
// The fixture becomes the eval harness's input: we replay the same
// transcript through curator variants and score the outputs to compare.
//
// Why a script and not a Lambda: this is dev-tooling, not production. We
// run it once per "interesting" session we want to add to the regression
// set, then commit the JSON.

import { Client } from 'pg'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, '..', 'tests', 'fixtures', 'transcripts')

interface TranscriptEntry { ts: number; text: string }

async function getDbUrl(): Promise<string> {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const arn = process.env.DB_SECRET_ARN
  if (!arn) throw new Error('DATABASE_URL or DB_SECRET_ARN required')
  const sm = new SecretsManagerClient({ region: 'ap-northeast-1' })
  const out = await sm.send(new GetSecretValueCommand({ SecretId: arn }))
  const s = JSON.parse(out.SecretString!) as Record<string, string>
  return `postgresql://${s.username}:${encodeURIComponent(s.password)}@${s.host}:${s.port}/${s.dbname ?? 'studyhelper'}?sslmode=require`
}

async function main(): Promise<void> {
  const sessionId = process.argv[2]
  const slug = process.argv[3] ?? sessionId.slice(0, 8)
  if (!sessionId) {
    console.error('usage: dump-transcript-fixture.ts <session_id> [slug]')
    process.exit(1)
  }
  const url = await getDbUrl()
  const c = new Client({ connectionString: url })
  await c.connect()
  try {
    const r = await c.query<{ url_original: string; transcripts: TranscriptEntry[]; outline: unknown }>(
      `SELECT url_original, transcripts, outline FROM sessions WHERE id = $1`,
      [sessionId],
    )
    if (r.rows.length === 0) {
      console.error('session not found')
      process.exit(1)
    }
    const row = r.rows[0]
    mkdirSync(FIXTURES_DIR, { recursive: true })
    const path = join(FIXTURES_DIR, `${slug}.json`)
    writeFileSync(path, JSON.stringify({
      session_id: sessionId,
      url: row.url_original,
      transcripts: row.transcripts,
      // We snapshot the outline that was current at dump time as a
      // "baseline outline" reference — useful as a sanity check when
      // designing eval prompts, not as ground truth.
      baseline_outline: row.outline,
    }, null, 2), 'utf8')
    console.log(`Wrote ${path} (${row.transcripts.length} chunks)`)
  } finally {
    await c.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })

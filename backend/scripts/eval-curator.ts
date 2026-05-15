// Eval harness for the curator.
//
// Replays one or more transcript fixtures through the curator and judges
// the resulting outline. Prints a scorecard so we can compare prompt /
// model variants without depending on subjective vibes.
//
// Three modes:
//   - default: replays each fixture as a "single curator run with full
//     transcript", scores the result.  Fast iteration on prompt changes.
//   - --rolling: simulates the live system. Replays chunks 1-by-1 and
//     calls the curator every CURATOR_EVERY_N_CHUNKS chunks, exactly as
//     stream-audio does. Scores the FINAL outline. Slower but matches
//     production behaviour, including the previousOutline-anchoring
//     dynamics.
//   - --baseline <file>: writes the scores to a baseline file. Subsequent
//     runs without --baseline compare against it (delta in each axis).
//
// Usage from backend/:
//   pnpm tsx scripts/eval-curator.ts                      # all fixtures, single mode
//   pnpm tsx scripts/eval-curator.ts --rolling            # all fixtures, rolling mode
//   pnpm tsx scripts/eval-curator.ts --fixture keio       # single fixture
//   pnpm tsx scripts/eval-curator.ts --baseline before    # save scores
//   pnpm tsx scripts/eval-curator.ts --against before     # compare against baseline

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { curateOutline, type Outline } from '../src/lib/curator.js'
import { judgeOutline, type JudgeResult } from './lib/judge.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, '..', 'tests', 'fixtures', 'transcripts')
const BASELINES_DIR = join(__dirname, '..', 'tests', 'fixtures', 'baselines')

// Mirror the production cadence so the rolling-mode simulation matches
// what the live extension drives.
const CURATOR_EVERY_N_CHUNKS = 3
const CURATOR_FULL_REWRITE_EVERY_N_RUNS = 5

interface Fixture {
  source?: string
  transcripts: { ts: number; text: string }[]
}

interface FixtureResult {
  slug: string
  source?: string
  chunks: number
  curatorRuns: number
  totalCuratorMs: number
  judgeMs: number
  outline: Outline
  judge: JudgeResult
}

function parseArgs(argv: string[]): {
  rolling: boolean
  fixture?: string
  baseline?: string
  against?: string
} {
  const opts: { rolling: boolean; fixture?: string; baseline?: string; against?: string } = { rolling: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--rolling') opts.rolling = true
    else if (a === '--fixture') opts.fixture = argv[++i]
    else if (a === '--baseline') opts.baseline = argv[++i]
    else if (a === '--against') opts.against = argv[++i]
  }
  return opts
}

function listFixtures(filterSlug?: string): { slug: string; path: string }[] {
  if (!existsSync(FIXTURES_DIR)) return []
  return readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.json'))
    .filter(f => !filterSlug || f.includes(filterSlug))
    .map(f => ({ slug: f.replace(/\.json$/, ''), path: join(FIXTURES_DIR, f) }))
}

async function runRolling(transcripts: Fixture['transcripts']): Promise<{
  outline: Outline
  curatorRuns: number
  totalCuratorMs: number
}> {
  // Walks through chunks one at a time, calling the curator every Nth
  // chunk just like stream-audio.ts does in production.
  let outline: Outline | null = null
  let runs = 0
  let totalMs = 0
  for (let i = 1; i <= transcripts.length; i++) {
    if (i % CURATOR_EVERY_N_CHUNKS !== 0 && i !== transcripts.length) continue
    const runIndex = Math.floor(i / CURATOR_EVERY_N_CHUNKS)
    const forceFullRewrite = runIndex > 0 && runIndex % CURATOR_FULL_REWRITE_EVERY_N_RUNS === 0
    const t0 = Date.now()
    outline = await curateOutline({
      bucketedTranscript: transcripts.slice(0, i),
      previousOutline: outline,
      forceFullRewrite,
    })
    totalMs += Date.now() - t0
    runs += 1
    process.stdout.write(`    rolling: ${i}/${transcripts.length} chunks, ${runs} runs (avg ${Math.round(totalMs / runs)} ms/run)${forceFullRewrite ? ' [full rewrite]' : ''}\r`)
  }
  process.stdout.write('\n')
  if (!outline) throw new Error('curator never ran (transcript too short?)')
  return { outline, curatorRuns: runs, totalCuratorMs: totalMs }
}

async function runSingle(transcripts: Fixture['transcripts']): Promise<{
  outline: Outline
  curatorRuns: number
  totalCuratorMs: number
}> {
  const t0 = Date.now()
  const outline = await curateOutline({
    bucketedTranscript: transcripts,
    previousOutline: null,
  })
  return { outline, curatorRuns: 1, totalCuratorMs: Date.now() - t0 }
}

async function evalFixture(slug: string, path: string, rolling: boolean): Promise<FixtureResult> {
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as Fixture
  console.log(`\n▼ ${slug} (${fixture.transcripts.length} chunks${fixture.source ? `, ${fixture.source}` : ''})`)
  const runner = rolling ? runRolling : runSingle
  const { outline, curatorRuns, totalCuratorMs } = await runner(fixture.transcripts)
  console.log(`  curator: ${curatorRuns} runs in ${(totalCuratorMs / 1000).toFixed(1)} s, ${outline.sections.length} sections, title="${outline.title}"`)
  const j0 = Date.now()
  const judge = await judgeOutline({
    bucketedTranscript: fixture.transcripts,
    outline,
  })
  const judgeMs = Date.now() - j0
  return {
    slug,
    source: fixture.source,
    chunks: fixture.transcripts.length,
    curatorRuns,
    totalCuratorMs,
    judgeMs,
    outline,
    judge,
  }
}

function formatScorecard(results: FixtureResult[], comparison?: Record<string, JudgeResult>): string {
  // Pretty per-fixture report + overall summary table.
  const lines: string[] = []
  lines.push('')
  lines.push('═══════════════════════════════════════════════════════════════════')
  lines.push('  CURATOR EVAL — Scorecard')
  lines.push('═══════════════════════════════════════════════════════════════════')
  for (const r of results) {
    const j = r.judge
    const cmp = comparison?.[r.slug]
    const delta = (cur: number, prev?: number): string => {
      if (prev === undefined) return ''
      const d = cur - prev
      if (d === 0) return ' (=)'
      const sign = d > 0 ? '+' : ''
      return ` (${sign}${d.toFixed(1)})`
    }
    lines.push('')
    lines.push(`▶ ${r.slug}`)
    lines.push(`    overall      ${j.overall.toFixed(1)}${delta(j.overall, cmp?.overall)}`)
    lines.push(`    coverage     ${j.coverage.toFixed(1)}${delta(j.coverage, cmp?.coverage)}`)
    lines.push(`    accuracy     ${j.accuracy.toFixed(1)}${delta(j.accuracy, cmp?.accuracy)}`)
    lines.push(`    hierarchy    ${j.hierarchy.toFixed(1)}${delta(j.hierarchy, cmp?.hierarchy)}`)
    lines.push(`    conciseness  ${j.conciseness.toFixed(1)}${delta(j.conciseness, cmp?.conciseness)}`)
    lines.push(`    importance   ${j.importance.toFixed(1)}${delta(j.importance, cmp?.importance)}`)
    lines.push(`    provenance   ${j.provenance.toFixed(1)}${delta(j.provenance, cmp?.provenance)}`)
    if (j.issues.length) {
      lines.push(`    issues:`)
      for (const x of j.issues) lines.push(`      - ${x}`)
    }
    if (j.wins.length) {
      lines.push(`    wins:`)
      for (const x of j.wins) lines.push(`      + ${x}`)
    }
    lines.push(`    perf: curator ${(r.totalCuratorMs / 1000).toFixed(1)}s · judge ${(r.judgeMs / 1000).toFixed(1)}s · sections ${r.outline.sections.length}`)
  }
  // Mean across fixtures.
  const n = results.length
  if (n > 1) {
    const mean = (k: keyof Pick<JudgeResult, 'overall' | 'coverage' | 'accuracy' | 'hierarchy' | 'conciseness' | 'importance' | 'provenance'>): number =>
      results.reduce((s, r) => s + r.judge[k], 0) / n
    lines.push('')
    lines.push('───────────────────────────────────────────────────────────────────')
    lines.push(`  MEAN over ${n} fixtures`)
    lines.push(`    overall      ${mean('overall').toFixed(2)}`)
    lines.push(`    coverage     ${mean('coverage').toFixed(2)}`)
    lines.push(`    accuracy     ${mean('accuracy').toFixed(2)}`)
    lines.push(`    hierarchy    ${mean('hierarchy').toFixed(2)}`)
    lines.push(`    conciseness  ${mean('conciseness').toFixed(2)}`)
    lines.push(`    importance   ${mean('importance').toFixed(2)}`)
    lines.push(`    provenance   ${mean('provenance').toFixed(2)}`)
    lines.push('───────────────────────────────────────────────────────────────────')
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv)
  const fixtures = listFixtures(opts.fixture)
  if (fixtures.length === 0) {
    console.error(`No fixtures found in ${FIXTURES_DIR} (filter=${opts.fixture ?? '*'})`)
    process.exit(1)
  }
  console.log(`Eval mode: ${opts.rolling ? 'rolling (production-like)' : 'single-shot'}`)
  console.log(`Fixtures: ${fixtures.map(f => f.slug).join(', ')}`)

  const results: FixtureResult[] = []
  for (const f of fixtures) {
    results.push(await evalFixture(f.slug, f.path, opts.rolling))
  }

  let comparison: Record<string, JudgeResult> | undefined
  if (opts.against) {
    const path = join(BASELINES_DIR, `${opts.against}.json`)
    if (existsSync(path)) {
      const baseline = JSON.parse(readFileSync(path, 'utf8')) as { results: FixtureResult[] }
      comparison = Object.fromEntries(baseline.results.map(r => [r.slug, r.judge]))
    } else {
      console.warn(`Baseline ${opts.against} not found at ${path} — skipping comparison`)
    }
  }

  console.log(formatScorecard(results, comparison))

  if (opts.baseline) {
    mkdirSync(BASELINES_DIR, { recursive: true })
    const path = join(BASELINES_DIR, `${opts.baseline}.json`)
    writeFileSync(path, JSON.stringify({ savedAt: new Date().toISOString(), results }, null, 2), 'utf8')
    console.log(`\nBaseline saved → ${path}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })

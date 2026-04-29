// Measures curator wall-clock latency at several transcript sizes that
// match what a real user pause would produce. Useful to answer "how
// long will the user actually wait when they hit pause at minute N?"
// without needing to drive the full extension end-to-end.
//
// Usage from backend/:
//   pnpm tsx scripts/measure-curator-latency.ts
//
// Reads the existing yt-JGXIB fixture and slices it at 1 / 5 / 10 / 20 /
// full-length, runs each through the curator, prints latency.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { curateOutline } from '../src/lib/curator.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface TranscriptEntry { ts: number; text: string }
interface Fixture { transcripts: TranscriptEntry[] }

async function main(): Promise<void> {
  const fixturePath = join(__dirname, '..', 'tests', 'fixtures', 'transcripts', 'yt-JGXIB.json')
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture

  // Pick representative slice points that match real pause moments.
  // The fixture has 10 s chunks, so chunk count = video minute × 6.
  const points = [
    { label: '1 min',  endIdx: 6 },
    { label: '5 min',  endIdx: 30 },
    { label: '10 min', endIdx: 60 },
    { label: '20 min', endIdx: 120 },
    { label: '30 min', endIdx: 180 },
    { label: 'full (44 min)', endIdx: fixture.transcripts.length },
  ]

  console.log(`Curator: ${process.env.CURATOR_PROVIDER ?? 'openai (gpt-5-nano default)'}`)
  console.log()
  console.log('point          | chunks | total chars | latency')
  console.log('---------------+--------+-------------+--------')

  for (const p of points) {
    const slice = fixture.transcripts.slice(0, p.endIdx)
    const totalChars = slice.reduce((s, c) => s + c.text.length, 0)
    const t0 = Date.now()
    try {
      const outline = await curateOutline({
        bucketedTranscript: slice,
        previousOutline: null,
        forceFullRewrite: false,
      })
      const ms = Date.now() - t0
      const sectionCount = outline.sections.length
      console.log(`${p.label.padEnd(14)} | ${String(p.endIdx).padStart(6)} | ${String(totalChars).padStart(11)} | ${(ms / 1000).toFixed(1).padStart(6)}s  (${sectionCount} sections)`)
    } catch (e) {
      const ms = Date.now() - t0
      console.log(`${p.label.padEnd(14)} | ${String(p.endIdx).padStart(6)} | ${String(totalChars).padStart(11)} | ${(ms / 1000).toFixed(1).padStart(6)}s  ERROR: ${e instanceof Error ? e.message.slice(0, 60) : 'unknown'}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })

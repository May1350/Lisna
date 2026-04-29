// Pulls a YouTube video's Japanese captions and converts them into our
// transcript-fixture format for the eval harness. Why YouTube instead of
// a real RDS-stored session:
//   - No VPC / DB access needed; runs anywhere.
//   - Reproducible: same URL → same transcript (modulo the lecturer
//     re-uploading a different captions track, which is rare).
//   - Human-generated captions on production lecture videos give us
//     (close to) ground-truth STT, so we can later compare our Whisper
//     output WER against this.
//   - Multiple test videos generalise across topics and presenters,
//     reducing the risk of "tuned to one specific lecture" bias.
//
// Pipeline:
//   1. yt-dlp downloads the Japanese subtitle file (prefer manual CC,
//      fall back to auto-captions) in JSON3 format. JSON3 is YouTube's
//      structured caption format with per-token timing — much cleaner to
//      parse than VTT.
//   2. We convert events into our { ts, text }[] chunk format. Chunks
//      are time-bucketed to ~10 s windows so the fixture matches what
//      the live extension would produce.
//   3. Resulting fixture is written under tests/fixtures/transcripts/.
//
// Usage (from backend/):
//   pnpm tsx scripts/fixture-from-youtube.ts <video_url_or_id> [slug]

import { execSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, '..', 'tests', 'fixtures', 'transcripts')

// Bucket window size in seconds. Matches the audio capture chunk length so
// the fixture's chunking pattern resembles what the live system produces.
const BUCKET_SEC = 10

interface Json3Event {
  tStartMs: number
  dDurationMs: number
  segs?: { utf8: string }[]
}

interface Json3Doc { events: Json3Event[] }

function videoIdFromArg(arg: string): string {
  // Accept either a bare 11-char video ID or a full URL.
  if (/^[A-Za-z0-9_-]{11}$/.test(arg)) return arg
  const m = arg.match(/[?&]v=([A-Za-z0-9_-]{11})/) || arg.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)
  if (!m) throw new Error('Cannot parse video ID from: ' + arg)
  return m[1]
}

function downloadCaptions(videoId: string): Json3Doc {
  // We go through a temp dir so yt-dlp doesn't pollute the repo. The
  // tool writes one .ja.json3 (or .ja-orig.json3 for translated tracks)
  // per available track; we pick the manual track if present, else the
  // auto-generated one.
  const tmp = mkdtempSync(join(tmpdir(), 'sh-yt-'))
  try {
    // Run with `|| true` semantics: yt-dlp can partial-succeed (e.g. ja
    // downloaded fine but en hit 429), but execSync would treat that
    // exit-code-1 as a hard failure even though we already have what we
    // need on disk. Wrap in try/catch and check for any .json3 below.
    try {
      execSync(
        `yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs 'ja,ja-orig' ` +
        `--sub-format json3 --output '%(id)s' 'https://www.youtube.com/watch?v=${videoId}' `,
        { cwd: tmp, stdio: ['ignore', 'inherit', 'inherit'] },
      )
    } catch {
      // Partial failure is OK if at least one subtitle landed. We check
      // the temp dir below.
    }
    const files = readdirSync(tmp).filter(f => f.endsWith('.json3'))
    if (files.length === 0) throw new Error('No subtitle files were downloaded')
    // Prefer manually authored 'ja' over auto-generated 'ja-orig'.
    const ranked = files.sort((a, b) => rank(a) - rank(b))
    const chosen = ranked[0]
    const raw = readFileSync(join(tmp, chosen), 'utf8')
    console.log(`[fixture] using subtitle file: ${chosen}`)
    return JSON.parse(raw) as Json3Doc
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function rank(name: string): number {
  // Lower = better. Manual ja first, then ja-orig (auto-translated to ja),
  // then en, then anything else.
  if (/\.ja\.json3$/.test(name)) return 0
  if (/\.ja-/.test(name)) return 1
  if (/\.en\.json3$/.test(name)) return 5
  return 10
}

function bucketsFromEvents(events: Json3Event[]): { ts: number; text: string }[] {
  // Each event contains an array of "segs" with text fragments and a
  // start time. We collapse all text within the same BUCKET_SEC window
  // into one bucket entry so the fixture matches our 10 s chunk model.
  const buckets = new Map<number, string[]>()
  for (const ev of events) {
    if (!ev.segs) continue
    const text = ev.segs.map(s => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const startSec = Math.floor((ev.tStartMs ?? 0) / 1000)
    const bucket = Math.floor(startSec / BUCKET_SEC) * BUCKET_SEC
    const arr = buckets.get(bucket) ?? []
    arr.push(text)
    buckets.set(bucket, arr)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, parts]) => ({ ts, text: parts.join(' ') }))
}

function main(): void {
  const arg = process.argv[2]
  const slug = process.argv[3]
  if (!arg) {
    console.error('usage: fixture-from-youtube.ts <video_url_or_id> [slug]')
    process.exit(1)
  }
  const videoId = videoIdFromArg(arg)
  const finalSlug = slug ?? `youtube-${videoId}`
  const doc = downloadCaptions(videoId)
  const buckets = bucketsFromEvents(doc.events ?? [])
  if (buckets.length === 0) throw new Error('No transcript text after bucketing')
  mkdirSync(FIXTURES_DIR, { recursive: true })
  const path = join(FIXTURES_DIR, `${finalSlug}.json`)
  writeFileSync(path, JSON.stringify({
    source: `https://www.youtube.com/watch?v=${videoId}`,
    bucket_seconds: BUCKET_SEC,
    transcripts: buckets,
  }, null, 2), 'utf8')
  const lastTs = buckets[buckets.length - 1].ts
  console.log(
    `Wrote ${path}\n` +
    `  ${buckets.length} chunks · ` +
    `${Math.floor(lastTs / 60)} min ${lastTs % 60} s of lecture`,
  )
}

main()

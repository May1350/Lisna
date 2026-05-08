import { withAuth } from '../lib/auth.js'
import { transcribeChunk } from '../lib/stt.js'
import { checkQuota, recordUsage } from '../lib/quota.js'
import { sendToSession } from '../lib/ws-broadcast.js'
import { query } from '../lib/db.js'
import { createHash } from 'node:crypto'
import { z } from 'zod'

// Phase 6.1 (2026-04-29): on-demand curator pivot.
// stream-audio is now ONLY the live STT path:
//   1. Run STT on the chunk
//   2. Append to session.transcripts[]
//   3. Broadcast transcript_chunk over WS for the modal's live captions
//
// The curator is no longer triggered here. It runs in a separate handler
// (session-curate.ts → POST /v1/session/:id/curate) which the modal calls
// when:
//   - the user pauses the video (debounced)
//   - the video ends
//   - the user clicks the manual "📝 ノートを生成" button
//   - the user stops the session
//
// This drops the per-chunk Lambda time from 60-90 s (curator was the
// bottleneck) to 1-3 s (just STT + DB append + WS broadcast). It also
// reduces curator calls per 1 h lecture from ~120 to ~1-3, slashing LLM
// cost from ~$0.12 to ~$0.005 — a 96% reduction with HIGHER quality
// because the on-demand call sees the full transcript instead of a
// 16 K-char tail window.

const Body = z.object({
  session_id: z.string().uuid(),
  url: z.string().url(),
  start_time_sec: z.number().nonnegative(),
  duration_sec: z.number().positive(),
  audio_b64: z.string().min(1),
  mime: z.string(),
})

interface TranscriptEntry { ts: number; text: string }

function normalizeUrl(u: string): string {
  const url = new URL(u)
  url.hash = ''
  return url.toString()
}

// Whisper / gpt-4o-transcribe both hallucinate stock phrases on silent or
// near-silent audio (paused video, music gaps, room tone). These outputs
// are training-data artifacts — usually English subtitles overlaid on
// silent shots in YouTube. If we let them through they pollute the live
// caption strip with "[02:12] you" repeating forever, and worse, the
// curator treats them as real lecture content.
//
// Heuristic: lowercase + strip whitespace/punctuation, compare against a
// known-bad set. If the transcript is JUST the hallucination phrase
// (after trim), drop it. Mixed real + phrase falls through unchanged.
const STT_HALLUCINATIONS = new Set([
  'you',
  'youyou',
  'youyouyou',
  'youyouyouyou',
  'thanks',
  'thankyou',
  'thanksforwatching',
  'thankyouforwatching',
  'thankyouforwatchingthisvideo',
  'pleasesubscribe',
  'subscribetomychannel',
  'bye',
  'byebye',
  'okay',
  'ok',
  'mm',
  'hmm',
  'uhhuh',
  'silence',
  'music',
  'applause',
  'laughter',
  // CJK silence / interjection artifacts
  'ご視聴ありがとうございました',
  'ご清聴ありがとうございました',
  '聞いてくださってありがとうございます',
  '음악',
  '感谢观看',
  '请订阅',
])

function isStuckHallucination(raw: string): boolean {
  // Strip [bracket/parenthesis] markers, whitespace, ASCII punctuation, and
  // lower-case the result. Also collapse repeated tokens like "you you you".
  const cleaned = raw
    .toLowerCase()
    .replace(/[\[\](){}♪。、,.\-_!?:;'"]/g, '')
    .replace(/\s+/g, '')
  if (cleaned.length === 0) return true
  if (STT_HALLUCINATIONS.has(cleaned)) return true
  // "youyouyouyou..." — same word repeated. Detect by stripping a single
  // repeated unit and checking the remainder.
  for (const unit of ['you', 'thanks', 'bye', 'mm', 'hmm', 'okay']) {
    if (cleaned.length >= unit.length * 2 && cleaned.replace(new RegExp(`(${unit})+`, 'g'), '') === '') {
      return true
    }
  }
  return false
}

export const handler = withAuth(async (event, payload) => {
  const body = Body.parse(JSON.parse(event.body || '{}'))
  const userPlan = payload.plan
  const quota = await checkQuota(payload.sub, userPlan)
  // Helper: pack the full quota snapshot into a structure the modal can
  // reason about (used / limit / remaining + percentage). Returned on
  // BOTH success and 402 responses so the frontend can render tiered
  // warnings (50% → 80% → 95% → 100% blocking) instead of a binary
  // "everything fine" / "everything broken" experience.
  const quotaSnapshot = {
    used_secs: quota.used,
    limit_secs: quota.limit,
    remaining_secs: quota.remainingSecs,
    percent_used: Math.min(100, Math.round((quota.used / Math.max(1, quota.limit)) * 100)),
    plan: userPlan,
  }
  if (!quota.allowed) {
    return {
      statusCode: 402,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'quota_exceeded', quota: quotaSnapshot }),
    }
  }

  const audioBuf = Buffer.from(body.audio_b64, 'base64').buffer

  // ── 1. UPSERT SESSION ROW ──────────────────────────────────────────────
  // Always return canonical session_id even on STT failure so the client
  // adopts it and connects WS. Any later /v1/session/:id/curate call will
  // find an empty (or partial) transcripts array and decide what to do.
  const urlHash = createHash('sha256').update(normalizeUrl(body.url)).digest('hex')
  const upserted = await query<{ id: string }>(
    `INSERT INTO sessions (id, user_id, url_hash, url_original)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, url_hash) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [body.session_id, payload.sub, urlHash, body.url]
  )
  const sessionId = upserted[0].id

  // ── 2. STT (best-effort) ────────────────────────────────────────────────
  let transcriptText = ''
  let segments: { start: number; end: number; text: string }[] = []
  let chunkError: string | undefined
  try {
    const transcript = await transcribeChunk(audioBuf, body.mime)
    transcriptText = transcript.text.trim()
    segments = transcript.segments
  } catch (e) {
    chunkError = 'stt_failed'
    // eslint-disable-next-line no-console
    console.warn('[stream-audio] STT failed; skipping chunk:', e instanceof Error ? e.message : e)
  }

  if (transcriptText.length === 0) {
    return ok(sessionId, {
      chunk_error: chunkError ?? 'empty_transcript',
      quota: quotaSnapshot,
    })
  }

  // Whisper hallucination guard at the CHUNK level — catches the
  // common case where the entire chunk is one stock phrase. We re-run
  // it per-segment below to also catch mixed chunks where only some
  // segments are hallucinations.
  if (isStuckHallucination(transcriptText)) {
    // eslint-disable-next-line no-console
    console.info('[stream-audio] dropping STT hallucination:', JSON.stringify(transcriptText))
    return ok(sessionId, {
      chunk_error: 'silence_hallucination',
      quota: quotaSnapshot,
    })
  }

  // ── 3. Build per-segment transcript entries ─────────────────────────────
  // Whisper returns 3-7 sentence-bounded segments per 10 s chunk with
  // sub-chunk start/end times. Promoting each segment to its own
  // transcript entry gives the curator (and the user clicking
  // timestamps) ~2-3 s granularity instead of the old 10 s chunk
  // boundary. If the STT backend returned an empty segment list (some
  // providers do for very short chunks), fall back to a single
  // chunk-level entry so the pipeline still produces something.
  const fallbackSegment = { start: 0, end: body.duration_sec, text: transcriptText }
  const rawSegments = segments.length > 0 ? segments : [fallbackSegment]

  const cleanEntries: TranscriptEntry[] = []
  let droppedSegments = 0
  for (const seg of rawSegments) {
    const text = seg.text.trim()
    if (text.length === 0) continue
    if (isStuckHallucination(text)) { droppedSegments++; continue }
    cleanEntries.push({
      ts: Math.round(body.start_time_sec + Math.max(0, seg.start)),
      text,
    })
  }

  if (cleanEntries.length === 0) {
    // Every segment was either empty or a hallucination — treat as a
    // silence chunk and don't bill quota.
    // eslint-disable-next-line no-console
    console.info('[stream-audio] all segments dropped as hallucination/empty', { droppedSegments })
    return ok(sessionId, {
      chunk_error: 'silence_hallucination',
      quota: quotaSnapshot,
    })
  }

  // ── 4. Live broadcast + DB append ───────────────────────────────────────
  // Send all segments in a single WS message. The frontend handler
  // appends `items` in order to its ring buffer. Doing it as one
  // message instead of N is cheaper (one PostToConnection vs N) and
  // avoids any out-of-order delivery edge cases.
  void sendToSession(sessionId, {
    type: 'transcript_chunk',
    items: cleanEntries,
    // Keep ts/text for legacy frontend builds that read the singular
    // shape — set to the FIRST segment so they at least see something
    // sensible. New clients prefer `items` and ignore these.
    ts: cleanEntries[0].ts,
    text: cleanEntries[0].text,
  }).catch(e => console.warn('[stream-audio] live transcript broadcast failed:', e))

  await query(
    `UPDATE sessions
       SET transcripts = COALESCE(transcripts, '[]'::jsonb) || $1::jsonb,
           updated_at  = NOW()
     WHERE id = $2`,
    [JSON.stringify(cleanEntries), sessionId],
  )

  const recordedSecs = Math.ceil(body.duration_sec)
  await recordUsage(payload.sub, recordedSecs)

  // Refresh the snapshot post-record so the client sees the up-to-date
  // counter that includes THIS chunk's seconds. Cheap recompute (single
  // arithmetic, no extra DB roundtrip) — quota.used is the pre-record
  // value, so we just add what we just wrote.
  const usedAfter = quota.used + recordedSecs
  const quotaSnapshotAfter = {
    ...quotaSnapshot,
    used_secs: usedAfter,
    remaining_secs: Math.max(0, quota.limit - usedAfter),
    percent_used: Math.min(100, Math.round((usedAfter / Math.max(1, quota.limit)) * 100)),
  }

  return ok(sessionId, {
    transcript_preview: transcriptText.slice(0, 80),
    quota: quotaSnapshotAfter,
    ...(chunkError ? { chunk_error: chunkError } : {}),
  })
})

function ok(sessionId: string, extra: Record<string, unknown>) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, ...extra }),
  }
}

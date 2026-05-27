// desktop/src/shared/note-schema/chunking.ts
//
// Lifted from desktop/spikes/phase-0/04-chunking/chunking.ts (Spike 0.4)
// per VERDICT.md carry-forward #2.
//
// Behavioral changes vs spike:
//   - TranscriptSegment / SessionTranscript types come from ./transcript
//     (v2 shape — `ts` + `endTs` + `speakerId` + `meta?`, not the spike's
//     local `ts` + `text` + `speakerId`).
//   - estimateTokens comes from ./tokens (extended CJK regex).
//   - findSilenceGaps uses seg.endTs instead of the text-length heuristic
//     (Task 8 I-3 fix — heuristic overflowed on STT-bucket-shaped fixtures).

import type { SessionTranscript, TranscriptSegment } from './transcript';
import { estimateTokens } from './tokens';

interface SilenceGap {
  startTs: number;
  endTs: number;
  durationSec: number;
}

/**
 * Find gaps between adjacent segments where the silent interval ≥ minGapSec
 * AND the gap-start lies within [windowStart, windowEnd]. Returns the gaps
 * for the caller's snap logic.
 *
 * Uses whisper-emitted endTs as the segment-end anchor; clamps to next-seg
 * `ts` so degenerate input (endTs >= next.ts) doesn't make every gap
 * negative-duration and disable the silence branch.
 */
function findSilenceGaps(
  segs: TranscriptSegment[],
  windowStart: number,
  windowEnd: number,
  minGapSec: number,
): SilenceGap[] {
  const gaps: SilenceGap[] = [];
  for (let i = 0; i < segs.length - 1; i++) {
    // Use whisper's per-segment endTs (plumbed from whisper_full_get_segment_t1
    // at desktop/sidecar/src/stt/whisper_engine.cpp:59 + json_protocol.cpp:111).
    // Clamp to segs[i+1].ts to handle degenerate input where a stale path
    // hands us endTs >= next.ts (would mark every gap negative-duration).
    const segLastWord = Math.min(segs[i]!.endTs, segs[i + 1]!.ts);
    const gapStart = Math.max(segLastWord, segs[i]!.ts);
    const gapEnd = segs[i + 1]!.ts;
    const gapDuration = gapEnd - gapStart;
    if (gapDuration >= minGapSec && gapStart >= windowStart && gapStart <= windowEnd) {
      gaps.push({ startTs: gapStart, endTs: gapEnd, durationSec: gapDuration });
    }
  }
  return gaps;
}

/**
 * Split a SessionTranscript into chunks bounded by `maxTokens`, preferring
 * silence > 1.5s within ±`slackSec` of the soft boundary. Per spec §5.2a.
 */
export function chunkTranscript(
  transcript: SessionTranscript,
  maxTokens: number,
  slackSec = 30,
): SessionTranscript[] {
  const segs = transcript.transcriptSegments;
  if (segs.length === 0) return [];

  const chunks: SessionTranscript[] = [];
  let cursorIdx = 0;

  while (cursorIdx < segs.length) {
    let tokens = 0;
    let softEndIdx = cursorIdx;
    for (let i = cursorIdx; i < segs.length; i++) {
      const segTokens = estimateTokens(segs[i]!.text);
      if (tokens + segTokens > maxTokens && i > cursorIdx) {
        softEndIdx = i - 1;
        break;
      }
      tokens += segTokens;
      softEndIdx = i;
    }

    if (softEndIdx >= segs.length - 1) {
      chunks.push({ ...transcript, transcriptSegments: segs.slice(cursorIdx) });
      break;
    }

    const softEndTs = segs[softEndIdx]!.ts;
    const candidates = findSilenceGaps(segs, softEndTs - slackSec, softEndTs + slackSec, 1.5);
    let hardEndIdx: number;
    if (candidates.length > 0) {
      const best = candidates.reduce((b, c) =>
        Math.abs(c.startTs - softEndTs) < Math.abs(b.startTs - softEndTs) ? c : b,
      );
      hardEndIdx = segs.findIndex((s, i) => i > cursorIdx && s.ts >= best.endTs) - 1;
      if (hardEndIdx < cursorIdx) hardEndIdx = softEndIdx;
    } else {
      hardEndIdx = softEndIdx;
    }

    chunks.push({
      ...transcript,
      transcriptSegments: segs.slice(cursorIdx, hardEndIdx + 1),
    });
    cursorIdx = hardEndIdx + 1;
  }

  return chunks;
}

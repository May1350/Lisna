export interface TranscriptSegment {
  ts: number;
  text: string;
  speakerId: number;
}

export interface SessionTranscript {
  sessionId: string;
  speakers: { id: number; name?: string }[];
  transcriptSegments: TranscriptSegment[];
}

function estimateTokens(text: string): number {
  const cjkCount = (text.match(/[぀-ゟ゠-ヿ一-鿿]/g) ?? []).length;
  const asciiCount = text.length - cjkCount;
  return Math.ceil(cjkCount * 0.6 + asciiCount * 0.25);
}

interface SilenceGap {
  startTs: number;
  endTs: number;
  durationSec: number;
}

function findSilenceGaps(segs: TranscriptSegment[], windowStart: number, windowEnd: number, minGapSec: number): SilenceGap[] {
  const gaps: SilenceGap[] = [];
  for (let i = 0; i < segs.length - 1; i++) {
    const segLastWord = segs[i].ts + (segs[i].text.length * 0.07);
    const gapStart = Math.max(segLastWord, segs[i].ts);
    const gapEnd = segs[i + 1].ts;
    const gapDuration = gapEnd - gapStart;
    if (gapDuration >= minGapSec && gapStart >= windowStart && gapStart <= windowEnd) {
      gaps.push({ startTs: gapStart, endTs: gapEnd, durationSec: gapDuration });
    }
  }
  return gaps;
}

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
      const segTokens = estimateTokens(segs[i].text);
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

    const softEndTs = segs[softEndIdx].ts;
    const candidates = findSilenceGaps(segs, softEndTs - slackSec, softEndTs + slackSec, 1.5);
    let hardEndIdx: number;
    if (candidates.length > 0) {
      const best = candidates.reduce((b, c) =>
        Math.abs(c.startTs - softEndTs) < Math.abs(b.startTs - softEndTs) ? c : b
      );
      hardEndIdx = segs.findIndex((s, i) => i > cursorIdx && s.ts >= best.endTs) - 1;
      if (hardEndIdx < cursorIdx) hardEndIdx = softEndIdx;
    } else {
      hardEndIdx = softEndIdx;
    }

    chunks.push({ ...transcript, transcriptSegments: segs.slice(cursorIdx, hardEndIdx + 1) });
    cursorIdx = hardEndIdx + 1;
  }

  return chunks;
}

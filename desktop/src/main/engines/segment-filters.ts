import type { TranscriptSegment, Language } from '@shared/engine-interfaces';

export const HALLUCINATION_BLOCKLIST: Readonly<Record<Language, ReadonlySet<string>>> = {
  ja: new Set([
    'はい',
    'ご視聴ありがとうございました',
    'ありがとうございました',
    'うん',
    'ねぇ',
    'ごめん',
    'あー',
    'えー',
    'んー',
    'おー',
  ]),
  en: new Set<string>(),
  ko: new Set<string>(),
  zh: new Set<string>(),
};

export const DEFAULT_NO_SPEECH_PROB_THRESHOLD = 0.6;

export interface FilterOptions {
  language: Language;
  noSpeechProbThreshold?: number;
}

export function isHallucination(
  segment: TranscriptSegment,
  opts: FilterOptions,
): boolean {
  const trimmed = segment.text.trim();

  // Always drop empty/whitespace-only text
  if (trimmed === '') return true;

  // Degenerate moraic-nasal burst: a segment that is only 「ん」 (or katakana ン),
  // possibly repeated, with optional trailing punctuation — 「ん」「んん」「ん、」…
  // Whisper emits these in bursts on hard/quiet audio (one recording had 76, at
  // noSpeechProb ≈ 1e-9) so no silence marker fires. Zero information, not a
  // blocklist phrase. Lang-agnostic: only JA output can produce ん at all.
  // ponytail: matches the observed pure-ん bursts; extend the char class if a
  // 「んー」/「んっ」 variant ever shows up in real data.
  if (/^[んン]+[、。！？…]*$/.test(trimmed)) return true;

  // Layer F.front: probability filter (lang-agnostic, only when prob is available)
  if (segment.noSpeechProb !== undefined) {
    const threshold = opts.noSpeechProbThreshold ?? DEFAULT_NO_SPEECH_PROB_THRESHOLD;
    if (segment.noSpeechProb > threshold) return true;
  }

  // Layer E: blocklist + hallucination marker (must have BOTH blocklist match AND a marker).
  // Whisper appends trailing punctuation (、。！？…) to stereotyped phrases; strip before lookup
  // so the exact-match set still catches "ごめん、" / "はい。" etc.
  const normalized = trimmed.replace(/[、。！？…]+$/, '');
  const blocklist = HALLUCINATION_BLOCKLIST[opts.language] ?? new Set<string>();
  if (blocklist.has(normalized)) {
    // Marker 1: elevated no-speech probability (≥ 0.3, below F.front threshold)
    if (segment.noSpeechProb !== undefined && segment.noSpeechProb >= 0.3) return true;
    // Marker 2: zero-zero timestamps (common for whisper silence hallucinations)
    if (segment.startSec === 0 && segment.endSec === 0) return true;
    // Marker 3: no probability data + short text (high suspicion without a counter-signal)
    if (segment.noSpeechProb === undefined && trimmed.length <= 10) return true;
    // Marker 4: first-chunk silence with high speech confidence. Kotoba-whisper-v2.0 on
    // all-zero PCM emits a blocklist phrase at [0, ≤3s] with noSpeechProb ≈ 0 — the model
    // is "confident" it's speech, it isn't. False-positive risk: a real isolated 「はい」
    // at startSec=0 < 3s also fires; accepted trade-off because dense-speech 「はい」
    // (startSec > 0) and long openers (endSec > 3) are protected.
    if (
      segment.noSpeechProb !== undefined &&
      segment.noSpeechProb < 0.1 &&
      segment.startSec === 0 &&
      segment.endSec > 0 &&
      segment.endSec <= 3
    ) return true;
  }

  return false;
}

// Keep at most this many consecutive segments with identical normalized text.
// A real double (「はい」「はい」) is a run of 2 and survives; a decoder loop
// (worst observed: one phrase ×343 to end-of-file) collapses to the first 2.
const MAX_CONSECUTIVE_REPEATS = 2;

/**
 * Collapse runs of consecutive segments with identical normalized text down to
 * the first {@link MAX_CONSECUTIVE_REPEATS}. Whisper's decoder latches onto a
 * phrase on hard audio and repeats it every ~1-2s to the end of the file; those
 * repeats have noSpeechProb ≈ 0, so the per-segment silence markers never catch
 * them. Runs are detected AFTER the hallucination filter so a dropped segment
 * doesn't split a run. Normalization strips trailing punctuation/space so
 * 「そうですね」/「そうですね。」 count as the same loop.
 */
function collapseConsecutiveRepeats(
  segments: readonly TranscriptSegment[],
): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let prevNorm: string | null = null;
  let runLen = 0;
  for (const s of segments) {
    const norm = s.text.trim().replace(/[、。！？!?…\s]+$/, '');
    if (norm !== '' && norm === prevNorm) {
      runLen += 1;
      if (runLen > MAX_CONSECUTIVE_REPEATS) continue; // drop 3rd+ copy of a loop
    } else {
      prevNorm = norm;
      runLen = 1;
    }
    out.push(s);
  }
  return out;
}

export function filterSegments(
  segments: readonly TranscriptSegment[],
  opts: FilterOptions,
): TranscriptSegment[] {
  const kept = segments.filter((s) => !isHallucination(s, opts));
  return collapseConsecutiveRepeats(kept);
}

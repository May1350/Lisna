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

  // Layer F.front: probability filter (lang-agnostic, only when prob is available)
  if (segment.noSpeechProb !== undefined) {
    const threshold = opts.noSpeechProbThreshold ?? DEFAULT_NO_SPEECH_PROB_THRESHOLD;
    if (segment.noSpeechProb > threshold) return true;
  }

  // Layer E: blocklist + hallucination marker (must have BOTH blocklist match AND a marker)
  const blocklist = HALLUCINATION_BLOCKLIST[opts.language] ?? new Set<string>();
  if (blocklist.has(trimmed)) {
    // Marker 1: elevated no-speech probability (≥ 0.3, below F.front threshold)
    if (segment.noSpeechProb !== undefined && segment.noSpeechProb >= 0.3) return true;
    // Marker 2: zero-zero timestamps (common for whisper silence hallucinations)
    if (segment.startSec === 0 && segment.endSec === 0) return true;
    // Marker 3: no probability data + short text (high suspicion without a counter-signal)
    if (segment.noSpeechProb === undefined && trimmed.length <= 10) return true;
  }

  return false;
}

export function filterSegments(
  segments: readonly TranscriptSegment[],
  opts: FilterOptions,
): TranscriptSegment[] {
  return segments.filter((s) => !isHallucination(s, opts));
}

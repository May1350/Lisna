// desktop/eval/anchor-match.ts
//
// Anchor-containment helpers for meeting-note coverage scoring.
// Used by both coverage.ts (scorecard) and contract/families/meeting.ts (contract rule).
//
// Motivation: the 3B model atomizes compound decisions into sub-facts across
// decisions[], next_steps[], and discussions[].key_points[]. A naive substring
// match of a dense compound gold decision against a single atomized note field
// always returns 0, even when every fact is captured. The anchor-containment
// approach checks that the key numeric and nominal tokens of the gold decision
// appear somewhere across all three fields.

/** Numeric and nominal tokens extracted from a Japanese/Latin text.
 *
 * numbers: digit sequences (full-width or half-width), optionally followed by
 *   a unit-like suffix (万, 億, %, %, 円), with intra-number separators (,, ，, ., ．)
 *   stripped for normalization. E.g. "3,480円" → "3480円".
 *
 * nouns: katakana runs ≥2 chars, or latin/ASCII runs ≥2 chars (lowercased).
 *   These capture loan-words, brand names, and product names that anchor meaning.
 */
export interface Anchors {
  numbers: string[];
  nouns: string[];
}

// [0-9] half-width digits, [０-９] full-width digits 0-9.
const NUMBER_RE = /[0-9０-９][0-9０-９,，.．]*(?:[万億%％円])?/g;
// ゠ = U+30A0 (katakana-hiragana double hyphen), ヿ = U+30FF (last katakana).
const KATAKANA_RE = /[゠-ヿ]{2,}/g;
const LATIN_RE = /[A-Za-z]{2,}/g;

function stripNumberSeps(s: string): string {
  // Remove thousand-separators and full-width equivalents; keep trailing unit.
  return s.replace(/[,，.．]/g, '');
}

export function anchorsOf(text: string): Anchors {
  const numbers: string[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    numbers.push(stripNumberSeps(m[0]));
  }
  const nouns: string[] = [];
  for (const m of text.matchAll(KATAKANA_RE)) nouns.push(m[0]);
  for (const m of text.matchAll(LATIN_RE)) nouns.push(m[0].toLowerCase());
  return { numbers, nouns };
}

function normContains(haystack: string, needle: string): boolean {
  // Strip whitespace AND number separators (,，.．) — consistent with anchorsOf's
  // stripNumberSeps — so a comma-formatted number in the note ("3,480円") matches
  // a normalized anchor ("3480円"). Lowercase for latin tokens.
  const norm = (s: string) => s.replace(/[\s,，.．]/g, '').toLowerCase();
  return norm(haystack).includes(norm(needle));
}

/** Minimal structural shape of the note fields this matcher reads.
 *  All optional — the note is LLM output and any field may be absent. */
type NoteShape = {
  decisions?: Array<{ text?: string }>;
  next_steps?: Array<{ text?: string }>;
  discussions?: Array<{ key_points?: string[] }>;
};

/**
 * Returns true when the `goldText` decision is captured in the note.
 *
 * Rule:
 *   (a) Legacy fast-path: goldText is a normalized substring of any
 *       `note.decisions[].text` OR `note.next_steps[].text`.
 *   (b) Anchor containment: ≥⌈2/3⌉ of the gold's anchors (numbers ∪ nouns)
 *       appear anywhere in the haystack of
 *       decisions[].text ∪ next_steps[].text ∪ discussions[].key_points[].
 *       Used when atomized output splits the compound gold across fields.
 *   If the gold has NO anchors, fall back to (a) only.
 */
export function meetingDecisionCaptured(goldText: string, note: NoteShape): boolean {
  const decisions: string[] = (note.decisions ?? []).map((d) => String(d.text ?? ''));
  const nextSteps: string[] = (note.next_steps ?? []).map((d) => String(d.text ?? ''));

  // (a) Legacy substring fast-path.
  const legacyHay = [...decisions, ...nextSteps];
  if (legacyHay.some(t => normContains(t, goldText))) return true;

  // (b) Anchor containment across the wider haystack.
  const { numbers, nouns } = anchorsOf(goldText);
  const anchors = [...numbers, ...nouns];
  if (anchors.length === 0) return false; // no anchors → substring only

  // Build the wider haystack: decisions ∪ next_steps ∪ discussions[].key_points[]
  const discussions = Array.isArray(note.discussions) ? note.discussions : [];
  const keyPoints: string[] = discussions.flatMap((d) =>
    Array.isArray(d.key_points) ? d.key_points.map((p) => String(p)) : [],
  );
  const wideHay = [...legacyHay, ...keyPoints].join('\n');

  // ⌈2/3⌉ of anchors must appear in the wide haystack.
  const threshold = Math.ceil((anchors.length * 2) / 3);
  const found = anchors.filter(a => normContains(wideHay, a)).length;
  return found >= threshold;
}

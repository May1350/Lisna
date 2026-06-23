// Serialize a finalized note → Markdown, and a transcript → plain text, for the
// Copy / Export(.md/.txt) buttons (NoteView / TranscriptView).
//
// ONE generic heuristic walker covers all 4 families (closed enum) instead of 4
// per-family serializers: the families share the NoteBase header + mostly
// {text, ts, from}-style items, so a field-walk with a small label/primary/
// annotation heuristic produces clean Obsidian-friendly Markdown and stays
// correct when a family gains a field. Legacy cloud notes already carry
// `.markdown`, returned verbatim.
// ponytail: heuristic walker over 4 hand-written serializers — refine per-family
// only if a family's export reads poorly.

const HEADER_KEYS = new Set([
  'schemaVersion', 'family', 'title', 'generatedAt', 'generatedBy',
  'language', 'durationSec', 'experimentArmId', 'validation_warnings', 'markdown',
  'transcriptSegments',
]);

const HEADING_OVERRIDES: Record<string, string> = {
  qa: 'Q&A', qa_pairs: 'Q&A',
  executive_summary: 'Executive summary', subject_summary: 'Subject summary',
  next_steps: 'Next steps', open_questions: 'Open questions',
  risks_or_concerns: 'Risks / concerns', topic_arc: 'Topic arc',
  key_terms: 'Key terms', idea_clusters: 'Idea clusters',
  quotable_lines: 'Quotable lines', action_items: 'Action items',
};

function humanize(key: string): string {
  return HEADING_OVERRIDES[key] ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// Item field roles (checked in order). An array item picks its lead text from a
// label (a short heading-ish field) + a primary (its prose body).
const LABEL_KEYS = ['heading', 'topic', 'theme', 'term', 'title', 'name', 'role'];
const PRIMARY_KEYS = ['text', 'task', 'summary', 'description', 'definition'];
// Extra prose rendered as an indented sub-line after the lead (lecture section
// takeaway, interview quotable why_notable).
const SECONDARY_KEYS = ['takeaway', 'why_notable'];
// Numeric speaker references (SpeakerRefSchema). `from` is NOT here — it is the
// ProvenanceSchema enum ('transcript' | 'inferred'), handled separately; reading
// it as a speaker both leaked the internal word and dropped the real speaker.
const SPEAKER_KEYS = ['owner', 'made_by', 'asked_by', 'answered_by', 'raised_by', 'proposed_by', 'contributed_by', 'speakerRef'];
const NESTED_ARRAY_KEYS = ['key_points', 'points', 'ideas', 'examples', 'key_terms', 'sub_points'];

function fmtTs(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

type Obj = Record<string, unknown>;

function firstString(item: Obj, keys: readonly string[]): string | undefined {
  for (const k of keys) if (typeof item[k] === 'string' && item[k]) return item[k] as string;
  return undefined;
}

/** Compact ` _(話者N, 期限: …, @m:ss)_` suffix + trailing `※` for inferred items
 *  (mirrors the on-screen renderer's inferred marker). Never prints `from`. */
function annotations(item: Obj): string {
  const parts: string[] = [];
  for (const k of SPEAKER_KEYS) {
    if (typeof item[k] === 'number') { parts.push(`話者${item[k] as number}`); break; }
  }
  if (typeof item.due === 'string' && item.due) parts.push(`期限: ${item.due}`);
  const ts = item.ts ?? item.ts_start ?? (Array.isArray(item.appears_at_ts) ? item.appears_at_ts[0] : undefined);
  if (typeof ts === 'number') parts.push(`@${fmtTs(ts)}`);
  const suffix = parts.length ? ` _(${parts.join(', ')})_` : '';
  return item.from === 'inferred' ? `${suffix} ※` : suffix;
}

function renderItem(item: Obj, indent: string): string[] {
  // Q&A shape (interview) — both fields carry meaning.
  if (typeof item.question === 'string' && typeof item.answer === 'string') {
    return [
      `${indent}- **Q:** ${item.question}`,
      `${indent}  **A:** ${item.answer}${annotations(item)}`,
    ];
  }
  const label = firstString(item, LABEL_KEYS);
  const primary = firstString(item, PRIMARY_KEYS);
  let lead: string;
  if (label && primary) lead = `**${label}** — ${primary}`;
  else if (label) lead = `**${label}**`;
  else if (primary) lead = primary;
  else {
    // Fallback: join whatever scalar strings exist so we never emit [object Object].
    lead = Object.entries(item)
      .filter(([, v]) => typeof v === 'string' && v)
      .map(([, v]) => v as string)
      .join(' — ') || '(empty)';
  }
  const lines = [`${indent}- ${lead}${annotations(item)}`];
  for (const sk of SECONDARY_KEYS) {
    if (typeof item[sk] === 'string' && item[sk] && item[sk] !== primary) {
      lines.push(`${indent}  - ${item[sk] as string}`);
    }
  }
  for (const nk of NESTED_ARRAY_KEYS) {
    const arr = item[nk];
    if (!Array.isArray(arr)) continue;
    for (const sub of arr) {
      if (typeof sub === 'string') lines.push(`${indent}  - ${sub}`);
      else if (sub && typeof sub === 'object') lines.push(...renderItem(sub as Obj, `${indent}  `));
    }
  }
  return lines;
}

function renderSection(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) {
    if (value.length === 0) return ['_(なし)_'];
    return value.flatMap((v) => (typeof v === 'string' ? [`- ${v}`] : renderItem(v as Obj, '')));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Obj)
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
      .map(([k, v]) => `- **${humanize(k)}**: ${v}`);
  }
  return [];
}

/**
 * Structured note → Markdown. Legacy notes (with `.markdown`) pass through
 * unchanged. Walks the note's content fields in declaration order, emitting a
 * `## Section` per field. System/header fields are skipped.
 */
export function noteToMarkdown(note: object): string {
  const n = note as Record<string, unknown>;
  if (typeof n.markdown === 'string') return n.markdown;

  const title = typeof n.title === 'string' && n.title ? n.title : 'Note';
  const out: string[] = [`# ${title}`];

  const metaBits: string[] = [];
  if (typeof n.family === 'string') metaBits.push(n.family);
  if (typeof n.language === 'string') metaBits.push(n.language);
  if (typeof n.durationSec === 'number') metaBits.push(fmtTs(n.durationSec));
  if (typeof n.generatedAt === 'string' && n.generatedAt) {
    const d = new Date(n.generatedAt);
    if (!Number.isNaN(d.getTime())) metaBits.push(d.toLocaleString());
  }
  if (metaBits.length) out.push(`*${metaBits.join(' · ')}*`);

  for (const [key, value] of Object.entries(n)) {
    if (HEADER_KEYS.has(key)) continue;
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    out.push('', `## ${humanize(key)}`, ...renderSection(value));
  }
  return out.join('\n');
}

/** Transcript segments → plain text, one `[m:ss] text` line per segment. */
export function transcriptToText(
  segments: ReadonlyArray<{ startSec: number; text: string }>,
  opts: { withTimestamps?: boolean } = {},
): string {
  const withTs = opts.withTimestamps !== false;
  return segments.map((s) => (withTs ? `[${fmtTs(s.startSec)}] ${s.text}` : s.text)).join('\n');
}

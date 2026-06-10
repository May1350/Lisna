import type { FamilyCoreDefinition } from '../families';
import type { NoteBase } from '../note-schema/base';
import type { SessionTranscript } from '../note-schema/transcript';
import { computeProvenance } from '../note-schema/provenance';
import { CURRENT_SCHEMA_VERSION } from '../note-schema/forward-incompat';

/**
 * Run the 5-stage post-decode pipeline per spec §5.2.
 *
 * Stage 1 — JSON.parse (throws SyntaxError on malformed input — no wrap)
 * Stage 2 — Fill ids (Brainstorm only; all other families are a no-op here)
 * Stage 2.5 — Drop empty user-visible items (founder P1, 2026-06-10): array
 *            items whose primary text slot is blank are removed instead of
 *            failing the chunk — fewer items is graceful degradation, an
 *            empty item is a visible defect
 * Stage 3 — Fill provenance (walk recursively, fill `from` on every
 *            provenance-bearing leaf missing `from` — resolved via `ts`
 *            when present, else `'inferred'`)
 * Stage 4 — Zod parse with referential closure (delegates to family.schema.parse)
 * Stage 5 — Deterministic dedup (Lecture is a no-op; dedup is field-level
 *            inside MergeStrategy at the merge stage, not per-chunk)
 *
 * @param rawJson  Raw JSON string emitted by the LLM grammar-constrained decode.
 * @param family   The family's core definition (provides schema + id).
 * @param transcript  The session transcript used to infer provenance.
 * @returns The fully validated note (type matches family's schema output type).
 */
export function runPostDecodePipeline(
  rawJson: string,
  family: FamilyCoreDefinition<NoteBase>,
  transcript: SessionTranscript,
): unknown {
  // Stage 1 — JSON.parse (native SyntaxError on bad input, per spec)
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;

  // Normalize system-owned schemaVersion (still Stage 1). The grammar exposes
  // NoteBase.schemaVersion as a free positive int, so a real LLM may emit any
  // value (observed: 2 in founder smoke 2026-06). A freshly generated note is
  // by definition the current schema version, so we OVERWRITE whatever the LLM
  // produced rather than reject it — rejecting blocked all note generation.
  // Forward-incompat defense for *persisted* future-version notes lives in the
  // load path (load-note.ts), the only place a genuinely-newer note is read.
  parsed.schemaVersion = CURRENT_SCHEMA_VERSION;

  // Stage 2 — id fill (Brainstorm only; Lecture / Meeting / Interview no-op)
  if (family.id === 'brainstorm') {
    fillBrainstormIdeaIds(parsed);
  }

  // Stage 2.5 — drop empty user-visible items
  dropEmptyUserVisibleItems(parsed, family.id);

  // Stage 3 — provenance fill
  fillProvenanceRecursive(parsed, transcript);

  // Stage 4 — Zod parse with referential closure
  const validated = family.schema.parse(parsed);

  // Stage 5 — deterministic dedup
  // Lecture: dedup is field-level inside MergeStrategy at the merge stage —
  // not applied per-chunk here. Other families (Plans 4-6) may add logic here.
  // Current implementation is a no-op for all families at the per-chunk stage.

  return validated;
}

/**
 * Primary user-visible text keys. An array item (object) whose value at one
 * of these keys is an empty/whitespace-only string is dropped; bare string
 * array elements that are blank are dropped too. `heading` is deliberately
 * NOT here — a lecture section without a heading is a structural failure
 * (Zod min(1) → chunk retry), not a droppable list item.
 *
 * Grammar-side .min(1) (json-string-nonempty) blocks the literal "" at decode
 * time; this stage catches what the grammar can't — whitespace-only strings
 * and sanitizeEscapeLiteralsInStrings residue.
 */
const PRIMARY_TEXT_KEYS = ['text', 'term', 'expression', 'question', 'answer', 'name', 'theme', 'topic'];

function isBlankString(v: unknown): boolean {
  return typeof v === 'string' && v.trim() === '';
}

function shouldDropItem(item: unknown): boolean {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
  const o = item as Record<string, unknown>;
  return PRIMARY_TEXT_KEYS.some((k) => k in o && isBlankString(o[k]));
}

/**
 * Stage 2.5 — drop array items whose primary text slot is blank (founder P1,
 * 2026-06-10: a mode-collapsed 3B filled "" into qa_pairs[].question,
 * themes[].name, quotable_lines[].text in production and every validation
 * layer accepted it). Also exported for the orchestrator's merged-note path:
 * interview/brainstorm merge-LLM output re-enters the note after the
 * per-chunk pipeline ran, so the merged tree needs the same sweep before the
 * final schema.parse.
 *
 * Mutates in place (same convention as fillProvenanceRecursive).
 */
export function dropEmptyUserVisibleItems(
  parsed: Record<string, unknown>,
  familyId?: string,
): void {
  dropEmptyTextItems(parsed);
  // A brainstorm cluster whose ideas were all dropped violates ideas.min(1)
  // at Stage 4 — the cluster itself is now meaningless, so drop it as well.
  if (familyId === 'brainstorm') {
    const clusters = parsed['idea_clusters'];
    if (Array.isArray(clusters)) {
      parsed['idea_clusters'] = clusters.filter((c) => {
        const ideas = (c as Record<string, unknown> | null)?.['ideas'];
        return Array.isArray(ideas) && ideas.length > 0;
      });
    }
  }
}

function dropEmptyTextItems(node: unknown): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) dropEmptyTextItems(child);
    return;
  }
  const o = node as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    const v = o[key];
    if (Array.isArray(v)) {
      const kept = v.filter((item) => !isBlankString(item) && !shouldDropItem(item));
      o[key] = kept;
      for (const item of kept) dropEmptyTextItems(item);
    } else {
      dropEmptyTextItems(v);
    }
  }
}

/**
 * Fill missing `id` fields on Brainstorm idea objects.
 * Brainstorm-only (Plan 4). For Plans 3/5/6 (Lecture/Meeting/Interview) this
 * function is never called — Stage 2 is a no-op.
 */
function fillBrainstormIdeaIds(parsed: Record<string, unknown>): void {
  const clusters = parsed['idea_clusters'];
  if (!Array.isArray(clusters)) return;
  for (const cluster of clusters) {
    const ideas = (cluster as Record<string, unknown>)['ideas'];
    if (!Array.isArray(ideas)) continue;
    for (const idea of ideas) {
      const obj = idea as Record<string, unknown>;
      if (typeof obj['id'] !== 'string' || obj['id'] === '') {
        obj['id'] = crypto.randomUUID();
      }
    }
  }
}

/**
 * Walk the parsed note tree recursively and fill `from` on every leaf
 * that:
 *   1. Is a plain object (not an array)
 *   2. Has `from === undefined` (not yet set)
 *   3. Has at least one discriminator field indicating it's a
 *      provenance-bearing leaf: `text`, `term`, `expression`, or both
 *      `question` + `answer` (Interview qa_pairs — they carry no `text`)
 *
 * `ts` is NO LONGER required for Stage 3 to act. When `ts` is absent
 * (e.g. MeetingNoteSchema.conclusions[] where ts is optional),
 * `computeProvenance` returns `'inferred'`. When `ts` is present it
 * resolves against the transcript as before.
 *
 * Discriminator rationale (verified against Lecture + Meeting schemas
 * and all slot schemas — every object carrying text/term/expression
 * also declares a `from` field, so this fill never injects `from` into
 * a schema that doesn't expect it):
 *   - LectureSectionSchema.key_terms[]:    has `term`   + ts (required)
 *   - LectureSectionSchema.examples[]:     has `text`   + ts (required)
 *   - LectureSectionSchema.points[]:       has `text`   + ts (required)
 *   - FormulaSchema:                       has `expression` + ts (required)
 *   - ProcedureStepsSchema.steps[]:        has `text`   + ts (required)
 *   - ArgumentChainSchema.claims[]:        has `text`   + ts (required)
 *   - TimelineSchema.events[]:             has `text`   + ts (required)
 *   - MeetingNoteSchema.conclusions[]:     has `text`   + ts (OPTIONAL) — the gap this fix closes
 *   - MeetingNoteSchema.next_steps[]/decisions[]/proposals[]/
 *     open_questions[]/risks_or_concerns[]: has `text`  + ts (required)
 *   - InterviewNoteSchema.qa_pairs[]:       has `question` + `answer` + ts
 *     (required) — the only leaf discriminated by question+answer, not text
 *
 * Objects without any discriminator field (outer section, note root, etc.)
 * are skipped — we do not add `from` to objects that don't declare it.
 */
function fillProvenanceRecursive(
  obj: unknown,
  transcript: SessionTranscript,
): void {
  if (obj == null || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (const child of obj) fillProvenanceRecursive(child, transcript);
    return;
  }

  const o = obj as Record<string, unknown>;

  if (
    o['from'] === undefined &&
    (
      'text' in o ||
      'term' in o ||
      'expression' in o ||
      ('question' in o && 'answer' in o)
    )
  ) {
    // Pass o as { ts?: number } — computeProvenance returns 'inferred' when
    // ts is undefined, and resolves against transcript when ts is present.
    o['from'] = computeProvenance(o as { ts?: number }, transcript);
  }

  for (const key of Object.keys(o)) {
    fillProvenanceRecursive(o[key], transcript);
  }
}

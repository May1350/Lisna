/**
 * Lossless plain-text note generation for the live session/stop path.
 *
 * Replaces orchestrator.stop()'s single-pass generation, which silently
 * overflowed n_ctx on long transcripts (the C++ decode loop breaks silently —
 * llama_engine.cpp:201 — yielding an empty/truncated note). Strategy:
 *   - short transcript → ONE pass, raw output byte-identical to before;
 *   - long transcript  → silence-aware chunks → per-chunk plain-text note →
 *     deterministic header-grouped merge;
 *   - overflow safety is REACTIVE: a non-empty chunk that yields empty output
 *     is the silent-overflow signature → subsplit + retry. Correctness does
 *     NOT depend on the token estimate being accurate.
 *
 * Spec: docs/superpowers/specs/2026-05-28-live-note-overflow-chunking-design.md
 */
import type { Language, TranscriptSegment, ChatMessage } from '@shared/engine-interfaces';
import { estimateTokens } from '@shared/note-schema';

// Budget constants. MIRROR desktop/sidecar/src/llm/llama_engine.cpp:106
// (cp.n_ctx = 16384). If n_ctx changes there, revisit these.
const CONTEXT_WINDOW = 16384;
const GEN_RESERVE = 4096;     // matches the maxTokens stop() requests
const SAFETY_MARGIN = 1500;   // estimateTokens is a heuristic — leave headroom
export const SINGLE_PASS_MAX_EST = CONTEXT_WINDOW - GEN_RESERVE - SAFETY_MARGIN; // 10788
export const CHUNK_BUDGET_EST = Math.floor((CONTEXT_WINDOW - GEN_RESERVE) / 2);  // 6144

const HEADER_RE = /^【.+】$/;

/** Sum the estimated token count across all chat-message contents. */
export function estimatePromptTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

/**
 * Deterministic merge of per-chunk plain-text notes: group lines under each
 * 【...】 header (first-seen order). Pure string ops — length-independent,
 * cannot overflow. Lossless: preamble/header-less lines attach to the first
 * section; if NO header appears across all notes, raw-concatenate.
 */
export function mergeChunkNotes(chunkOutputs: string[]): string {
  const notes = chunkOutputs.map((s) => s.trim()).filter((s) => s.length > 0);
  if (notes.length === 0) return '';
  if (notes.length === 1) return notes[0]!;

  const order: string[] = [];
  const groups = new Map<string, string[]>();
  const preamble: string[] = [];

  for (const note of notes) {
    let current: string | null = null;
    for (const line of note.split('\n')) {
      if (HEADER_RE.test(line.trim())) {
        current = line.trim();
        if (!groups.has(current)) {
          groups.set(current, []);
          order.push(current);
        }
      } else if (line.trim().length > 0) {
        if (current === null) preamble.push(line);
        else groups.get(current)!.push(line);
      }
    }
  }

  if (order.length === 0) return notes.join('\n\n'); // no headers anywhere → lossless raw concat

  const out: string[] = [];
  order.forEach((header, idx) => {
    out.push(header);
    if (idx === 0 && preamble.length > 0) out.push(...preamble);
    out.push(...groups.get(header)!);
    out.push('');
  });
  return out.join('\n').trimEnd();
}

/** Split one segment's text near the middle — prefer a 。 sentence boundary. */
export function splitTextHalf(text: string): string[] {
  const t = text.trim();
  if (t.length < 2) return [t];
  const sentences = t.split(/(?<=。)/).filter((s) => s.length > 0);
  if (sentences.length >= 2) {
    const mid = Math.ceil(sentences.length / 2);
    return [sentences.slice(0, mid).join(''), sentences.slice(mid).join('')];
  }
  const mid = Math.floor(t.length / 2);
  return [t.slice(0, mid), t.slice(mid)];
}

export interface GenerateChunkedNoteArgs {
  segments: TranscriptSegment[];
  language: Language;
  buildPrompt: (language: Language, segments: TranscriptSegment[]) => ChatMessage[];
  /** Pre-bound generate (the caller binds maxTokens/temperature). */
  generate: (messages: ChatMessage[]) => AsyncIterable<string>;
}

async function drain(stream: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const tok of stream) out += tok;
  return out;
}

export async function generateChunkedNote(args: GenerateChunkedNoteArgs): Promise<string> {
  const { segments, language, buildPrompt, generate } = args;

  // 1) Single-pass fast path — byte-identical to the legacy behavior when it fits.
  const fullPrompt = buildPrompt(language, segments);
  if (estimatePromptTokens(fullPrompt) <= SINGLE_PASS_MAX_EST) {
    const single = await drain(generate(fullPrompt));
    if (single.trim().length > 0) return single; // RAW — MUST NOT route through mergeChunkNotes
    // else: overflow despite a low estimate → fall through (chunked branch, Task 4).
  }

  // Chunked branch added in Task 4.
  return '';
}

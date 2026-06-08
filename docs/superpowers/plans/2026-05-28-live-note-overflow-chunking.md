# Live Note Path Overflow — Lossless Plain-Text Chunking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the live `session/stop` note path from silently producing empty/truncated notes on long recordings, by generating plain-text notes in silence-aware chunks (lossless) with a reactive empty-output subsplit backstop.

**Architecture:** A new pure helper `generateChunkedNote` replaces `orchestrator.stop()`'s single-pass generation. Short transcripts take a single pass (byte-identical to today). Long transcripts are chunked (`chunkTranscript`), generated per-chunk with the existing plain-text prompt, and merged deterministically by `【...】` header. Overflow safety is REACTIVE — a non-empty chunk that returns empty output (the silent-overflow signature, `llama_engine.cpp:201`) is subsplit and retried — so correctness does not depend on token-estimate accuracy.

**Tech Stack:** TypeScript (Electron main), Vitest. No C++/grammar/renderer/preload changes. Reuses `chunkTranscript`, `estimateTokens`, `adaptToV2Transcript`, `buildJaNoteV1Prompt`.

**Spec:** `docs/superpowers/specs/2026-05-28-live-note-overflow-chunking-design.md` (two-round reviewed; "Approve with minor fixes" integrated).

**Lane:** ai-infra. Code under `desktop/src/main/sidecar/` + `desktop/src/shared/note-schema/`. Worktree `.claude/worktrees/fix+live-overflow-chunked-note`, branch `worktree-fix+live-overflow-chunked-note`, off `origin/main` `b8afbd2`.

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `desktop/src/shared/note-schema/adapt-legacy-transcript.ts` | Create | Lifted pure adapter: legacy `TranscriptSegment[]` → v2 `SessionTranscript` (single-speaker). |
| `desktop/src/shared/note-schema/index.ts` | Modify | Re-export `adaptToV2Transcript`. |
| `desktop/src/main/sidecar/ipc/session-finalize.ts` | Modify | Drop the file-local `adaptToV2Transcript`; import the lifted one. |
| `desktop/src/main/sidecar/chunked-note.ts` | Create | `generateChunkedNote` + `generateChunkWithSubsplit` + `mergeChunkNotes` + `splitTextHalf` + `estimatePromptTokens` + budget constants. |
| `desktop/src/main/sidecar/__tests__/chunked-note.test.ts` | Create | Unit tests for all of the above + the fail-first overflow regression. |
| `desktop/src/main/sidecar/orchestrator.ts` | Modify | `stop()` calls `generateChunkedNote` instead of the inline single-pass loop. |

**Note on adapter location:** the spec (section 3.3) says "lift to `shared/note-schema/`." This plan keeps that location. The adapter imports the legacy type from `@shared/types` (type-only) — a transitional dependency that disappears when the legacy live path is retired.

**Verification commands (run from the worktree root):**
- Typecheck: `pnpm --filter @lisna/desktop exec tsc --noEmit`
- A single test file: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/__tests__/chunked-note.test.ts`
- Lint (REQUIRED before push — `desktop-ci` gates on it): `pnpm --filter @lisna/desktop lint`

> If `pnpm --filter @lisna/desktop ...` is not the right invocation, check `desktop/package.json` `scripts` + the workspace name in `desktop/package.json` `name`, and use the matching filter. Do NOT pass a bare directory to `vitest run` (it picks up hardware-gated spike tests — pitfalls.md `vitest-scope`); always pass the explicit file path.

---

## Task 1: Lift `adaptToV2Transcript` to shared note-schema

**Files:**
- Create: `desktop/src/shared/note-schema/adapt-legacy-transcript.ts`
- Modify: `desktop/src/shared/note-schema/index.ts`
- Modify: `desktop/src/main/sidecar/ipc/session-finalize.ts:16,160-184`
- Test: existing `desktop/src/main/sidecar/ipc/__tests__/session-finalize.test.ts` (must stay green — this is a pure refactor)

- [ ] **Step 1: Create the lifted adapter** (identical logic to the current file-local copy)

```typescript
// desktop/src/shared/note-schema/adapt-legacy-transcript.ts
import type { TranscriptSegment as LegacySegment } from '@shared/types';
import type { SessionTranscript, TranscriptSegment as V2Segment } from './transcript';

/**
 * Adapt legacy STT segments (startSec/endSec/text/noSpeechProb?) to a v2
 * SessionTranscript. The live alpha path is pre-diarization → single speaker
 * (speakerId = 0).
 *
 * Lifted from session-finalize.ts. 3rd call site (routeLecture, routeMeeting,
 * chunked-note.ts) → architecture.md DRY extraction threshold met.
 */
export function adaptToV2Transcript(
  legacySegs: readonly LegacySegment[],
  sessionId: string,
): SessionTranscript {
  const v2Segs: V2Segment[] = legacySegs.map((s) => ({
    ts: s.startSec,
    endTs: s.endSec,
    text: s.text,
    speakerId: 0,
    meta: typeof s.noSpeechProb === 'number' ? { noSpeechProb: s.noSpeechProb } : undefined,
  }));
  return {
    sessionId,
    speakers: [{ id: 0 }],
    transcriptSegments: v2Segs,
  };
}
```

- [ ] **Step 2: Re-export from the barrel.** In `desktop/src/shared/note-schema/index.ts`, after the `export { chunkTranscript } from './chunking';` line (currently line 31), add:

```typescript
export { adaptToV2Transcript } from './adapt-legacy-transcript';
```

- [ ] **Step 3: Update `session-finalize.ts` to import the lifted adapter.**

Replace the import on line 16:
```typescript
import type { SessionTranscript, TranscriptSegment as V2Segment } from '@shared/note-schema/transcript';
```
with (drop `SessionTranscript` + `V2Segment` — both were used ONLY by the now-removed local adapter):
```typescript
import { adaptToV2Transcript } from '@shared/note-schema';
```

Then delete the file-local adapter block (the `// ─── adapter ───` comment through the end of the `adaptToV2Transcript` function — currently lines ~160-184):

```typescript
// ─── adapter ──────────────────────────────────────────────────────────────────

/**
 * Convert legacy TranscriptSegment[] ...
 */
function adaptToV2Transcript(
  legacySegs: readonly LegacySegment[],
  sessionId: string,
): SessionTranscript {
  ...
}
```

- [ ] **Step 4: Typecheck — expect any unused-import errors surfaced here.**

Run: `pnpm --filter @lisna/desktop exec tsc --noEmit`
Expected: exit 0. If it reports `SessionTranscript`/`V2Segment` still referenced, that reference is real — keep that one type import; otherwise leave them removed.

- [ ] **Step 5: Run session-finalize tests — pure refactor, must stay green.**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/ipc/__tests__/session-finalize.test.ts`
Expected: PASS (same count as before).

- [ ] **Step 6: Commit**

```bash
git add desktop/src/shared/note-schema/adapt-legacy-transcript.ts \
        desktop/src/shared/note-schema/index.ts \
        desktop/src/main/sidecar/ipc/session-finalize.ts
git commit -m "refactor(v2): lift adaptToV2Transcript to shared note-schema"
```

---

## Task 2: Pure merge + split helpers (`mergeChunkNotes`, `splitTextHalf`)

**Files:**
- Create: `desktop/src/main/sidecar/chunked-note.ts` (partial — pure helpers + constants only)
- Test: `desktop/src/main/sidecar/__tests__/chunked-note.test.ts` (new)

- [ ] **Step 1: Write failing tests for the pure helpers**

```typescript
// desktop/src/main/sidecar/__tests__/chunked-note.test.ts
import { describe, it, expect } from 'vitest';
import { mergeChunkNotes, splitTextHalf } from '../chunked-note';

describe('mergeChunkNotes', () => {
  it('returns the single note unchanged when given one chunk', () => {
    expect(mergeChunkNotes(['【要点】\n・あ'])).toBe('【要点】\n・あ');
  });

  it('groups bullets under one header across chunks (first-seen order)', () => {
    const merged = mergeChunkNotes([
      '【要点】\n・point1\n【決定事項】\n・dec1',
      '【要点】\n・point2',
    ]);
    // single 【要点】 header, both bullets present, 【決定事項】 preserved
    expect(merged.match(/【要点】/g)).toHaveLength(1);
    expect(merged).toContain('・point1');
    expect(merged).toContain('・point2');
    expect(merged).toContain('【決定事項】');
    expect(merged).toContain('・dec1');
    // 【要点】 appears before 【決定事項】 (first-seen order)
    expect(merged.indexOf('【要点】')).toBeLessThan(merged.indexOf('【決定事項】'));
  });

  it('raw-concatenates losslessly when NO chunk has a recognizable header', () => {
    const merged = mergeChunkNotes(['just prose A', 'just prose B']);
    expect(merged).toContain('just prose A');
    expect(merged).toContain('just prose B');
  });

  it('attaches preamble (lines before first header) to the first section', () => {
    const merged = mergeChunkNotes([
      'intro line\n【要点】\n・p1',
      '【要点】\n・p2',
    ]);
    expect(merged).toContain('intro line');
    expect(merged).toContain('・p1');
    expect(merged).toContain('・p2');
    expect(merged.match(/【要点】/g)).toHaveLength(1);
  });

  it('drops empty/whitespace chunk outputs', () => {
    expect(mergeChunkNotes(['', '   ', '【要点】\n・only'])).toBe('【要点】\n・only');
    expect(mergeChunkNotes(['', '  '])).toBe('');
  });
});

describe('splitTextHalf', () => {
  it('splits on sentence boundary near the middle', () => {
    expect(splitTextHalf('一文目。二文目。三文目。四文目。')).toEqual([
      '一文目。二文目。',
      '三文目。四文目。',
    ]);
  });

  it('falls back to char midpoint when there is no sentence boundary', () => {
    expect(splitTextHalf('abcdef')).toEqual(['abc', 'def']);
  });

  it('returns a single element for trivially short text', () => {
    expect(splitTextHalf('あ')).toEqual(['あ']);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module '../chunked-note'`)

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/__tests__/chunked-note.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `chunked-note.ts` with constants + the pure helpers**

```typescript
// desktop/src/main/sidecar/chunked-note.ts
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
import { estimateTokens, chunkTranscript, adaptToV2Transcript } from '@shared/note-schema';

// Budget constants. MIRROR desktop/sidecar/src/llm/llama_engine.cpp:106
// (cp.n_ctx = 16384). If n_ctx changes there, revisit these.
const CONTEXT_WINDOW = 16384;
const GEN_RESERVE = 4096;     // matches the maxTokens stop() requests
const SAFETY_MARGIN = 1500;   // estimateTokens is a heuristic — leave headroom
export const SINGLE_PASS_MAX_EST = CONTEXT_WINDOW - GEN_RESERVE - SAFETY_MARGIN; // 10788
export const CHUNK_BUDGET_EST = Math.floor((CONTEXT_WINDOW - GEN_RESERVE) / 2);  // 6144
const SUBSPLIT_MAX_DEPTH = 6;

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
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/__tests__/chunked-note.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/sidecar/chunked-note.ts \
        desktop/src/main/sidecar/__tests__/chunked-note.test.ts
git commit -m "feat(v2): plain-text note merge + split helpers (chunked-note)"
```

---

## Task 3: `generateChunkedNote` — single-pass fast path

**Files:**
- Modify: `desktop/src/main/sidecar/chunked-note.ts`
- Test: `desktop/src/main/sidecar/__tests__/chunked-note.test.ts`

- [ ] **Step 1: Add failing tests** (append to the test file)

```typescript
import { generateChunkedNote, SINGLE_PASS_MAX_EST } from '../chunked-note';
import type { Language, TranscriptSegment, ChatMessage } from '@shared/engine-interfaces';

// A buildPrompt whose content length tracks the transcript (so estimateTokens
// reflects size). One system line + the joined transcript text.
const testBuildPrompt = (_lang: Language, segs: TranscriptSegment[]): ChatMessage[] => [
  { role: 'system', content: 'sys' },
  { role: 'user', content: segs.map((s) => s.text).join('\n') },
];

// A fake streaming generate that records calls and returns a canned note.
function fakeGenerate(reply: (m: ChatMessage[]) => string) {
  const calls: ChatMessage[][] = [];
  const gen = async function* (m: ChatMessage[]): AsyncIterable<string> {
    calls.push(m);
    yield reply(m);
  };
  return { gen, calls };
}

const seg = (i: number, text: string): TranscriptSegment => ({
  startSec: i * 10,
  endSec: i * 10 + 10,
  text,
});

describe('generateChunkedNote — single pass', () => {
  it('does exactly ONE pass and returns raw output when under the threshold', async () => {
    const { gen, calls } = fakeGenerate(() => '【要点】\n・x');
    const out = await generateChunkedNote({
      segments: [seg(0, 'みじかい')],
      language: 'ja',
      buildPrompt: testBuildPrompt,
      generate: gen,
    });
    expect(calls).toHaveLength(1);
    expect(out).toBe('【要点】\n・x'); // RAW, not merge-reformatted
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`generateChunkedNote` not exported)

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/__tests__/chunked-note.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the single-pass path** (append to `chunked-note.ts`)

```typescript
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
    // else: overflow despite a low estimate → fall through (added in Task 4).
  }

  // Chunked branch added in Task 4.
  return '';
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/__tests__/chunked-note.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/sidecar/chunked-note.ts desktop/src/main/sidecar/__tests__/chunked-note.test.ts
git commit -m "feat(v2): generateChunkedNote single-pass fast path"
```

---

## Task 4: `generateChunkedNote` — chunked branch (chunks assumed to fit)

**Files:**
- Modify: `desktop/src/main/sidecar/chunked-note.ts`
- Test: `desktop/src/main/sidecar/__tests__/chunked-note.test.ts`

- [ ] **Step 1: Add a failing test** (append). Builds a transcript large enough (estimate > `SINGLE_PASS_MAX_EST`) to force chunking, using the real `chunkTranscript`.

```typescript
describe('generateChunkedNote — chunked branch', () => {
  it('chunks an over-threshold transcript, generates per chunk, and merges', async () => {
    // ~60 segments × ~400 JA chars × 0.6 t/char ≈ 14400 est tokens > 10788 → chunked.
    const big = Array.from({ length: 60 }, (_, i) => seg(i, 'あ'.repeat(400)));
    let n = 0;
    const { gen, calls } = fakeGenerate(() => {
      n += 1;
      return `【要点】\n・point${n}`;
    });
    const out = await generateChunkedNote({
      segments: big,
      language: 'ja',
      buildPrompt: testBuildPrompt,
      generate: gen,
    });
    expect(calls.length).toBeGreaterThanOrEqual(2);        // multiple chunks
    expect(out.match(/【要点】/g)).toHaveLength(1);          // merged to one header
    expect(out).toContain('・point1');
    expect(out).toContain(`・point${calls.length}`);        // every chunk's bullet survived
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (chunked branch returns `''`)

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/__tests__/chunked-note.test.ts`
Expected: FAIL on the chunked-branch test.

- [ ] **Step 3: Implement the chunked branch.** Replace the `// Chunked branch added in Task 4.` + `return '';` lines in `generateChunkedNote` with:

```typescript
  // 2) Chunked branch: silence-aware chunks → per-chunk note → merge.
  const v2 = adaptToV2Transcript(segments, 'live');
  const chunks = chunkTranscript(v2, CHUNK_BUDGET_EST);
  const chunkOutputs: string[] = [];
  for (const chunk of chunks) {
    const legacySegs: TranscriptSegment[] = chunk.transcriptSegments.map((s) => ({
      startSec: s.ts,
      endSec: s.endTs,
      text: s.text,
    }));
    chunkOutputs.push(await drain(generate(buildPrompt(language, legacySegs))));
  }
  return mergeChunkNotes(chunkOutputs);
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/__tests__/chunked-note.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/sidecar/chunked-note.ts desktop/src/main/sidecar/__tests__/chunked-note.test.ts
git commit -m "feat(v2): generateChunkedNote chunked branch + merge"
```

---

## Task 5: Reactive overflow backstop (`generateChunkWithSubsplit`)

**Files:**
- Modify: `desktop/src/main/sidecar/chunked-note.ts`
- Test: `desktop/src/main/sidecar/__tests__/chunked-note.test.ts`

- [ ] **Step 1: Add failing tests for the subsplit backstop** (append). Tests the exported `generateChunkWithSubsplit` directly with a fake `runPass` that simulates overflow by segment count / text length.

```typescript
import { generateChunkWithSubsplit } from '../chunked-note';

describe('generateChunkWithSubsplit — reactive overflow backstop', () => {
  it('subsplits when a chunk returns empty, until halves fit', async () => {
    const seen: number[] = [];
    const runPass = async (segs: TranscriptSegment[]): Promise<string> => {
      seen.push(segs.length);
      return segs.length > 4 ? '' : `【要点】\n・${segs.length}seg`; // "overflow" if >4 segs
    };
    const eight = Array.from({ length: 8 }, (_, i) => seg(i, 'x'));
    const out = await generateChunkWithSubsplit(eight, runPass, 0);
    expect(seen).toEqual([8, 4, 4]); // 8 overflowed → split into 4 + 4, both fit
    expect(out).toContain('・4seg');
  });

  it('splits a single oversized segment by its text', async () => {
    const runPass = async (segs: TranscriptSegment[]): Promise<string> =>
      segs[0]!.text.length > 10 ? '' : `【要点】\n・${segs[0]!.text}`;
    const out = await generateChunkWithSubsplit(
      [seg(0, '一文目。二文目。三文目。四文目。')], // 16 chars > 10 → overflow
      runPass,
      0,
    );
    expect(out).toContain('一文目。二文目。');
    expect(out).toContain('三文目。四文目。');
  });

  it('falls back to raw transcript text at the depth cap (lossless, never empty)', async () => {
    const runPass = async (): Promise<string> => ''; // always "overflow"
    const out = await generateChunkWithSubsplit(
      [seg(0, 'これは消えてはいけない本文')],
      runPass,
      0,
    );
    expect(out).toContain('これは消えてはいけない本文'); // verbatim, not dropped
    expect(out).toContain('[0.0s]');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`generateChunkWithSubsplit` not exported)

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/__tests__/chunked-note.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `generateChunkWithSubsplit` + `renderRaw`, and route the chunk loop through it.** Add to `chunked-note.ts`:

```typescript
function renderRaw(segs: TranscriptSegment[]): string {
  return segs.map((s) => `[${s.startSec.toFixed(1)}s] ${s.text}`).join('\n');
}

/**
 * Generate a note for one chunk with the reactive overflow backstop: a
 * non-empty input that yields empty output is the silent-overflow signature
 * (llama_engine.cpp:201) → subsplit + retry. Terminates at SUBSPLIT_MAX_DEPTH
 * by emitting the raw transcript text (lossless; pure string op, no LLM call).
 */
export async function generateChunkWithSubsplit(
  segs: TranscriptSegment[],
  runPass: (s: TranscriptSegment[]) => Promise<string>,
  depth: number,
): Promise<string> {
  if (segs.length === 0) return '';
  const out = (await runPass(segs)).trim();
  if (out.length > 0) return out;

  if (depth >= SUBSPLIT_MAX_DEPTH) return renderRaw(segs);

  if (segs.length >= 2) {
    const mid = Math.floor(segs.length / 2);
    const left = await generateChunkWithSubsplit(segs.slice(0, mid), runPass, depth + 1);
    const right = await generateChunkWithSubsplit(segs.slice(mid), runPass, depth + 1);
    return [left, right].filter((s) => s.trim().length > 0).join('\n\n');
  }

  // Single oversized segment → split its text.
  const s0 = segs[0]!;
  const halves = splitTextHalf(s0.text);
  if (halves.length < 2) return renderRaw(segs);
  const left = await generateChunkWithSubsplit([{ ...s0, text: halves[0]! }], runPass, depth + 1);
  const right = await generateChunkWithSubsplit([{ ...s0, text: halves[1]! }], runPass, depth + 1);
  return [left, right].filter((s) => s.trim().length > 0).join('\n\n');
}
```

Then, in `generateChunkedNote`, replace the per-chunk line:
```typescript
    chunkOutputs.push(await drain(generate(buildPrompt(language, legacySegs))));
```
with a `runPass` closure routed through the backstop:
```typescript
    const runPass = (s: TranscriptSegment[]): Promise<string> =>
      drain(generate(buildPrompt(language, s)));
    chunkOutputs.push(await generateChunkWithSubsplit(legacySegs, runPass, 0));
```

(Define `runPass` once before the loop, not inside it — hoist the `const runPass = ...` above `for (const chunk of chunks)`.)

- [ ] **Step 4: Run, expect PASS** (all chunked-note tests)

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/__tests__/chunked-note.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/sidecar/chunked-note.ts desktop/src/main/sidecar/__tests__/chunked-note.test.ts
git commit -m "feat(v2): reactive empty-output subsplit backstop"
```

---

## Task 6: Fail-first overflow regression test

**Files:**
- Test: `desktop/src/main/sidecar/__tests__/chunked-note.test.ts`

This uses the REAL `buildJaNoteV1Prompt` + real `chunkTranscript` + real `estimateTokens`, and a fake `generate` that simulates the sidecar's silent overflow (empty output when the prompt exceeds a simulated context). It demonstrates: OLD single-pass strategy → empty (the bug); NEW `generateChunkedNote` → complete.

- [ ] **Step 1: Add the regression test** (append)

```typescript
import { buildJaNoteV1Prompt } from '../prompts/ja-note-v1';

describe('overflow regression — fail-first demonstration', () => {
  // Simulate the sidecar: empty output once the prompt exceeds the context.
  const SIM_CTX_EST = 12000;
  const simGenerate = async function* (m: ChatMessage[]): AsyncIterable<string> {
    if (estimatePromptTokens(m) > SIM_CTX_EST) {
      yield ''; // silent overflow — matches llama_engine.cpp:201 (break, emits nothing)
      return;
    }
    yield '【要点】\n・ok';
  };

  // ~80 segments × 400 JA chars → est ≈ 19200 tokens in a single pass (> SIM_CTX_EST).
  const big = Array.from({ length: 80 }, (_, i) => seg(i, 'あ'.repeat(400)));

  it('OLD single-pass strategy produces an EMPTY note (the bug)', async () => {
    let oldOut = '';
    for await (const tok of simGenerate(buildJaNoteV1Prompt('ja', big))) oldOut += tok;
    expect(oldOut.trim()).toBe(''); // empirical fail-first: today's path loses everything
  });

  it('NEW generateChunkedNote produces a COMPLETE note', async () => {
    const out = await generateChunkedNote({
      segments: big,
      language: 'ja',
      buildPrompt: buildJaNoteV1Prompt,
      generate: simGenerate,
    });
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).toContain('・ok');
  });
});
```

- [ ] **Step 2: Run — confirm the OLD-path test PASSES (proving the bug) and the NEW-path test PASSES (proving the fix)**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/__tests__/chunked-note.test.ts`
Expected: PASS. The "OLD single-pass produces EMPTY" assertion passing IS the fail-first evidence (the legacy strategy yields empty on this input); the "NEW produces COMPLETE" assertion confirms the fix. If the OLD-path test does NOT see empty, the fixture is too small — raise segment count/length until a single-pass prompt exceeds `SIM_CTX_EST`.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/main/sidecar/__tests__/chunked-note.test.ts
git commit -m "test(v2): fail-first overflow regression for chunked-note"
```

---

## Task 7: Wire `generateChunkedNote` into `orchestrator.stop()`

**Files:**
- Modify: `desktop/src/main/sidecar/orchestrator.ts:1` (import) + `:146-152` (stop body)
- Test: existing `desktop/src/main/sidecar/__tests__/*orchestrator*.test.ts` + `orchestrator.test.ts` must stay green

- [ ] **Step 1: Add the import** near the other sidecar-local imports (after line 6, `import { TIMEOUTS, ... } from './timeouts';`):

```typescript
import { generateChunkedNote } from './chunked-note';
```

- [ ] **Step 2: Replace the single-pass generation in `stop()`.** Current (lines ~146-152):

```typescript
      onPhase?.('generating');
      const messages = (this.opts.buildPrompt ?? defaultPrompt)(this.opts.language, this.segments);
      // generate() is per-token streaming; the GENERATE_TIMEOUT (no-progress
      // 60s) is enforced inside LlamaCppLLM → SidecarClient.sendStream, so
      // no extra wrapping here.
      let md = '';
      for await (const tok of this.opts.llm.generate(messages, { maxTokens: 4096, temperature: 0.4 })) md += tok;
```

Replace with:

```typescript
      onPhase?.('generating');
      // generateChunkedNote chunks long transcripts to stay within n_ctx
      // (see chunked-note.ts) — short transcripts still take the single-pass
      // path (byte-identical output). GENERATE_TIMEOUT (no-progress 60s) is
      // enforced per generate() call inside LlamaCppLLM → SidecarClient.sendStream.
      const md = await generateChunkedNote({
        segments: this.segments,
        language: this.opts.language,
        buildPrompt: this.opts.buildPrompt ?? defaultPrompt,
        generate: (messages) =>
          this.opts.llm.generate(messages, { maxTokens: 4096, temperature: 0.4 }),
      });
```

(The `return { language, generatedAt, markdown: md, transcriptSegments: this.segments }` block below is unchanged.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @lisna/desktop exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Run the orchestrator tests — short-transcript single-pass path keeps them green**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/__tests__/orchestrator.test.ts src/main/sidecar/__tests__/lecture-orchestrator.test.ts src/main/sidecar/__tests__/meeting-orchestrator.test.ts`
Expected: PASS (same counts as before the change). The existing single-pass markdown assertions (`orchestrator.test.ts` ~lines 32/276) and the empty-transcript guard (~line 307) are preserved because small fixtures stay under `SINGLE_PASS_MAX_EST`.

- [ ] **Step 5: Lint (REQUIRED — `desktop-ci` gates on it; pitfalls.md `pre-push-lint`)**

Run: `pnpm --filter @lisna/desktop lint`
Expected: 0 errors. (Catches unused imports/vars that `tsc` ignores — e.g. a stray `defaultPrompt`/`messages` left behind.)

- [ ] **Step 6: Commit**

```bash
git add desktop/src/main/sidecar/orchestrator.ts
git commit -m "fix(v2): chunk long transcripts in stop() to prevent silent overflow"
```

---

## Task 8: Manual real-3B smoke (hardware-gated)

**Files:** none (verification only). 8 GB discipline (pitfalls.md `spike-llm`): foreground, single run, `pkill -9 -f llama-completion` after; never `run_in_background` for LLM inference.

- [ ] **Step 1: Build the desktop app** (sidecar already built; this is TS-only — no sidecar rebuild needed since no C++ changed).

Run: `pnpm --filter @lisna/desktop build` (or the app's dev launch — confirm the script in `desktop/package.json`).

- [ ] **Step 2: Record a long dense-JA session (~20 min+) and Stop.** Confirm the produced note covers content from BOTH the first and last few minutes (lossless), not just the opening.

- [ ] **Step 3: Confirm a SHORT recording (~2 min) still produces a note identical in shape to before** (single-pass path, no regression).

- [ ] **Step 4: Clean up any LLM processes**

Run: `ps -ef | grep -E "llama-completion" | grep -v grep` then `kill -9 <pids>` for survivors.

- [ ] **Step 5 (founder/owner judgment):** confirm note QUALITY on the long recording is acceptable for the alpha (chunk-boundary coherence, header grouping). This is product judgment — not a code gate.

---

## Self-Review (run by the plan author)

**Spec coverage:**
- Spec 3.1 (pure helper, single-pass fast path, returns raw) → Tasks 3, 7. ✓
- Spec 3.2 (reactive empty-output subsplit, within-segment split, depth-cap verbatim) → Task 5. ✓
- Spec 3.3 (reuse `chunkTranscript`, lift adapter) → Tasks 1, 4. ✓
- Spec 3.4 (M1 header-grouped merge + precise raw-concat fallback) → Task 2. ✓
- Spec 3.5 (budget constants, perf-not-correctness) → Task 2 (constants). ✓
- Spec 5.1 unit / 5.2 fail-first regression / 5.4 existing tests green → Tasks 2-6 / 6 / 7. ✓
- Spec 5.3 manual smoke → Task 8. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The only conditional ("if `pnpm --filter` is wrong, check package.json") is a real environment check, not a placeholder.

**Type consistency:** `generateChunkedNote` / `generateChunkWithSubsplit` / `mergeChunkNotes` / `splitTextHalf` / `estimatePromptTokens` / `SINGLE_PASS_MAX_EST` / `CHUNK_BUDGET_EST` names are consistent across Tasks 2-7. `TranscriptSegment` (legacy `{startSec,endSec,text}`) used consistently; v2 chunk segments mapped back via `{startSec: s.ts, endSec: s.endTs, text: s.text}`. `ChatMessage`/`Language` from `@shared/engine-interfaces`.

**Open risk flagged for execution:** the `pnpm --filter` workspace name is assumed `@lisna/desktop`; the implementer must confirm against `desktop/package.json` `name` and adjust all commands if different.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-live-note-overflow-chunking.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Each dispatch prompt MUST pin: stay inside the worktree path (run `pwd` before any git command); run `pnpm lint` + the explicit test FILE path (never a bare dir); completion contract (don't report DONE until the commit lands).
2. **Inline Execution** — execute tasks in this session via `superpowers:executing-plans`, batch with checkpoints.

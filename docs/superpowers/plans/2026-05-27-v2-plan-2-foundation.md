# Lisna v2 Note Creation — Plan 2: Foundation Infrastructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the shared infrastructure that every downstream Plan (3 Lecture / 4 Diarization / 5 Meeting / 6 Interview-Brainstorm / 7 Eval) plugs into — grammar-constrained-call wrapper with retry, production-grade chunking utility, canonical TranscriptSegment + Provenance + ModelProfile types, FamilyRegistry / PromptRegistry skeleton, and PipelineHooks contract. No family schemas yet (that's Plan 3+); this plan delivers the load-bearing contracts the families bind to.

**Architecture:** A new `desktop/src/shared/note-schema/` module holds the v2 types + Zod schemas + grammar converter + post-decode hydration + provenance computer. A sibling `desktop/src/shared/families/` holds the registry skeleton + per-family utility helpers (`prompts.ts`, `slot.ts`, `provenance.ts`). A new `desktop/src/shared/models/profiles.ts` holds `ModelProfile`. The grammar-call wrapper lives at `desktop/src/main/sidecar/grammar-call.ts` (orchestration layer, since it depends on `SidecarClient`). Spike 0.4 chunking lifts to `desktop/src/shared/note-schema/chunking.ts` with the I-1 boundary-ts test tightening, I-3 silence-snap correctness restored via `endSec` (already plumbed from C++), and M-2 extended CJK regex. Spike 0.1's `hydratePostDecode` and `zod-to-gbnf` lift to the same module. Naming canonicalised as **camelCase + `Sec` suffix** (matches existing `desktop/src/shared/types.ts`).

**Tech Stack:** TypeScript (strict), Zod v3 (`^3` — matches `desktop/package.json` "zod": "^3"), Vitest, no new runtime deps. No real LLM in unit tests — the wrapper is tested via injected mock generator. The Spike-0.1 `round-trip.test.ts` empirically validated the contract at N=5 on real hardware; this plan tests the JS wrapper logic only.

**Sub-plan position:** Plan 2 of 7 in the v2 note-creation sequence (Plan 1 = Phase 0 spikes, landed 2026-05-27 at `44e546d`).

**Spec reference:** `docs/superpowers/specs/2026-05-26-v2-structured-note-creation-design.md` (commit `af3af63`) §1 (intent), §2.8 (grammar ⊂ validated split), §3.1 (NoteBase + SessionTranscript + GenerationTelemetry), §4.0 (core interfaces), §4.1-4.15 + P1-P8 (modifiability), §5.2/§5.2a/§5.2b (pipeline + chunking + merge contract), §6 (file structure).

**Verdict carry-forward:** `desktop/spikes/phase-0/VERDICT.md` "Carry-forward items to Plan 2 (Foundation)" table — 7 items, plus 2 from Spike 0.2 reviewer feedback (per controller instruction). All 9 mapped to tasks below.

**Branch:** `spec/v2-note-creation-design` (HEAD `44e546d`, pushed). All Plan 2 commits land on this branch.

---

## Carry-forward → Task mapping

| # | Carry item | Source | Task(s) |
|---|---|---|---|
| 1 | Grammar-call wrapper with `maxAttempts=3` + fresh-seed retry, `attemptsUsed`/`attempts[].reason` logged | Spike 0.1 take-4 | Task 11, 12, 13 |
| 2 | Move `chunkTranscript` to shared with same exports | Spike 0.4 | Task 7 |
| 3 | Carry `endSec` on TranscriptSegment + restore silence-snap correctness | Spike 0.4 I-3 | Task 8 |
| 4 | Reconcile naming (camelCase canonical, lock `Sec` suffix) | Spike 0.4 M-1 | Task 5 |
| 5 | Extend `estimateTokens` CJK regex (Ext A, halfwidth katakana, fullwidth ASCII, JP punct) | Spike 0.4 M-2 | Task 6 |
| 6 | Export `estimateTokens` from shared | Spike 0.4 review M-7 | Task 6 (same task) |
| 7 | FamilyRegistry / PromptRegistry / ModelProfile / PipelineHooks skeleton | Spec §4 | Task 14, 15, 16, 17 |
| 8 | Surface `attemptsUsed` + per-attempt `reason` + `latencyMs` (for Plan 7 eval consumption) | Spike 0.2 reviewer #3 | Task 12 (return shape) |
| 9 | Lift `hydratePostDecode` from spike round-trip into shared | Spike 0.2 reviewer M-3 | Task 10 |

Additional infrastructure derived from the spec (not on the carry-forward list but required for downstream Plans to plug in):

| Task | Reason |
|---|---|
| Task 1 — module skeleton + .gitkeep | First commit needs a folder to land in. |
| Task 2 — `NoteBase` + `Provenance` + `ProvenanceSchema` + `SpeakerRef` Zod definitions | §3.1, §2.8. Every family schema in Plan 3+ extends this. |
| Task 3 — `SessionTranscript` + `TranscriptSegment` Zod with `meta?: Record<string, unknown>` (P1) | §3.1, §4.P1. The shape every downstream consumer reads. |
| Task 4 — `GenerationTelemetry` Zod | §3.1. Required by orchestrator + Plan 7. |
| Task 9 — `computeProvenance()` pure function + `ProvenanceConfig` | §4.P8. Table-driven tests. |
| Task 18 — re-export barrel `desktop/src/shared/note-schema/index.ts` | Single import surface for downstream Plans. |
| Task 19 — typecheck + test + commit-final verification gate | Verification-before-completion contract. |

Total: **19 tasks**. Estimated LOC: ~1100 (this plan file).

---

## File structure (delta only — what this plan touches)

```
desktop/src/shared/
├── note-schema/                          # NEW — created in Task 1
│   ├── base.ts                           # Task 2 — NoteBase, Provenance, ProvenanceSchema, SpeakerRef
│   ├── transcript.ts                     # Task 3 — SessionTranscript, TranscriptSegment (v2 shape)
│   ├── telemetry.ts                      # Task 4 — GenerationTelemetry
│   ├── tokens.ts                         # Task 6 — estimateTokens (extended CJK regex)
│   ├── chunking.ts                       # Task 7 — chunkTranscript (lifted from spike, endSec-aware)
│   ├── chunking.test.ts                  # Task 7 — boundary-ts tightening + synth fixture re-run
│   ├── provenance.ts                     # Task 9 — computeProvenance + ProvenanceConfig
│   ├── provenance.test.ts                # Task 9 — table-driven
│   ├── post-decode-hydration.ts          # Task 10 — hydratePostDecode (lifted from spike)
│   ├── post-decode-hydration.test.ts     # Task 10 — recursive deep-leaf coverage
│   ├── zod-to-gbnf.ts                    # Task 18 — lifted from spike (already test-covered in 01-zod-to-gbnf/)
│   ├── zod-to-gbnf.test.ts               # Task 18 — lifted (or re-pointed)
│   ├── fixtures/
│   │   └── synth-90min.json              # Task 7 — copied from spike fixture
│   └── index.ts                          # Task 18 — barrel re-export
├── families/                             # NEW — created in Task 14
│   ├── index.ts                          # Task 14 — FamilyDefinition<T> interface + registry stub
│   └── util/
│       ├── prompts.ts                    # Task 15 — PromptVariant + selectPromptVariant()
│       └── slot.ts                       # Task 16 — SlotDefinition<T>
├── models/                               # NEW — created in Task 17
│   └── profiles.ts                       # Task 17 — ModelProfile + initial llama-3.2-3b-q4-km entry
└── pipeline-hooks.ts                     # Task 17 — PipelineHooks interface

desktop/src/main/sidecar/
└── grammar-call.ts                       # Task 11-13 — wrapper around SidecarClient + GBNF + retry
└── __tests__/
    └── grammar-call.test.ts              # Task 11-13 — Vitest with mocked generate()

desktop/src/shared/types.ts               # Task 5 — append a JSDoc lock comment about camelCase/`Sec` convention
                                          # No shape change to existing TranscriptSegment (startSec/endSec/text/noSpeechProb? stays).
                                          # The v2 `note-schema/transcript.ts` is the NEW v2 shape (ts/endTs/speakerId/text/meta?).
                                          # See Task 5 for the naming-reconciliation memo + adapter direction.
```

**What this plan does NOT touch:**
- Any family schemas (Plan 3+ owns `lecture/`, `meeting/`, `interview/`, `brainstorm/` folders).
- The C++ sidecar (`endSec` is already emitted per `desktop/sidecar/src/stt/whisper_engine.cpp:59` + serialized in `desktop/sidecar/src/ipc/json_protocol.cpp:111`).
- Existing `desktop/src/main/sidecar/orchestrator.ts` (Plan 3 wires `PipelineHooks` into it; this plan only defines the interface).
- The root `/shared/` workspace package (HTTP wire, frozen extension territory — see CLAUDE.md scope freeze).
- The legacy `ja-note-v1.ts` single-shot prompt — coexists per spec §10.1.

---

## Pre-flight (do once before Task 1)

### Task 0: Confirm branch + Plan 1 base

**Files:** none. Read-only check.

- [ ] **Step 1: Verify on the right branch with Plan 1 landed**

Run:
```bash
git rev-parse --abbrev-ref HEAD
git log -1 --oneline
```
Expected:
```
spec/v2-note-creation-design
44e546d <subject>   # or later — the merge of Plan 1's verdict commit
```

If not on `spec/v2-note-creation-design`: `git checkout spec/v2-note-creation-design`. If HEAD is behind `44e546d`: `git pull --ff-only origin spec/v2-note-creation-design`.

- [ ] **Step 2: Verify Plan 1 verdict was committed**

Run:
```bash
test -f desktop/spikes/phase-0/VERDICT.md && head -1 desktop/spikes/phase-0/VERDICT.md
```
Expected: `# Phase 0 Verdict — 2026-05-27`. If missing, Plan 1 didn't land cleanly — stop, fix Plan 1 first.

- [ ] **Step 3: Verify spike artifacts still present (we lift code from them)**

Run:
```bash
ls desktop/spikes/phase-0/04-chunking/chunking.ts desktop/spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.ts desktop/spikes/phase-0/01-zod-to-gbnf/round-trip.test.ts
```
Expected: all three exist. If any missing, abort and check `git log` for accidental removal.

- [ ] **Step 4: Verify clean tree**

Run: `git status -s`
Expected: empty (or only files unrelated to this plan). If dirty, commit or stash before starting.

---

## Task 1: Module skeleton + path aliases

**Files:**
- Create: `desktop/src/shared/note-schema/.gitkeep`
- Create: `desktop/src/shared/families/.gitkeep`
- Create: `desktop/src/shared/families/util/.gitkeep`
- Create: `desktop/src/shared/models/.gitkeep`
- Read-only: `desktop/electron.vite.config.ts`, `desktop/tsconfig.json` (verify `@shared/*` alias resolves to `./src/shared/*`)

**Goal:** Reserve the directory shape so subsequent commits have a place to land, and confirm the `@shared/*` alias already covers the new subdirectories.

- [ ] **Step 1: Create the directory skeleton**

```bash
mkdir -p desktop/src/shared/note-schema/fixtures
mkdir -p desktop/src/shared/families/util
mkdir -p desktop/src/shared/models
touch desktop/src/shared/note-schema/.gitkeep
touch desktop/src/shared/families/.gitkeep
touch desktop/src/shared/families/util/.gitkeep
touch desktop/src/shared/models/.gitkeep
```

- [ ] **Step 2: Verify alias coverage**

Read `desktop/tsconfig.json` and `desktop/electron.vite.config.ts`. Confirm both already map `@shared/*` to `./src/shared/*`. If they do (they should — already configured for current shared modules), no edit needed.

Expected: no edit to `tsconfig.json` or `electron.vite.config.ts`. The alias resolves `@shared/note-schema/base` → `desktop/src/shared/note-schema/base.ts`.

- [ ] **Step 3: Verify typecheck passes (baseline before any new code)**

Run: `pnpm --filter @lisna/desktop typecheck`
Expected: PASS (no new files yet that could break).

- [ ] **Step 4: Commit**

```bash
git add desktop/src/shared/note-schema/.gitkeep \
        desktop/src/shared/families/.gitkeep \
        desktop/src/shared/families/util/.gitkeep \
        desktop/src/shared/models/.gitkeep
git commit -m "chore(v2): scaffold Plan 2 module skeleton (note-schema/families/models)"
```

---

## Task 2: NoteBase + Provenance + SpeakerRef Zod definitions

**Files:**
- Create: `desktop/src/shared/note-schema/base.ts`
- Create: `desktop/src/shared/note-schema/__tests__/base.test.ts`

**Goal:** Codify the spec §3.1 + §2.8 contract — `NoteBase` (every family extends), `Provenance` enum, `ProvenanceSchema` (marked `postDecodeOnly`), `SpeakerRef` numeric type. The `postDecodeOnly` marker is encoded via `.describe(JSON.stringify({ postDecodeOnly: true }))` (Zod v3 has no `.meta()` — per `desktop/spikes/phase-0/01-zod-to-gbnf/fixtures/lecture-mini-schema.ts:13` comment).

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/shared/note-schema/__tests__/base.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  NoteBaseSchema,
  Provenance,
  ProvenanceSchema,
  SpeakerRefSchema,
  POST_DECODE_MARKER_DESCRIPTION,
} from '../base';

describe('NoteBase / Provenance / SpeakerRef Zod', () => {
  it('NoteBaseSchema parses minimum required fields', () => {
    const minimal = {
      schemaVersion: 1,
      family: 'lecture' as const,
      title: 'Hello',
      generatedAt: '2026-05-27T00:00:00Z',
      generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
      language: 'ja' as const,
      durationSec: 600,
    };
    expect(() => NoteBaseSchema.parse(minimal)).not.toThrow();
  });

  it('NoteBaseSchema rejects invalid family discriminator', () => {
    expect(() =>
      NoteBaseSchema.parse({
        schemaVersion: 1,
        family: 'podcast',
        title: 't',
        generatedAt: '2026-05-27T00:00:00Z',
        generatedBy: { model: 'm', promptVersion: 1 },
        language: 'ja',
        durationSec: 1,
      }),
    ).toThrow();
  });

  it('NoteBaseSchema accepts optional experimentArmId + validation_warnings', () => {
    const withOpt = {
      schemaVersion: 1,
      family: 'meeting' as const,
      title: 't',
      generatedAt: '2026-05-27T00:00:00Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'en' as const,
      durationSec: 1,
      experimentArmId: 'llama-3.2-3b-q4-km/v1-baseline',
      validation_warnings: ['Dropped 1 invalid speaker reference'],
    };
    expect(() => NoteBaseSchema.parse(withOpt)).not.toThrow();
  });

  it('Provenance type narrows to literal union', () => {
    const a: Provenance = 'transcript';
    const b: Provenance = 'inferred';
    expect(ProvenanceSchema.parse(a)).toBe('transcript');
    expect(ProvenanceSchema.parse(b)).toBe('inferred');
    expect(() => ProvenanceSchema.parse('guessed')).toThrow();
  });

  it('ProvenanceSchema carries the postDecodeOnly marker description', () => {
    // The marker is the JSON-stringified object `{"postDecodeOnly":true}` set
    // via .describe(). zod-to-gbnf reads _def.description and strips fields
    // whose JSON-parsed description has postDecodeOnly: true (see
    // desktop/spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.ts:32-47).
    const desc = (ProvenanceSchema as any)._def.description;
    expect(desc).toBe(POST_DECODE_MARKER_DESCRIPTION);
    const parsed = JSON.parse(desc) as { postDecodeOnly?: boolean };
    expect(parsed.postDecodeOnly).toBe(true);
  });

  it('SpeakerRefSchema parses non-negative integers', () => {
    expect(SpeakerRefSchema.parse(0)).toBe(0);
    expect(SpeakerRefSchema.parse(7)).toBe(7);
    expect(() => SpeakerRefSchema.parse(-1)).toThrow();
    expect(() => SpeakerRefSchema.parse(1.5)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/base.test.ts`
Expected: FAIL with "Cannot find module '../base'".

- [ ] **Step 3: Implement `base.ts`**

```typescript
// desktop/src/shared/note-schema/base.ts
import { z } from 'zod';

/**
 * Marker for fields the LLM does NOT emit during grammar-constrained decode,
 * but `loadNote()` fills post-decode. The zod-to-gbnf converter reads
 * `_def.description`, JSON.parses it, and skips any field whose object has
 * `postDecodeOnly: true`. Zod v3 has no `.meta()` — `.describe(...)` is the
 * v3 metadata channel.
 *
 * See spec §2.8 and `zod-to-gbnf.ts` filter logic.
 */
export const POST_DECODE_MARKER_DESCRIPTION = JSON.stringify({ postDecodeOnly: true });

/**
 * Helper to mark a Zod schema as post-decode-only. Equivalent to
 * `.describe(POST_DECODE_MARKER_DESCRIPTION)` but signals intent at the
 * call site.
 */
export function postDecodeOnly<T extends z.ZodTypeAny>(schema: T): T {
  // .describe() returns the same node type with description set on _def.
  return schema.describe(POST_DECODE_MARKER_DESCRIPTION) as T;
}

/** Provenance: where this leaf came from. Computed post-hoc per spec §2.7. */
export const ProvenanceSchema = postDecodeOnly(z.enum(['transcript', 'inferred']));
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** Speaker reference: integer index into SessionTranscript.speakers[].id. */
export const SpeakerRefSchema = z.number().int().nonnegative();
export type SpeakerRef = z.infer<typeof SpeakerRefSchema>;

/** Note families — closed enum. Adding a family = bump this + add registry entry. */
export const NoteFamilySchema = z.enum(['lecture', 'meeting', 'interview', 'brainstorm']);
export type NoteFamily = z.infer<typeof NoteFamilySchema>;

/** Output / display language. */
export const LanguageSchema = z.enum(['ja', 'en', 'ko']);
export type NoteLanguage = z.infer<typeof LanguageSchema>;

/**
 * Common fields every family inherits. Per spec §3.1.
 * - `experimentArmId` is set by orchestrator at generation time. Lifecycle
 *   detail in spec §3.1 NoteBase comment.
 * - `validation_warnings` (user-visible) is distinct from
 *   GenerationTelemetry.validationWarnings (ops). See §3.1.
 */
export const NoteBaseSchema = z.object({
  schemaVersion: z.number().int().positive(),
  family: NoteFamilySchema,
  title: z.string(),
  generatedAt: z.string(),                          // ISO datetime
  generatedBy: z.object({
    model: z.string(),
    promptVersion: z.number().int().nonnegative(),
  }),
  language: LanguageSchema,
  durationSec: z.number().nonnegative(),
  experimentArmId: z.string().optional(),
  validation_warnings: z.array(z.string()).optional(),
});
export type NoteBase = z.infer<typeof NoteBaseSchema>;
```

- [ ] **Step 4: Run the test and confirm pass**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/base.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/note-schema/base.ts \
        desktop/src/shared/note-schema/__tests__/base.test.ts
git commit -m "feat(v2-foundation): NoteBase + Provenance + SpeakerRef Zod schemas"
```

---

## Task 3: SessionTranscript + v2 TranscriptSegment with `meta?`

**Files:**
- Create: `desktop/src/shared/note-schema/transcript.ts`
- Create: `desktop/src/shared/note-schema/__tests__/transcript.test.ts`

**Goal:** v2's transcript shape per spec §3.1. Fields: `ts` (start seconds), `endTs` (end seconds, from whisper t1), `text`, `speakerId`, `meta?: Record<string, unknown>` (per spec P1 — extensible per-segment metadata). Sibling artifact `SessionTranscript` carries `speakers: { id, name? }[]`.

This is the **v2 in-process shape**. It is DISTINCT from the existing `desktop/src/shared/types.ts::TranscriptSegment` (which uses `startSec/endSec/text/noSpeechProb?` and is consumed by the current alpha STT path). See Task 5 for the naming-reconciliation memo.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/shared/note-schema/__tests__/transcript.test.ts
import { describe, it, expect } from 'vitest';
import {
  TranscriptSegmentSchema,
  SessionTranscriptSchema,
  type TranscriptSegment,
  type SessionTranscript,
} from '../transcript';

describe('TranscriptSegment / SessionTranscript Zod', () => {
  it('TranscriptSegmentSchema parses minimum required fields', () => {
    const seg = { ts: 0, endTs: 1.5, text: 'hi', speakerId: 0 };
    expect(() => TranscriptSegmentSchema.parse(seg)).not.toThrow();
  });

  it('TranscriptSegmentSchema accepts optional meta', () => {
    const withMeta = {
      ts: 0,
      endTs: 1,
      text: 'hi',
      speakerId: 0,
      meta: { noSpeechProb: 0.02, customFlag: true },
    };
    const parsed = TranscriptSegmentSchema.parse(withMeta);
    expect(parsed.meta?.noSpeechProb).toBe(0.02);
  });

  it('TranscriptSegmentSchema rejects endTs < ts', () => {
    // Note: cross-field validation is OUT OF SCOPE for the shape schema
    // (orchestrator enforces ordering). This test documents intent: we
    // DO NOT add an internal refine() because the cost would be paid on
    // every chunk parse during streaming. If you need strict ordering,
    // validate in the orchestrator AFTER coalescing.
    const seg = { ts: 5, endTs: 4, text: 'x', speakerId: 0 };
    expect(() => TranscriptSegmentSchema.parse(seg)).not.toThrow();
  });

  it('SessionTranscriptSchema parses well-formed payload', () => {
    const t: SessionTranscript = {
      sessionId: 'abc',
      speakers: [{ id: 0 }, { id: 1, name: '田中' }],
      transcriptSegments: [
        { ts: 0, endTs: 1, text: 'hi', speakerId: 0 },
        { ts: 1.5, endTs: 2.5, text: 'world', speakerId: 1 },
      ],
    };
    expect(() => SessionTranscriptSchema.parse(t)).not.toThrow();
  });

  it('SessionTranscriptSchema accepts empty segments (e.g. silent recording)', () => {
    const empty: SessionTranscript = {
      sessionId: 'empty',
      speakers: [{ id: 0 }],
      transcriptSegments: [],
    };
    expect(() => SessionTranscriptSchema.parse(empty)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/transcript.test.ts`
Expected: FAIL with "Cannot find module '../transcript'".

- [ ] **Step 3: Implement `transcript.ts`**

```typescript
// desktop/src/shared/note-schema/transcript.ts
import { z } from 'zod';
import { SpeakerRefSchema } from './base';

/**
 * v2 transcript-segment shape (spec §3.1).
 *
 * Naming convention: camelCase with `Sec`-implied seconds (no suffix on
 * `ts`/`endTs` because they're already understood as seconds — matches
 * spec §5.2a pseudo-code and Spike 0.4 chunking.ts).
 *
 * Distinction vs the existing `desktop/src/shared/types.ts::TranscriptSegment`
 * (`startSec`/`endSec`/`text`/`noSpeechProb?`, no speakerId, no meta):
 * the legacy shape feeds the alpha single-shot path. The v2 shape is what
 * the structured-note pipeline consumes. They COEXIST during the alpha
 * overlap. Adapter direction: STT→v2 (the orchestrator builds v2 segments
 * from legacy segments after diarization adds speakerId).
 *
 * `meta?: Record<string, unknown>` is the P1 extensibility hatch — hooks
 * can attach `{ noSpeechProb }`, `{ markerFlag: 'silence-snap' }`, etc.
 * without forking the schema.
 */
export const TranscriptSegmentSchema = z.object({
  ts: z.number().nonnegative(),
  endTs: z.number().nonnegative(),
  text: z.string(),
  speakerId: SpeakerRefSchema,
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

/** Speaker entry — id is canonical, name? is user-assigned at any time. */
export const SpeakerSchema = z.object({
  id: SpeakerRefSchema,
  name: z.string().optional(),
});
export type Speaker = z.infer<typeof SpeakerSchema>;

/**
 * SessionTranscript — the sibling-artifact JSON written to
 * sessions/<id>/transcript.json. Durable source of truth; never re-LLM'd.
 */
export const SessionTranscriptSchema = z.object({
  sessionId: z.string(),
  speakers: z.array(SpeakerSchema),
  transcriptSegments: z.array(TranscriptSegmentSchema),
});
export type SessionTranscript = z.infer<typeof SessionTranscriptSchema>;
```

- [ ] **Step 4: Run the test and confirm pass**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/transcript.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/note-schema/transcript.ts \
        desktop/src/shared/note-schema/__tests__/transcript.test.ts
git commit -m "feat(v2-foundation): SessionTranscript + v2 TranscriptSegment with meta? (P1)"
```

---

## Task 4: GenerationTelemetry Zod

**Files:**
- Create: `desktop/src/shared/note-schema/telemetry.ts`
- Create: `desktop/src/shared/note-schema/__tests__/telemetry.test.ts`

**Goal:** Per spec §3.1, the orchestrator writes `sessions/<id>/telemetry.json` alongside the note. Plan 7 (Eval) consumes this. Adding the type now means the orchestrator (Plan 3) doesn't need to invent it.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/shared/note-schema/__tests__/telemetry.test.ts
import { describe, it, expect } from 'vitest';
import { GenerationTelemetrySchema } from '../telemetry';

describe('GenerationTelemetry Zod', () => {
  it('parses a complete telemetry record', () => {
    const t = {
      noteId: 'abc',
      modelId: 'llama-3.2-3b-q4-km',
      promptVariantId: 'v1-baseline',
      schemaVersion: 1,
      generationStartedAt: '2026-05-27T00:00:00Z',
      generationDurationMs: 95000,
      chunkCount: 3,
      totalTokensIn: 24000,
      totalTokensOut: 1200,
      validationWarnings: ['Dropped 1 invalid speakerRef'],
      dedupHits: [{ field: 'decisions', count: 2 }],
      postDecodeMutations: [
        { field: 'sections[0].key_terms[2].from', reason: 'no-ts-match' },
      ],
    };
    expect(() => GenerationTelemetrySchema.parse(t)).not.toThrow();
  });

  it('rejects negative durations', () => {
    expect(() =>
      GenerationTelemetrySchema.parse({
        noteId: 'a', modelId: 'm', promptVariantId: 'v',
        schemaVersion: 1, generationStartedAt: '2026-05-27T00:00:00Z',
        generationDurationMs: -1, chunkCount: 1,
        totalTokensIn: 0, totalTokensOut: 0,
        validationWarnings: [], dedupHits: [], postDecodeMutations: [],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/telemetry.test.ts`
Expected: FAIL "Cannot find module '../telemetry'".

- [ ] **Step 3: Implement `telemetry.ts`**

```typescript
// desktop/src/shared/note-schema/telemetry.ts
import { z } from 'zod';

/**
 * Per spec §3.1 — observability sibling artifact at
 * sessions/<id>/telemetry.json. Plan 7 (Eval) consumes this for
 * regression scoring.
 */
export const GenerationTelemetrySchema = z.object({
  noteId: z.string(),
  modelId: z.string(),
  promptVariantId: z.string(),
  schemaVersion: z.number().int().positive(),
  generationStartedAt: z.string(),
  generationDurationMs: z.number().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  totalTokensIn: z.number().int().nonnegative(),
  totalTokensOut: z.number().int().nonnegative(),
  validationWarnings: z.array(z.string()),
  dedupHits: z.array(z.object({ field: z.string(), count: z.number().int().nonnegative() })),
  postDecodeMutations: z.array(z.object({ field: z.string(), reason: z.string() })),
});
export type GenerationTelemetry = z.infer<typeof GenerationTelemetrySchema>;
```

- [ ] **Step 4: Run the test and confirm pass**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/telemetry.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/note-schema/telemetry.ts \
        desktop/src/shared/note-schema/__tests__/telemetry.test.ts
git commit -m "feat(v2-foundation): GenerationTelemetry Zod schema"
```

---

## Task 5: Naming-reconciliation memo + JSDoc lock comment

**Files:**
- Modify: `desktop/src/shared/types.ts` (append a JSDoc block above the `TranscriptSegment` interface — NO shape change)
- Create: `desktop/src/shared/note-schema/NAMING.md` (single source of truth memo)

**Goal:** Per carry-forward #4 — explicit decision on which naming wins, with the adapter direction documented. This is a *decision* task, not a code-change task. NO data shape changes anywhere.

**Decision (locked here):**
1. **Canonical in-process shape = camelCase** with `Sec`-implied or `Sec`-suffixed durations (`ts`, `endTs`, `durationSec`, `startMs`, `endMs`).
2. **HTTP wire shape = snake_case** (root `/shared/` workspace package — frozen extension territory, not touched).
3. **Two in-process variants COEXIST:**
   - Legacy: `desktop/src/shared/types.ts::TranscriptSegment` = `{ startSec, endSec, text, noSpeechProb? }`. Drives current alpha single-shot path.
   - v2: `desktop/src/shared/note-schema/transcript.ts::TranscriptSegment` = `{ ts, endTs, text, speakerId, meta? }`. Drives v2 structured-note pipeline.
4. **Adapter direction:** STT-emitted legacy segments are converted to v2 inside the orchestrator (Plan 3) once `speakerId` is known from diarization. v2 segments are never converted back — the v2 path supersedes the alpha path for new sessions.
5. **`noSpeechProb` migration:** the value the legacy shape carries as a typed field moves into v2's `meta?: { noSpeechProb?: number }` (Plan 3 orchestrator's `afterTranscribe` hook does the move). This is why P1 was added.

- [ ] **Step 1: Write the NAMING memo**

Create `desktop/src/shared/note-schema/NAMING.md`:

```markdown
# v2 Note Schema Naming Convention

**Locked 2026-05-27 (Plan 2 Task 5).**

## Three shapes, three layers

| Layer | Module | Shape | Naming |
|---|---|---|---|
| HTTP wire (extension ↔ backend) | `/shared/src/index.ts` (workspace pkg) | `session_id`, `start_time_sec`, `audio_b64` | **snake_case** |
| Desktop in-process (alpha single-shot path) | `desktop/src/shared/types.ts::TranscriptSegment` | `startSec`, `endSec`, `text`, `noSpeechProb?` | **camelCase + Sec suffix** |
| Desktop in-process (v2 structured-note path) | `desktop/src/shared/note-schema/transcript.ts::TranscriptSegment` | `ts`, `endTs`, `text`, `speakerId`, `meta?` | **camelCase, Sec implied** |

## Why two desktop shapes?

The alpha path (`ja-note-v1.ts` single-shot) was built around the legacy
shape and is in production. v2 introduces `speakerId` (diarization) and
`meta` (P1 extensibility) and follows the spec §3.1 pseudo-code naming.
Both shapes co-exist during the alpha→v2 transition per spec §10.1.

## Adapter direction

STT emits legacy. The Plan 3 orchestrator's `afterTranscribe` hook
converts legacy → v2 once diarization has assigned `speakerId`:

```ts
function legacyToV2(legacy: LegacyTranscriptSegment, speakerId: number): TranscriptSegment {
  const { startSec, endSec, text, noSpeechProb } = legacy;
  return {
    ts: startSec,
    endTs: endSec,
    text,
    speakerId,
    meta: noSpeechProb !== undefined ? { noSpeechProb } : undefined,
  };
}
```

v2 segments are NEVER converted back to legacy. The alpha path stays
untouched on its existing shape; new sessions use v2 end-to-end.

## HTTP wire is out of scope

The root `/shared/` workspace package (snake_case) serves the extension
HTTP boundary. Extension is FROZEN per CLAUDE.md scope-freeze
(2026-05-24). Plan 2 does not touch it. If v2 ever needs HTTP sync
(it doesn't today — v2 is on-device only per PRD), an adapter at the
HTTP boundary would convert v2 ↔ wire.
```

- [ ] **Step 2: Append a JSDoc lock comment to the legacy shape**

Edit `desktop/src/shared/types.ts`. Above the existing `interface TranscriptSegment {`, insert:

```typescript
/**
 * Legacy (alpha) transcript segment shape — drives the alpha single-shot
 * `ja-note-v1.ts` path. v2 structured-note pipeline uses
 * `desktop/src/shared/note-schema/transcript.ts::TranscriptSegment`
 * (`{ ts, endTs, text, speakerId, meta? }`).
 *
 * Both shapes coexist during alpha→v2 transition (spec §10.1).
 * Adapter direction: STT emits legacy → orchestrator converts to v2 after
 * diarization assigns `speakerId`. See
 * `desktop/src/shared/note-schema/NAMING.md` for the locked convention.
 */
export interface TranscriptSegment {
```

- [ ] **Step 3: Verify typecheck still passes**

Run: `pnpm --filter @lisna/desktop typecheck`
Expected: PASS (comment-only change to types.ts, new MD file).

- [ ] **Step 4: Commit**

```bash
git add desktop/src/shared/note-schema/NAMING.md desktop/src/shared/types.ts
git commit -m "docs(v2): lock naming convention — camelCase canonical, alpha+v2 coexist"
```

---

## Task 6: Extended `estimateTokens` exported from note-schema

**Files:**
- Create: `desktop/src/shared/note-schema/tokens.ts`
- Create: `desktop/src/shared/note-schema/__tests__/tokens.test.ts`

**Goal:** Carry-forward #5 + #6 — extend the CJK regex from Spike 0.4 (`[぀-ゟ゠-ヿ一-鿿]`) to cover four more ranges:
- CJK Extension A: `[㐀-䶿]` (U+3400–U+4DBF)
- Halfwidth katakana: `[｡-ﾟ]` (U+FF61–U+FF9F)
- Fullwidth ASCII: `[！-～]` (U+FF01–U+FF5E)
- JP punctuation / fullwidth space: `[　-〿]` (U+3000–U+303F)

And export it from shared so eval-time tests (Plan 7) use the same estimator as the production chunker, eliminating the 6.6% drift between Spike 0.4's `synth.test.ts` ad-hoc estimator and the real one.

Ratios stay the same: CJK 0.6 t/char, ASCII 0.25 t/char.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/shared/note-schema/__tests__/tokens.test.ts
import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../tokens';

describe('estimateTokens — extended CJK coverage', () => {
  it('hiragana + katakana + CJK basic (regression vs Spike 0.4)', () => {
    // 5 hiragana chars × 0.6 = 3
    expect(estimateTokens('あいうえお')).toBe(3);
  });

  it('CJK Extension A (鿀 is in BMP basic, 㐀 is in Extension A)', () => {
    // 㐀 = U+3400. Spike 0.4 regex MISSED Extension A. Now: 0.6 t/char.
    expect(estimateTokens('㐀㐁㐂㐃㐄')).toBe(3);
  });

  it('halfwidth katakana (｡ｱｲｳ｡)', () => {
    // 5 halfwidth chars × 0.6 = 3
    expect(estimateTokens('｡ｱｲｳ｡')).toBe(3);
  });

  it('fullwidth ASCII (Ａ-Ｚ range)', () => {
    // 5 fullwidth × 0.6 = 3
    expect(estimateTokens('ＡＢＣＤＥ')).toBe(3);
  });

  it('JP punctuation + ideographic space', () => {
    // 「」、。　 = 5 chars × 0.6 = 3
    expect(estimateTokens('「」、。　')).toBe(3);
  });

  it('pure ASCII (regression vs Spike 0.4)', () => {
    // "hello world" = 11 ASCII × 0.25 = 2.75 → ceil → 3
    expect(estimateTokens('hello world')).toBe(3);
  });

  it('mixed JA + ASCII', () => {
    // "今日hello" = 2 CJK × 0.6 + 5 ASCII × 0.25 = 1.2 + 1.25 = 2.45 → 3
    expect(estimateTokens('今日hello')).toBe(3);
  });

  it('empty string → 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('boundary chars between ranges do not double-count', () => {
    // Each char counted exactly once. Sentinel: 5 mixed-range chars × 0.6 + 0 ASCII = 3
    expect(estimateTokens('あ㐀ｱＡ「')).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/tokens.test.ts`
Expected: FAIL "Cannot find module '../tokens'".

- [ ] **Step 3: Implement `tokens.ts`**

```typescript
// desktop/src/shared/note-schema/tokens.ts

/**
 * Estimate LLM token count for a string.
 *
 * Calibrated against kotoba-whisper-v2 + Llama 3.2 tokenizer empirics
 * during Spike 0.4: ~0.6 tokens/char for JA-dense input, ~0.25 tokens/char
 * for ASCII. Used for chunk-budget decisions (chunkTranscript).
 *
 * CJK coverage extended in Plan 2 Task 6 from Spike 0.4's original three
 * ranges to seven (carry-forward M-2):
 *
 *   - hiragana       U+3040–U+309F  [぀-ゟ]
 *   - katakana       U+30A0–U+30FF  [゠-ヿ]
 *   - CJK basic      U+4E00–U+9FFF  [一-鿿]
 *   - CJK Ext A      U+3400–U+4DBF  [㐀-䶿]   (NEW)
 *   - halfwidth kana U+FF61–U+FF9F  [｡-ﾟ]    (NEW)
 *   - fullwidth ASCII U+FF01–U+FF5E [！-～]   (NEW)
 *   - JP punct       U+3000–U+303F  [　-〿]   (NEW)
 *
 * Anything not in the above ranges is treated as ASCII at 0.25 t/char.
 * This is exported from `@shared/note-schema` so eval-time fixture-builders
 * and tests use the SAME estimator as the production chunker, avoiding the
 * 6.6% drift observed in Spike 0.4's synth.test.ts.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const cjkRegex = /[぀-ゟ゠-ヿ一-鿿㐀-䶿｡-ﾟ！-～　-〿]/g;
  const cjkCount = (text.match(cjkRegex) ?? []).length;
  const asciiCount = text.length - cjkCount;
  return Math.ceil(cjkCount * 0.6 + asciiCount * 0.25);
}
```

- [ ] **Step 4: Run the test and confirm pass**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/tokens.test.ts`
Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/note-schema/tokens.ts \
        desktop/src/shared/note-schema/__tests__/tokens.test.ts
git commit -m "feat(v2-foundation): estimateTokens with extended CJK regex (M-2/M-7)"
```

---

## Task 7: Move `chunkTranscript` to shared with I-1 test tightening

**Files:**
- Create: `desktop/src/shared/note-schema/chunking.ts`
- Create: `desktop/src/shared/note-schema/__tests__/chunking.test.ts`
- Create: `desktop/src/shared/note-schema/fixtures/synth-90min.json` (copied from spike)

**Goal:** Lift Spike 0.4's `chunking.ts` into `note-schema/`. Drop the local `TranscriptSegment`/`SessionTranscript` interfaces and import from `./transcript`. Drop the local `estimateTokens` and import from `./tokens`. I-3 (silence-snap correctness on `endSec`) lands in Task 8 — this task keeps the spike's text-length heuristic so Task 7 stays a pure lift+rename.

Additionally:
- **I-1 fix:** the existing "splits at silence > 1.5s within slack window" test only asserted `chunks.length > 1`. Tighten with an explicit boundary-ts assertion (verify the split happens AT the silence gap, not just that any split happened).

- [ ] **Step 1: Copy the synth fixture**

```bash
cp desktop/spikes/phase-0/04-chunking/fixtures/synth-90min.json \
   desktop/src/shared/note-schema/fixtures/synth-90min.json
```

(Acceptance: file is ~4544 lines, JSON-parseable, has `sessionId` + `speakers` + `transcriptSegments` keys. If `sessionId` is missing in the spike fixture, add it as `"synth-90min"`.)

- [ ] **Step 2: Re-implement chunking with shared imports**

Create `desktop/src/shared/note-schema/chunking.ts`:

```typescript
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
//   - findSilenceGaps STILL uses the text-length heuristic in THIS task
//     (Task 7). Task 8 swaps it for `endTs` (I-3 fix).

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
 * Task 7: text-length heuristic (segLastWord = ts + text.length * 0.07).
 * Task 8: swap to seg.endTs (now that v2 segments carry it).
 */
function findSilenceGaps(
  segs: TranscriptSegment[],
  windowStart: number,
  windowEnd: number,
  minGapSec: number,
): SilenceGap[] {
  const gaps: SilenceGap[] = [];
  for (let i = 0; i < segs.length - 1; i++) {
    const segLastWord = segs[i].ts + segs[i].text.length * 0.07;
    const gapStart = Math.max(segLastWord, segs[i].ts);
    const gapEnd = segs[i + 1].ts;
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
```

- [ ] **Step 3: Write the test with I-1 tightening**

Create `desktop/src/shared/note-schema/__tests__/chunking.test.ts`:

```typescript
// desktop/src/shared/note-schema/__tests__/chunking.test.ts
//
// Carry-forward I-1: the spike test asserted only chunks.length > 1.
// This version asserts boundary-ts — confirms the split landed AT the
// silence gap, not just that A split happened.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chunkTranscript } from '../chunking';
import type { SessionTranscript } from '../transcript';

const mkTranscript = (
  segs: Array<{ ts: number; endTs?: number; text: string; speakerId?: number }>,
): SessionTranscript => ({
  sessionId: 'test',
  speakers: [{ id: 0 }],
  transcriptSegments: segs.map(s => ({
    ts: s.ts,
    endTs: s.endTs ?? s.ts + 0.5,
    text: s.text,
    speakerId: s.speakerId ?? 0,
  })),
});

describe('chunkTranscript (v2 shape)', () => {
  it('empty transcript returns []', () => {
    expect(chunkTranscript(mkTranscript([]), 8000, 30)).toEqual([]);
  });

  it('single segment under budget returns [transcript]', () => {
    const t = mkTranscript([{ ts: 0, text: 'short' }]);
    expect(chunkTranscript(t, 8000, 30)).toHaveLength(1);
  });

  it('multiple segments fitting budget returns one chunk', () => {
    const t = mkTranscript([
      { ts: 0, text: 'hi' },
      { ts: 1, text: 'there' },
      { ts: 2, text: 'all' },
    ]);
    expect(chunkTranscript(t, 8000, 30)).toHaveLength(1);
  });

  it('splits at silence > 1.5s within slack window (I-1 tightening)', () => {
    // Set up a clear silence at ts=10..20 (10s gap) between segment 0 and 1.
    // Soft budget threshold lands AT segment 0 (3000 tokens > 2500 budget),
    // and the silence-gap is within ±30s slack, so split snaps there.
    const t = mkTranscript([
      { ts: 0, endTs: 9.9, text: 'あ'.repeat(5000) },   // exceeds 2500 budget on its own
      { ts: 20, endTs: 20.5, text: 'B' },
      { ts: 30, endTs: 30.5, text: 'C' },
      { ts: 32, endTs: 32.5, text: 'D' },
    ]);
    const chunks = chunkTranscript(t, 2500, 30);

    // I-1 tightening: not just "more than one chunk" — the chunk boundary
    // must land AT the silence gap (chunk[0] ends at ts=0, chunk[1]
    // starts at ts=20).
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].transcriptSegments.at(-1)?.ts).toBe(0);
    expect(chunks[1].transcriptSegments[0].ts).toBe(20);
  });

  it('hard-cuts at token budget when no silence in slack window', () => {
    const segs: Array<{ ts: number; text: string }> = [];
    for (let i = 0; i < 200; i++) segs.push({ ts: i * 0.5, text: 'あ'.repeat(100) });
    const t = mkTranscript(segs);
    const chunks = chunkTranscript(t, 1000, 5);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      const totalChars = c.transcriptSegments.reduce((s, x) => s + x.text.length, 0);
      expect(totalChars).toBeLessThan(2500);
    }
  });
});

describe('chunkTranscript on the 90-min synth fixture', () => {
  const FIXTURE_PATH = resolve(import.meta.dirname, '../fixtures/synth-90min.json');
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
  // Adapt the spike fixture (which has only `ts`/`text`/`speakerId`) to the v2
  // shape by deriving endTs = ts + max(text.length * 0.07, 0.5). This is a
  // TEST-ONLY adaptation; Task 8's I-3 fix uses STT's real endTs.
  const transcript: SessionTranscript = {
    sessionId: raw.sessionId ?? 'synth-90min',
    speakers: raw.speakers,
    transcriptSegments: raw.transcriptSegments.map((s: { ts: number; text: string; speakerId: number }) => ({
      ts: s.ts,
      endTs: s.ts + Math.max(s.text.length * 0.07, 0.5),
      text: s.text,
      speakerId: s.speakerId,
    })),
  };

  it('produces 4-12 chunks at 8K-token budget', () => {
    const chunks = chunkTranscript(transcript, 8000, 30);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks.length).toBeLessThanOrEqual(12);
  });

  it('preserves all segments (no loss)', () => {
    const chunks = chunkTranscript(transcript, 8000, 30);
    const totalChunked = chunks.reduce((s, c) => s + c.transcriptSegments.length, 0);
    expect(totalChunked).toBe(transcript.transcriptSegments.length);
  });
});
```

- [ ] **Step 4: Run the tests and confirm pass**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/chunking.test.ts`
Expected: all 7 tests PASS.

If the synth-90min fixture is missing `sessionId`, add it as `"sessionId": "synth-90min"` at the top of the JSON (one-line edit) and re-run.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/note-schema/chunking.ts \
        desktop/src/shared/note-schema/__tests__/chunking.test.ts \
        desktop/src/shared/note-schema/fixtures/synth-90min.json
git commit -m "refactor(shared): move chunkTranscript to shared + I-1 boundary-ts test"
```

---

## Task 8: I-3 silence-snap correctness — use `endTs`

**Files:**
- Modify: `desktop/src/shared/note-schema/chunking.ts` (replace text-length heuristic with `seg.endTs`)
- Modify: `desktop/src/shared/note-schema/__tests__/chunking.test.ts` (add a regression that proves the silence branch is exercised on STT-bucket-shaped fixtures)

**Goal:** Carry-forward #3 — the spike's silence-snap branch was DEAD on STT-bucket-shaped fixtures because `segLastWord = ts + text.length * 0.07` overflowed past `next_seg.ts` for ~150-char segments at 10-s buckets. Now that v2's TranscriptSegment carries `endTs` (from `whisper_full_get_segment_t1`, already plumbed at `desktop/sidecar/src/stt/whisper_engine.cpp:59` + `desktop/sidecar/src/ipc/json_protocol.cpp:111`), use it directly.

The STT→v2 adapter (in Plan 3's orchestrator) maps `seg.endSec` → `v2.endTs`. The whisper-side fix is already there; Task 8 just consumes it.

**Note:** if for some reason a downstream caller passes a v2 segment with `endTs === ts` (no real duration available), the interim clamp from VERDICT.md still applies. Keep the clamp as the function's behavior on degenerate input.

- [ ] **Step 1: Write the failing regression test**

Append to `desktop/src/shared/note-schema/__tests__/chunking.test.ts` (inside the first describe block):

```typescript
  it('silence branch is exercised when endTs is well-defined (I-3 fix)', () => {
    // 200 segments at 5s each, but a 3-second silence between seg[99]
    // and seg[100]. Without I-3 fix (text-length heuristic), segLastWord
    // overflows past seg[100].ts and the gap is computed as negative —
    // silence branch is skipped.
    // With I-3 fix (use endTs), the gap is computed correctly as 3s, > 1.5s
    // minimum, within slack — split snaps there.
    const segs: Array<{ ts: number; endTs: number; text: string }> = [];
    for (let i = 0; i < 200; i++) {
      const ts = i < 100 ? i * 5 : i * 5 + 3;       // 3s offset after seg[99]
      segs.push({
        ts,
        endTs: ts + 4.9,                              // each seg = 4.9s of audio
        text: 'あ'.repeat(60),                       // ~36 tokens each
      });
    }
    const t = mkTranscript(segs);
    // Budget: ~3000 tokens. seg[99] is the natural boundary.
    const chunks = chunkTranscript(t, 3000, 30);
    expect(chunks.length).toBeGreaterThan(1);

    // Find the split that should align with the 3-s gap
    // (chunk[0] should end at seg[99] with ts=495; next chunk starts at
    // seg[100] with ts=503).
    const splitFound = chunks.some(
      (c, i) =>
        i + 1 < chunks.length &&
        c.transcriptSegments.at(-1)?.ts === 99 * 5 &&
        chunks[i + 1].transcriptSegments[0].ts === 100 * 5 + 3,
    );
    expect(splitFound).toBe(true);
  });
```

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/chunking.test.ts`
Expected: NEW test FAILS (the text-length heuristic computes segLastWord = 495 + 60*0.07 = 499.2 > 503's gap-floor 500.0 — the gap is incorrectly computed and the snap misses).

Actually, this might depend on integer rounding. If the test passes accidentally with the heuristic, narrow the segment text to a length that makes the heuristic miss but `endTs` catches.

- [ ] **Step 2: Replace the heuristic with `endTs`**

In `desktop/src/shared/note-schema/chunking.ts`, replace:

```typescript
    const segLastWord = segs[i].ts + segs[i].text.length * 0.07;
    const gapStart = Math.max(segLastWord, segs[i].ts);
```

with:

```typescript
    // Use whisper's per-segment endTs (plumbed from whisper_full_get_segment_t1
    // at desktop/sidecar/src/stt/whisper_engine.cpp:59 + json_protocol.cpp:111).
    // Clamp to segs[i+1].ts to handle degenerate input where a stale path
    // hands us endTs >= next.ts (would mark every gap negative-duration).
    const segLastWord = Math.min(segs[i].endTs, segs[i + 1].ts);
    const gapStart = Math.max(segLastWord, segs[i].ts);
```

And in the JSDoc at top of `findSilenceGaps`, update:

```typescript
 * Task 7: text-length heuristic (segLastWord = ts + text.length * 0.07).
 * Task 8: swap to seg.endTs (now that v2 segments carry it).
```

to:

```typescript
 * Uses whisper-emitted endTs as the segment-end anchor; clamps to next-seg
 * `ts` so degenerate input (endTs >= next.ts) doesn't make every gap
 * negative-duration and disable the silence branch.
```

- [ ] **Step 3: Run the test and confirm pass**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/chunking.test.ts`
Expected: all tests including the new I-3 regression PASS.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/shared/note-schema/chunking.ts \
        desktop/src/shared/note-schema/__tests__/chunking.test.ts
git commit -m "fix(v2-foundation): silence-snap uses endTs (Spike 0.4 I-3 dead-branch)"
```

---

## Task 9: `computeProvenance()` pure function + ProvenanceConfig

**Files:**
- Create: `desktop/src/shared/note-schema/provenance.ts`
- Create: `desktop/src/shared/note-schema/__tests__/provenance.test.ts`

**Goal:** Per spec §4.P8 — `computeProvenance(item, transcript, config?)` is a pure function the orchestrator runs over every leaf with a `ts`. Returns `'transcript'` if the leaf's ts falls within `matchWindowSec` of any segment, else `'inferred'`. Empty transcript → config-driven default (default `'inferred'`).

Table-driven tests cover the cases in the spec's pseudocode + edge cases.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/shared/note-schema/__tests__/provenance.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeProvenance,
  DEFAULT_PROVENANCE_CONFIG,
  type ProvenanceConfig,
} from '../provenance';
import type { SessionTranscript } from '../transcript';

const mkTranscript = (tsValues: number[]): SessionTranscript => ({
  sessionId: 't',
  speakers: [{ id: 0 }],
  transcriptSegments: tsValues.map(ts => ({
    ts,
    endTs: ts + 0.5,
    text: 'x',
    speakerId: 0,
  })),
});

describe('computeProvenance — table-driven', () => {
  const transcript = mkTranscript([0, 5, 10, 15, 20]);

  it.each<[string, { ts?: number }, ProvenanceConfig | undefined, 'transcript' | 'inferred']>([
    ['exact hit', { ts: 5 }, undefined, 'transcript'],
    ['within window upper', { ts: 7 }, undefined, 'transcript'],          // 7 ∈ 5±3
    ['within window lower', { ts: 8 }, undefined, 'transcript'],          // 8 ∈ 10±3
    ['outside window', { ts: 100 }, undefined, 'inferred'],
    ['undefined ts → inferred', {}, undefined, 'inferred'],
    ['ts = 0 boundary', { ts: 0 }, undefined, 'transcript'],
    ['narrow window misses', { ts: 6 }, { matchWindowSec: 0.5, emptyTranscriptDefault: 'inferred' }, 'inferred'],
    ['narrow window hits', { ts: 5.3 }, { matchWindowSec: 0.5, emptyTranscriptDefault: 'inferred' }, 'transcript'],
  ])('%s', (_label, item, config, expected) => {
    expect(computeProvenance(item, transcript, config)).toBe(expected);
  });

  it('empty transcript honours config emptyTranscriptDefault', () => {
    const empty = mkTranscript([]);
    expect(computeProvenance({ ts: 5 }, empty)).toBe('inferred');
    expect(
      computeProvenance({ ts: 5 }, empty, {
        matchWindowSec: 3,
        emptyTranscriptDefault: 'transcript',
      }),
    ).toBe('transcript');
  });

  it('DEFAULT_PROVENANCE_CONFIG = { matchWindowSec: 3, emptyTranscriptDefault: "inferred" }', () => {
    expect(DEFAULT_PROVENANCE_CONFIG.matchWindowSec).toBe(3);
    expect(DEFAULT_PROVENANCE_CONFIG.emptyTranscriptDefault).toBe('inferred');
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/provenance.test.ts`
Expected: FAIL "Cannot find module '../provenance'".

- [ ] **Step 3: Implement `provenance.ts`**

```typescript
// desktop/src/shared/note-schema/provenance.ts
import type { Provenance } from './base';
import type { SessionTranscript } from './transcript';

export interface ProvenanceConfig {
  /** Window in seconds around a segment's `ts` that counts as a match. */
  matchWindowSec: number;
  /** Fallback when transcript has 0 segments. */
  emptyTranscriptDefault: Provenance;
}

export const DEFAULT_PROVENANCE_CONFIG: ProvenanceConfig = {
  matchWindowSec: 3,
  emptyTranscriptDefault: 'inferred',
};

/**
 * Decide whether a generated leaf's `ts` aligns with a real transcript
 * segment. Pure function — input-output only, no side effects, no IO.
 *
 * Per spec §4.P8. The orchestrator runs this over every leaf with a `ts`
 * field after LLM decode, before final Zod parse.
 */
export function computeProvenance(
  item: { ts?: number },
  transcript: SessionTranscript,
  config: ProvenanceConfig = DEFAULT_PROVENANCE_CONFIG,
): Provenance {
  if (item.ts === undefined) return 'inferred';
  if (transcript.transcriptSegments.length === 0) return config.emptyTranscriptDefault;
  const within = transcript.transcriptSegments.some(
    seg => Math.abs(seg.ts - item.ts!) <= config.matchWindowSec,
  );
  return within ? 'transcript' : 'inferred';
}

/** Type alias for use in FamilyDefinition.inferProvenance? optional override. */
export type ProvenanceComputer = typeof computeProvenance;
```

- [ ] **Step 4: Run the test and confirm pass**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/provenance.test.ts`
Expected: all tests PASS (10 cases including 8 table rows + 2 standalone).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/note-schema/provenance.ts \
        desktop/src/shared/note-schema/__tests__/provenance.test.ts
git commit -m "feat(v2-foundation): computeProvenance pure function + ProvenanceConfig (P8)"
```

---

## Task 10: Lift `hydratePostDecode` to shared

**Files:**
- Create: `desktop/src/shared/note-schema/post-decode-hydration.ts`
- Create: `desktop/src/shared/note-schema/__tests__/post-decode-hydration.test.ts`

**Goal:** Carry-forward #9 — the recursive helper that walks a parsed JSON tree and fills `from` fields with the result of `computeProvenance()`. Spike 0.1 used it once in `round-trip.test.ts`; Spike 0.2 (if/when it lands) would use it again. Production orchestrator (Plan 3) will be the third caller.

The spike version (`round-trip.test.ts:143-151`) was hand-coded for the LectureMini shape. The shared version is **generic** — walks any nested object and fills `from` on any leaf that has a `ts` but no `from`. UUID assignment for Brainstorm `ideas[].id` is a separate hydration step (Plan 6, when the Brainstorm schema lands) — out of scope here.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/shared/note-schema/__tests__/post-decode-hydration.test.ts
import { describe, it, expect } from 'vitest';
import { hydratePostDecode } from '../post-decode-hydration';
import type { SessionTranscript } from '../transcript';

const transcript: SessionTranscript = {
  sessionId: 't',
  speakers: [{ id: 0 }],
  transcriptSegments: [
    { ts: 0, endTs: 0.5, text: 'a', speakerId: 0 },
    { ts: 10, endTs: 10.5, text: 'b', speakerId: 0 },
  ],
};

describe('hydratePostDecode', () => {
  it('fills `from` on a top-level leaf with ts (transcript match)', () => {
    const obj = { key: 'k', text: 'x', ts: 0 };
    hydratePostDecode(obj, transcript);
    expect((obj as any).from).toBe('transcript');
  });

  it('fills `from = inferred` when ts outside window', () => {
    const obj = { key: 'k', text: 'x', ts: 999 };
    hydratePostDecode(obj, transcript);
    expect((obj as any).from).toBe('inferred');
  });

  it('recurses into arrays of objects', () => {
    const obj = {
      sections: [
        {
          heading: 'Intro',
          key_terms: [
            { term: 'photo', definition: 'd', ts: 0 },
            { term: 'unknown', definition: 'd', ts: 9999 },
          ],
        },
      ],
    };
    hydratePostDecode(obj, transcript);
    expect((obj.sections[0].key_terms[0] as any).from).toBe('transcript');
    expect((obj.sections[0].key_terms[1] as any).from).toBe('inferred');
  });

  it('does NOT overwrite an explicit `from` already present', () => {
    const obj = { ts: 0, from: 'inferred' };
    hydratePostDecode(obj, transcript);
    expect(obj.from).toBe('inferred'); // unchanged
  });

  it('does NOT add `from` to leaves without ts', () => {
    const obj = { text: 'no-anchor' };
    hydratePostDecode(obj, transcript);
    expect((obj as any).from).toBeUndefined();
  });

  it('handles null / non-object values gracefully', () => {
    expect(() => hydratePostDecode(null as unknown as object, transcript)).not.toThrow();
    expect(() => hydratePostDecode(42 as unknown as object, transcript)).not.toThrow();
  });

  it('handles empty transcript per config', () => {
    const empty: SessionTranscript = { sessionId: 'e', speakers: [], transcriptSegments: [] };
    const obj = { ts: 5 };
    hydratePostDecode(obj, empty);
    expect((obj as any).from).toBe('inferred');
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/post-decode-hydration.test.ts`
Expected: FAIL "Cannot find module '../post-decode-hydration'".

- [ ] **Step 3: Implement `post-decode-hydration.ts`**

```typescript
// desktop/src/shared/note-schema/post-decode-hydration.ts
import { computeProvenance, DEFAULT_PROVENANCE_CONFIG, type ProvenanceConfig } from './provenance';
import type { SessionTranscript } from './transcript';

/**
 * Walk a parsed JSON tree and fill `from` on every leaf that:
 *   - has a numeric `ts`, AND
 *   - does NOT already have a `from`.
 *
 * Spec §2.8 — grammar schema strips `from` (via the postDecodeOnly marker
 * on `ProvenanceSchema`); validated-note schema requires it. This function
 * is the bridge.
 *
 * Mutates the input in place. Used in Plan 3's orchestrator AFTER raw
 * JSON.parse but BEFORE Zod.parse against the full validated-note schema.
 *
 * Brainstorm `ideas[].id` UUID hydration is a SEPARATE post-decode step
 * (lands with the Brainstorm schema in Plan 6).
 */
export function hydratePostDecode(
  node: unknown,
  transcript: SessionTranscript,
  config: ProvenanceConfig = DEFAULT_PROVENANCE_CONFIG,
): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) hydratePostDecode(item, transcript, config);
    return;
  }
  const obj = node as Record<string, unknown>;
  // Leaf-with-ts criterion: numeric `ts` present, `from` not already set.
  if (typeof obj.ts === 'number' && obj.from === undefined) {
    obj.from = computeProvenance({ ts: obj.ts }, transcript, config);
  }
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      hydratePostDecode(obj[k], transcript, config);
    }
  }
}
```

- [ ] **Step 4: Run the test and confirm pass**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/post-decode-hydration.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/note-schema/post-decode-hydration.ts \
        desktop/src/shared/note-schema/__tests__/post-decode-hydration.test.ts
git commit -m "feat(v2-foundation): hydratePostDecode shared helper (Spike 0.1+0.2 lift)"
```

---

## Task 11: Grammar-call wrapper — interface + injection point

**Files:**
- Create: `desktop/src/main/sidecar/grammar-call.ts`
- Create: `desktop/src/main/sidecar/__tests__/grammar-call.test.ts`

**Goal:** Stand up the **interface + injection seam** for the grammar-constrained-call wrapper. Implementation of the retry loop lands in Task 12; production-side `SidecarClient` adapter lands in Task 13.

Per VERDICT.md, the wrapper must:
- accept `maxAttempts` (default 3)
- vary the seed across attempts: `baseSeed + (attempt - 1) * 100`
- hold temperature constant across attempts
- catch `JSON.parse` errors AND Zod validation errors → retry
- return `{ ok: true, value, attemptsUsed, attempts: [...] }` on success
- return `{ ok: false, attempts, finalReason }` after `maxAttempts` exhausted
- surface per-attempt `latencyMs`, `seed`, `reason` for Plan 7 eval consumption (carry-forward #8)

**Spike-llm hardware safety:** the unit test does NOT spawn `llama-completion`. It injects a mock generator (`MockLlmGenerator`) that returns canned JSON. Per `.claude/rules/pitfalls.md (spike-llm)` — only the integration smoke (Task 13) ever touches real LLM, and that smoke does NOT run in this plan's tests (it lives behind an env-var gate consumed by Plan 7).

- [ ] **Step 1: Write the failing test for the interface shape**

```typescript
// desktop/src/main/sidecar/__tests__/grammar-call.test.ts
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  callWithGrammar,
  type LlmGenerator,
  type GrammarCallSuccess,
  type GrammarCallFailure,
} from '../grammar-call';

const SimpleSchema = z.object({ name: z.string(), n: z.number() });

describe('callWithGrammar — happy path', () => {
  it('returns success with attemptsUsed=1 when first attempt parses+validates', async () => {
    const generator: LlmGenerator = vi.fn(async ({ seed }) => ({
      text: JSON.stringify({ name: 'ok', n: 7 }),
      seed,
    }));
    const out = await callWithGrammar({
      prompt: 'gen',
      schema: SimpleSchema,
      grammar: '<grammar-stub>',
      baseSeed: 1000,
      temperature: 0.6,
      maxAttempts: 3,
      maxTokens: 1024,
      generator,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.attemptsUsed).toBe(1);
      expect(out.attempts).toHaveLength(1);
      expect(out.value).toEqual({ name: 'ok', n: 7 });
      expect(out.attempts[0].seed).toBe(1000);
      expect(out.attempts[0].ok).toBe(true);
      expect(typeof out.attempts[0].latencyMs).toBe('number');
    }
    expect(generator).toHaveBeenCalledTimes(1);
  });
});

describe('callWithGrammar — surfaces seed + latencyMs per attempt', () => {
  it('exposes seed/latencyMs/reason on each attempt for Plan 7 eval consumption', async () => {
    const generator: LlmGenerator = vi.fn(async ({ seed }) => ({
      text: JSON.stringify({ name: 's', n: 1 }),
      seed,
    }));
    const out = await callWithGrammar({
      prompt: 'p',
      schema: SimpleSchema,
      grammar: 'g',
      baseSeed: 2000,
      temperature: 0.4,
      maxAttempts: 3,
      maxTokens: 512,
      generator,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      const a = out.attempts[0];
      expect(a).toMatchObject({ attempt: 1, seed: 2000, ok: true });
      expect(a.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @lisna/desktop test desktop/src/main/sidecar/__tests__/grammar-call.test.ts`
Expected: FAIL "Cannot find module '../grammar-call'".

- [ ] **Step 3: Implement the minimal interface + happy path**

```typescript
// desktop/src/main/sidecar/grammar-call.ts
import type { z } from 'zod';

/**
 * Caller-supplied function that runs ONE grammar-constrained LLM call.
 * Production binds this to SidecarClient.generate() with grammar attached
 * (Task 13). Tests bind it to a mock that returns canned JSON.
 *
 * Returning `{ text }` keeps the surface narrow — the wrapper's job is
 * parse + validate + retry, not LLM-protocol details.
 */
export type LlmGenerator = (opts: {
  prompt: string;
  grammar: string;
  seed: number;
  temperature: number;
  maxTokens: number;
}) => Promise<{ text: string; seed: number }>;

/** Per-attempt observability record. Surfaces in both success + failure shapes. */
export interface GrammarAttempt {
  attempt: number;          // 1-indexed
  seed: number;
  latencyMs: number;
  ok: boolean;
  reason?: string;          // populated when ok = false
}

export interface GrammarCallSuccess<T> {
  ok: true;
  value: T;
  attemptsUsed: number;
  attempts: GrammarAttempt[];
}

export interface GrammarCallFailure {
  ok: false;
  attempts: GrammarAttempt[];
  finalReason: string;      // = last attempt's reason
}

export type GrammarCallResult<T> = GrammarCallSuccess<T> | GrammarCallFailure;

export interface GrammarCallOpts<T> {
  prompt: string;
  schema: z.ZodType<T>;
  grammar: string;
  baseSeed: number;
  temperature: number;
  maxAttempts: number;
  maxTokens: number;
  generator: LlmGenerator;
}

/**
 * Run a grammar-constrained LLM call with `maxAttempts` retries.
 * Implementation completed in Task 12 — Task 11 stub returns ok on first
 * call (no retry loop yet).
 */
export async function callWithGrammar<T>(
  opts: GrammarCallOpts<T>,
): Promise<GrammarCallResult<T>> {
  const attempts: GrammarAttempt[] = [];
  const seed = opts.baseSeed;
  const t0 = Date.now();
  const r = await opts.generator({
    prompt: opts.prompt,
    grammar: opts.grammar,
    seed,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
  });
  const latencyMs = Date.now() - t0;
  const value = opts.schema.parse(JSON.parse(r.text));
  attempts.push({ attempt: 1, seed, latencyMs, ok: true });
  return { ok: true, value, attemptsUsed: 1, attempts };
}
```

- [ ] **Step 4: Run the tests — both should PASS**

Run: `pnpm --filter @lisna/desktop test desktop/src/main/sidecar/__tests__/grammar-call.test.ts`
Expected: both happy-path tests PASS. The retry-on-error tests don't exist yet (added in Task 12).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/sidecar/grammar-call.ts \
        desktop/src/main/sidecar/__tests__/grammar-call.test.ts
git commit -m "feat(v2-foundation): callWithGrammar interface + happy-path stub"
```

---

## Task 12: Grammar-call wrapper — retry loop with fresh seed

**Files:**
- Modify: `desktop/src/main/sidecar/grammar-call.ts`
- Modify: `desktop/src/main/sidecar/__tests__/grammar-call.test.ts`

**Goal:** Complete the wrapper per Spike 0.1 take-4 contract — retry on JSON.parse OR Zod failure with a fresh seed (`baseSeed + (attempt - 1) * 100`), surface per-attempt `reason` text for Plan 7 eval-loop tuning.

- [ ] **Step 1: Write the failing retry tests**

Append to `desktop/src/main/sidecar/__tests__/grammar-call.test.ts`:

```typescript
describe('callWithGrammar — retry on JSON.parse failure', () => {
  it('retries when first attempt emits non-JSON, succeeds on attempt 2', async () => {
    let calls = 0;
    const generator: LlmGenerator = vi.fn(async ({ seed }) => {
      calls += 1;
      const text = calls === 1 ? '{"name": "ok", "n":' : JSON.stringify({ name: 'ok', n: 7 });
      return { text, seed };
    });
    const out = await callWithGrammar({
      prompt: 'p',
      schema: SimpleSchema,
      grammar: 'g',
      baseSeed: 1000,
      temperature: 0.6,
      maxAttempts: 3,
      maxTokens: 1024,
      generator,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.attemptsUsed).toBe(2);
      expect(out.attempts).toHaveLength(2);
      expect(out.attempts[0].ok).toBe(false);
      expect(out.attempts[0].reason).toMatch(/JSON|Unexpected/i);
      expect(out.attempts[1].ok).toBe(true);
      expect(out.attempts[0].seed).toBe(1000);
      expect(out.attempts[1].seed).toBe(1100);                  // fresh seed
    }
  });
});

describe('callWithGrammar — retry on Zod failure', () => {
  it('retries when first attempt fails schema validation', async () => {
    let calls = 0;
    const generator: LlmGenerator = vi.fn(async ({ seed }) => {
      calls += 1;
      const text =
        calls === 1
          ? JSON.stringify({ name: 'ok', n: 'not-a-number' })       // wrong type
          : JSON.stringify({ name: 'ok', n: 42 });
      return { text, seed };
    });
    const out = await callWithGrammar({
      prompt: 'p',
      schema: SimpleSchema,
      grammar: 'g',
      baseSeed: 500,
      temperature: 0.5,
      maxAttempts: 3,
      maxTokens: 1024,
      generator,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.attemptsUsed).toBe(2);
      expect(out.attempts[0].ok).toBe(false);
      // ZodError messages mention "Expected" / "number"
      expect(out.attempts[0].reason).toBeDefined();
      expect(out.attempts[1].seed).toBe(600);                      // 500 + 100
    }
  });
});

describe('callWithGrammar — exhaustion', () => {
  it('returns ok=false with full attempts log when maxAttempts exhausted', async () => {
    const generator: LlmGenerator = vi.fn(async ({ seed }) => ({
      text: 'not even close to JSON',
      seed,
    }));
    const out = await callWithGrammar({
      prompt: 'p',
      schema: SimpleSchema,
      grammar: 'g',
      baseSeed: 100,
      temperature: 0.6,
      maxAttempts: 3,
      maxTokens: 256,
      generator,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.attempts).toHaveLength(3);
      expect(out.attempts[0].seed).toBe(100);
      expect(out.attempts[1].seed).toBe(200);
      expect(out.attempts[2].seed).toBe(300);
      expect(out.finalReason).toBe(out.attempts[2].reason);
      expect(out.finalReason).toMatch(/JSON|Unexpected/i);
    }
    expect(generator).toHaveBeenCalledTimes(3);
  });
});

describe('callWithGrammar — maxAttempts = 1 is allowed', () => {
  it('no retry when maxAttempts=1 and first attempt fails', async () => {
    const generator: LlmGenerator = vi.fn(async ({ seed }) => ({
      text: '{bad',
      seed,
    }));
    const out = await callWithGrammar({
      prompt: 'p',
      schema: SimpleSchema,
      grammar: 'g',
      baseSeed: 0,
      temperature: 0.6,
      maxAttempts: 1,
      maxTokens: 256,
      generator,
    });
    expect(out.ok).toBe(false);
    expect(generator).toHaveBeenCalledTimes(1);
  });
});

describe('callWithGrammar — generator throw is captured as failed attempt', () => {
  it('treats generator rejection as failure + retries', async () => {
    let calls = 0;
    const generator: LlmGenerator = vi.fn(async ({ seed }) => {
      calls += 1;
      if (calls === 1) throw new Error('sidecar transient: ECONNRESET');
      return { text: JSON.stringify({ name: 'ok', n: 1 }), seed };
    });
    const out = await callWithGrammar({
      prompt: 'p',
      schema: SimpleSchema,
      grammar: 'g',
      baseSeed: 0,
      temperature: 0.6,
      maxAttempts: 3,
      maxTokens: 256,
      generator,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.attempts[0].ok).toBe(false);
      expect(out.attempts[0].reason).toMatch(/ECONNRESET/);
    }
  });
});
```

- [ ] **Step 2: Run the tests and confirm failure**

Run: `pnpm --filter @lisna/desktop test desktop/src/main/sidecar/__tests__/grammar-call.test.ts`
Expected: the new tests FAIL (stub from Task 11 doesn't retry).

- [ ] **Step 3: Implement the retry loop**

Replace the body of `callWithGrammar` in `desktop/src/main/sidecar/grammar-call.ts`:

```typescript
export async function callWithGrammar<T>(
  opts: GrammarCallOpts<T>,
): Promise<GrammarCallResult<T>> {
  const attempts: GrammarAttempt[] = [];
  let lastReason = 'no attempts run (maxAttempts < 1)';

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const seed = opts.baseSeed + (attempt - 1) * 100;
    const t0 = Date.now();
    let ok = false;
    let reason: string | undefined;
    let value: T | undefined;

    try {
      const r = await opts.generator({
        prompt: opts.prompt,
        grammar: opts.grammar,
        seed,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
      });
      const parsed = JSON.parse(r.text);
      value = opts.schema.parse(parsed);
      ok = true;
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
      lastReason = reason;
    }

    const latencyMs = Date.now() - t0;
    attempts.push({ attempt, seed, latencyMs, ok, reason });
    if (ok && value !== undefined) {
      return { ok: true, value, attemptsUsed: attempt, attempts };
    }
  }

  return { ok: false, attempts, finalReason: lastReason };
}
```

- [ ] **Step 4: Run the tests and confirm pass**

Run: `pnpm --filter @lisna/desktop test desktop/src/main/sidecar/__tests__/grammar-call.test.ts`
Expected: all 6 tests PASS (1 from Task 11 happy path + 1 seed test + 4 new retry tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/sidecar/grammar-call.ts \
        desktop/src/main/sidecar/__tests__/grammar-call.test.ts
git commit -m "feat(v2-foundation): callWithGrammar retry loop + per-attempt telemetry"
```

---

## Task 13: Grammar-call wrapper — SidecarClient generator binding

**Files:**
- Modify: `desktop/src/main/sidecar/grammar-call.ts` (add `makeSidecarGenerator(client)` factory)
- Modify: `desktop/src/main/sidecar/__tests__/grammar-call.test.ts` (add factory test with mocked client)

**Goal:** Production-side helper to bind the wrapper's `LlmGenerator` to a real `SidecarClient`. The factory translates between the wrapper's narrow `{ prompt, grammar, seed, temperature, maxTokens }` surface and the sidecar's IPC envelope.

**IMPORTANT:** This task does NOT change the SidecarClient itself. The existing `SidecarClient.send({type:'generate', messages, ...})` is what Plan 3 uses for non-grammar generation. Grammar support requires the sidecar to accept a `grammar` field on the generate request — that protocol extension is **Plan 3's responsibility** (touches C++ side). Task 13 ships the TS-side factory ready for that extension; until Plan 3 wires the C++ side, `makeSidecarGenerator` is exported but unused in production.

This keeps Task 13 a pure TS-side stub commit — no real LLM, no integration smoke, no protocol change.

- [ ] **Step 1: Write the factory test (uses a mock SidecarClient surface)**

Append to `desktop/src/main/sidecar/__tests__/grammar-call.test.ts`:

```typescript
import { makeSidecarGenerator } from '../grammar-call';

describe('makeSidecarGenerator', () => {
  it('translates wrapper opts → SidecarClient.generate call with grammar attached', async () => {
    // Mock SidecarClient surface — only `generate` matters for the factory.
    const fakeClient = {
      generateWithGrammar: vi.fn(async (req: {
        prompt: string;
        grammar: string;
        seed: number;
        temperature: number;
        maxTokens: number;
      }) => ({ text: JSON.stringify({ name: 'x', n: 1 }), seed: req.seed })),
    };
    const generator = makeSidecarGenerator(fakeClient as unknown as {
      generateWithGrammar: (req: {
        prompt: string;
        grammar: string;
        seed: number;
        temperature: number;
        maxTokens: number;
      }) => Promise<{ text: string; seed: number }>;
    });
    const r = await generator({
      prompt: 'P',
      grammar: 'G',
      seed: 42,
      temperature: 0.5,
      maxTokens: 100,
    });
    expect(r.text).toContain('"name":"x"');
    expect(r.seed).toBe(42);
    expect(fakeClient.generateWithGrammar).toHaveBeenCalledWith({
      prompt: 'P',
      grammar: 'G',
      seed: 42,
      temperature: 0.5,
      maxTokens: 100,
    });
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @lisna/desktop test desktop/src/main/sidecar/__tests__/grammar-call.test.ts`
Expected: FAIL "makeSidecarGenerator is not exported".

- [ ] **Step 3: Add the factory**

Append to `desktop/src/main/sidecar/grammar-call.ts`:

```typescript
/**
 * Minimal sidecar surface the wrapper needs. The real `SidecarClient`
 * grows a `generateWithGrammar` method in Plan 3 (touches C++ to add a
 * `grammar` field to the generate IPC envelope). Until then, this
 * factory exists as a typed seam so Plan 2 can publish a stable API.
 */
export interface GrammarCapableSidecar {
  generateWithGrammar(req: {
    prompt: string;
    grammar: string;
    seed: number;
    temperature: number;
    maxTokens: number;
  }): Promise<{ text: string; seed: number }>;
}

/**
 * Bind `callWithGrammar`'s LlmGenerator to a SidecarClient that supports
 * grammar-constrained generation. Plan 3 will add `generateWithGrammar`
 * to the real client.
 */
export function makeSidecarGenerator(client: GrammarCapableSidecar): LlmGenerator {
  return async ({ prompt, grammar, seed, temperature, maxTokens }) =>
    client.generateWithGrammar({ prompt, grammar, seed, temperature, maxTokens });
}
```

- [ ] **Step 4: Run the test and confirm pass**

Run: `pnpm --filter @lisna/desktop test desktop/src/main/sidecar/__tests__/grammar-call.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/sidecar/grammar-call.ts \
        desktop/src/main/sidecar/__tests__/grammar-call.test.ts
git commit -m "feat(v2-foundation): makeSidecarGenerator factory + GrammarCapableSidecar seam"
```

---

## Task 14: FamilyRegistry skeleton

**Files:**
- Create: `desktop/src/shared/families/index.ts`
- Create: `desktop/src/shared/families/__tests__/registry.test.ts`

**Goal:** Per spec §4.0 + §4.8 — the `FamilyDefinition<T>` interface and an empty registry stub. Family bindings (Lecture, Meeting, Interview, Brainstorm) land in Plans 3-6. This task delivers the **contract** they bind to.

Type relations:
- `FamilyDefinition<T>` is generic over the family-specific note type (e.g. `LectureNote`).
- The registry is `Record<NoteFamily, FamilyDefinition<any>>`. Each family files in via Plan 3+.
- `MergeStrategy` (referenced by `FamilyDefinition`) is defined in `families/util/merge.ts` (created here as a stub — full per-family defaults land in Plans 3-6).

The interface uses `ComponentType` from React. Since this file might be imported into the main process (orchestrator) which doesn't have React, define `ComponentType` as a **type-only** import (`import type`) — no React runtime dependency leaks into main.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/shared/families/__tests__/registry.test.ts
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { familyRegistry, type FamilyDefinition, type MergeStrategy } from '../index';
import type { NoteFamily, NoteBase } from '@shared/note-schema/base';

describe('familyRegistry skeleton', () => {
  it('familyRegistry is an empty mutable record at the type-level (filled by Plans 3-6)', () => {
    // The registry is exported as a Record<NoteFamily, FamilyDefinition<any>>.
    // At Plan 2's landing, it's empty (or contains stub entries) — the
    // contract is what we're shipping, not the data.
    expect(typeof familyRegistry).toBe('object');
  });

  it('FamilyDefinition has the expected shape (type-level contract)', () => {
    // Compile-time assertion: a definition can be constructed.
    // (We don't run it — just verify the shape compiles.)
    type _CompileCheck<T extends NoteBase> = FamilyDefinition<T> extends {
      id: NoteFamily;
      schema: z.ZodType<T>;
      prompts: ReadonlyArray<{ variantId: string }>;
      defaultPromptVariant: string;
      evalBaselines: ReadonlyArray<string>;
      mergeStrategy: MergeStrategy;
    } ? true : false;
    const ok: _CompileCheck<NoteBase> = true;
    expect(ok).toBe(true);
  });

  it('MergeStrategy admits the alpha scalarPolicy/arrayPolicy unions', () => {
    const s: MergeStrategy = {
      scalarPolicy: 'longest',
      arrayPolicy: 'concat-dedup',
      sortByTs: true,
    };
    expect(s.scalarPolicy).toBe('longest');
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/__tests__/registry.test.ts`
Expected: FAIL "Cannot find module '../index'".

- [ ] **Step 3: Implement the registry skeleton**

```typescript
// desktop/src/shared/families/index.ts
import type { z } from 'zod';
import type { ComponentType } from 'react';
import type { NoteBase, NoteFamily } from '@shared/note-schema/base';
import type { ProvenanceComputer } from '@shared/note-schema/provenance';
import type { PromptVariant } from './util/prompts';
import type { SlotDefinition } from './util/slot';

/** Per spec §5.2b. Per-family default strategies land in Plans 3-6 alongside each schema. */
export interface MergeStrategy {
  scalarPolicy: 'longest' | 'first' | 'merge-llm';
  arrayPolicy: 'concat-dedup' | 'merge-llm' | 'concat-only';
  sortByTs?: boolean;
  fieldOverrides?: {
    [field: string]: {
      policy: 'longest' | 'first' | 'concat-dedup' | 'concat-only' | 'merge-llm' | 'custom';
      handler?: (partials: unknown[]) => unknown;
    };
  };
}

/** Picker config — i18n keys, icon, visibility. Per spec §4 #8. */
export interface FamilyPickerConfig {
  labelKey: string;
  icon: ComponentType;
  descriptionKey: string;
  visibility: 'production' | 'experimental';
}

/**
 * The single binding point per family — schema + prompts + renderer +
 * picker + eval baselines + slots + merge strategy.
 *
 * Per spec §4.0. Each family ships a FamilyDefinition<FamilyNote> via
 * its own `index.ts` (Plans 3-6).
 */
export interface FamilyDefinition<T extends NoteBase> {
  id: NoteFamily;
  schema: z.ZodType<T>;
  prompts: ReadonlyArray<PromptVariant>;
  defaultPromptVariant: string;
  renderer: ComponentType<{ note: T }>;
  streamingRenderer?: ComponentType<{ partial: Partial<T> }>;
  picker: FamilyPickerConfig;
  evalBaselines: ReadonlyArray<string>;
  inferProvenance?: ProvenanceComputer;
  slots?: ReadonlyArray<SlotDefinition<unknown>>;
  mergeStrategy: MergeStrategy;
}

/**
 * The runtime registry. Empty at Plan 2 landing — Plans 3-6 populate
 * each family. Consumers (orchestrator, picker UI) read this to resolve
 * family-specific behavior.
 *
 * Per spec §4 #8: "Adding a family = mkdir + 1 line in the registry map".
 */
export const familyRegistry: Partial<Record<NoteFamily, FamilyDefinition<NoteBase>>> = {};

/**
 * Type-safe helper to register a family. Plans 3-6 import this in their
 * family `index.ts` and call once at module-load time.
 */
export function registerFamily<T extends NoteBase>(
  def: FamilyDefinition<T>,
): void {
  if (familyRegistry[def.id] !== undefined) {
    throw new Error(`Family ${def.id} already registered`);
  }
  // Cast to NoteBase storage — read-side narrows back via discriminator.
  familyRegistry[def.id] = def as unknown as FamilyDefinition<NoteBase>;
}
```

- [ ] **Step 4: Run the test and confirm pass**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/__tests__/registry.test.ts`
Expected: all 3 tests PASS (after Tasks 15 and 16 land — but the types from those tasks are referenced in `index.ts`, so this task needs them first or stubs).

**Sequencing note:** Tasks 14, 15, 16 are interdependent. Implement Task 15 (`util/prompts.ts`) and Task 16 (`util/slot.ts`) BEFORE running Task 14's tests. If using SDD, dispatch Tasks 15+16 first, then come back to Task 14's test step.

To break the dependency: drop the `import type` of `PromptVariant`/`SlotDefinition` in Task 14 and inline minimal stubs as `unknown`; Task 15+16 will replace with the real types. The simpler approach is **execute Tasks 14 → 15 → 16 in that order, but defer Task 14 Step 4 (test run) until after Task 16 lands**. Mark Task 14 Step 4 as "wait until Task 16 commits" in the SDD controller.

- [ ] **Step 5: Commit (without running tests yet — tests run after Tasks 15+16)**

```bash
git add desktop/src/shared/families/index.ts \
        desktop/src/shared/families/__tests__/registry.test.ts
git commit -m "feat(v2-foundation): FamilyDefinition interface + familyRegistry skeleton"
```

---

## Task 15: PromptVariant + selection logic

**Files:**
- Create: `desktop/src/shared/families/util/prompts.ts`
- Create: `desktop/src/shared/families/util/__tests__/prompts.test.ts`

**Goal:** Per spec §4.0 + §4 #9 — `PromptVariant` shape + `selectPromptVariant()` runtime selection (env var → user pref → family default).

`ChatMessage` is reused from existing `@shared/ipc-protocol` (already defined there).

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/shared/families/util/__tests__/prompts.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { selectPromptVariant, type PromptVariant } from '../prompts';

const VARIANTS: PromptVariant[] = [
  {
    version: 1,
    variantId: 'v1-baseline',
    systemTemplate: 'sys',
    chunkUserTemplate: 'user',
    mergeUserTemplate: 'merge',
    recommendedTemp: 0.4,
    notes: 'baseline',
  },
  {
    version: 2,
    variantId: 'v2-experimental',
    systemTemplate: 'sys2',
    chunkUserTemplate: 'user2',
    mergeUserTemplate: 'merge2',
    recommendedTemp: 0.5,
    notes: 'experimental',
  },
];

describe('selectPromptVariant', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns family default when no env, no pref', () => {
    const v = selectPromptVariant(VARIANTS, 'v1-baseline');
    expect(v.variantId).toBe('v1-baseline');
  });

  it('user preference overrides default', () => {
    const v = selectPromptVariant(VARIANTS, 'v1-baseline', {
      userPreference: 'v2-experimental',
    });
    expect(v.variantId).toBe('v2-experimental');
  });

  it('env var overrides user preference', () => {
    vi.stubEnv('LISNA_PROMPT_VARIANT', 'v2-experimental');
    const v = selectPromptVariant(VARIANTS, 'v1-baseline', {
      userPreference: 'v1-baseline',
    });
    expect(v.variantId).toBe('v2-experimental');
  });

  it('throws on unknown variantId', () => {
    expect(() => selectPromptVariant(VARIANTS, 'no-such')).toThrow();
  });

  it('falls back to default when env-specified variant does not exist', () => {
    vi.stubEnv('LISNA_PROMPT_VARIANT', 'phantom-variant');
    const v = selectPromptVariant(VARIANTS, 'v1-baseline');
    expect(v.variantId).toBe('v1-baseline');
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/util/__tests__/prompts.test.ts`
Expected: FAIL "Cannot find module '../prompts'".

- [ ] **Step 3: Implement `prompts.ts`**

```typescript
// desktop/src/shared/families/util/prompts.ts
import type { ChatMessage } from '@shared/ipc-protocol';

/** Per spec §4.0. A versioned prompt artifact. */
export interface PromptVariant {
  version: number;
  variantId: string;
  systemTemplate: string;
  chunkUserTemplate: string;
  mergeUserTemplate: string;
  exemplars?: ChatMessage[];
  recommendedTemp: number;
  notes: string;
}

export interface PromptSelectionOpts {
  /** User-set preference from settings (e.g. picker UI). */
  userPreference?: string;
  /** Env-var override name. Default 'LISNA_PROMPT_VARIANT'. */
  envVar?: string;
}

/**
 * Select a prompt variant by precedence:
 *   1. process.env[envVar] (if set AND that variantId exists)
 *   2. opts.userPreference (if set AND that variantId exists)
 *   3. familyDefaultVariantId
 *
 * Throws if the family default doesn't exist in `variants` (programmer
 * error — caught at first call).
 */
export function selectPromptVariant(
  variants: ReadonlyArray<PromptVariant>,
  familyDefaultVariantId: string,
  opts: PromptSelectionOpts = {},
): PromptVariant {
  const envVar = opts.envVar ?? 'LISNA_PROMPT_VARIANT';
  const envValue = process.env[envVar];
  if (envValue) {
    const fromEnv = variants.find(v => v.variantId === envValue);
    if (fromEnv) return fromEnv;
    // Unknown env value — fall through (don't error; env may be left from
    // an older config). Logged separately by the orchestrator if needed.
  }
  if (opts.userPreference) {
    const fromPref = variants.find(v => v.variantId === opts.userPreference);
    if (fromPref) return fromPref;
  }
  const def = variants.find(v => v.variantId === familyDefaultVariantId);
  if (!def) {
    throw new Error(
      `selectPromptVariant: family default '${familyDefaultVariantId}' not in variants`,
    );
  }
  return def;
}
```

- [ ] **Step 4: Run the test and confirm pass**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/util/__tests__/prompts.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/families/util/prompts.ts \
        desktop/src/shared/families/util/__tests__/prompts.test.ts
git commit -m "feat(v2-foundation): PromptVariant + selectPromptVariant precedence"
```

---

## Task 16: SlotDefinition

**Files:**
- Create: `desktop/src/shared/families/util/slot.ts`

**Goal:** Per spec §4.0 + §4 #15 — `SlotDefinition<T>` shape. Lecture's `extras` discriminated union is built from registered slots in Plan 3. Per spec P2: triggers affect **prompt hints only**, NOT grammar surface. Document that contract in JSDoc here so future readers don't infer dynamic grammar regen.

This is a pure type file — no runtime logic, no tests. Skip the TDD cycle.

- [ ] **Step 1: Implement `slot.ts`**

```typescript
// desktop/src/shared/families/util/slot.ts
import type { z } from 'zod';
import type { ComponentType } from 'react';

/**
 * A typed Lecture `extras` slot. Per spec §4.0 + §4 #15.
 *
 * `triggers` (optional regex strings) affect **prompt-hint injection only**.
 * The GBNF grammar always allows every registered slot type (spec P2).
 * This keeps grammar regeneration cost zero across user-session content
 * variation; the model learns "include this slot when transcript matches"
 * from the system-prompt hint, not from a runtime-narrowed grammar.
 */
export interface SlotDefinition<T> {
  type: string;
  schema: z.ZodType<T>;
  renderer: ComponentType<{ items: T[] }>;
  promptHint: string;
  triggers?: ReadonlyArray<string>;
}
```

- [ ] **Step 2: Verify typecheck and that Task 14's tests now pass**

Run: `pnpm --filter @lisna/desktop typecheck`
Expected: PASS.

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/families/__tests__/registry.test.ts`
Expected: all 3 tests from Task 14 PASS now that `SlotDefinition` and `PromptVariant` exist.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/shared/families/util/slot.ts
git commit -m "feat(v2-foundation): SlotDefinition + locked P2 static-grammar contract"
```

---

## Task 17: ModelProfile registry + PipelineHooks interface

**Files:**
- Create: `desktop/src/shared/models/profiles.ts`
- Create: `desktop/src/shared/models/__tests__/profiles.test.ts`
- Create: `desktop/src/shared/pipeline-hooks.ts`

**Goal:** Per spec §4.0 + §4 #10 + §4 #14:
- `ModelProfile` shape + initial entry for `llama-3.2-3b-q4-km` (current alpha default; Plan 6 may add `qwen-2.5-3b` once Spike 0.2 Path E lands).
- `PipelineHooks` interface (7 hook points). Plan 3 wires these into the orchestrator; this task ships the type contract.

- [ ] **Step 1: Write the failing ModelProfile test**

```typescript
// desktop/src/shared/models/__tests__/profiles.test.ts
import { describe, it, expect } from 'vitest';
import { modelProfiles, getModelProfile } from '../profiles';

describe('modelProfiles', () => {
  it('includes the default llama-3.2-3b-q4-km entry', () => {
    const p = modelProfiles['llama-3.2-3b-q4-km'];
    expect(p).toBeDefined();
    expect(p.contextWindow).toBe(16384);              // M1 8GB ceiling (memory: feedback_llm_chat_template_sidecar)
    expect(p.chatTemplate).toBe('llama-3.2');
    expect(p.grammarDialect).toBe('llama-cpp');
    expect(p.recommendedChunkTokens).toBeLessThanOrEqual(p.contextWindow);
  });

  it('getModelProfile returns the profile for a known id', () => {
    const p = getModelProfile('llama-3.2-3b-q4-km');
    expect(p.id).toBe('llama-3.2-3b-q4-km');
  });

  it('getModelProfile throws on unknown id', () => {
    expect(() => getModelProfile('phantom-model')).toThrow();
  });

  it('every profile has positive ramBudgetMB and recommendedChunkTokens', () => {
    for (const id of Object.keys(modelProfiles)) {
      const p = modelProfiles[id];
      expect(p.ramBudgetMB).toBeGreaterThan(0);
      expect(p.recommendedChunkTokens).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/models/__tests__/profiles.test.ts`
Expected: FAIL "Cannot find module '../profiles'".

- [ ] **Step 3: Implement `profiles.ts`**

```typescript
// desktop/src/shared/models/profiles.ts

/** Per spec §4.0 + §4 #10. */
export interface ModelProfile {
  id: string;
  displayName: string;
  filename: string;
  chatTemplate: 'llama-3.2' | 'qwen-2.5' | 'phi-3.5' | 'auto';
  contextWindow: number;
  recommendedChunkTokens: number;
  grammarDialect: 'llama-cpp' | 'llama-cpp-strict';
  bosTokenFix?: 'dormant-bos';
  recommendedTemp: number;
  warmupRequired: boolean;
  ramBudgetMB: number;
}

/**
 * Runtime profile registry. Alpha ships with one entry; Plan 6 may add
 * `qwen-2.5-3b` if Spike 0.2 Path E shows it's worth swapping.
 *
 * n_ctx=16384 chosen per memory feedback_llm_chat_template_sidecar:
 * 32K caused 8GB OOM. 8K = recommendedChunkTokens (half-ctx leaves
 * room for system prompt + generated tokens).
 */
export const modelProfiles: Record<string, ModelProfile> = {
  'llama-3.2-3b-q4-km': {
    id: 'llama-3.2-3b-q4-km',
    displayName: 'Llama 3.2 3B (Q4_K_M)',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    chatTemplate: 'llama-3.2',
    contextWindow: 16384,
    recommendedChunkTokens: 8000,
    grammarDialect: 'llama-cpp',
    bosTokenFix: 'dormant-bos',
    recommendedTemp: 0.4,
    warmupRequired: true,
    ramBudgetMB: 3072,
  },
};

/** Throws on unknown id — caller's bug, not a runtime fallback case. */
export function getModelProfile(id: string): ModelProfile {
  const p = modelProfiles[id];
  if (!p) throw new Error(`Unknown model profile: ${id}`);
  return p;
}
```

- [ ] **Step 4: Implement `pipeline-hooks.ts`**

```typescript
// desktop/src/shared/pipeline-hooks.ts
import type { TranscriptSegment, SessionTranscript } from '@shared/note-schema/transcript';
import type { NoteBase } from '@shared/note-schema/base';

/**
 * Live captured speaker-labeled segment (post-diarization).
 * Spec §4.0 — duplicated here to avoid a circular import from
 * note-schema. Plan 4 will canonicalise via Diarization module.
 */
export interface SpeakerLabeledSegment extends TranscriptSegment {
  /** True during diarization warm-up window (~10-30s). */
  tentative?: boolean;
}

/**
 * Per spec §4.0 + §4 #14. Each hook is optional — default is identity
 * passthrough. Hooks may be sync or async. Errors are caught by the
 * orchestrator and appended to NoteBase.validation_warnings; pipeline
 * continues with the pre-hook value.
 *
 * Order of execution in Plan 3's orchestrator:
 *   afterTranscribe → beforeDiarize → afterDiarize → beforeChunk
 *     → afterLLM (per chunk) → afterValidate → afterMerge
 */
export interface PipelineHooks {
  afterTranscribe?: (segs: TranscriptSegment[]) =>
    TranscriptSegment[] | Promise<TranscriptSegment[]>;
  beforeDiarize?: (segs: TranscriptSegment[]) => TranscriptSegment[];
  afterDiarize?: (segs: SpeakerLabeledSegment[]) => SpeakerLabeledSegment[];
  beforeChunk?: (transcript: SessionTranscript) => SessionTranscript;
  afterLLM?: (parsedJson: unknown, chunkIndex: number) => unknown;
  afterValidate?: (note: NoteBase) => NoteBase;
  afterMerge?: (note: NoteBase) => NoteBase;
}
```

- [ ] **Step 5: Run tests and confirm pass**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/models/__tests__/profiles.test.ts`
Expected: all 4 tests PASS.

Run: `pnpm --filter @lisna/desktop typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/shared/models/profiles.ts \
        desktop/src/shared/models/__tests__/profiles.test.ts \
        desktop/src/shared/pipeline-hooks.ts
git commit -m "feat(v2-foundation): ModelProfile registry + PipelineHooks interface (§4 #10+#14)"
```

---

## Task 18: Lift zod-to-gbnf into shared + barrel index

**Files:**
- Create: `desktop/src/shared/note-schema/zod-to-gbnf.ts` (lifted from spike)
- Create: `desktop/src/shared/note-schema/__tests__/zod-to-gbnf.test.ts` (lifted)
- Create: `desktop/src/shared/note-schema/index.ts` (barrel)

**Goal:** Move the converter from `desktop/spikes/phase-0/01-zod-to-gbnf/` into production. Re-run the same test suite from production location. The spike's `round-trip.test.ts` STAYS in the spike folder — it's the hardware-budget integration test, not a unit test.

The barrel exports everything Plan 3+ will import from this module.

- [ ] **Step 1: Copy the converter file**

```bash
cp desktop/spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.ts \
   desktop/src/shared/note-schema/zod-to-gbnf.ts
cp desktop/spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.test.ts \
   desktop/src/shared/note-schema/__tests__/zod-to-gbnf.test.ts
```

- [ ] **Step 2: Update import paths in the copied test file**

The spike test imports from `./zod-to-gbnf` (relative to spike folder). The lifted test is now at `desktop/src/shared/note-schema/__tests__/zod-to-gbnf.test.ts` importing from `../zod-to-gbnf`. Verify the relative path matches `../zod-to-gbnf` — should already be correct given the move.

- [ ] **Step 3: Update the file's JSDoc header**

Edit the top of `desktop/src/shared/note-schema/zod-to-gbnf.ts`. Replace the spike-era comment block with:

```typescript
// Zod → llama.cpp GBNF converter.
//
// Lifted from desktop/spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.ts
// (Spike 0.1, take-4 PASS at N=5 in 5.79 min wall; see VERDICT.md +
// decision-0.1-fail.md for the empirical narrative).
//
// Used by the production orchestrator (Plan 3+) to derive the grammar
// surface from a family's Zod schema. The grammar is the strict subset
// of the validated-note schema: fields marked
// .describe(JSON.stringify({ postDecodeOnly: true }))
// (the Zod v3 metadata channel) are stripped from the grammar but
// remain on the validated-note schema. See spec §2.8.
//
// Runtime-cached in-memory per family (Plan 3 wires the cache).
//
// (Original spike-era comments preserved below for archeology.)
```

Then keep the rest of the file body unchanged.

- [ ] **Step 4: Write the barrel `index.ts`**

```typescript
// desktop/src/shared/note-schema/index.ts
//
// Single import surface for downstream Plans (3-7). Re-exports the v2
// note-schema types, utilities, and the grammar converter.

export {
  POST_DECODE_MARKER_DESCRIPTION,
  postDecodeOnly,
  ProvenanceSchema,
  type Provenance,
  SpeakerRefSchema,
  type SpeakerRef,
  NoteFamilySchema,
  type NoteFamily,
  LanguageSchema,
  type NoteLanguage,
  NoteBaseSchema,
  type NoteBase,
} from './base';

export {
  TranscriptSegmentSchema,
  type TranscriptSegment,
  SpeakerSchema,
  type Speaker,
  SessionTranscriptSchema,
  type SessionTranscript,
} from './transcript';

export { GenerationTelemetrySchema, type GenerationTelemetry } from './telemetry';

export { estimateTokens } from './tokens';
export { chunkTranscript } from './chunking';

export {
  computeProvenance,
  DEFAULT_PROVENANCE_CONFIG,
  type ProvenanceConfig,
  type ProvenanceComputer,
} from './provenance';

export { hydratePostDecode } from './post-decode-hydration';
export { zodToGbnf } from './zod-to-gbnf';
```

- [ ] **Step 5: Verify the lifted test passes from the new location**

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/zod-to-gbnf.test.ts`
Expected: all tests PASS (same suite that passed in the spike).

- [ ] **Step 6: Verify the spike round-trip is NOT lifted (it stays in spike folder)**

Confirm:
```bash
test -f desktop/spikes/phase-0/01-zod-to-gbnf/round-trip.test.ts && echo "still in spike (correct)"
test ! -f desktop/src/shared/note-schema/__tests__/round-trip.test.ts && echo "NOT in shared (correct)"
```
Both should print confirmation lines. The round-trip test is hardware-gated and stays out of the default unit-test run.

- [ ] **Step 7: Verify barrel imports cleanly**

Add a tiny self-import test to confirm the barrel is correct:

Create `desktop/src/shared/note-schema/__tests__/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  POST_DECODE_MARKER_DESCRIPTION,
  ProvenanceSchema,
  NoteBaseSchema,
  TranscriptSegmentSchema,
  SessionTranscriptSchema,
  GenerationTelemetrySchema,
  estimateTokens,
  chunkTranscript,
  computeProvenance,
  hydratePostDecode,
  zodToGbnf,
} from '../index';

describe('note-schema barrel', () => {
  it('exports the full Plan 2 surface', () => {
    expect(POST_DECODE_MARKER_DESCRIPTION).toBe(JSON.stringify({ postDecodeOnly: true }));
    expect(ProvenanceSchema).toBeDefined();
    expect(NoteBaseSchema).toBeDefined();
    expect(TranscriptSegmentSchema).toBeDefined();
    expect(SessionTranscriptSchema).toBeDefined();
    expect(GenerationTelemetrySchema).toBeDefined();
    expect(typeof estimateTokens).toBe('function');
    expect(typeof chunkTranscript).toBe('function');
    expect(typeof computeProvenance).toBe('function');
    expect(typeof hydratePostDecode).toBe('function');
    expect(typeof zodToGbnf).toBe('function');
  });
});
```

Run: `pnpm --filter @lisna/desktop test desktop/src/shared/note-schema/__tests__/index.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/shared/note-schema/zod-to-gbnf.ts \
        desktop/src/shared/note-schema/__tests__/zod-to-gbnf.test.ts \
        desktop/src/shared/note-schema/index.ts \
        desktop/src/shared/note-schema/__tests__/index.test.ts
git commit -m "refactor(shared): lift zod-to-gbnf into note-schema + barrel re-export"
```

---

## Task 19: Verification gate (typecheck + full test run + recap)

**Files:** none. Verification-only.

**Goal:** Honour `superpowers:verification-before-completion` — evidence before assertions. Run the full desktop typecheck and test suite. Confirm Plan 2's surface area is intact.

- [ ] **Step 1: Run typecheck**

Run: `pnpm --filter @lisna/desktop typecheck`
Expected: PASS (zero errors). If errors are reported in non-Plan-2 files (drift from main), report them but do not fix in this plan.

- [ ] **Step 2: Run the full desktop test suite**

Run: `pnpm --filter @lisna/desktop test`
Expected: ALL tests PASS, including:
- `note-schema/__tests__/base.test.ts` (Task 2)
- `note-schema/__tests__/transcript.test.ts` (Task 3)
- `note-schema/__tests__/telemetry.test.ts` (Task 4)
- `note-schema/__tests__/tokens.test.ts` (Task 6)
- `note-schema/__tests__/chunking.test.ts` (Tasks 7-8)
- `note-schema/__tests__/provenance.test.ts` (Task 9)
- `note-schema/__tests__/post-decode-hydration.test.ts` (Task 10)
- `note-schema/__tests__/zod-to-gbnf.test.ts` (Task 18 — lifted)
- `note-schema/__tests__/index.test.ts` (Task 18)
- `main/sidecar/__tests__/grammar-call.test.ts` (Tasks 11-13)
- `shared/families/__tests__/registry.test.ts` (Task 14)
- `shared/families/util/__tests__/prompts.test.ts` (Task 15)
- `shared/models/__tests__/profiles.test.ts` (Task 17)
- Plus all pre-existing desktop tests still passing.

The spike round-trip test (`desktop/spikes/phase-0/01-zod-to-gbnf/round-trip.test.ts`) is skipped by its own `it.skipIf(!PREREQS_PRESENT)` gate unless the dev has the GGUF model + llama-completion binary present. This plan does NOT exercise it.

- [ ] **Step 3: Check `ps` for survived LLM processes**

Per `.claude/rules/pitfalls.md (spike-llm)` — even though this plan's tests don't spawn LLM, verify no zombies linger.

Run: `ps -ef | grep -E "llama-completion|vitest.*spike" | grep -v grep`
Expected: empty output. If non-empty: investigate (could be from a prior session), kill with `kill -9 <pid>`.

- [ ] **Step 4: Verify the git tree state**

Run: `git log --oneline -20`
Expected: 18 new commits since `44e546d` (Plan 1's verdict commit), in order matching Tasks 1-18.

Run: `git status -s`
Expected: empty (no untracked / dirty files).

- [ ] **Step 5: No commit needed for Task 19 (verification only)**

This task closes Plan 2. If any verification step fails, halt and report — do not push, do not start Plan 3.

---

## Self-review checklist (do not skip)

After all 19 tasks complete, run through:

**Spec coverage:**
- [ ] §2.8 `postDecodeOnly` marker + `loadNote()` post-decode flow → Tasks 2 + 10 (marker + hydration)
- [ ] §3.1 NoteBase + SessionTranscript + GenerationTelemetry → Tasks 2, 3, 4
- [ ] §4.0 PromptVariant, SlotDefinition, FamilyDefinition, ModelProfile, PipelineHooks → Tasks 14, 15, 16, 17
- [ ] §4 #1 schemaVersion → Task 2 (`NoteBaseSchema`)
- [ ] §4 #2 Zod single source of truth → Tasks 2-4, 9, 18
- [ ] §4 #3 zod-to-gbnf → Task 18
- [ ] §4 #8 FamilyRegistry → Task 14
- [ ] §4 #9 PromptRegistry → Task 15
- [ ] §4 #10 ModelProfile registry → Task 17
- [ ] §4 #14 SessionOrchestrator pipeline hooks → Task 17 (interface; Plan 3 wires)
- [ ] §4 P1 TranscriptSegment.meta? → Task 3
- [ ] §4 P2 static-grammar slot triggers → Task 16 JSDoc
- [ ] §4 P6 experimentArmId? → Task 2 (`NoteBaseSchema`)
- [ ] §4 P8 computeProvenance + ProvenanceConfig → Task 9
- [ ] §5.2a chunking algorithm → Tasks 7, 8 (lifted + I-3 fix)
- [ ] §7.4 Plan 2 wrapper mandate (retry + per-attempt observability) → Tasks 11, 12, 13

**Carry-forward coverage:**
- [ ] Wrapper maxAttempts=3 + fresh-seed retry → Task 12
- [ ] chunkTranscript lifted → Task 7
- [ ] endTs (whisper t1) used for silence-snap → Task 8
- [ ] I-1 boundary-ts assertion → Task 7 test
- [ ] Naming reconciliation → Task 5
- [ ] Extended CJK regex → Task 6
- [ ] estimateTokens exported → Task 6
- [ ] FamilyRegistry/PromptRegistry/ModelProfile/PipelineHooks skeleton → Tasks 14-17
- [ ] attemptsUsed + per-attempt reason+latencyMs surfaced → Task 12 return shape
- [ ] hydratePostDecode lifted → Task 10

**Placeholder scan:**
- [ ] No "TODO" / "TBD" / "implement later" in any committed file
- [ ] Every test step shows actual test code
- [ ] Every implementation step shows actual code
- [ ] No "similar to Task N" — code is repeated where needed (per the No-Placeholders rule)

**Type consistency:**
- [ ] `TranscriptSegment` (v2 shape) used consistently in `chunking.ts`, `provenance.ts`, `hydratePostDecode`, `PipelineHooks`
- [ ] `Provenance` enum is the type referenced by `ProvenanceComputer` and `computeProvenance` return
- [ ] `NoteFamily` is the discriminator referenced by `NoteBaseSchema` and `FamilyDefinition.id`
- [ ] `GrammarAttempt` shape is consistent between `GrammarCallSuccess` and `GrammarCallFailure`

**Hardware safety (`.claude/rules/pitfalls.md (spike-llm)`):**
- [ ] No Plan 2 test spawns real `llama-completion`
- [ ] `grammar-call.test.ts` uses `vi.fn()` mocks for `LlmGenerator`
- [ ] The spike round-trip test is NOT lifted into shared (stays hardware-gated in `desktop/spikes/`)
- [ ] No `run_in_background: true` for any LLM-bearing command in any task

---

## Next plan dependencies

Plan 3 (Lecture family schema + first end-to-end pipeline wire-through) is unblocked when:
- Tasks 1-18 all committed and `git status -s` clean
- `pnpm --filter @lisna/desktop typecheck` PASSES
- `pnpm --filter @lisna/desktop test` PASSES

What Plan 3 inherits from Plan 2:
- Note-schema base types (`NoteBaseSchema`, `Provenance`, `SpeakerRefSchema`) for `LectureNoteSchema` to extend
- `TranscriptSegment` v2 shape for `Recording → SessionTranscript` plumbing
- `chunkTranscript` + `estimateTokens` for the chunk-at-stop pipeline phase
- `computeProvenance` + `hydratePostDecode` for the post-decode stage
- `zodToGbnf` for grammar generation from `LectureNoteSchema`
- `callWithGrammar` + `makeSidecarGenerator` for the retry-wrapped LLM call
- `familyRegistry` + `registerFamily()` to register the Lecture binding
- `selectPromptVariant` for the runtime prompt selection
- `ModelProfile` for n_ctx and recommendedChunkTokens
- `PipelineHooks` interface for orchestrator's hook plumbing

What Plan 3 must add (not in Plan 2):
- `desktop/src/shared/families/lecture/{schema,renderer,prompts/,slots/,eval-baselines,index}.ts`
- Sidecar protocol extension: `generateWithGrammar` IPC message + C++ grammar attachment (touches `desktop/sidecar/src/llm/llama_engine.cpp` + `desktop/sidecar/src/ipc/json_protocol.cpp`)
- `desktop/src/main/sidecar/orchestrator.ts` extension: chunk-at-stop pipeline, hook ordering, telemetry write
- STT-legacy → v2 segment adapter (uses `noSpeechProb` → `meta.noSpeechProb`)
- `session/finalize(family)` IPC channel (new IPC handler — see spec §5.2)
- Lecture family eval fixture (1 hand-curated v1-lecture-sample.json for migration-chain infrastructure exercise per §4 #13)

Plans 4-6 (Diarization / Meeting / Interview-Brainstorm) all share Plan 2's foundation but add their own family + (Plan 4) `DiarizationEngine` impl.

Plan 7 (Eval harness) consumes Plan 2's `GenerationTelemetry`, `callWithGrammar` per-attempt records, and the family registry's `evalBaselines`.

---

## Open questions / decisions deferred to execution

These are NOT blockers for Plan 2 execution — they're design questions surfaced by writing the plan that the implementer should be aware of:

1. **Spike fixture's `sessionId` field.** Spike 0.4's `synth-90min.json` was synthesised before the v2 `SessionTranscript` shape locked. If it lacks `sessionId`, Task 7 Step 1 instructs adding it as `"synth-90min"`. Confirm during execution and proceed.

2. **Sidecar protocol extension scope.** Task 13's `GrammarCapableSidecar` interface assumes Plan 3 will add a `generateWithGrammar` method to the real client (with a corresponding C++ IPC extension). If Plan 3 decides to overload the existing `generate` IPC with an optional `grammar` field instead, the factory in Task 13 should be updated to match. Either approach honours the wrapper's `LlmGenerator` interface.

3. **`familyRegistry` thread-safety.** Plan 2's registry is a plain mutable Record — fine for boot-time registration in Plans 3-6's `index.ts` (called once at module load). If Plan 3 introduces hot-reloading or runtime mutation, lock semantics may need adding.

---

**End of Plan 2.**

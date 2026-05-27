# Lisna v2 — Plan 3: Lecture pipeline (first family end-to-end)

**Branch:** `spec/v2-note-creation-design` (HEAD at Plan 6 commit `761cd36` or later)
**Depends on:** Plan 1 PASS (Phase 0 spikes), Plan 2 (Foundation infrastructure), Plan 7 fixture format (Plan 7 task 1 baselines schema)
**Independent of:** Plan 4 (Lecture is single-speaker, NoOp diarization), Plan 5, Plan 6
**Unblocks:** Plan 5 (orchestrator extension pattern reused), Plan 6 (same), Plan 7 (Lecture frozen baseline lands)

Plan 3 lands the FIRST family end-to-end. After Plan 3, the chunked-at-end Lecture flow works: Recording → Stop → family picker (Lecture selected) → STT finalize + LLM load → chunkTranscript → per-chunk grammar-constrained call → deterministic merge → Zod-validated `LectureNote` → Markdown render → persist to `~/Library/Application Support/@lisna/desktop/sessions/<id>/`.

Lecture is the simplest family (single-speaker, no diarization, deterministic merge — `concat-dedup` per spec §5.2b, zero second LLM call). It's the pathfinder for the orchestrator + renderer + migration patterns reused by Plans 5/6.

---

## Carry-forward → Task mapping

| # | Source | Task(s) |
|---|---|---|
| 1 | Spec §3.3 LectureNote schema + §3.1 NoteBase | Task 1 (Zod schema), Task 2 (slot definitions) |
| 2 | Spec §3.5 / §3.6 `.max(N)` bounds + Path G | Task 1 (all arrays `.max()`), Task 5 (MAX_TOKENS reduced 4096 → 3000) |
| 3 | Spec §4 P1 FamilyRegistry registration | Task 3 (Lecture FamilyDefinition + register) |
| 4 | Spike 0.2 anti-parroting (reviewer Important #4 from Path E memo) | Task 4 (prompt builder — shape descriptions, no literal exemplars) |
| 5 | Spec §5.2b Lecture MergeStrategy | Task 6 (MergeStrategy), Task 7 (deterministic merge) |
| 6 | Spec §5.2 Stop phase orchestration | Task 8 (post-decode pipeline), Task 9 (orchestrator branch), Task 10 (`session/finalize` IPC) |
| 7 | Spec §5.3 Render phase + §3.1 NoteBase migration | Task 11 (renderer), Task 13 (loadNote + first migration chain) |
| 8 | Spec §5.1 family picker integration | Task 12 (UI Recording → Stop → picker → progress → render) |
| 9 | Plan 2 Task 9 `computeProvenance` consumption | Task 8 (post-decode pipeline Stage 3) |
| 10 | Plan 7 `evalBaselines` startup validator (Plan 7 Task 23) | Task 14 (Lecture baseline registration) |
| 11 | Path F load-bearing — 3B Lecture default, prompt design produces slot emergence | Task 4 (prompt) + Task 15 (E2E gate `slotsEmerged ≥ 1` against existing baseline) |
| 12 | Spike 0.2 v0 baseline (3 result JSONs) is Lecture's first frozen baseline | Task 14 (lift to `desktop/tests/fixtures/baselines/lecture/spike-0.2-v0.baseline.json`) |
| 13 | Task 0 verifies Plan 2 dependencies present before any work | Task 0 (pre-flight) |
| 14 | Verification gate (typecheck + full test run) before declaring DONE | Task 16 |

---

## File structure (delta only — what this plan touches)

```
desktop/src/shared/families/lecture/
├── index.ts                         (T3 — register; default export `LectureFamily`)
├── schema.ts                        (T1 — Zod LectureNote + `.max(N)` annotations)
├── slots/
│   ├── index.ts                     (T2 — barrel; registered slots array)
│   ├── procedure-steps.ts           (T2)
│   ├── argument-chain.ts            (T2)
│   ├── formula.ts                   (T2)
│   └── timeline.ts                  (T2)
├── prompts/
│   ├── v1.ts                        (T4 + T5 — PromptVariant: system + chunkUserTemplate)
│   └── index.ts                     (T4 — variant registry; default v1)
├── merge.ts                         (T6 — Lecture MergeStrategy)
├── renderer.tsx                     (T11 — JSX renderer)
└── migrations/
    ├── index.ts                     (T13 — chain registry)
    └── v1-fixture.json              (T13 — first v1 sample, exercises chain runner)

desktop/src/main/sidecar/
├── orchestrator.ts                  (T9 modify — `family === 'lecture'` branch)
└── ipc/session-finalize.ts          (T10 new — `session/finalize` channel)

desktop/src/shared/post-decode/
├── pipeline.ts                      (T8 new — Stage 1-5 per spec §5.2)
└── deterministic-merge.ts           (T7 new — trigram Jaccard dedup + concat)

desktop/src/renderer/                (T12 modify)
├── App.tsx                          (Recording.tsx → Stop → FamilyPickerStep → NoteView wire)
├── components/
│   ├── FamilyPickerStep.tsx         (T12 new)
│   └── NoteRenderProgress.tsx       (T12 new — "Processing chunk X/N")

desktop/tests/fixtures/baselines/lecture/
└── spike-0.2-v0.baseline.json       (T14 — Spike 0.2 3-run frozen baseline)

desktop/src/integration/             (T15 new — hardware-gated)
└── lecture-e2e.test.ts              (LISNA_LLM_INTEGRATION=1)
```

**Untouched** (intentionally): root `/shared/` package (HTTP-wire territory for frozen extension per CLAUDE.md scope freeze); `desktop/src/main/audio/` capture path; `desktop/src/main/picker/` for diarization (Lecture uses NoOp); v1 alpha note storage (v1 path stays operational alongside v2 for any user with v1 notes).

---

## Pre-flight (Task 0)

### Task 0: Verify Plan 2 dependencies present + branch state

**Files:** none (read + verification only).

- [ ] **Step 1: Verify branch + HEAD**
```bash
cd /Users/guntak/Lisna
git branch --show-current   # must show: spec/v2-note-creation-design
git log -1 --oneline        # must show Plan 2 OR later (≥ 675479b)
```

- [ ] **Step 2: Verify Plan 2 outputs present on disk**
```bash
ls desktop/src/shared/note-schema/index.ts                   # Task 2 output (NoteBase + Provenance + SpeakerRef)
ls desktop/src/shared/note-schema/session-transcript.ts      # Task 3 output (SessionTranscript + v2 TranscriptSegment)
ls desktop/src/shared/note-schema/telemetry.ts               # Task 4 output (GenerationTelemetry)
ls desktop/src/shared/note-schema/estimate-tokens.ts         # Task 6 output (extended CJK regex + exported)
ls desktop/src/shared/note-schema/chunk-transcript.ts        # Task 7 output (moved from spike)
ls desktop/src/shared/note-schema/compute-provenance.ts      # Task 9 output
ls desktop/src/shared/note-schema/hydrate-post-decode.ts     # Task 10 output (lifted)
ls desktop/src/shared/note-schema/grammar-call-wrapper.ts    # Task 11-13 output
ls desktop/src/shared/families/index.ts                      # Task 14 output (FamilyRegistry + registerFamily)
ls desktop/src/shared/note-schema/prompt-variant.ts          # Task 15 output
ls desktop/src/shared/note-schema/slot-definition.ts         # Task 16 output
ls desktop/src/shared/note-schema/model-profile.ts           # Task 17 output (ModelProfile + PipelineHooks)
ls desktop/src/shared/note-schema/zod-to-gbnf.ts             # Task 18 output (lifted converter; Plan 6 T17 extends for `.max(N)`)
```

If any path is missing, **STOP**. Plan 2 must complete first. Do not proceed.

- [ ] **Step 3: Verify typecheck is green at HEAD**
```bash
cd /Users/guntak/Lisna/desktop
pnpm exec tsc --noEmit 2>&1 | tail -5
```
Expect exit 0. If errors, fix in Plan 2 amendment commits BEFORE starting Plan 3 work.

- [ ] **Step 4: Verify Path G converter extension status**

Plan 6 Task 17 owns the converter extension to emit bounded GBNF when `.max(N)` is present. Plan 3 SCHEMA tasks (Task 1 + Task 2) require this to exist — otherwise the `.max(N)` annotations on Lecture arrays will not propagate to grammar.

If Plan 6 Task 17 has NOT landed yet:
- Option A (recommended): block Plan 3 Task 5 (where the grammar gets generated for the first runtime use) on Plan 6 Task 17. Tasks 1-4 + Tasks 6-16 can still proceed (schema annotations are non-breaking; grammar regeneration happens at orchestrator boot which Plan 3 Task 9 handles).
- Option B: temporarily emit unbounded grammar in Plan 3 Task 5 and add a `// FIXME(plan-6-task-17): switch to bounded emission` comment; backfill in a follow-up commit.

**Commit:** none (read-only).

---

## Phase A — Schema + slot definitions (Tasks 1-3)

### Task 1: `LectureNote` Zod schema with `.max(N)` bounds

**Goal:** Produce the Zod schema for `LectureNote` matching spec §3.3, extending `NoteBase` from Plan 2, with `.max(N)` annotations on every array per Path G.

**Files:**
- Create: `desktop/src/shared/families/lecture/schema.ts`
- Create: `desktop/src/shared/families/lecture/schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

```typescript
// schema.test.ts
import { describe, it, expect } from 'vitest';
import { LectureNoteSchema } from './schema';

describe('LectureNoteSchema', () => {
  it('parses a minimal valid lecture note', () => {
    const minimal = {
      schemaVersion: 1,
      family: 'lecture',
      title: '電磁ポテンシャル入門',
      generatedAt: '2026-05-27T12:00:00.000Z',
      generatedBy: { model: 'Llama-3.2-3B-Q4_K_M', promptVersion: 1 },
      language: 'ja',
      durationSec: 3220,
      sections: [
        {
          heading: '導入',
          ts: 0,
          summary: '静電ポテンシャルの定義',
          key_terms: [],
          examples: [],
          points: [],
        },
      ],
    };
    expect(() => LectureNoteSchema.parse(minimal)).not.toThrow();
  });

  it('rejects notes missing required NoteBase fields', () => {
    expect(() => LectureNoteSchema.parse({ family: 'lecture' })).toThrow();
  });

  it('rejects wrong family discriminator', () => {
    const bad = { /* otherwise valid */ family: 'meeting', schemaVersion: 1 };
    expect(() => LectureNoteSchema.parse(bad)).toThrow();
  });

  it('enforces .max(N) on sections array (Path G)', () => {
    const tooManySections = {
      schemaVersion: 1, family: 'lecture', title: 't',
      generatedAt: '2026-05-27T12:00:00.000Z',
      generatedBy: { model: 'm', promptVersion: 1 },
      language: 'ja', durationSec: 1,
      sections: Array.from({ length: 11 }, (_, i) => ({
        heading: `s${i}`, ts: i, summary: '',
        key_terms: [], examples: [], points: [],
      })),
    };
    expect(() => LectureNoteSchema.parse(tooManySections)).toThrow(/sections/i);
  });

  it('enforces .max(N) on key_terms (Path G)', () => {
    // 13 key_terms exceeds .max(12)
    const tooManyTerms = {
      /* ... 13 terms in sections[0].key_terms ... */
    };
    expect(() => LectureNoteSchema.parse(tooManyTerms)).toThrow(/key_terms/i);
  });

  it('hydrates Provenance "inferred" on key_terms without `from`', () => {
    // After post-decode (handled in Task 8 / Plan 2 Task 10), but schema requires `from`
    // present. Confirm the schema rejects raw LLM output that lacks `from`.
    const noFrom = { /* note with key_terms[0] missing `from` */ };
    expect(() => LectureNoteSchema.parse(noFrom)).toThrow(/from/i);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `schema.ts`**

```typescript
// schema.ts
import { z } from 'zod';
import { NoteBase } from '../../note-schema';        // Plan 2 Task 2
import { ProvenanceSchema } from '../../note-schema'; // Plan 2 Task 2
import { LectureSlotInstanceSchema } from './slots';  // Task 2 output

// Bounds calibrated per spec §3.5/§3.6 + Path G memo (real Lecture content,
// not arbitrary). See `decision-0.2-path-f.md` for the runaway-tail risk
// that makes these mandatory rather than aspirational.
const MAX_SECTIONS = 10;
const MAX_KEY_TERMS_PER_SECTION = 12;
const MAX_EXAMPLES_PER_SECTION = 10;
const MAX_POINTS_PER_SECTION = 20;
const MAX_EXTRAS_PER_SECTION = 8;
const MAX_TITLE_CHARS = 200;
const MAX_HEADING_CHARS = 120;

export const LectureSectionSchema = z.object({
  heading: z.string().min(1).max(MAX_HEADING_CHARS),
  ts: z.number().nonnegative(),
  summary: z.string().min(0),
  takeaway: z.string().optional(),
  key_terms: z
    .array(
      z.object({
        term: z.string().min(1),
        definition: z.string().min(0),
        ts: z.number().nonnegative(),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_KEY_TERMS_PER_SECTION),
  examples: z
    .array(
      z.object({
        text: z.string().min(1),
        ts: z.number().nonnegative(),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_EXAMPLES_PER_SECTION),
  points: z
    .array(
      z.object({
        text: z.string().min(1),
        ts: z.number().nonnegative(),
        important: z.boolean(),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_POINTS_PER_SECTION),
  extras: z.array(LectureSlotInstanceSchema).max(MAX_EXTRAS_PER_SECTION).optional(),
});

export const LectureNoteSchema = NoteBase.extend({
  family: z.literal('lecture'),
  course: z.string().optional(),
  lecturer: z.string().optional(),
  tldr: z.string().optional(),
  sections: z.array(LectureSectionSchema).max(MAX_SECTIONS),
}).strict();

// Exports for renderer + migration + eval:
export type LectureNote = z.infer<typeof LectureNoteSchema>;
export type LectureSection = z.infer<typeof LectureSectionSchema>;
```

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/shared/families/lecture/schema.ts \
        desktop/src/shared/families/lecture/schema.test.ts
git commit -m "feat(v2-lecture): LectureNote schema with .max(N) bounds (Path G)"
```

### Task 2: Lecture slot definitions (4 initial slots)

**Goal:** Define the 4 Lecture extras slot types (procedure_steps, argument_chain, formula, timeline) per spec §3.3, using Plan 2 Task 16's `SlotDefinition` type.

**Files:**
- Create: `desktop/src/shared/families/lecture/slots/index.ts`
- Create: `desktop/src/shared/families/lecture/slots/procedure-steps.ts`
- Create: `desktop/src/shared/families/lecture/slots/argument-chain.ts`
- Create: `desktop/src/shared/families/lecture/slots/formula.ts`
- Create: `desktop/src/shared/families/lecture/slots/timeline.ts`
- Create: `desktop/src/shared/families/lecture/slots/slots.test.ts`

- [ ] **Step 1: Failing slot dispatch test**

```typescript
// slots.test.ts
import { describe, it, expect } from 'vitest';
import { LectureSlotInstanceSchema, LECTURE_SLOTS } from './index';

describe('LECTURE_SLOTS', () => {
  it('registers exactly 4 slots', () => {
    expect(LECTURE_SLOTS).toHaveLength(4);
    expect(LECTURE_SLOTS.map((s) => s.kind)).toEqual([
      'procedure_steps',
      'argument_chain',
      'formula',
      'timeline',
    ]);
  });

  it('parses a procedure_steps instance', () => {
    const inst = {
      kind: 'procedure_steps',
      steps: [
        { order: 1, text: '材料を準備する', ts: 30, from: 'transcript' },
        { order: 2, text: '混ぜる', ts: 45, from: 'transcript' },
      ],
    };
    expect(() => LectureSlotInstanceSchema.parse(inst)).not.toThrow();
  });

  it('parses a formula instance with LaTeX-like expression', () => {
    const inst = {
      kind: 'formula',
      expression: '\\nabla \\cdot E = \\rho / \\epsilon_0',
      label: 'ガウスの法則',
      ts: 120,
      from: 'transcript',
    };
    expect(() => LectureSlotInstanceSchema.parse(inst)).not.toThrow();
  });

  it('rejects an unknown slot kind', () => {
    expect(() =>
      LectureSlotInstanceSchema.parse({ kind: 'mystery_meat', text: 'x' }),
    ).toThrow();
  });

  it('enforces .max(N) on procedure_steps.steps (Path G)', () => {
    const tooManySteps = {
      kind: 'procedure_steps',
      steps: Array.from({ length: 21 }, (_, i) => ({
        order: i + 1, text: `step ${i + 1}`, ts: i, from: 'inferred',
      })),
    };
    expect(() => LectureSlotInstanceSchema.parse(tooManySteps)).toThrow(/steps/i);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement each slot**

`procedure-steps.ts`:
```typescript
import { z } from 'zod';
import { ProvenanceSchema } from '../../../note-schema';
import { defineSlot } from '../../../note-schema/slot-definition'; // Plan 2 Task 16

const MAX_STEPS = 20;

export const ProcedureStepsSchema = z.object({
  kind: z.literal('procedure_steps'),
  steps: z
    .array(
      z.object({
        order: z.number().int().positive(),
        text: z.string().min(1),
        ts: z.number().nonnegative(),
        from: ProvenanceSchema,
      }),
    )
    .min(1)
    .max(MAX_STEPS),
});

export const procedureStepsSlot = defineSlot({
  kind: 'procedure_steps',
  schema: ProcedureStepsSchema,
  triggers: ['手順', '工程', '次に', 'まず', '最後に', 'ステップ'],   // injected into prompt only — see spec §4 P2 static-grammar semantics
  promptHint:
    'If the lecture describes an ordered procedure (recipe / algorithm / lab protocol), emit a procedure_steps extra with each step in order.',
});
```

`formula.ts`:
```typescript
import { z } from 'zod';
import { ProvenanceSchema } from '../../../note-schema';
import { defineSlot } from '../../../note-schema/slot-definition';

const MAX_EXPRESSION_CHARS = 240;

export const FormulaSchema = z.object({
  kind: z.literal('formula'),
  expression: z.string().min(1).max(MAX_EXPRESSION_CHARS),
  label: z.string().optional(),
  derivation_steps: z.array(z.string()).max(8).optional(),
  ts: z.number().nonnegative(),
  from: ProvenanceSchema,
});

export const formulaSlot = defineSlot({
  kind: 'formula',
  schema: FormulaSchema,
  triggers: ['式', '公式', '方程式', 'イコール', 'パイ', 'シグマ', 'インテグラル'],
  promptHint:
    'If the lecture writes or speaks a mathematical formula, emit a formula extra. CRITICAL: the expression field MUST be the formula AS SPOKEN/WRITTEN in the lecture (LaTeX-style fine). NEVER use a generic placeholder like "E=mc^2" unless the lecture is literally about that formula. If the lecture content doesn\'t contain a formula, do not invent one.',
});
```

`argument-chain.ts`:
```typescript
import { z } from 'zod';
import { ProvenanceSchema } from '../../../note-schema';
import { defineSlot } from '../../../note-schema/slot-definition';

const MAX_CLAIMS = 10;

export const ArgumentChainSchema = z.object({
  kind: 'argument_chain',
  claims: z
    .array(
      z.object({
        order: z.number().int().positive(),
        text: z.string().min(1),
        supports?: z.array(z.number().int().nonnegative()).max(5).optional(),  // refs other claim orders
        ts: z.number().nonnegative(),
        from: ProvenanceSchema,
      }),
    )
    .min(2)
    .max(MAX_CLAIMS),
});

export const argumentChainSlot = defineSlot({
  kind: 'argument_chain',
  schema: ArgumentChainSchema,
  triggers: ['したがって', 'なぜなら', '前提', '結論', 'よって'],
  promptHint:
    'If the lecture builds a multi-step argument (each step depending on a previous claim), emit an argument_chain extra with claims in order.',
});
```

`timeline.ts`:
```typescript
import { z } from 'zod';
import { ProvenanceSchema } from '../../../note-schema';
import { defineSlot } from '../../../note-schema/slot-definition';

const MAX_EVENTS = 15;

export const TimelineSchema = z.object({
  kind: 'timeline',
  events: z
    .array(
      z.object({
        when: z.string().min(1),  // free-form: '1991年' / '20世紀初頭' / etc.
        text: z.string().min(1),
        ts: z.number().nonnegative(),
        from: ProvenanceSchema,
      }),
    )
    .min(2)
    .max(MAX_EVENTS),
});

export const timelineSlot = defineSlot({
  kind: 'timeline',
  schema: TimelineSchema,
  triggers: ['年', '世紀', '初頭', '末期', '時代'],
  promptHint:
    'If the lecture references multiple historical events with dates, emit a timeline extra with the events in chronological order.',
});
```

`slots/index.ts`:
```typescript
import { z } from 'zod';
import { procedureStepsSlot, ProcedureStepsSchema } from './procedure-steps';
import { argumentChainSlot, ArgumentChainSchema } from './argument-chain';
import { formulaSlot, FormulaSchema } from './formula';
import { timelineSlot, TimelineSchema } from './timeline';

export const LECTURE_SLOTS = [
  procedureStepsSlot,
  argumentChainSlot,
  formulaSlot,
  timelineSlot,
] as const;

export const LectureSlotInstanceSchema = z.discriminatedUnion('kind', [
  ProcedureStepsSchema,
  ArgumentChainSchema,
  FormulaSchema,
  TimelineSchema,
]);
```

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/shared/families/lecture/slots/
git commit -m "feat(v2-lecture): 4 slot definitions (procedure_steps, argument_chain, formula, timeline)"
```

### Task 3: Lecture `FamilyDefinition` + registration

**Goal:** Wrap the schema + slots + (placeholder) prompt + (placeholder) renderer + (placeholder) merge into a `FamilyDefinition` and register with Plan 2's `FamilyRegistry`.

**Files:**
- Create: `desktop/src/shared/families/lecture/index.ts`
- Create: `desktop/src/shared/families/lecture/family.test.ts`

- [ ] **Step 1: Failing registration test**

```typescript
// family.test.ts
import { describe, it, expect } from 'vitest';
import { familyRegistry } from '../index';   // Plan 2 Task 14 FamilyRegistry
import './index';                             // side-effect register

describe('Lecture family registration', () => {
  it('registers under key "lecture"', () => {
    const fam = familyRegistry.get('lecture');
    expect(fam).toBeDefined();
    expect(fam.family).toBe('lecture');
    expect(fam.requiresDiarization).toBe(false);
  });

  it('exposes 4 slots', () => {
    const fam = familyRegistry.get('lecture');
    expect(fam.slots.map((s) => s.kind)).toEqual([
      'procedure_steps', 'argument_chain', 'formula', 'timeline',
    ]);
  });

  it('exposes schema + default prompt variant + merge strategy', () => {
    const fam = familyRegistry.get('lecture');
    expect(fam.schema).toBeDefined();
    expect(fam.prompts.default).toBeDefined();
    expect(fam.mergeStrategy.scalarPolicy).toBe('longest');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement registration**

```typescript
// index.ts
import { registerFamily, FamilyDefinition } from '../index';
import { LectureNoteSchema } from './schema';
import { LECTURE_SLOTS } from './slots';
import { lectureMergeStrategy } from './merge';                  // Task 6 output (placeholder for now)
import { lecturePromptsV1 } from './prompts/v1';                 // Task 4 output (placeholder for now)
import { LectureRenderer } from './renderer';                    // Task 11 output (placeholder for now)

export const LectureFamily: FamilyDefinition = {
  family: 'lecture',
  schema: LectureNoteSchema,
  slots: LECTURE_SLOTS,
  prompts: { default: lecturePromptsV1, v1: lecturePromptsV1 },
  mergeStrategy: lectureMergeStrategy,
  renderer: LectureRenderer,
  requiresDiarization: false,                                    // Lecture is single-speaker
};

registerFamily(LectureFamily);
```

NOTE: Tasks 4 / 6 / 11 produce the placeholder modules referenced above. Task 3's commit MAY land before those modules exist — order the import additions per the dependency: Task 4 lands first (`prompts/v1`), then Task 6 (`merge`), then Task 11 (`renderer`). Until then, mock with `const lecturePromptsV1: PromptVariant = { variantId: 'lecture-v1', system: '', chunkUserTemplate: '' }` etc., committed as TODO scaffolding alongside Task 3.

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/shared/families/lecture/index.ts \
        desktop/src/shared/families/lecture/family.test.ts
git commit -m "feat(v2-lecture): FamilyDefinition registration (single-speaker, no diarization)"
```

---

## CHECKPOINT (founder gate) — fork app-design session?

**STOP after Task 3 commits. Do NOT proceed to Task 4 without founder
acknowledgement.**

Phase A (Tasks 1-3) is the **contract-freeze point** for app-design:
- `LectureNote` schema + slots are now locked
- `LectureFamily.renderer: ComponentType<{note: LectureNote}>` slot exists
  (still stub / undefined-pending — Task 11 fills it)

Per the `.claude/lanes.md` app-design lane and the 2026-05-28
post-Plan-2 design discussion, this is the right moment to fork a
parallel app-design session so the renderer work proceeds while
ai-infra continues Phases B-E (Tasks 4-16).

**The decision to present to founder (with both options spelled out):**

- **(A) Fork now** — create `.claude/worktrees/app-design` from current
  branch, launch a new Claude session in that worktree to work
  `desktop/src/renderer/` (LectureRenderer + UI integration =
  Plan 3 Tasks 11-12, formally re-homed to app-design lane).
  This session continues with Phase B (Tasks 4-10) in parallel.
  Setup commands in `.claude/lanes.md` "App design" entry.

- **(B) Sequential** — stay in this session, complete all of Plan 3
  Phases B-E linearly. Renderer work (Tasks 11-12) lands inside
  ai-infra lane as cross-lane edits with `Cross-lane:` trailer.
  No design-session overhead, but no parallel speed-up.

After founder picks A or B, **explicitly note the decision in a memory
entry** (e.g. `v2_plan3_fork_decision_<date>.md`) so subsequent sessions
inherit the choice, then proceed.

If A: this session continues from Task 4 (Phase B). The new app-design
session reads `.claude/lanes.md`, picks up Plan 3 Tasks 11-12 spec, and
implements LectureRenderer against the now-locked `LectureNote` schema.

If B: this session continues from Task 4 straight through Task 16.

---

## Phase B — Prompts (Tasks 4-5)

### Task 4: Lecture system prompt + chunkUserTemplate (PromptVariant v1)

**Goal:** Build the `PromptVariant` (Plan 2 Task 15 type) for Lecture v1. The system prompt + chunk template embed the slot trigger hints + the **anti-parroting rule** (Spike 0.2 reviewer Important #4 — Path F empirically validated that 1B parrots `E=mc²` from prompt; 3B can do the same on a weaker fixture). Plain string (no `<|system|>` chat-template tags) — Spike 0.1/0.2 proved plain prompts work with grammar-constrained sampling.

**Files:**
- Create: `desktop/src/shared/families/lecture/prompts/v1.ts`
- Create: `desktop/src/shared/families/lecture/prompts/index.ts`
- Create: `desktop/src/shared/families/lecture/prompts/v1.test.ts`

- [ ] **Step 1: Failing prompt-shape test**

```typescript
// v1.test.ts
import { describe, it, expect } from 'vitest';
import { lecturePromptsV1 } from './v1';

describe('lecturePromptsV1', () => {
  it('has the correct variantId', () => {
    expect(lecturePromptsV1.variantId).toBe('lecture-v1');
  });

  it('system prompt contains the anti-parroting rule', () => {
    expect(lecturePromptsV1.system).toMatch(/never (use|invent|fabricate)/i);
    expect(lecturePromptsV1.system).toMatch(/from the lecture/i);
  });

  it('system prompt does NOT include literal slot exemplars like "E=mc^2"', () => {
    expect(lecturePromptsV1.system).not.toMatch(/E\s*=\s*mc/);
    expect(lecturePromptsV1.system).not.toMatch(/F\s*=\s*ma/);
  });

  it('system prompt mentions all 4 slot kinds', () => {
    for (const kind of ['procedure_steps', 'argument_chain', 'formula', 'timeline']) {
      expect(lecturePromptsV1.system).toContain(kind);
    }
  });

  it('chunkUserTemplate is a function string-builder', () => {
    const out = lecturePromptsV1.chunkUserTemplate({
      chunkIndex: 0,
      totalChunks: 2,
      transcript: '[00:00] テスト',
    });
    expect(out).toContain('[00:00] テスト');
    expect(out).toContain('Chunk 1 of 2');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement v1 prompts**

```typescript
// v1.ts
import { PromptVariant } from '../../../note-schema/prompt-variant';  // Plan 2 Task 15
import { LECTURE_SLOTS } from '../slots';

const SLOT_HINTS = LECTURE_SLOTS.map(
  (s) => `- **${s.kind}**: ${s.promptHint}`,
).join('\n');

const SYSTEM = `You are a lecture note writer producing structured JSON for a Japanese university-style lecture. You receive a transcript chunk with timestamps; output a JSON note matching the LectureNote schema.

Hard rules:
- All user-visible text in the JSON MUST be Japanese, unless the lecture itself uses English or romanized loanwords (then preserve as-is).
- Every section has a heading (≤120 chars), ts (seconds offset, integer), summary (1-3 sentences), and key_terms, examples, points arrays (may be empty).
- Output ONLY valid JSON matching the schema. No markdown, no commentary, no preamble.

Slot extras (optional per section — emit at most one of each kind unless content genuinely supports more):
${SLOT_HINTS}

CRITICAL anti-parroting rule:
- NEVER use placeholder exemplars like "E=mc^2", "F=ma", "P=NP" in formula expressions unless the lecture LITERALLY discusses that formula.
- The formula expression field MUST be transcribed from what the lecturer actually said/wrote. If you cannot identify a specific formula in the transcript, OMIT the formula extras slot entirely. An empty extras array is correct; a fabricated formula is WRONG.
- The same rule applies to procedure_steps, argument_chain, and timeline — invent nothing. Use what the transcript contains.

Provenance:
- The schema expects \`from: "transcript" | "inferred"\` on every key_term, example, point, and slot leaf. Output ONLY \`"from": "transcript"\` for items directly stated in the transcript. The pipeline assigns \`"inferred"\` post-hoc for anything you generated by paraphrase or compression — you do not need to mark them yourself, but if uncertain, prefer \`"transcript"\`.

If the chunk does not contain meaningful content (silence, filler), output a minimal note with empty sections rather than fabricating content.`;

export const lecturePromptsV1: PromptVariant = {
  variantId: 'lecture-v1',
  system: SYSTEM,
  chunkUserTemplate: ({ chunkIndex, totalChunks, transcript }) =>
    `Chunk ${chunkIndex + 1} of ${totalChunks}\n\nTranscript:\n${transcript}\n\nProduce the LectureNote JSON for this chunk only.`,
  // No mergeUserTemplate — Lecture uses deterministic merge (spec §5.2b).
};
```

`prompts/index.ts`:
```typescript
import { lecturePromptsV1 } from './v1';

export const lecturePromptVariants = {
  default: lecturePromptsV1,
  v1: lecturePromptsV1,
};
```

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/shared/families/lecture/prompts/
git commit -m "feat(v2-lecture): v1 prompt with anti-parroting rule (Path F finding)"
```

### Task 5: MAX_TOKENS calibration + ModelProfile.recommendedChunkTokens

**Goal:** Wire Plan 2's `ModelProfile` to expose Lecture-tuned `MAX_TOKENS` per Path G recommendation (Path E memo: 3B latency MIXED at 8K prompt; Path F: 1B Run 2 ran away at 4096 generation). Reduce per-chunk generation cap from spike's 4096 to **3000** for production.

**Files:**
- Modify: `desktop/src/shared/note-schema/model-profile.ts` (Plan 2 Task 17 output — extend with Lecture-specific tuning)
- Create: `desktop/src/shared/note-schema/model-profile-lecture.test.ts`

- [ ] **Step 1: Failing tuning test**

```typescript
// model-profile-lecture.test.ts
import { describe, it, expect } from 'vitest';
import { modelProfileRegistry } from './model-profile';

describe('Lecture ModelProfile tuning', () => {
  it('3B Q4_K_M profile emits maxGenTokens 3000 for Lecture', () => {
    const profile = modelProfileRegistry.get('llama-3.2-3b-q4-k-m');
    expect(profile.perFamily.lecture.maxGenTokens).toBe(3000);
  });

  it('3B Q4_K_M profile emits recommendedChunkTokens 8000 (spec §2.3)', () => {
    const profile = modelProfileRegistry.get('llama-3.2-3b-q4-k-m');
    expect(profile.perFamily.lecture.recommendedChunkTokens).toBe(8000);
  });

  it('1B Q4_K_M profile maps to Lecture as fallback only (until Plan 6 Task 16 PASS)', () => {
    const profile = modelProfileRegistry.get('llama-3.2-1b-q4-k-m');
    expect(profile.perFamily.lecture.tier).toBe('fallback');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Extend `model-profile.ts`** to add `perFamily.lecture` tuning:

```typescript
// model-profile.ts (delta on Plan 2 Task 17 base)
// ... existing ModelProfile interface ...

export interface PerFamilyTuning {
  recommendedChunkTokens: number;
  maxGenTokens: number;            // n_predict for grammar-constrained call
  temperature: number;
  tier: 'default' | 'fallback';    // default = picker recommends; fallback = lower-RAM Macs only
}

export interface ModelProfile {
  id: string;
  weightPath: string;
  estimatedRamMb: number;
  perFamily: Record<NoteFamily, PerFamilyTuning>;
}

// 3B profile — default for Lecture per Path F (1B failed quality on Lecture)
modelProfileRegistry.register({
  id: 'llama-3.2-3b-q4-k-m',
  weightPath: '<resolved at boot>',
  estimatedRamMb: 3000,
  perFamily: {
    lecture: {
      recommendedChunkTokens: 8000,    // spec §2.3 top-of-budget
      maxGenTokens: 3000,              // reduced from spike 4096 per Path G tail-risk mitigation
      temperature: 0.4,
      tier: 'default',
    },
    meeting: { /* Plan 5 fills */ recommendedChunkTokens: 8000, maxGenTokens: 3000, temperature: 0.4, tier: 'default' },
    interview: { /* Plan 6 fills */ recommendedChunkTokens: 7000, maxGenTokens: 3500, temperature: 0.4, tier: 'default' },
    brainstorm: { /* Plan 6 fills */ recommendedChunkTokens: 7000, maxGenTokens: 3500, temperature: 0.5, tier: 'default' },
  },
});

// 1B profile — fallback until Plan 6 Task 16 PASS
modelProfileRegistry.register({
  id: 'llama-3.2-1b-q4-k-m',
  weightPath: '<resolved at boot>',
  estimatedRamMb: 1000,
  perFamily: {
    lecture: {
      recommendedChunkTokens: 8000,
      maxGenTokens: 3000,
      temperature: 0.4,
      tier: 'fallback',              // Path F finding — quality FAIL on Lecture
    },
    // Meeting / Interview / Brainstorm = also fallback until Plan 6 verifies
    meeting: { recommendedChunkTokens: 8000, maxGenTokens: 3000, temperature: 0.4, tier: 'fallback' },
    interview: { recommendedChunkTokens: 7000, maxGenTokens: 3500, temperature: 0.4, tier: 'fallback' },
    brainstorm: { recommendedChunkTokens: 7000, maxGenTokens: 3500, temperature: 0.5, tier: 'fallback' },
  },
});
```

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/shared/note-schema/model-profile.ts \
        desktop/src/shared/note-schema/model-profile-lecture.test.ts
git commit -m "feat(v2): ModelProfile per-family tuning — 3B default, 1B fallback (Path F)"
```

---

## Phase C — Pipeline integration (Tasks 6-10)

### Task 6: Lecture `MergeStrategy`

**Goal:** Implement Lecture's deterministic merge per spec §5.2b — `scalarPolicy: 'longest'`, `arrayPolicy: 'concat-dedup'`, `sortByTs: true`; with `sections: concat-only` (sections are unique per ts range) + `extras: concat-dedup` (typed slots dedup across chunks).

**Files:**
- Create: `desktop/src/shared/families/lecture/merge.ts`
- Create: `desktop/src/shared/families/lecture/merge.test.ts`

- [ ] **Step 1: Failing merge test**

```typescript
// merge.test.ts
import { describe, it, expect } from 'vitest';
import { lectureMergeStrategy } from './merge';
import { deterministicMerge } from '../../post-decode/deterministic-merge';   // Task 7 output
import type { LectureNote } from './schema';

describe('lectureMergeStrategy', () => {
  it('picks longest scalar for title across chunks', () => {
    const chunks: Partial<LectureNote>[] = [
      { title: '電磁気' },
      { title: '電磁気の基礎' },
    ];
    const merged = deterministicMerge(chunks, lectureMergeStrategy);
    expect(merged.title).toBe('電磁気の基礎');
  });

  it('concat-only sections (sortByTs)', () => {
    const chunks: Partial<LectureNote>[] = [
      { sections: [{ heading: 'B', ts: 50, /* ... */ } as any] },
      { sections: [{ heading: 'A', ts: 0, /* ... */ } as any] },
    ];
    const merged = deterministicMerge(chunks, lectureMergeStrategy);
    expect(merged.sections.map((s) => s.heading)).toEqual(['A', 'B']);
  });

  it('concat-dedup on top-level arrays not specifically overridden', () => {
    // Lecture has no top-level arrays besides `sections` in spec §3.3; this
    // test guards against schema additions accidentally regressing dedup.
  });

  it('dedups extras across chunks via trigram Jaccard > 0.7', () => {
    const chunks: Partial<LectureNote>[] = [
      { sections: [{ extras: [{ kind: 'formula', expression: 'E=mc^2', /* ... */ } as any] }] as any },
      { sections: [{ extras: [{ kind: 'formula', expression: 'E = m c^2', /* ... */ } as any] }] as any },
    ];
    // Note: this test exists post-Task 7 (which implements trigram Jaccard).
    // Until then, mark `.skip` and uncomment when Task 7 lands.
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `merge.ts`**

```typescript
// merge.ts
import type { MergeStrategy } from '../../note-schema';   // Plan 2 / spec §5.2b

export const lectureMergeStrategy: MergeStrategy = {
  scalarPolicy: 'longest',
  arrayPolicy: 'concat-dedup',
  sortByTs: true,
  fieldOverrides: {
    sections: { policy: 'concat-only' },     // sections are temporal/unique per ts range
    extras: { policy: 'concat-dedup' },      // typed slots dedup across chunks (formula appearing in 2 chunks → 1)
  },
};
```

- [ ] **Step 4: Run tests, expect PASS** (or skip the dedup test until Task 7).

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/shared/families/lecture/merge.ts \
        desktop/src/shared/families/lecture/merge.test.ts
git commit -m "feat(v2-lecture): MergeStrategy — concat-dedup with sections concat-only (spec §5.2b)"
```

### Task 7: `deterministicMerge()` pure function (shared)

**Goal:** Generic, family-agnostic deterministic merge utility used by Lecture (and Meeting / Interview-fallback / Brainstorm-fallback). Applies a `MergeStrategy` to N partial JSONs → single merged JSON. Trigram Jaccard > 0.7 dedup as spec §5.2 calls for.

**Files:**
- Create: `desktop/src/shared/post-decode/deterministic-merge.ts`
- Create: `desktop/src/shared/post-decode/deterministic-merge.test.ts`

- [ ] **Step 1: Failing tests** (5 cases: longest scalar / first scalar / concat-only / concat-dedup / sortByTs interaction)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```typescript
// deterministic-merge.ts
import type { MergeStrategy } from '../note-schema';

const JACCARD_THRESHOLD = 0.7;

function trigrams(text: string): Set<string> {
  const tg = new Set<string>();
  const t = text.toLowerCase().normalize('NFKC').trim();
  for (let i = 0; i <= t.length - 3; i++) tg.add(t.slice(i, i + 3));
  return tg;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

function dedupByText<T>(items: T[], textFn: (t: T) => string): T[] {
  const out: { item: T; tg: Set<string> }[] = [];
  for (const it of items) {
    const tg = trigrams(textFn(it));
    let dup = false;
    for (const existing of out) {
      if (jaccard(tg, existing.tg) > JACCARD_THRESHOLD) {
        dup = true;
        break;
      }
    }
    if (!dup) out.push({ item: it, tg });
  }
  return out.map((x) => x.item);
}

export function deterministicMerge<T extends Record<string, unknown>>(
  partials: Partial<T>[],
  strategy: MergeStrategy,
): T {
  const result: Record<string, unknown> = {};
  const allKeys = new Set<string>();
  for (const p of partials) for (const k of Object.keys(p)) allKeys.add(k);

  for (const key of allKeys) {
    const override = strategy.fieldOverrides?.[key];
    const policy = override?.policy ?? guessFieldPolicy(key, partials, strategy);

    if (policy === 'longest') {
      result[key] = pickLongest(partials.map((p) => p[key]));
    } else if (policy === 'first') {
      result[key] = partials.find((p) => p[key] !== undefined)?.[key];
    } else if (policy === 'concat-only') {
      result[key] = sortMaybe(concatArrays(partials, key), strategy.sortByTs);
    } else if (policy === 'concat-dedup') {
      const concat = concatArrays(partials, key);
      result[key] = sortMaybe(dedupArrayByTextField(concat), strategy.sortByTs);
    } else if (policy === 'custom') {
      result[key] = override!.handler!(partials.map((p) => p[key]));
    }
  }

  return result as T;
}

function concatArrays(partials: any[], key: string): any[] {
  return partials.flatMap((p) => (Array.isArray(p[key]) ? p[key] : []));
}

function pickLongest(values: unknown[]): unknown {
  let best: unknown = undefined;
  let bestLen = -1;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    if (v.length > bestLen) { best = v; bestLen = v.length; }
  }
  return best ?? values.find((v) => v !== undefined);
}

function sortMaybe<T>(arr: T[], sortByTs: boolean | undefined): T[] {
  if (!sortByTs) return arr;
  return arr.slice().sort((a: any, b: any) =>
    typeof a?.ts === 'number' && typeof b?.ts === 'number' ? a.ts - b.ts : 0,
  );
}

function dedupArrayByTextField(items: any[]): any[] {
  // Heuristic: dedup by the first string field found on each item (text > term > expression > heading).
  // Items without any string field are kept unique by reference.
  return dedupByText(items, (it) =>
    typeof it?.text === 'string' ? it.text :
    typeof it?.term === 'string' ? it.term :
    typeof it?.expression === 'string' ? it.expression :
    typeof it?.heading === 'string' ? it.heading :
    JSON.stringify(it),
  );
}

function guessFieldPolicy(
  key: string,
  partials: any[],
  strategy: MergeStrategy,
): 'longest' | 'first' | 'concat-only' | 'concat-dedup' | 'custom' {
  const anyValue = partials.map((p) => p[key]).find((v) => v !== undefined);
  if (Array.isArray(anyValue)) return strategy.arrayPolicy;
  return strategy.scalarPolicy === 'merge-llm' ? 'longest' : strategy.scalarPolicy;
}
```

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/shared/post-decode/deterministic-merge.ts \
        desktop/src/shared/post-decode/deterministic-merge.test.ts
git commit -m "feat(v2): deterministicMerge() — trigram Jaccard dedup + concat + sortByTs"
```

### Task 8: Post-decode pipeline (Stages 1-5 per spec §5.2)

**Goal:** Wire the 5-stage post-decode pipeline that converts raw LLM output (per chunk) → ValidatedNote: parse → fill ids (Brainstorm only — Lecture is no-op) → fill provenance → Zod parse with referential closure → deterministic dedup.

**Files:**
- Create: `desktop/src/shared/post-decode/pipeline.ts`
- Create: `desktop/src/shared/post-decode/pipeline.test.ts`

- [ ] **Step 1: Failing test** (5 stages with a Lecture fixture)

```typescript
// pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { runPostDecodePipeline } from './pipeline';
import { LectureFamily } from '../families/lecture';

describe('runPostDecodePipeline (Lecture)', () => {
  it('Stage 1: parses raw JSON', () => { /* ... */ });
  it('Stage 2: no-op for Lecture (Brainstorm-only stage)', () => { /* ... */ });
  it('Stage 3: fills `from` via computeProvenance for every leaf with `ts`', () => {
    const raw = JSON.stringify({
      schemaVersion: 1, family: 'lecture', title: 't',
      generatedAt: '...', generatedBy: { model: 'm', promptVersion: 1 },
      language: 'ja', durationSec: 60,
      sections: [{
        heading: 'h', ts: 0, summary: '...',
        key_terms: [{ term: 'x', definition: 'y', ts: 5 /* no `from` */ }],
        examples: [], points: [],
      }],
    });
    const transcript = /* SessionTranscript with seg ts=5 containing "x" */;
    const note = runPostDecodePipeline(raw, LectureFamily, transcript);
    expect(note.sections[0].key_terms[0].from).toBe('transcript');
  });
  it('Stage 4: Zod parses with closure clamp-not-throw on bad SpeakerRef', () => {
    // Lecture has no SpeakerRef but the pipeline runs the closure validator anyway
    // — defensive against future Lecture-extending notes.
  });
  it('Stage 5: dedups items via trigram Jaccard', () => { /* ... */ });
  it('throws ForwardIncompatNoteError if schemaVersion > CURRENT', () => { /* ... */ });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```typescript
// pipeline.ts
import type { FamilyDefinition, SessionTranscript } from '../note-schema';
import { computeProvenance } from '../note-schema/compute-provenance';     // Plan 2 Task 9
import { hydratePostDecode } from '../note-schema/hydrate-post-decode';     // Plan 2 Task 10 (fallback)
import { v4 as uuid } from 'uuid';

const CURRENT_SCHEMA_VERSION = 1;

export class ForwardIncompatNoteError extends Error {
  constructor(public readonly observed: number, public readonly supported: number) {
    super(`Note schemaVersion ${observed} is newer than this app supports (${supported}). Please update Lisna.`);
  }
}

export function runPostDecodePipeline(
  rawJson: string,
  family: FamilyDefinition,
  transcript: SessionTranscript,
): unknown {
  // Stage 1 — parse
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;

  // Forward-incompat check
  if (typeof parsed.schemaVersion === 'number' && parsed.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new ForwardIncompatNoteError(parsed.schemaVersion, CURRENT_SCHEMA_VERSION);
  }

  // Stage 2 — id fill (Brainstorm only; Lecture / Meeting / Interview no-op)
  if (family.family === 'brainstorm') {
    fillBrainstormIdeaIds(parsed);
  }

  // Stage 3 — provenance fill
  fillProvenanceRecursive(parsed, transcript);

  // Stage 4 — Zod parse with referential closure
  const validated = family.schema.parse(parsed);
  // (Closure validator clamp-not-throw applied per spec §4 P8 — internally on `family.schema`)

  // Stage 5 — deterministic dedup at terminal level
  // Lecture: dedup is field-level (handled inside MergeStrategy at merge stage,
  // not per-chunk). Per-chunk dedup not needed.

  return validated;
}

function fillBrainstormIdeaIds(parsed: any): void {
  for (const cluster of parsed.idea_clusters ?? []) {
    for (const idea of cluster.ideas ?? []) {
      if (typeof idea.id !== 'string' || idea.id === '') idea.id = uuid();
    }
  }
}

function fillProvenanceRecursive(obj: any, transcript: SessionTranscript): void {
  if (obj == null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const child of obj) fillProvenanceRecursive(child, transcript);
    return;
  }
  // If this object has both `ts` and looks like a Provenance-bearing leaf, fill `from`.
  if (typeof obj.ts === 'number' && obj.from === undefined && 'text' in obj || 'term' in obj || 'expression' in obj) {
    obj.from = computeProvenance(obj, transcript);   // Plan 2 Task 9
  }
  for (const key of Object.keys(obj)) fillProvenanceRecursive(obj[key], transcript);
}
```

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/shared/post-decode/pipeline.ts \
        desktop/src/shared/post-decode/pipeline.test.ts
git commit -m "feat(v2): post-decode pipeline (5 stages per spec §5.2)"
```

### Task 9: Orchestrator extension — `family === 'lecture'` branch

**Goal:** Extend `desktop/src/main/sidecar/orchestrator.ts` to handle the chunked-at-end Lecture flow: finalize STT → load LLM with grammar → chunk transcript → per-chunk grammar call → deterministic merge → post-decode pipeline → persist Note.

**Files:**
- Modify: `desktop/src/main/sidecar/orchestrator.ts`
- Create: `desktop/src/main/sidecar/lecture-orchestrator.test.ts`

- [ ] **Step 1: Failing test (E2E orchestrator with mocked sidecar)**

```typescript
// lecture-orchestrator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { finalizeLecture } from './orchestrator';
import { mockSidecar } from '../../test-helpers/mock-sidecar';

describe('finalizeLecture', () => {
  it('processes 1-chunk transcript end-to-end with mocked LLM', async () => {
    const sc = mockSidecar({
      grammarCallResponses: [/* canned valid LectureNote JSON for chunk 0 */],
    });
    const result = await finalizeLecture({
      sessionId: 'test',
      transcript: /* small SessionTranscript fitting in 1 chunk */,
      sidecar: sc,
      modelProfile: /* 3B profile */,
      promptVariantId: 'lecture-v1',
    });
    expect(result.note.family).toBe('lecture');
    expect(result.note.sections.length).toBeGreaterThanOrEqual(1);
    expect(sc.grammarCalls).toHaveLength(1);
  });

  it('processes 3-chunk transcript with deterministic merge (no merge-LLM call)', async () => {
    const sc = mockSidecar({ /* 3 canned chunk responses */ });
    const result = await finalizeLecture({/* ... */});
    expect(sc.grammarCalls).toHaveLength(3);   // 3 per-chunk calls + 0 merge calls
    expect(result.note.sections.length).toBeGreaterThan(1);
  });

  it('respects retry budget per Plan 2 wrapper (failing chunk retried up to 3×)', async () => {
    const sc = mockSidecar({
      grammarCallFailures: { 0: 1 },   // chunk 0 fails once, succeeds on retry
    });
    const result = await finalizeLecture({/* ... */});
    expect(sc.grammarCalls).toHaveLength(2 + 0);  // initial fail + 1 retry; remaining chunks succeed first try
    expect(result.note.family).toBe('lecture');
  });

  it('surfaces validation_warnings on referential closure clamps', async () => {
    // Lecture has no SpeakerRef so this is a defensive test; expect 0 warnings.
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement orchestrator extension**

```typescript
// orchestrator.ts (delta — add finalizeLecture or extend existing finalize)
import { familyRegistry } from '../../shared/families';
import { chunkTranscript } from '../../shared/note-schema/chunk-transcript';   // Plan 2 Task 7
import { runGrammarCallWithRetry } from '../../shared/note-schema/grammar-call-wrapper'; // Plan 2 Tasks 11-13
import { deterministicMerge } from '../../shared/post-decode/deterministic-merge';        // Task 7
import { runPostDecodePipeline } from '../../shared/post-decode/pipeline';                // Task 8
import { zodToGbnf } from '../../shared/note-schema/zod-to-gbnf';                          // Plan 2 Task 18

export async function finalizeLecture(args: {
  sessionId: string;
  transcript: SessionTranscript;
  sidecar: SidecarClient;
  modelProfile: ModelProfile;
  promptVariantId: string;
  onProgress?: (e: { phase: 'chunk' | 'merge' | 'persist'; chunkIndex?: number; totalChunks?: number }) => void;
}): Promise<{ note: LectureNote; telemetry: GenerationTelemetry }> {
  const fam = familyRegistry.get('lecture');
  const tuning = args.modelProfile.perFamily.lecture;

  const startedAt = new Date().toISOString();
  const t0 = performance.now();

  // 1) Chunk
  const chunks = chunkTranscript(args.transcript, tuning.recommendedChunkTokens);
  if (chunks.length === 0) {
    throw new Error('EMPTY_TRANSCRIPT');
  }

  // 2) Generate grammar (regen each session — Path G `.max(N)` may have evolved)
  const grammarPath = await args.sidecar.writeTempGrammar(
    zodToGbnf(fam.schema, 'LectureNote'),
  );

  // 3) Per-chunk grammar call with retry
  const prompt = fam.prompts[args.promptVariantId] ?? fam.prompts.default;
  const partials: Partial<LectureNote>[] = [];
  for (let i = 0; i < chunks.length; i++) {
    args.onProgress?.({ phase: 'chunk', chunkIndex: i, totalChunks: chunks.length });
    const userMsg = prompt.chunkUserTemplate({
      chunkIndex: i,
      totalChunks: chunks.length,
      transcript: renderTranscriptChunk(chunks[i]),
    });
    const rawJson = await runGrammarCallWithRetry({
      sidecar: args.sidecar,
      grammarPath,
      systemPrompt: prompt.system,
      userPrompt: userMsg,
      maxTokens: tuning.maxGenTokens,
      temperature: tuning.temperature,
      maxAttempts: 3,
      baseSeed: 5000 + i,
    });
    const validated = runPostDecodePipeline(rawJson, fam, args.transcript);
    partials.push(validated as Partial<LectureNote>);
  }

  // 4) Deterministic merge — NO merge-LLM call for Lecture
  args.onProgress?.({ phase: 'merge' });
  const merged = deterministicMerge(partials, fam.mergeStrategy);

  // 5) Final Zod parse (defensive — merged shape might have gained array-bound violations from concat)
  const note = fam.schema.parse(merged);

  // 6) Telemetry assembly
  const elapsed = performance.now() - t0;
  const telemetry: GenerationTelemetry = {
    noteId: args.sessionId,
    modelId: args.modelProfile.id,
    promptVariantId: prompt.variantId,
    schemaVersion: 1,
    generationStartedAt: startedAt,
    generationDurationMs: Math.round(elapsed),
    chunkCount: chunks.length,
    totalTokensIn: chunks.reduce((s, c) => s + estimateTokens(renderTranscriptChunk(c)), 0),
    totalTokensOut: 0, // sidecar fills via perf-print parsing if available
    validationWarnings: [],
    dedupHits: [],
    postDecodeMutations: [],
  };

  args.onProgress?.({ phase: 'persist' });
  return { note, telemetry };
}

function renderTranscriptChunk(chunk: SessionTranscript): string {
  return chunk.transcriptSegments
    .map((s) => `[${fmtTs(s.ts)}] ${s.text}`)
    .join('\n');
}
```

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/main/sidecar/orchestrator.ts \
        desktop/src/main/sidecar/lecture-orchestrator.test.ts
git commit -m "feat(v2-lecture): orchestrator branch — chunkTranscript + per-chunk + deterministic merge"
```

### Task 10: `session/finalize` IPC channel

**Goal:** Add the IPC channel per spec §5.2 — replaces the current `session/stop` (which takes no args). Signature: `session/finalize({ family, promptVariant? }) → Promise<{ noteId }>`. Migrates existing call sites.

**Files:**
- Create: `desktop/src/main/sidecar/ipc/session-finalize.ts`
- Modify: `desktop/src/main/sidecar/ipc/index.ts` (register new channel)
- Modify: `desktop/src/main/sidecar/orchestrator.ts` (export dispatcher)
- Create: `desktop/src/main/sidecar/ipc/session-finalize.test.ts`

- [ ] **Step 1: Failing IPC test** (mock ipcMain.handle + assert dispatch on family)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** the dispatcher that routes by `args.family` → `finalizeLecture` (Lecture only here; Plans 5/6 extend).

```typescript
// session-finalize.ts
import { ipcMain } from 'electron';
import { finalizeLecture } from '../orchestrator';

ipcMain.handle(
  'session/finalize',
  async (_evt, args: { family: 'lecture' | 'meeting' | 'interview' | 'brainstorm'; promptVariant?: string }) => {
    if (args.family === 'lecture') {
      const result = await finalizeLecture({
        // ... pull session context from a session registry
      });
      return { noteId: result.note.title /* placeholder; real id assigned on persist */ };
    }
    if (args.family === 'meeting' || args.family === 'interview' || args.family === 'brainstorm') {
      throw new Error(`Family "${args.family}" not yet implemented (lands in Plan ${args.family === 'meeting' ? '5' : '6'})`);
    }
    throw new Error(`Unknown family: ${args.family}`);
  },
);
```

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/main/sidecar/ipc/session-finalize.ts \
        desktop/src/main/sidecar/ipc/session-finalize.test.ts \
        desktop/src/main/sidecar/ipc/index.ts \
        desktop/src/main/sidecar/orchestrator.ts
git commit -m "feat(v2): session/finalize IPC channel (Lecture branch live; Meeting/Interview/Brainstorm stubbed)"
```

---

## Phase D — Renderer + UI (Tasks 11-12)

### Task 11: `LectureRenderer` (Markdown / JSX)

**Goal:** Pure `({ note, transcript }) => JSX` per spec §5.3. Emits Markdown-formatted Lecture note. Renders `※ inferred` marker on key_terms / examples / points / slot leaves where `from === 'inferred'` per spec §3 Provenance contract.

**Files:**
- Create: `desktop/src/shared/families/lecture/renderer.tsx`
- Create: `desktop/src/shared/families/lecture/renderer.test.tsx`

- [ ] **Step 1: Failing render test** (snapshot or DOM probe)

```tsx
// renderer.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LectureRenderer } from './renderer';

describe('LectureRenderer', () => {
  it('renders title + tldr + sections with key_terms', () => {
    const note = /* fully-validated LectureNote fixture */;
    const transcript = /* SessionTranscript fixture */;
    const { container } = render(<LectureRenderer note={note} transcript={transcript} />);
    expect(container.textContent).toContain(note.title);
  });

  it('shows ※ inferred marker on key_terms where from === "inferred"', () => {
    /* ... */
    expect(container.querySelectorAll('.provenance-inferred')).toHaveLength(2);
  });

  it('renders formula extras with monospace expression', () => {
    /* ... */
  });

  it('renders empty sections gracefully (no crash on `extras` undefined)', () => {
    /* ... */
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement renderer**

```tsx
// renderer.tsx
import type { LectureNote, LectureSection } from './schema';
import type { SessionTranscript } from '../../note-schema';
import { fmtTs } from '../../utils/fmt-ts';

export interface LectureRendererProps {
  note: LectureNote;
  transcript: SessionTranscript;
}

export function LectureRenderer({ note, transcript }: LectureRendererProps) {
  return (
    <article className="lecture-note">
      <header>
        <h1>{note.title}</h1>
        {note.lecturer && <div className="lecturer">講師: {note.lecturer}</div>}
        {note.course && <div className="course">{note.course}</div>}
        {note.tldr && <div className="tldr">{note.tldr}</div>}
      </header>
      {note.sections.map((sec, i) => (
        <Section key={i} section={sec} />
      ))}
      {note.validation_warnings?.length ? (
        <aside className="validation-warnings">
          AI cleanup notes:
          <ul>{note.validation_warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </aside>
      ) : null}
    </article>
  );
}

function Section({ section }: { section: LectureSection }) {
  return (
    <section>
      <h2>
        {section.heading}{' '}
        <span className="ts-anchor">[{fmtTs(section.ts)}]</span>
      </h2>
      {section.summary && <p className="summary">{section.summary}</p>}
      {section.takeaway && <p className="takeaway"><strong>要点:</strong> {section.takeaway}</p>}

      {section.key_terms.length > 0 && (
        <dl className="key-terms">
          {section.key_terms.map((kt, i) => (
            <Fragment key={i}>
              <dt>
                {kt.term}
                {kt.from === 'inferred' && <span className="provenance-inferred" title="AI-inferred">※</span>}
              </dt>
              <dd>{kt.definition} <span className="ts-anchor">[{fmtTs(kt.ts)}]</span></dd>
            </Fragment>
          ))}
        </dl>
      )}

      {section.examples.length > 0 && (
        <ul className="examples">
          {section.examples.map((ex, i) => (
            <li key={i}>
              {ex.text}{' '}
              {ex.from === 'inferred' && <span className="provenance-inferred">※</span>}
              <span className="ts-anchor">[{fmtTs(ex.ts)}]</span>
            </li>
          ))}
        </ul>
      )}

      {section.points.length > 0 && (
        <ul className="points">
          {section.points.map((p, i) => (
            <li key={i} className={p.important ? 'important' : ''}>
              {p.text}{' '}
              {p.from === 'inferred' && <span className="provenance-inferred">※</span>}
              <span className="ts-anchor">[{fmtTs(p.ts)}]</span>
            </li>
          ))}
        </ul>
      )}

      {section.extras?.map((slot, i) => <SlotRenderer key={i} slot={slot} />)}
    </section>
  );
}

function SlotRenderer({ slot }: { slot: LectureSlotInstance }) {
  switch (slot.kind) {
    case 'procedure_steps':
      return (
        <ol className="slot procedure-steps">
          {slot.steps.map((s, i) => (
            <li key={i}>
              {s.text} <span className="ts-anchor">[{fmtTs(s.ts)}]</span>
              {s.from === 'inferred' && <span className="provenance-inferred">※</span>}
            </li>
          ))}
        </ol>
      );
    case 'formula':
      return (
        <div className="slot formula">
          {slot.label && <strong>{slot.label}: </strong>}
          <code>{slot.expression}</code>
          {slot.from === 'inferred' && <span className="provenance-inferred">※</span>}
        </div>
      );
    case 'argument_chain':
      return (
        <ol className="slot argument-chain">
          {slot.claims.map((c, i) => (
            <li key={i} value={c.order}>
              {c.text}
              {c.supports?.length ? <span className="supports">← {c.supports.join(', ')}</span> : null}
            </li>
          ))}
        </ol>
      );
    case 'timeline':
      return (
        <ul className="slot timeline">
          {slot.events.map((e, i) => (
            <li key={i}><strong>{e.when}:</strong> {e.text}</li>
          ))}
        </ul>
      );
  }
}
```

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/shared/families/lecture/renderer.tsx \
        desktop/src/shared/families/lecture/renderer.test.tsx
git commit -m "feat(v2-lecture): renderer with ※ inferred Provenance markers (spec §3, §5.3)"
```

### Task 12: UI integration — Recording → Stop → FamilyPicker → progress → NoteView

**Goal:** Wire the Lecture flow into `App.tsx`. Add `FamilyPickerStep` component (1-2s user choice; defaults Lecture) and `NoteRenderProgress` showing "Processing chunk X/N" + "Merging" + "Rendering" phases.

**Files:**
- Modify: `desktop/src/renderer/App.tsx`
- Create: `desktop/src/renderer/components/FamilyPickerStep.tsx`
- Create: `desktop/src/renderer/components/NoteRenderProgress.tsx`
- Create: `desktop/src/renderer/components/FamilyPickerStep.test.tsx`
- Create: `desktop/src/renderer/components/NoteRenderProgress.test.tsx`

- [ ] **Step 1: Failing UI tests** (Stop click → picker shown → Lecture selected → progress shown → note rendered)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement components**

```tsx
// FamilyPickerStep.tsx
import { useState } from 'react';

const FAMILIES = [
  { id: 'lecture',    label: '講義 (Lecture)',          desc: '単一話者・章立て・key_terms' },
  { id: 'meeting',    label: 'ミーティング (Meeting)',  desc: '決定事項・アクション・参加者', disabled: true /* until Plan 5 */ },
  { id: 'interview',  label: 'インタビュー (Interview)', desc: 'Q/A・テーマ・引用', disabled: true /* until Plan 6 */ },
  { id: 'brainstorm', label: 'ブレスト (Brainstorm)',    desc: 'アイデア・クラスタ', disabled: true /* until Plan 6 */ },
] as const;

export function FamilyPickerStep({ onPick }: { onPick: (family: string) => void }) {
  const [selected, setSelected] = useState<string>('lecture');
  return (
    <div className="family-picker">
      <h2>このセッションの種類は?</h2>
      <ul>
        {FAMILIES.map((f) => (
          <li key={f.id}>
            <label className={f.disabled ? 'disabled' : ''}>
              <input
                type="radio"
                name="family"
                value={f.id}
                checked={selected === f.id}
                disabled={f.disabled}
                onChange={() => setSelected(f.id)}
              />
              <strong>{f.label}</strong>
              <div className="desc">{f.desc}</div>
              {f.disabled && <small>(coming soon)</small>}
            </label>
          </li>
        ))}
      </ul>
      <button onClick={() => onPick(selected)}>続行</button>
    </div>
  );
}
```

```tsx
// NoteRenderProgress.tsx
export interface ProgressState {
  phase: 'chunk' | 'merge' | 'persist';
  chunkIndex?: number;
  totalChunks?: number;
}

export function NoteRenderProgress({ progress }: { progress: ProgressState | null }) {
  if (!progress) return null;
  if (progress.phase === 'chunk') {
    return (
      <div className="progress">
        <div className="bar">
          <div className="fill" style={{ width: `${(progress.chunkIndex! / progress.totalChunks!) * 100}%` }} />
        </div>
        <p>チャンク {progress.chunkIndex! + 1} / {progress.totalChunks!} を処理中...</p>
      </div>
    );
  }
  if (progress.phase === 'merge')   return <div className="progress"><p>チャンクをマージ中...</p></div>;
  if (progress.phase === 'persist') return <div className="progress"><p>保存中...</p></div>;
  return null;
}
```

`App.tsx` wire (delta):

```tsx
// State machine:
//   recording → (Stop) → familyPicking → curating(progress) → rendered
const [stage, setStage] = useState<'recording' | 'familyPicking' | 'curating' | 'rendered'>('recording');
const [progress, setProgress] = useState<ProgressState | null>(null);
const [note, setNote] = useState<LectureNote | null>(null);

async function handleStop() {
  setStage('familyPicking');
}

async function handleFamilyPick(family: string) {
  setStage('curating');
  const result = await window.lisna.ipc.invoke('session/finalize', { family, promptVariant: 'lecture-v1' });
  // ... receives note via the orchestrator's onProgress + final return
  setNote(result.note);
  setStage('rendered');
}

return (
  <>
    {stage === 'recording' && <Recording onStop={handleStop} />}
    {stage === 'familyPicking' && <FamilyPickerStep onPick={handleFamilyPick} />}
    {stage === 'curating' && <NoteRenderProgress progress={progress} />}
    {stage === 'rendered' && note && <LectureRenderer note={note} transcript={transcript} />}
  </>
);
```

(Progress streaming via a separate `session/progress` IPC event — orchestrator emits per-phase events that the renderer subscribes to. Wire in same task.)

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/renderer/App.tsx \
        desktop/src/renderer/components/FamilyPickerStep.tsx \
        desktop/src/renderer/components/NoteRenderProgress.tsx \
        desktop/src/renderer/components/FamilyPickerStep.test.tsx \
        desktop/src/renderer/components/NoteRenderProgress.test.tsx
git commit -m "feat(v2-lecture): UI — Recording → FamilyPicker → progress → NoteView"
```

---

## Phase E — Migration + Eval + E2E + Verify (Tasks 13-16)

### Task 13: `loadNote()` + first concrete migration chain

**Goal:** Implement the spec §5.3 render-time loader: `loadNote(json)` → schemaVersion check → migration chain → Zod parse → ValidatedNote. Lecture v1 sample fixture exercises the chain runner with a no-op migration (current schemaVersion = 1, so v1→v1 is identity but the runner must invoke without error).

**Files:**
- Create: `desktop/src/shared/note-schema/load-note.ts`
- Create: `desktop/src/shared/note-schema/load-note.test.ts`
- Create: `desktop/src/shared/families/lecture/migrations/index.ts`
- Create: `desktop/src/shared/families/lecture/migrations/v1-fixture.json`

- [ ] **Step 1: Failing test**

```typescript
// load-note.test.ts
import { describe, it, expect } from 'vitest';
import { loadNote, ForwardIncompatNoteError } from './load-note';
import sample from '../families/lecture/migrations/v1-fixture.json';

describe('loadNote', () => {
  it('loads a v1 Lecture sample without throwing', () => {
    expect(() => loadNote(JSON.stringify(sample))).not.toThrow();
  });

  it('throws ForwardIncompatNoteError on schemaVersion > current', () => {
    const bad = { ...sample, schemaVersion: 999 };
    expect(() => loadNote(JSON.stringify(bad))).toThrow(ForwardIncompatNoteError);
  });

  it('routes by `family` discriminator', () => {
    const note = loadNote(JSON.stringify(sample));
    expect(note.family).toBe('lecture');
  });

  it('runs registered migrations in order on older schemaVersion', () => {
    // When schemaVersion 2 exists, this test will validate v1 → v2 migration runs.
    // For Plan 3 (schemaVersion 1 only), this is a placeholder test.
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```typescript
// load-note.ts
import { familyRegistry } from '../families';

const CURRENT_SCHEMA_VERSION = 1;

export class ForwardIncompatNoteError extends Error { /* same as pipeline.ts */ }

export function loadNote(json: string): ValidatedNote {
  const parsed = JSON.parse(json) as { schemaVersion: number; family: NoteFamily };
  if (parsed.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new ForwardIncompatNoteError(parsed.schemaVersion, CURRENT_SCHEMA_VERSION);
  }
  let migrated = parsed as any;
  const fam = familyRegistry.get(parsed.family);
  const migrations = fam.migrations ?? [];
  for (const mig of migrations) {
    if (mig.fromVersion === migrated.schemaVersion) {
      migrated = mig.run(migrated);
    }
  }
  return fam.schema.parse(migrated);
}
```

`migrations/index.ts`:
```typescript
// Lecture migrations registry. Empty for v1 — future schemaVersion 2 adds
// entries here.
export const lectureMigrations: Migration[] = [];
```

`v1-fixture.json`: a hand-curated valid Lecture note (~30 lines) sourced from the Spike 0.2 procedural-physics-em output (5 sections, 静電ポテンシャル content, no slot extras to keep concise).

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/shared/note-schema/load-note.ts \
        desktop/src/shared/note-schema/load-note.test.ts \
        desktop/src/shared/families/lecture/migrations/
git commit -m "feat(v2): loadNote + Lecture v1 migration chain runner"
```

### Task 14: Eval baseline registration

**Goal:** Freeze the Spike 0.2 best 3-run as Lecture's v0 baseline in `desktop/tests/fixtures/baselines/lecture/spike-0.2-v0.baseline.json`. Register in Plan 7's `evalBaselines` startup validator (`desktop/scripts/lib/eval-baselines.ts`, populated by Plan 7 Task 23) so the eval CLI picks it up.

**Files:**
- Create: `desktop/tests/fixtures/baselines/lecture/spike-0.2-v0.baseline.json`
- Modify: `desktop/scripts/lib/eval-baselines.ts` (append `'lecture/spike-0.2-v0'` to baselines list)

- [ ] **Step 1: Copy** the cleanest of the 3 Spike 0.2 result JSONs (likely run 0 — 4 sections, 4 slots) and **strip placeholder formulas** if `E=mc^2` parroting present. Annotate the baseline file's header comment:
  ```json
  {
    "_meta": "Lecture v0 baseline from Spike 0.2 run 0 (commit a85a682). Used by Plan 7 ContractTest + judge as the floor: regressions producing fewer sections / fewer slots / parroted formulas should be caught.",
    "schemaVersion": 1, "family": "lecture", ...
  }
  ```

- [ ] **Step 2: Register** in `eval-baselines.ts`:
  ```typescript
  export const evalBaselines: string[] = [
    'lecture/spike-0.2-v0',
    // 'meeting/...' lands in Plan 5
    // 'interview/...' / 'brainstorm/...' land in Plan 6
  ];
  ```

- [ ] **Step 3: Verify** Plan 7's startup validator picks it up:
  ```bash
  cd /Users/guntak/Lisna/desktop
  pnpm exec tsx scripts/eval.ts --check-baselines
  # Expected: "✓ 1 baseline registered, 1 found on disk"
  ```

- [ ] **Step 4: Commit.**

```bash
git add desktop/tests/fixtures/baselines/lecture/spike-0.2-v0.baseline.json \
        desktop/scripts/lib/eval-baselines.ts
git commit -m "test(v2-lecture): freeze Spike 0.2 v0 baseline + register in eval startup"
```

### Task 15: Hardware-gated E2E test

**Goal:** End-to-end test that records a tiny JA fixture (~30s), runs the full Lecture pipeline (chunkTranscript → grammar call → merge → render), asserts the output matches the baseline structurally (Plan 7 ContractTest level) + the Markdown render produces non-empty key sections. Gated behind `LISNA_LLM_INTEGRATION=1` env per `(spike-llm)` rule.

**Files:**
- Create: `desktop/src/integration/lecture-e2e.test.ts`
- Create: `desktop/src/integration/fixtures/lecture-30s.transcript.json`

- [ ] **Step 1: Failing test**

```typescript
// lecture-e2e.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { finalizeLecture } from '../main/sidecar/orchestrator';
import { spawnSidecar } from '../main/sidecar/spawn';
import { LectureNoteSchema } from '../shared/families/lecture/schema';

const HARD_GATED = process.env.LISNA_LLM_INTEGRATION === '1';

// Same hardware safety pattern as Spike 0.1 round-trip.test.ts.
afterAll(() => {
  try { execSync('pkill -9 -f llama-completion', { stdio: 'ignore' }); } catch {}
});

describe.skipIf(!HARD_GATED)('Lecture E2E (real LLM, hardware gated)', () => {
  it('runs the full pipeline on a 30s fixture and produces a valid LectureNote', async () => {
    const transcript = JSON.parse(readFileSync('src/integration/fixtures/lecture-30s.transcript.json', 'utf-8'));
    const sidecar = await spawnSidecar({ /* 3B path */ });
    const result = await finalizeLecture({
      sessionId: 'e2e-test',
      transcript,
      sidecar,
      modelProfile: /* 3B profile */,
      promptVariantId: 'lecture-v1',
    });
    expect(() => LectureNoteSchema.parse(result.note)).not.toThrow();
    expect(result.note.sections.length).toBeGreaterThanOrEqual(1);
    // ContractTest-level: every section has ts >= 0, summary non-empty, etc.
    for (const s of result.note.sections) {
      expect(s.ts).toBeGreaterThanOrEqual(0);
      expect(s.summary.length).toBeGreaterThan(0);
    }
    await sidecar.shutdown();
  }, 180_000);

  it('slot emergence ≥ 1 on the formula-rich physics fixture', async () => {
    /* Same as above but with a 30s physics fixture; expect at least 1 formula slot */
    expect(formulaSlotsEmitted).toBeGreaterThanOrEqual(1);
  }, 180_000);
});
```

- [ ] **Step 2: Run** without `LISNA_LLM_INTEGRATION=1` — expect SKIPPED (default CI behavior).

- [ ] **Step 3: Run** with `LISNA_LLM_INTEGRATION=1` locally:
```bash
cd /Users/guntak/Lisna/desktop
LISNA_LLM_INTEGRATION=1 pnpm exec vitest run src/integration/lecture-e2e.test.ts
```
Expect 2/2 PASS. Wall time ~60-180s depending on fixture length + hardware.

- [ ] **Step 4: Commit.**

```bash
git add desktop/src/integration/lecture-e2e.test.ts \
        desktop/src/integration/fixtures/lecture-30s.transcript.json
git commit -m "test(v2-lecture): hardware-gated E2E (LISNA_LLM_INTEGRATION=1)"
```

### Task 16: Verification gate (typecheck + full test run + recap)

**Goal:** Before marking Plan 3 DONE, run the verification gate. Per the global `superpowers:verification-before-completion` skill — claims of completion need evidence.

- [ ] **Step 1: Typecheck**
```bash
cd /Users/guntak/Lisna/desktop && pnpm exec tsc --noEmit 2>&1 | tail -10
```
Expect 0 errors.

- [ ] **Step 2: Full Lecture test sweep**
```bash
pnpm exec vitest run src/shared/families/lecture/ src/shared/post-decode/ src/main/sidecar/lecture-orchestrator.test.ts src/renderer/components/FamilyPickerStep.test.tsx src/renderer/components/NoteRenderProgress.test.tsx
```
Expect all PASS.

- [ ] **Step 3: Regression — Phase 0 spike tests still pass**
```bash
pnpm exec vitest run spikes/phase-0/04-chunking/ spikes/phase-0/01-zod-to-gbnf/
```
Expect all PASS.

- [ ] **Step 4: Hardware-gated smoke (optional but recommended before Plan 4)**
```bash
LISNA_LLM_INTEGRATION=1 pnpm exec vitest run src/integration/lecture-e2e.test.ts
```
Expect 2/2 PASS. Wall time and slot emergence captured.

- [ ] **Step 5: Self-review checklist** (see below) — walk through, confirm each item.

- [ ] **Step 6: Update VERDICT.md** at `desktop/spikes/phase-0/VERDICT.md` to reflect Plan 3 completion + any deviations.

- [ ] **Step 7: Commit verdict update.**

```bash
git add desktop/spikes/phase-0/VERDICT.md
git commit -m "docs(v2-lecture): Plan 3 verification gate cleared"
```

---

## Self-review checklist (do not skip)

After all 17 tasks complete, walk through:

- [ ] `LectureNote` schema matches spec §3.3 verbatim (field names, types, optionality).
- [ ] All Lecture arrays carry `.max(N)` per Path G — at least sections, key_terms, examples, points, extras, and per-slot inner arrays (steps, claims, events).
- [ ] `MAX_GEN_TOKENS = 3000` in ModelProfile (reduced from spike's 4096 per Path G tail-risk).
- [ ] System prompt explicitly forbids placeholder formulas (anti-parroting). No literal `E=mc^2` / `F=ma` exemplars.
- [ ] All 4 slots registered + each has `triggers` (for prompt-hint injection) + `promptHint` (string injected).
- [ ] `MergeStrategy` matches spec §5.2b Lecture defaults exactly.
- [ ] `deterministicMerge` handles 5 cases (longest scalar / first scalar / concat-only / concat-dedup / sortByTs) — unit tests exist for each.
- [ ] Post-decode pipeline runs Stages 1-5 in order. Stage 2 (id fill) is no-op for Lecture.
- [ ] Orchestrator extends without breaking v1 alpha path (recording capture is unchanged).
- [ ] `session/finalize` IPC channel dispatches by `family`; non-Lecture branches throw `not yet implemented` rather than silently doing nothing.
- [ ] Renderer is pure (no IPC, no fetch, no LLM access); ` ※ inferred` marker on every Provenance-bearing leaf where `from === 'inferred'`.
- [ ] `loadNote()` throws `ForwardIncompatNoteError` on future schemaVersion; runs migrations in order.
- [ ] Lecture v0 baseline registered + Plan 7 startup validator passes.
- [ ] Hardware-gated E2E exists and runs cleanly with `LISNA_LLM_INTEGRATION=1`.
- [ ] No `process.exit()` / no hardcoded paths / no `console.log` left in production code (test files OK).
- [ ] No `§` U+00A7 markers in user-facing rendered output (per global CLAUDE.md ban). The `※` U+203B is the locked marker.
- [ ] No `run_in_background:true` for any LLM-touching task; tests respect `(spike-llm)` rule.
- [ ] Commit-msg prefixes: every Plan 3 commit uses `feat|fix|chore|refactor|docs|test|perf|ci|style|build|revert(scope):` per repo hook.

---

## Next plan dependencies

Plan 5 (Meeting family) unlocks once:
- [ ] Task 3 lands (FamilyRegistry registration pattern — Plan 5 follows same shape)
- [ ] Task 8 lands (post-decode pipeline — Meeting reuses)
- [ ] Task 9 lands (orchestrator extension pattern — Meeting adds `family === 'meeting'` branch)
- [ ] Task 11 lands (renderer pattern — Meeting builds analogous JSX)
- [ ] Task 13 lands (loadNote + migration runner — Meeting adds its v1 fixture)
- [ ] Task 14 lands (eval baseline pattern — Meeting registers its baseline)

Plan 6 (Interview / Brainstorm / merge-LLM) unlocks once:
- [ ] All of Plan 5 dependencies above (same patterns reused)
- [ ] Plan 6's own Task 17 (Path G converter extension) — Plan 3 sees the `.max(N)` annotations but the GBNF emission must respect them; Plan 6 Task 17 is the converter side.

Plan 7 (Eval harness) unblocked tasks:
- [ ] Plan 7 Task 27 (Spike 0.2 v0 baseline lift) can run as soon as Plan 3 Task 14 lands.
- [ ] Plan 7 Lecture judge (Task 9 in Plan 7) is informed by Plan 3 Task 4's prompt rules — content-fidelity axis covers Plan 3 Task 4's anti-parroting prompt.

Plan 4 (Diarization) — independent. Plan 3 does NOT consume diarization (`requiresDiarization: false`). Plans 5/6 do.

---

## Open questions / decisions deferred to execution

1. **Renderer styling (`provenance-inferred` class)** — the visual treatment of `※ inferred` markers is design-side. Plan 3 Task 11 lands the markup; CSS is left for a downstream small commit (mockup at `.claude/mockups/note-marker-locked.html` shows the agreed appearance: dotted underline + `ink-500` color + small `※` glyph; do NOT use `§`).

2. **Sidecar grammar regeneration cost** — Task 9's orchestrator regenerates the GBNF on every session. If first-call latency is sensitive on cold launch, the `zodToGbnf()` output for `LectureNoteSchema` could be cached. Defer caching until Plan 7 measures the cost; Plan 3's spike timings (Spike 0.2) put first-call grammar emission at <100ms which is acceptable.

3. **Empty section handling** — if the LLM emits a `Lecture` with `sections: []` (transcript was all silence or filler), the renderer shows "empty session" per spec §5.3 fallback. Plan 3 renderer Task 11 implements this via a `note.sections.length === 0 ? <EmptyState /> : ...` branch — verify in tests.

4. **JA tokenizer for `recommendedChunkTokens` accuracy** — `chunkTranscript`'s `estimateTokens` (Plan 2 Task 6) uses heuristic 0.6 tok/char for JA. Real Whisper-output tokenization may diverge. Plan 7's eval harness should measure this drift over the alpha population.

5. **First-run model-resolver interaction** — if user hasn't picked an LLM in §5.1 picker (Plan 1 Step 5), `session/finalize` will surface the picker before proceeding. Plan 3 Task 10 should check `modelResolver.getCurrentModel()` and trigger the picker flow if no model is set. This delegates to existing Step 5 §5.1 code.

6. **Provenance ts proximity threshold** — `computeProvenance` (Plan 2 Task 9) matches a note item's `ts` to a transcript segment within a tolerance window (e.g. ±5s). If the LLM emits an item at `ts: 137` but the matching transcript phrase is at `ts: 142`, the item is `transcript`; if the closest segment is at `ts: 200`, it's `inferred`. The threshold (5s? 10s?) is a Plan 2 decision; Plan 3 inherits without override.

7. **Picker UX for ≤ 12 GB Macs** — Path F finding: 3B is required default until Plan 6 prompt engineering surfaces 1B viability. Plan 3 Task 12's `FamilyPickerStep` does NOT include a model-tier selector — that's the existing Step 5 §5.1 picker concern. Decoupling intentional.

8. **Telemetry persistence** — `GenerationTelemetry` JSON is persisted alongside the note per spec §3.1. Plan 3 Task 9 emits the structure; the actual file write happens in a small "persistence" helper that Plan 3 ships as part of Task 9 (`desktop/src/main/sidecar/persist-session.ts`).

---

## Hardware safety summary

| Task | LLM touched? | Discipline |
|---|---|---|
| 0-8, 10-14, 16 | NO (mocked or pure) | Standard unit-test |
| 9 (orchestrator) | NO (`mockSidecar`) | Standard unit-test |
| 15 (E2E) | YES (real 3B) | `LISNA_LLM_INTEGRATION=1` gate + `afterAll pkill` + foreground vitest + post-task `ps` check |

All real-LLM activity gated behind explicit env. The `(spike-llm)` rule applies to Task 15 — never `run_in_background:true`, always foreground, always ps-check after.

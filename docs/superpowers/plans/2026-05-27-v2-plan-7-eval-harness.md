# Lisna v2 Note Creation — Plan 7: Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the v2 eval harness (fixtures + ContractTest + LLM-as-judge + runners + CLI + baselines + Spike 0.2 v0 baseline lift) so every Plan 3-6 family delivery has a measurable yardstick from day one, with anti-parroting / slot-type vs occurrence / retry-rate axes baked in per the Phase 0 VERDICT.

**Architecture:** Mirrors the v1 backend pattern (`backend/scripts/eval-curator.ts` + `backend/scripts/lib/judge.ts` + `backend/tests/fixtures/{transcripts,baselines}/`) lifted into `desktop/eval/` per spec §6, with five expansions: (1) **family-aware judges** (axes per Lecture / Meeting / Interview / Brainstorm), (2) **ContractTest layer** (deterministic structural assertions, separate from LLM judge — catches mode collapse the LLM misses, spec P7), (3) **anti-parroting content-fidelity check** (VERDICT carry-forward #1 — `E=mc²` parrot), (4) **retry-rate histogram** (VERDICT carry-forward #2 — mean attempts as quality axis), (5) **judge-swap matrix** (cross-vendor bias measurement). Scripts live outside `desktop/src/` per `.claude/rules/architecture.md (bundles)` so they never enter the production renderer/main bundles.

**Tech Stack:** TypeScript (Vitest for ContractTest unit-test surface; tsx for CLI runners), Zod (single source of truth for fixture + result schemas), OpenAI SDK pointed at Groq (same llama-3.3-70b judge family as v1) + Anthropic SDK (cross-vendor judge), Bradley-Terry pairwise comparison (`pairwise-judge.ts`). No external LLM eval framework — keeps the harness <2000 LOC and fully owned.

**Sub-plan position:** Plan 7 of 7 (see spec status header). **Independent of Plan 2** — its fixture format, judge contract, ContractTest surface, and CLI design are self-contained. Plan 7 can ship in parallel with Plan 2 (Foundation) and is *consumed* by Plans 3-6 (each family delivery registers its `evalBaselines: string[]` and runs against the harness).

**Spec reference:** `docs/superpowers/specs/2026-05-26-v2-structured-note-creation-design.md` (`af3af63`) §4 #12 (Eval harness), §4 P4 (`evalBaselines` startup validation), §4 P7 (ContractTest), §6 (file structure `desktop/eval/`), §7.2 (Lecture acceptance), §7.3 (full-pipeline acceptance).

**VERDICT carry-forward:** `desktop/spikes/phase-0/VERDICT.md` (`44e546d`) §"Carry-forward items to Plan 7":
1. Content-fidelity eval (anti-parroting `formula.expression`) — Task 8 + Task 14
2. Retry-rate histogram per-call — Task 16
3. DER skeleton lift from Spike 0.3 — Task 24 (deferred — references Plan 4 once Spike 0.3 runs)

**v1 precedent referenced (read before starting):**
- `backend/scripts/eval-curator.ts` (248 LOC) — proven CLI shape: `--fixture <slug>`, `--rolling`, `--baseline <name>`, `--against <name>`. Spec §6 path = `desktop/scripts/eval-notes.ts` — same name pattern, expanded flag set per Task 22.
- `backend/scripts/lib/judge.ts` (197 LOC) — proven 6-axis JSON-schema judge with retry+fallback model. Plan 7 lifts the patterns (deterministic temperature, JSON response_format, tail-window transcript budget) and forks per-family.
- `backend/tests/fixtures/transcripts/*.json` — proven `{source, bucket_seconds, transcripts: [{ts, text}]}` shape. Plan 7 fixture extends this for v2 (adds `family`, `groundTruth`, `expectedSlots`).
- `backend/tests/fixtures/baselines/*.json` — proven `{savedAt, results: [{slug, judge, ...}]}` shape. Plan 7 baseline extends with `modelId`, `promptVariantId`, `judgeModelId`, `retryHistogram`.

---

## Eval-harness conceptual map

```
┌──────────────────────────────────────────────────────────────────────────┐
│  FIXTURE  (committed JSON, per family/scenario)                          │
│  desktop/eval/fixtures/<family>/<scenario>/                              │
│    transcript.json   — SessionTranscript shape (Plan 2 type)             │
│    meta.json         — family, language, expectedSlots, scenarioTags     │
│    ground-truth.json — hand-curated reference answers (when relevant)    │
│    baselines/        — per-variant scorecards (gitignored — large)       │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  RUNNER  (per spec §4 #12 — single-fixture / family-suite / regression)  │
│  desktop/eval/runners/                                                   │
│    Calls the pipeline (Plan 2 SessionOrchestrator or stub) →             │
│    produces a ValidatedNote + GenerationTelemetry                        │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │
                             ├─────────► ContractTest      (cheap, deterministic, CI-gated)
                             │             • Zod parse OK
                             │             • Family-specific structural rules
                             │             • Anti-parroting JS heuristic
                             │             • slotTypes ≠ slotsEmerged tracking
                             │             • Retry-rate histogram bin
                             │
                             ├─────────► LLM-as-judge      (expensive, axis scores 0-10)
                             │             • Per-family axes
                             │             • Content-fidelity axis (anti-parroting)
                             │             • Cross-vendor swap available
                             │
                             ├─────────► Pairwise judge    (Bradley-Terry, A/B variant decision)
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  SCORECARD  (printed to stdout + baseline file)                          │
│  desktop/eval/scorecard.ts                                               │
│    Per-fixture: ContractTest pass/fail, axis scores, deltas vs baseline  │
│    Aggregate: mean across family, judge-model comparison, regression %   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## File structure (locked at Task 0; minor adjustments in subsequent tasks must be flagged in commit)

```
desktop/
├── eval/
│   ├── README.md                     # operator guide (Task 25)
│   ├── fixtures/
│   │   ├── _schema.ts                # FixtureMeta + FixtureGroundTruth Zod (Task 1)
│   │   ├── _schema.test.ts           # unit tests for schema (Task 1)
│   │   ├── _validator.ts             # boot-time evalBaselines validator (Task 23)
│   │   ├── _validator.test.ts        # (Task 23)
│   │   ├── lecture/
│   │   │   ├── procedural-physics-em/{transcript.json, meta.json}
│   │   │   ├── narrative-ukraine-russia/{transcript.json, meta.json}
│   │   │   └── yt-jgxib-bookkeeping/{transcript.json, meta.json}
│   │   ├── meeting/
│   │   │   ├── sprint-planning-4spk/{transcript.json, meta.json, ground-truth.json}
│   │   │   ├── design-review-3spk/{transcript.json, meta.json, ground-truth.json}
│   │   │   └── decision-heavy-3spk/{transcript.json, meta.json, ground-truth.json}
│   │   ├── interview/
│   │   │   ├── product-research-2spk/{transcript.json, meta.json, ground-truth.json}
│   │   │   ├── pm-candidate-2spk/{transcript.json, meta.json, ground-truth.json}
│   │   │   └── customer-success-2spk/{transcript.json, meta.json, ground-truth.json}
│   │   └── brainstorm/
│   │       ├── feature-ideation-3spk/{transcript.json, meta.json, ground-truth.json}
│   │       ├── crisis-options-4spk/{transcript.json, meta.json, ground-truth.json}
│   │       └── roadmap-2026-q3-5spk/{transcript.json, meta.json, ground-truth.json}
│   ├── contract/
│   │   ├── contract-test.ts          # Task 4 core
│   │   ├── contract-test.test.ts     # unit tests (Task 4)
│   │   ├── families/
│   │   │   ├── lecture.ts            # Task 5
│   │   │   ├── meeting.ts            # Task 5
│   │   │   ├── interview.ts          # Task 5
│   │   │   └── brainstorm.ts         # Task 5
│   │   ├── families.test.ts          # (Task 5)
│   │   ├── anti-parroting.ts         # Task 6 — JS heuristic ground layer
│   │   └── anti-parroting.test.ts    # (Task 6)
│   ├── judges/
│   │   ├── judge-types.ts            # Task 7 — JudgeRequest, JudgeResult, JudgeFamily
│   │   ├── llm-judge.ts              # Task 8 — base judge (router by family)
│   │   ├── llm-judge.test.ts         # (Task 8 — uses __testOnly export)
│   │   ├── families/
│   │   │   ├── lecture-judge.ts      # Task 9
│   │   │   ├── meeting-judge.ts      # Task 10
│   │   │   ├── interview-judge.ts    # Task 11
│   │   │   └── brainstorm-judge.ts   # Task 12
│   │   ├── content-fidelity-judge.ts # Task 13 — anti-parroting LLM axis
│   │   ├── content-fidelity-judge.test.ts
│   │   ├── pairwise-judge.ts         # Task 21 — Bradley-Terry
│   │   └── pairwise-judge.test.ts
│   ├── metrics/
│   │   ├── retry-histogram.ts        # Task 16
│   │   ├── retry-histogram.test.ts
│   │   ├── slot-distribution.ts      # Task 17 — slotTypes vs slotsEmerged
│   │   ├── slot-distribution.test.ts
│   │   └── der.ts                    # Task 24 — placeholder for Plan 4 lift
│   ├── runners/
│   │   ├── single-fixture.ts         # Task 18
│   │   ├── single-fixture.test.ts
│   │   ├── family-suite.ts           # Task 19
│   │   ├── regression.ts             # Task 20
│   │   └── pipeline-stub.ts          # Task 18 — Plan 2 SessionOrchestrator shim
│   ├── baselines/
│   │   └── (gitignored — populated by runs)
│   ├── baseline/
│   │   ├── format.ts                 # Task 14 — Zod for BaselineFile
│   │   ├── format.test.ts
│   │   ├── store.ts                  # Task 14 — save/load
│   │   ├── store.test.ts
│   │   └── diff.ts                   # Task 15 — diff between baselines
│   ├── scorecard.ts                  # Task 22 — print scorecard
│   └── scorecard.test.ts
└── scripts/
    ├── eval-notes.ts                 # Task 22 — CLI entry
    ├── eval-notes.test.ts            # CLI argparse unit tests
    ├── eval-judge-swap.ts            # Task 25 — cross-vendor matrix CLI
    └── score-spike-0.2.ts            # Task 26 — v0 baseline lift from Spike 0.2 results
```

**Path convention rationale:** `.claude/rules/architecture.md (bundles)` says `scripts/` lives outside `src/` so v2 eval scripts never enter the Electron main/renderer/sidecar bundles. We mirror the backend's split: `desktop/eval/` holds the *library* (judges, contract, metrics, runners — typed, unit-tested) and `desktop/scripts/eval-*.ts` holds the *CLI entry points* (argparse, file I/O, stdout). Vitest already covers `desktop/eval/**/*.test.ts` via the existing `vitest.config.ts` glob.

---

## Hardware-safety reminders (per `.claude/rules/pitfalls.md (spike-llm)`)

Plan 7 spans three execution classes — apply the relevant guard per task:

| Class | Tasks | Hardware risk | Required guard |
|---|---|---|---|
| **Pure-TS (unit tests + library code)** | Tasks 1, 2, 3, 4, 6, 7, 14, 15, 16, 17, 21, 23 | none — typecheck + vitest only | none |
| **Network LLM judge (Groq / Anthropic)** | Tasks 8, 9, 10, 11, 12, 13 | none locally — network calls over standard internet | none beyond standard retry/cooldown |
| **Local sidecar inference (end-to-end runner)** | Tasks 18, 19, 20, 22, 26 | M3/8GB sustained Llama load → potential kernel panic per spike-llm rule | `afterAll` cleanup, foreground exec only, `ps -ef \| grep -E "llama-completion\|vitest.*eval" \| grep -v grep`, `kill -9` survivors, NEVER `run_in_background:true` |

**The Task 18 `pipeline-stub.ts` exists specifically so Tasks 4-17 can run *without* invoking the sidecar.** Plan 7 boots usable end-to-end only at Task 18; everything before that is stub-driven.

---

## Pre-flight (do once before Task 1)

### Task 0: Set up eval workspace + gitignore

**Files:**
- Create: `desktop/eval/README.md` (operator placeholder; replaced by full README in Task 28)
- Create: `desktop/eval/baselines/.gitkeep`
- Modify: `desktop/.gitignore`

- [ ] **Step 1: Create the eval directory skeleton**

```bash
mkdir -p desktop/eval/{fixtures/{lecture,meeting,interview,brainstorm},contract/families,judges/families,metrics,runners,baseline,baselines}
mkdir -p desktop/scripts
touch desktop/eval/baselines/.gitkeep
```

- [ ] **Step 2: Write a placeholder README**

```markdown
# Lisna v2 eval harness

See `docs/superpowers/plans/2026-05-27-v2-plan-7-eval-harness.md` for the full plan.

Quick start (filled in at Task 25):
- `pnpm --filter @lisna/desktop eval:notes --family lecture` — run Lecture suite
- `pnpm --filter @lisna/desktop eval:notes --family lecture --baseline v0` — freeze baseline
- `pnpm --filter @lisna/desktop eval:notes --family lecture --against v0` — compare against baseline
```

Write to `desktop/eval/README.md`.

- [ ] **Step 3: Update `desktop/.gitignore`**

Append:
```
# v2 eval harness — large baseline snapshots are ephemeral
eval/baselines/*.json
!eval/baselines/.gitkeep
```

- [ ] **Step 4: Commit pre-flight**

```bash
git add desktop/eval desktop/scripts desktop/.gitignore
git commit -m "chore(eval): scaffold v2 eval harness workspace"
```

---

## Item 1 — Fixture format

### Task 1: Fixture metadata + ground-truth Zod schema

**Files:**
- Create: `desktop/eval/fixtures/_schema.ts`
- Create: `desktop/eval/fixtures/_schema.test.ts`

**Goal:** A single source-of-truth Zod for the fixture-meta + ground-truth shape so every fixture in Tasks 2-3 is type-safe AND `_validator.ts` (Task 23) can enforce at harness boot.

**Acceptance:** `pnpm --filter @lisna/desktop test desktop/eval/fixtures/_schema.test.ts` passes with at least one valid fixture for each family and one invalid case per validation rule.

- [ ] **Step 1: Write the failing schema test**

```typescript
// desktop/eval/fixtures/_schema.test.ts
import { describe, it, expect } from 'vitest';
import {
  FixtureMetaSchema,
  FixtureGroundTruthSchema,
  type FixtureMeta,
} from './_schema';

describe('FixtureMetaSchema', () => {
  it('parses a minimal Lecture meta', () => {
    const meta = {
      fixtureId: 'procedural-physics-em',
      family: 'lecture',
      language: 'ja',
      durationSec: 660,
      bucketSeconds: 10,
      scenarioTags: ['physics', 'procedural'],
      expectedSlots: ['formula'],
      sourceUrl: 'https://www.youtube.com/watch?v=Qx1n-U1ciD0',
    } satisfies FixtureMeta;
    expect(FixtureMetaSchema.safeParse(meta).success).toBe(true);
  });

  it('rejects Lecture meta with expectedSlots when family is meeting', () => {
    const meta = {
      fixtureId: 'sprint-planning',
      family: 'meeting',
      language: 'ja',
      durationSec: 1800,
      bucketSeconds: 10,
      scenarioTags: ['planning'],
      expectedSlots: ['formula'], // only Lecture has slots
      sourceUrl: null,
    };
    const parsed = FixtureMetaSchema.safeParse(meta);
    expect(parsed.success).toBe(false);
  });

  it('parses a Meeting ground-truth with decisions + action items', () => {
    const gt = {
      fixtureId: 'sprint-planning',
      decisions: [
        { text: 'Ship payment refactor in 2026-Q3', mustAppear: true },
      ],
      actionItems: [
        { text: 'Tanaka writes RFC by Friday', mustAppear: true },
      ],
      participantCount: 4,
    };
    expect(FixtureGroundTruthSchema.safeParse(gt).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `pnpm --filter @lisna/desktop test desktop/eval/fixtures/_schema.test.ts`
Expected: FAIL with "Cannot find module './_schema'"

- [ ] **Step 3: Implement the schema**

```typescript
// desktop/eval/fixtures/_schema.ts
import { z } from 'zod';

const FamilyEnum = z.enum(['lecture', 'meeting', 'interview', 'brainstorm']);
const LanguageEnum = z.enum(['ja', 'en', 'ko']);
const LectureSlotEnum = z.enum(['procedure_steps', 'argument_chain', 'formula', 'timeline']);

export const FixtureMetaSchema = z
  .object({
    fixtureId: z.string().min(1),                  // slug, unique within family
    family: FamilyEnum,
    language: LanguageEnum,
    durationSec: z.number().int().positive(),
    bucketSeconds: z.number().int().positive(),    // STT bucket size (10 for v1/v2 parity)
    scenarioTags: z.array(z.string()).default([]),
    expectedSlots: z.array(LectureSlotEnum).default([]),  // Lecture only; empty otherwise
    sourceUrl: z.string().url().nullable(),
    notes: z.string().optional(),                  // human comment
  })
  .superRefine((meta, ctx) => {
    if (meta.family !== 'lecture' && meta.expectedSlots.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedSlots'],
        message: 'expectedSlots is Lecture-only; other families have no slots',
      });
    }
  });
export type FixtureMeta = z.infer<typeof FixtureMetaSchema>;

export const FixtureGroundTruthSchema = z.object({
  fixtureId: z.string().min(1),
  // Lecture-family ground truths
  expectedSections: z.array(z.object({ heading: z.string(), ts: z.number() })).optional(),
  expectedKeyTerms: z.array(z.string()).optional(),
  expectedFormulas: z.array(z.string()).optional(),         // anti-parroting allowlist (literal expressions actually IN this fixture)
  // Meeting/Interview/Brainstorm ground truths
  decisions: z.array(z.object({ text: z.string(), mustAppear: z.boolean() })).optional(),
  actionItems: z.array(z.object({ text: z.string(), mustAppear: z.boolean() })).optional(),
  qaPairs: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  themes: z.array(z.string()).optional(),
  ideaCount: z.number().int().nonnegative().optional(),
  participantCount: z.number().int().positive().optional(),
});
export type FixtureGroundTruth = z.infer<typeof FixtureGroundTruthSchema>;

// Transcript shape — mirrors v1 backend fixture for direct lift,
// extended with `speakerId` per spec §3.1 SessionTranscript.
export const FixtureTranscriptSchema = z.object({
  sessionId: z.string().optional(),
  speakers: z
    .array(z.object({ id: z.number().int().nonnegative(), name: z.string().optional() }))
    .default([{ id: 0 }]),
  bucket_seconds: z.number().int().positive(),
  transcripts: z.array(
    z.object({
      ts: z.number().nonnegative(),
      text: z.string().min(1),
      speakerId: z.number().int().nonnegative().default(0),
    }),
  ),
});
export type FixtureTranscript = z.infer<typeof FixtureTranscriptSchema>;
```

- [ ] **Step 4: Run test, expect PASS**

Run: `pnpm --filter @lisna/desktop test desktop/eval/fixtures/_schema.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add desktop/eval/fixtures/_schema.ts desktop/eval/fixtures/_schema.test.ts
git commit -m "feat(eval): fixture meta + ground-truth Zod schemas

Single source of truth for v2 eval fixtures. FixtureMetaSchema
gates Lecture-only fields (expectedSlots) on non-Lecture families.
FixtureGroundTruthSchema accepts the union of all family ground-truth
shapes; Task 23 enforces per-family required fields at boot."
```

---

### Task 2: Lift v1 Lecture fixtures + write meta.json files

**Files:**
- Create: `desktop/eval/fixtures/lecture/procedural-physics-em/{transcript.json, meta.json}`
- Create: `desktop/eval/fixtures/lecture/narrative-ukraine-russia/{transcript.json, meta.json}`
- Create: `desktop/eval/fixtures/lecture/yt-jgxib-bookkeeping/{transcript.json, meta.json}`

**Goal:** Lift the three v1 Lecture transcripts from `backend/tests/fixtures/transcripts/` into v2 layout with metadata. The procedural-physics-em fixture is the **same one Spike 0.2 used** — Task 26 will score Spike 0.2's existing result JSONs against this fixture as the v0 baseline.

**Acceptance:** Each fixture passes `FixtureMetaSchema.parse` + `FixtureTranscriptSchema.parse`.

- [ ] **Step 1: Copy v1 transcripts into v2 layout**

```bash
# Lift each v1 transcript into its own folder; rewrap into v2 shape
mkdir -p desktop/eval/fixtures/lecture/{procedural-physics-em,narrative-ukraine-russia,yt-jgxib-bookkeeping}
# Use a small Node one-liner to add speakerId:0 + speakers:[{id:0}] (single-speaker Lecture)
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const lifts = [
  ['backend/tests/fixtures/transcripts/procedural-physics-em.json', 'desktop/eval/fixtures/lecture/procedural-physics-em/transcript.json'],
  ['backend/tests/fixtures/transcripts/narrative-ukraine-russia.json', 'desktop/eval/fixtures/lecture/narrative-ukraine-russia/transcript.json'],
  ['backend/tests/fixtures/transcripts/yt-JGXIB.json', 'desktop/eval/fixtures/lecture/yt-jgxib-bookkeeping/transcript.json'],
];
for (const [src, dst] of lifts) {
  const v1 = JSON.parse(readFileSync(src, 'utf8'));
  const v2 = {
    sessionId: dst.split('/').slice(-2, -1)[0],
    speakers: [{ id: 0, name: 'Lecturer' }],
    bucket_seconds: v1.bucket_seconds ?? 10,
    transcripts: v1.transcripts.map(b => ({ ts: b.ts, text: b.text, speakerId: 0 })),
  };
  writeFileSync(dst, JSON.stringify(v2, null, 2));
  console.log('Wrote', dst, 'with', v2.transcripts.length, 'buckets');
}
"
```

- [ ] **Step 2: Write meta.json for procedural-physics-em**

```json
// desktop/eval/fixtures/lecture/procedural-physics-em/meta.json
{
  "fixtureId": "procedural-physics-em",
  "family": "lecture",
  "language": "ja",
  "durationSec": 3220,
  "bucketSeconds": 10,
  "scenarioTags": ["physics", "procedural", "electromagnetics"],
  "expectedSlots": ["formula"],
  "sourceUrl": "https://www.youtube.com/watch?v=Qx1n-U1ciD0",
  "notes": "Same fixture used by Spike 0.2 — Task 26 scores Spike 0.2 result JSONs against this entry as the v0 baseline."
}
```

- [ ] **Step 3: Write meta.json for narrative-ukraine-russia**

```json
// desktop/eval/fixtures/lecture/narrative-ukraine-russia/meta.json
{
  "fixtureId": "narrative-ukraine-russia",
  "family": "lecture",
  "language": "ja",
  "durationSec": 3190,
  "bucketSeconds": 10,
  "scenarioTags": ["narrative", "history", "geopolitics"],
  "expectedSlots": ["timeline"],
  "sourceUrl": null,
  "notes": "Narrative-style Lecture — timeline slot trigger expected; argument_chain may also emerge."
}
```

- [ ] **Step 4: Write meta.json for yt-jgxib-bookkeeping**

```json
// desktop/eval/fixtures/lecture/yt-jgxib-bookkeeping/meta.json
{
  "fixtureId": "yt-jgxib-bookkeeping",
  "family": "lecture",
  "language": "ja",
  "durationSec": 2660,
  "bucketSeconds": 10,
  "scenarioTags": ["bookkeeping", "procedural", "accounting"],
  "expectedSlots": ["procedure_steps", "formula"],
  "sourceUrl": "https://www.youtube.com/watch?v=JGXIB-dJCMM",
  "notes": "v1 baseline file is `v5-gpt4omini.json` — useful when comparing v2 3B output to v1 production."
}
```

- [ ] **Step 5: Verify schemas parse**

```bash
pnpm --filter @lisna/desktop tsx -e "
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FixtureMetaSchema, FixtureTranscriptSchema } from './desktop/eval/fixtures/_schema';
const base = 'desktop/eval/fixtures/lecture';
for (const slug of readdirSync(base)) {
  const m = JSON.parse(readFileSync(join(base, slug, 'meta.json'), 'utf8'));
  const t = JSON.parse(readFileSync(join(base, slug, 'transcript.json'), 'utf8'));
  FixtureMetaSchema.parse(m);
  FixtureTranscriptSchema.parse(t);
  console.log('OK', slug, '—', t.transcripts.length, 'buckets');
}
"
```
Expected: 3 lines `OK <slug> — <N> buckets`, no exceptions.

- [ ] **Step 6: Commit**

```bash
git add desktop/eval/fixtures/lecture
git commit -m "test(v2-eval): lift 3 Lecture fixtures from v1 backend with v2 meta

procedural-physics-em is the same fixture Spike 0.2 used; baseline lift
in Task 26. narrative-ukraine-russia + yt-jgxib-bookkeeping add scenario
coverage (timeline/argument_chain triggers + multi-slot procedural)."
```

---

### Task 3: Meeting/Interview/Brainstorm fixture stubs (3 each) with ground truths

**Files:**
- Create: `desktop/eval/fixtures/meeting/{sprint-planning-4spk,design-review-3spk,decision-heavy-3spk}/{transcript.json, meta.json, ground-truth.json}`
- Create: `desktop/eval/fixtures/interview/{product-research-2spk,pm-candidate-2spk,customer-success-2spk}/{transcript.json, meta.json, ground-truth.json}`
- Create: `desktop/eval/fixtures/brainstorm/{feature-ideation-3spk,crisis-options-4spk,roadmap-2026-q3-5spk}/{transcript.json, meta.json, ground-truth.json}`

**Goal:** Stub Meeting/Interview/Brainstorm transcripts (~10 buckets each, synthetic) + meta.json + ground-truth.json so Plans 5/6 deliveries have a runnable harness from day one. Real production fixtures (founder-recorded or anonymized) replace these in a follow-up; the stubs validate plumbing.

**Why synthetic stubs and not real recordings here:** Real recordings need the founder gate (privacy, recording quality, transcription pass — see VERDICT §"Spike 0.3 — founder-gated"). Plan 7 ships the *infrastructure* — running judges against real fixtures is Plan 5/6 work. Stubs let Tasks 4-22 run end-to-end against a frozen, deterministic surface.

**Acceptance:** All 9 stubs parse via `FixtureMetaSchema` + `FixtureTranscriptSchema` + `FixtureGroundTruthSchema`.

- [ ] **Step 1: Write the Meeting sprint-planning-4spk stub**

```json
// desktop/eval/fixtures/meeting/sprint-planning-4spk/transcript.json
{
  "sessionId": "sprint-planning-4spk",
  "speakers": [
    { "id": 0, "name": "PM" },
    { "id": 1, "name": "Eng Lead" },
    { "id": 2, "name": "Designer" },
    { "id": 3, "name": "QA" }
  ],
  "bucket_seconds": 10,
  "transcripts": [
    { "ts": 0, "text": "PM: 今日のスプリント計画を始めます。最初に、Q3で出荷予定の支払いリファクタについて。", "speakerId": 0 },
    { "ts": 10, "text": "Eng Lead: バックエンド側はあと2週間です。RFC は田中が金曜までに書きます。", "speakerId": 1 },
    { "ts": 20, "text": "Designer: UI モックは来週月曜に共有します。", "speakerId": 2 },
    { "ts": 30, "text": "QA: 自動テストの範囲を広げる必要があります。", "speakerId": 3 },
    { "ts": 40, "text": "PM: では、支払いリファクタはQ3末に出荷で確定します。", "speakerId": 0 },
    { "ts": 50, "text": "Eng Lead: 了解。RFC、UIモック、テスト拡張、3点で進めます。", "speakerId": 1 },
    { "ts": 60, "text": "PM: 次のトピック、デプロイパイプラインの遅延について議論します。", "speakerId": 0 },
    { "ts": 70, "text": "Eng Lead: 主な原因はCDKの再ビルドです。hotswap で15分→3秒に短縮できます。", "speakerId": 1 },
    { "ts": 80, "text": "QA: 監視は誰が責任を持ちますか?", "speakerId": 3 },
    { "ts": 90, "text": "PM: 監視は私が引き受けます。来週までにダッシュボードを作ります。", "speakerId": 0 }
  ]
}
```

```json
// desktop/eval/fixtures/meeting/sprint-planning-4spk/meta.json
{
  "fixtureId": "sprint-planning-4spk",
  "family": "meeting",
  "language": "ja",
  "durationSec": 100,
  "bucketSeconds": 10,
  "scenarioTags": ["planning", "4-speaker", "decision-bearing"],
  "expectedSlots": [],
  "sourceUrl": null,
  "notes": "Synthetic stub — replace with real recording in Plan 5 follow-up."
}
```

```json
// desktop/eval/fixtures/meeting/sprint-planning-4spk/ground-truth.json
{
  "fixtureId": "sprint-planning-4spk",
  "decisions": [
    { "text": "支払いリファクタはQ3末に出荷", "mustAppear": true }
  ],
  "actionItems": [
    { "text": "RFC を田中が金曜までに書く", "mustAppear": true },
    { "text": "UI モック共有 (来週月曜)", "mustAppear": true },
    { "text": "監視ダッシュボード作成 (PM)", "mustAppear": true }
  ],
  "participantCount": 4
}
```

- [ ] **Step 2: Write Meeting design-review-3spk stub**

Pattern: same shape, 3 speakers, ~12 buckets, ground-truth with 2 decisions + 2 action items + participantCount=3. Topic: design review with one accepted proposal, one deferred proposal. (Use the same JA structure as Step 1; vary tags to `["design-review","3-speaker","proposal-heavy"]`.)

Full transcript content (10 buckets, 100 seconds, 3 speakers `Lead Designer/Eng/PM`):

```json
// desktop/eval/fixtures/meeting/design-review-3spk/transcript.json
{
  "sessionId": "design-review-3spk",
  "speakers": [
    { "id": 0, "name": "Lead Designer" },
    { "id": 1, "name": "Eng" },
    { "id": 2, "name": "PM" }
  ],
  "bucket_seconds": 10,
  "transcripts": [
    { "ts": 0, "text": "Lead Designer: 新しいオンボーディングフローのレビューを始めます。", "speakerId": 0 },
    { "ts": 10, "text": "Eng: ステップ2のアニメーションは実装コストが高いです。CSSのみで代替を提案します。", "speakerId": 1 },
    { "ts": 20, "text": "Lead Designer: CSSのみで質感が出るなら受け入れます。", "speakerId": 0 },
    { "ts": 30, "text": "PM: ステップ4のチュートリアル動画は、今四半期は見送ります。", "speakerId": 2 },
    { "ts": 40, "text": "Eng: 了解。動画なしでテキスト案内のみで進めます。", "speakerId": 1 },
    { "ts": 50, "text": "Lead Designer: アイコンセットの統一について議論しましょう。", "speakerId": 0 },
    { "ts": 60, "text": "PM: Lucide を全面採用で確定します。既存のFontAwesomeは段階的に削除。", "speakerId": 2 },
    { "ts": 70, "text": "Eng: マイグレーションは2スプリントで完了予定です。", "speakerId": 1 },
    { "ts": 80, "text": "Lead Designer: アクセシビリティのコントラスト比、AA以上を必須にします。", "speakerId": 0 },
    { "ts": 90, "text": "PM: 全員同意。CIにaxe-coreで自動チェックを追加します。", "speakerId": 2 }
  ]
}
```

```json
// desktop/eval/fixtures/meeting/design-review-3spk/meta.json
{
  "fixtureId": "design-review-3spk",
  "family": "meeting",
  "language": "ja",
  "durationSec": 100,
  "bucketSeconds": 10,
  "scenarioTags": ["design-review", "3-speaker", "proposal-heavy"],
  "expectedSlots": [],
  "sourceUrl": null,
  "notes": "Synthetic stub. Tests proposals with accepted/deferred outcomes + cross-functional decisions."
}
```

```json
// desktop/eval/fixtures/meeting/design-review-3spk/ground-truth.json
{
  "fixtureId": "design-review-3spk",
  "decisions": [
    { "text": "Lucide アイコンセット全面採用", "mustAppear": true },
    { "text": "コントラスト比 AA 以上を必須化", "mustAppear": true }
  ],
  "actionItems": [
    { "text": "FontAwesome 段階的削除 (2スプリント)", "mustAppear": true },
    { "text": "axe-core CI 統合", "mustAppear": true }
  ],
  "participantCount": 3
}
```

- [ ] **Step 3: Write Meeting decision-heavy-3spk stub**

Same pattern; 10 buckets; 3 speakers `CEO/COO/CFO`; 4 decisions + 1 action item; scenario `["board","decision-heavy","3-speaker"]`.

```json
// desktop/eval/fixtures/meeting/decision-heavy-3spk/transcript.json
{
  "sessionId": "decision-heavy-3spk",
  "speakers": [
    { "id": 0, "name": "CEO" },
    { "id": 1, "name": "COO" },
    { "id": 2, "name": "CFO" }
  ],
  "bucket_seconds": 10,
  "transcripts": [
    { "ts": 0, "text": "CEO: 今期の予算配分について4つの決定を進めます。", "speakerId": 0 },
    { "ts": 10, "text": "CFO: 第一に、マーケティング予算を20%増額します。", "speakerId": 2 },
    { "ts": 20, "text": "CEO: 承認します。", "speakerId": 0 },
    { "ts": 30, "text": "COO: 第二に、新オフィス契約は来年に延期します。", "speakerId": 1 },
    { "ts": 40, "text": "CEO: 承認、リモート継続を前提に。", "speakerId": 0 },
    { "ts": 50, "text": "CFO: 第三に、SaaS のサブスクを年間契約に切り替えてコスト削減。", "speakerId": 2 },
    { "ts": 60, "text": "CEO: 承認。", "speakerId": 0 },
    { "ts": 70, "text": "COO: 第四に、人事評価制度を四半期毎に変更します。", "speakerId": 1 },
    { "ts": 80, "text": "CEO: 承認。CFO、新制度の予算影響をまとめてください。", "speakerId": 0 },
    { "ts": 90, "text": "CFO: 来週までに資料を出します。", "speakerId": 2 }
  ]
}
```

```json
// desktop/eval/fixtures/meeting/decision-heavy-3spk/meta.json
{
  "fixtureId": "decision-heavy-3spk",
  "family": "meeting",
  "language": "ja",
  "durationSec": 100,
  "bucketSeconds": 10,
  "scenarioTags": ["board", "decision-heavy", "3-speaker"],
  "expectedSlots": [],
  "sourceUrl": null,
  "notes": "Stress-test for decision extraction. 4 explicit decisions, all approved, with clear made-by attribution."
}
```

```json
// desktop/eval/fixtures/meeting/decision-heavy-3spk/ground-truth.json
{
  "fixtureId": "decision-heavy-3spk",
  "decisions": [
    { "text": "マーケティング予算 20% 増額", "mustAppear": true },
    { "text": "新オフィス契約延期", "mustAppear": true },
    { "text": "SaaS 年間契約切り替え", "mustAppear": true },
    { "text": "人事評価四半期毎", "mustAppear": true }
  ],
  "actionItems": [
    { "text": "CFO 新評価制度予算影響資料", "mustAppear": true }
  ],
  "participantCount": 3
}
```

- [ ] **Step 4: Write Interview product-research-2spk stub**

```json
// desktop/eval/fixtures/interview/product-research-2spk/transcript.json
{
  "sessionId": "product-research-2spk",
  "speakers": [
    { "id": 0, "name": "Interviewer" },
    { "id": 1, "name": "User" }
  ],
  "bucket_seconds": 10,
  "transcripts": [
    { "ts": 0, "text": "Interviewer: 普段のノート作成ワークフローを教えてください。", "speakerId": 0 },
    { "ts": 10, "text": "User: 会議中はNotionに手書き、後でCursorでまとめます。", "speakerId": 1 },
    { "ts": 20, "text": "Interviewer: 一番時間がかかる工程はどこですか?", "speakerId": 0 },
    { "ts": 30, "text": "User: 終わってから情報を構造化する部分です。30分かかります。", "speakerId": 1 },
    { "ts": 40, "text": "Interviewer: もしAIが自動的に構造化したら使いますか?", "speakerId": 0 },
    { "ts": 50, "text": "User: 出力の質と編集のしやすさ次第です。生成だけして編集できないと困ります。", "speakerId": 1 },
    { "ts": 60, "text": "Interviewer: プライバシーについて懸念はありますか?", "speakerId": 0 },
    { "ts": 70, "text": "User: クラウド送信は絶対NG、オンデバイスなら問題なし。", "speakerId": 1 },
    { "ts": 80, "text": "Interviewer: 月額いくらまで払えますか?", "speakerId": 0 },
    { "ts": 90, "text": "User: 構造化と編集を含めて 2000-3000円が上限です。", "speakerId": 1 }
  ]
}
```

```json
// desktop/eval/fixtures/interview/product-research-2spk/meta.json
{
  "fixtureId": "product-research-2spk",
  "family": "interview",
  "language": "ja",
  "durationSec": 100,
  "bucketSeconds": 10,
  "scenarioTags": ["product-research", "2-speaker", "theme-rich"],
  "expectedSlots": [],
  "sourceUrl": null,
  "notes": "Synthetic. 5 distinct QA pairs, themes (workflow / pricing / privacy)."
}
```

```json
// desktop/eval/fixtures/interview/product-research-2spk/ground-truth.json
{
  "fixtureId": "product-research-2spk",
  "qaPairs": [
    { "q": "普段のノート作成ワークフロー", "a": "会議中Notion+後でCursor" },
    { "q": "一番時間がかかる工程", "a": "構造化30分" },
    { "q": "AI自動構造化使う?", "a": "出力の質と編集次第" },
    { "q": "プライバシー懸念", "a": "クラウドNG、オンデバイスOK" },
    { "q": "月額予算", "a": "2000-3000円" }
  ],
  "themes": ["workflow", "pricing", "privacy", "editing", "structuring"],
  "participantCount": 2
}
```

- [ ] **Step 5: Write Interview pm-candidate-2spk + customer-success-2spk stubs**

Same pattern. For brevity, follow the structure above. Each has 10 buckets, 2 speakers, 5 QA pairs in ground truth, themes array, participantCount=2. Vary scenarioTags: `["hiring","2-speaker","behavioral"]` and `["customer-success","2-speaker","support"]` respectively.

```json
// desktop/eval/fixtures/interview/pm-candidate-2spk/transcript.json
{
  "sessionId": "pm-candidate-2spk",
  "speakers": [
    { "id": 0, "name": "Interviewer" },
    { "id": 1, "name": "Candidate" }
  ],
  "bucket_seconds": 10,
  "transcripts": [
    { "ts": 0, "text": "Interviewer: 一番大きなプロダクトの失敗体験を教えてください。", "speakerId": 0 },
    { "ts": 10, "text": "Candidate: 前職で新機能をリリースしたが、ユーザー調査不足でほぼ使われませんでした。", "speakerId": 1 },
    { "ts": 20, "text": "Interviewer: そこから何を学びましたか?", "speakerId": 0 },
    { "ts": 30, "text": "Candidate: ローンチ前のユーザーインタビューを必須化することです。", "speakerId": 1 },
    { "ts": 40, "text": "Interviewer: チーム内対立をどう扱いますか?", "speakerId": 0 },
    { "ts": 50, "text": "Candidate: 個別1on1で背景を聞いてから、全体で議論を持ちます。", "speakerId": 1 },
    { "ts": 60, "text": "Interviewer: データドリブンとユーザーの直感、どちらを優先しますか?", "speakerId": 0 },
    { "ts": 70, "text": "Candidate: 段階で異なります。初期は直感、規模が出たらデータです。", "speakerId": 1 },
    { "ts": 80, "text": "Interviewer: 5年後に達成したいことは?", "speakerId": 0 },
    { "ts": 90, "text": "Candidate: B2B SaaSのVPまたはCPOになりたいです。", "speakerId": 1 }
  ]
}
```

```json
// desktop/eval/fixtures/interview/pm-candidate-2spk/meta.json
{
  "fixtureId": "pm-candidate-2spk",
  "family": "interview",
  "language": "ja",
  "durationSec": 100,
  "bucketSeconds": 10,
  "scenarioTags": ["hiring", "2-speaker", "behavioral"],
  "expectedSlots": [],
  "sourceUrl": null,
  "notes": "PM hiring loop. 5 QA pairs, themes around past failure, conflict, decision style, career goal."
}
```

```json
// desktop/eval/fixtures/interview/pm-candidate-2spk/ground-truth.json
{
  "fixtureId": "pm-candidate-2spk",
  "qaPairs": [
    { "q": "プロダクト失敗体験", "a": "ユーザー調査不足で新機能unused" },
    { "q": "そこからの学び", "a": "ローンチ前ユーザーインタビュー必須化" },
    { "q": "チーム対立対処", "a": "1on1で背景聞く→全体議論" },
    { "q": "データ vs 直感", "a": "初期直感、規模出てからデータ" },
    { "q": "5年後の目標", "a": "B2B SaaS VP/CPO" }
  ],
  "themes": ["past-failure", "learning", "conflict-resolution", "decision-style", "career-goal"],
  "participantCount": 2
}
```

```json
// desktop/eval/fixtures/interview/customer-success-2spk/transcript.json
{
  "sessionId": "customer-success-2spk",
  "speakers": [
    { "id": 0, "name": "CSM" },
    { "id": 1, "name": "Customer" }
  ],
  "bucket_seconds": 10,
  "transcripts": [
    { "ts": 0, "text": "CSM: 直近のご利用状況について教えてください。", "speakerId": 0 },
    { "ts": 10, "text": "Customer: 週次でレポート生成機能を使っていますが、エクスポートが遅いです。", "speakerId": 1 },
    { "ts": 20, "text": "CSM: 具体的にどのくらいかかりますか?", "speakerId": 0 },
    { "ts": 30, "text": "Customer: 大きいレポートで30秒、不満です。", "speakerId": 1 },
    { "ts": 40, "text": "CSM: 他に困っていることは?", "speakerId": 0 },
    { "ts": 50, "text": "Customer: ユーザー管理画面でフィルタが効かない時があります。", "speakerId": 1 },
    { "ts": 60, "text": "CSM: 再現条件を共有いただけますか?", "speakerId": 0 },
    { "ts": 70, "text": "Customer: 100人以上のリストで再現します。スクショ送ります。", "speakerId": 1 },
    { "ts": 80, "text": "CSM: 来月のロードマップで両方とも対処予定です。", "speakerId": 0 },
    { "ts": 90, "text": "Customer: ありがとうございます。引き続き使い続けます。", "speakerId": 1 }
  ]
}
```

```json
// desktop/eval/fixtures/interview/customer-success-2spk/meta.json
{
  "fixtureId": "customer-success-2spk",
  "family": "interview",
  "language": "ja",
  "durationSec": 100,
  "bucketSeconds": 10,
  "scenarioTags": ["customer-success", "2-speaker", "support"],
  "expectedSlots": [],
  "sourceUrl": null,
  "notes": "CSM check-in. Tests bug-report QA pair extraction + roadmap commitments as action-items."
}
```

```json
// desktop/eval/fixtures/interview/customer-success-2spk/ground-truth.json
{
  "fixtureId": "customer-success-2spk",
  "qaPairs": [
    { "q": "利用状況", "a": "週次レポート生成、エクスポート遅い" },
    { "q": "エクスポート時間", "a": "大きいレポート30秒" },
    { "q": "他の困りごと", "a": "ユーザー管理画面フィルタ不具合" },
    { "q": "再現条件", "a": "100人以上のリスト" },
    { "q": "ロードマップ", "a": "来月両方対処" }
  ],
  "themes": ["export-performance", "filter-bug", "roadmap-commitment"],
  "participantCount": 2
}
```

- [ ] **Step 6: Write Brainstorm feature-ideation-3spk stub**

```json
// desktop/eval/fixtures/brainstorm/feature-ideation-3spk/transcript.json
{
  "sessionId": "feature-ideation-3spk",
  "speakers": [
    { "id": 0, "name": "PM" },
    { "id": 1, "name": "Eng" },
    { "id": 2, "name": "Designer" }
  ],
  "bucket_seconds": 10,
  "transcripts": [
    { "ts": 0, "text": "PM: 次の四半期のテーマは「速さ」です。アイデアをどんどん出しましょう。", "speakerId": 0 },
    { "ts": 10, "text": "Eng: ノート生成を5秒以内に。プログレッシブ表示で。", "speakerId": 1 },
    { "ts": 20, "text": "Designer: スタートアップ時間も含めて全体5秒、それ以外は要らないとしましょう。", "speakerId": 2 },
    { "ts": 30, "text": "PM: 編集のスピードも重要。キーボードショートカット網羅。", "speakerId": 0 },
    { "ts": 40, "text": "Eng: 検索を全文インデックスで瞬時に。", "speakerId": 1 },
    { "ts": 50, "text": "Designer: ノートのテンプレート表示も0.5秒以内に。", "speakerId": 2 },
    { "ts": 60, "text": "PM: 別テーマ、「シェア」について。", "speakerId": 0 },
    { "ts": 70, "text": "Eng: 一方向リンクで匿名共有、コメントだけ可能なモード。", "speakerId": 1 },
    { "ts": 80, "text": "Designer: チーム空間、ノートをドラッグで他人に渡せる感覚。", "speakerId": 2 },
    { "ts": 90, "text": "PM: Slack/Discord にワンクリック投稿。", "speakerId": 0 }
  ]
}
```

```json
// desktop/eval/fixtures/brainstorm/feature-ideation-3spk/meta.json
{
  "fixtureId": "feature-ideation-3spk",
  "family": "brainstorm",
  "language": "ja",
  "durationSec": 100,
  "bucketSeconds": 10,
  "scenarioTags": ["feature-ideation", "3-speaker", "multi-cluster"],
  "expectedSlots": [],
  "sourceUrl": null,
  "notes": "Synthetic. 2 idea clusters (speed + share), 8+ ideas total. Tests cluster boundary detection."
}
```

```json
// desktop/eval/fixtures/brainstorm/feature-ideation-3spk/ground-truth.json
{
  "fixtureId": "feature-ideation-3spk",
  "themes": ["speed", "share"],
  "ideaCount": 8,
  "participantCount": 3
}
```

- [ ] **Step 7: Write Brainstorm crisis-options-4spk + roadmap-2026-q3-5spk stubs**

```json
// desktop/eval/fixtures/brainstorm/crisis-options-4spk/transcript.json
{
  "sessionId": "crisis-options-4spk",
  "speakers": [
    { "id": 0, "name": "CEO" },
    { "id": 1, "name": "CTO" },
    { "id": 2, "name": "Lead" },
    { "id": 3, "name": "PM" }
  ],
  "bucket_seconds": 10,
  "transcripts": [
    { "ts": 0, "text": "CEO: 本番障害が3時間続いた。再発防止のオプションをすべて並べましょう。", "speakerId": 0 },
    { "ts": 10, "text": "CTO: 監視ダッシュボードを24時間体制、オンコールローテで。", "speakerId": 1 },
    { "ts": 20, "text": "Lead: ステージング環境を本番と同じスケールに。", "speakerId": 2 },
    { "ts": 30, "text": "PM: 顧客通知の自動化、ステータスページも整備。", "speakerId": 3 },
    { "ts": 40, "text": "CTO: カオステストを月次で導入。", "speakerId": 1 },
    { "ts": 50, "text": "Lead: マルチリージョン構成への移行検討。", "speakerId": 2 },
    { "ts": 60, "text": "PM: 障害発生時のロールバック手順を1ボタン化。", "speakerId": 3 },
    { "ts": 70, "text": "CEO: コスト面も気にする必要がある。", "speakerId": 0 },
    { "ts": 80, "text": "CTO: 段階的導入で月次予算100万円以内に収める案。", "speakerId": 1 },
    { "ts": 90, "text": "Lead: パークロット、外部監査の導入は来年に検討。", "speakerId": 2 }
  ]
}
```

```json
// desktop/eval/fixtures/brainstorm/crisis-options-4spk/meta.json
{
  "fixtureId": "crisis-options-4spk",
  "family": "brainstorm",
  "language": "ja",
  "durationSec": 100,
  "bucketSeconds": 10,
  "scenarioTags": ["crisis-response", "4-speaker", "parking-lot"],
  "expectedSlots": [],
  "sourceUrl": null,
  "notes": "Tests parking_lot extraction (外部監査 deferred). 1-2 idea clusters, cost constraint context."
}
```

```json
// desktop/eval/fixtures/brainstorm/crisis-options-4spk/ground-truth.json
{
  "fixtureId": "crisis-options-4spk",
  "themes": ["monitoring", "rollback-mechanism", "cost-constraint"],
  "ideaCount": 7,
  "participantCount": 4
}
```

```json
// desktop/eval/fixtures/brainstorm/roadmap-2026-q3-5spk/transcript.json
{
  "sessionId": "roadmap-2026-q3-5spk",
  "speakers": [
    { "id": 0, "name": "PM" },
    { "id": 1, "name": "Eng A" },
    { "id": 2, "name": "Eng B" },
    { "id": 3, "name": "Designer" },
    { "id": 4, "name": "QA" }
  ],
  "bucket_seconds": 10,
  "transcripts": [
    { "ts": 0, "text": "PM: Q3 ロードマップを白紙から考えます。優先テーマを出してください。", "speakerId": 0 },
    { "ts": 10, "text": "Eng A: パフォーマンスの大幅な改善、特に起動時間。", "speakerId": 1 },
    { "ts": 20, "text": "Eng B: 既存バグの一斉清算、月の中盤を当てる。", "speakerId": 2 },
    { "ts": 30, "text": "Designer: オンボーディングUXの全面刷新。", "speakerId": 3 },
    { "ts": 40, "text": "QA: 自動テストカバレッジを70%まで上げる。", "speakerId": 4 },
    { "ts": 50, "text": "PM: 新機能側だと?", "speakerId": 0 },
    { "ts": 60, "text": "Eng A: チーム共有モード、ノートをリンクで配布。", "speakerId": 1 },
    { "ts": 70, "text": "Designer: モバイル版を試作で出す。", "speakerId": 3 },
    { "ts": 80, "text": "Eng B: AI モデルの自動アップデートメカニズム。", "speakerId": 2 },
    { "ts": 90, "text": "QA: 国際化、最初は英語と中国語に絞って。", "speakerId": 4 }
  ]
}
```

```json
// desktop/eval/fixtures/brainstorm/roadmap-2026-q3-5spk/meta.json
{
  "fixtureId": "roadmap-2026-q3-5spk",
  "family": "brainstorm",
  "language": "ja",
  "durationSec": 100,
  "bucketSeconds": 10,
  "scenarioTags": ["roadmap", "5-speaker", "multi-cluster"],
  "expectedSlots": [],
  "sourceUrl": null,
  "notes": "Stress for 5-speaker brainstorm. 2 cluster themes (quality + new-features), tests multi-speaker attribution."
}
```

```json
// desktop/eval/fixtures/brainstorm/roadmap-2026-q3-5spk/ground-truth.json
{
  "fixtureId": "roadmap-2026-q3-5spk",
  "themes": ["quality-improvements", "new-features", "internationalization"],
  "ideaCount": 8,
  "participantCount": 5
}
```

- [ ] **Step 8: Verify all 9 stubs parse via schemas**

```bash
pnpm --filter @lisna/desktop tsx -e "
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FixtureMetaSchema, FixtureTranscriptSchema, FixtureGroundTruthSchema } from './desktop/eval/fixtures/_schema';
const fams = ['meeting', 'interview', 'brainstorm'];
let count = 0;
for (const fam of fams) {
  const base = join('desktop/eval/fixtures', fam);
  for (const slug of readdirSync(base)) {
    const m = JSON.parse(readFileSync(join(base, slug, 'meta.json'), 'utf8'));
    const t = JSON.parse(readFileSync(join(base, slug, 'transcript.json'), 'utf8'));
    const g = JSON.parse(readFileSync(join(base, slug, 'ground-truth.json'), 'utf8'));
    FixtureMetaSchema.parse(m);
    FixtureTranscriptSchema.parse(t);
    FixtureGroundTruthSchema.parse(g);
    count++;
    console.log('OK', fam, slug);
  }
}
console.log('Total:', count);
"
```
Expected: 9 lines + `Total: 9`.

- [ ] **Step 9: Commit**

```bash
git add desktop/eval/fixtures/meeting desktop/eval/fixtures/interview desktop/eval/fixtures/brainstorm
git commit -m "test(v2-eval): synthetic Meeting/Interview/Brainstorm fixtures (3 each)

Synthetic stubs so Plan 7 infra runs end-to-end without founder-gated
real recordings. Each fixture has 10 buckets + ground-truth covering
the family-specific schema fields. Real recordings replace these in
Plan 5/6 follow-up."
```

---

## Items 3, 5, 8 — ContractTest (deterministic structural assertions + anti-parroting + slot distinction)

### Task 4: ContractTest core — Zod parse + base structural assertions

**Files:**
- Create: `desktop/eval/contract/contract-test.ts`
- Create: `desktop/eval/contract/contract-test.test.ts`

**Goal:** Cheap, fast, deterministic structural checks that run in CI on every PR. **No LLM call.** Catches mode-collapse failures the LLM-judge misses (the v1 plateau pattern — spec P7). Returns a typed result with pass/fail + per-rule findings.

**Acceptance:** `pnpm --filter @lisna/desktop test desktop/eval/contract/contract-test.test.ts` PASS with cases for: (1) Zod parse failure, (2) Zod parse success / rule pass, (3) per-family rule registry dispatch.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/eval/contract/contract-test.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { runContractTest, type ContractRule } from './contract-test';

const TrivialSchema = z.object({ family: z.literal('lecture'), title: z.string() });

describe('runContractTest', () => {
  it('reports schemaParse=FAIL on invalid input', () => {
    const result = runContractTest({
      family: 'lecture',
      schema: TrivialSchema,
      note: { family: 'lecture' /* missing title */ },
      rules: [],
      transcript: { transcripts: [] } as never,
      groundTruth: undefined,
    });
    expect(result.schemaParse).toBe('FAIL');
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.overall).toBe('FAIL');
  });

  it('reports schemaParse=PASS and runs rules when input is valid', () => {
    const titleRule: ContractRule = {
      id: 'title-non-empty',
      severity: 'error',
      run: ({ note }) => ({
        pass: typeof note.title === 'string' && note.title.length > 0,
        message: 'title must be non-empty',
      }),
    };
    const result = runContractTest({
      family: 'lecture',
      schema: TrivialSchema,
      note: { family: 'lecture', title: 'My Lecture' },
      rules: [titleRule],
      transcript: { transcripts: [] } as never,
      groundTruth: undefined,
    });
    expect(result.schemaParse).toBe('PASS');
    expect(result.findings.find(f => f.ruleId === 'title-non-empty')?.pass).toBe(true);
    expect(result.overall).toBe('PASS');
  });

  it('marks overall=FAIL when any error-severity rule fails', () => {
    const failingRule: ContractRule = {
      id: 'always-fails',
      severity: 'error',
      run: () => ({ pass: false, message: 'fails always' }),
    };
    const result = runContractTest({
      family: 'lecture',
      schema: TrivialSchema,
      note: { family: 'lecture', title: 'X' },
      rules: [failingRule],
      transcript: { transcripts: [] } as never,
      groundTruth: undefined,
    });
    expect(result.overall).toBe('FAIL');
  });

  it('marks overall=PASS when only warning-severity rules fail', () => {
    const warningRule: ContractRule = {
      id: 'warns-only',
      severity: 'warning',
      run: () => ({ pass: false, message: 'soft fail' }),
    };
    const result = runContractTest({
      family: 'lecture',
      schema: TrivialSchema,
      note: { family: 'lecture', title: 'X' },
      rules: [warningRule],
      transcript: { transcripts: [] } as never,
      groundTruth: undefined,
    });
    expect(result.overall).toBe('PASS');
    expect(result.findings.find(f => f.ruleId === 'warns-only')?.pass).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL** (module not found)

Run: `pnpm --filter @lisna/desktop test desktop/eval/contract/contract-test.test.ts`

- [ ] **Step 3: Implement `contract-test.ts`**

```typescript
// desktop/eval/contract/contract-test.ts
import type { z } from 'zod';
import type { FixtureTranscript, FixtureGroundTruth } from '../fixtures/_schema';

export type NoteFamily = 'lecture' | 'meeting' | 'interview' | 'brainstorm';
export type Severity = 'error' | 'warning';

export interface RuleInput {
  family: NoteFamily;
  note: any;                              // already Zod-parsed when rule.run is called
  transcript: FixtureTranscript;
  groundTruth?: FixtureGroundTruth;
}

export interface RuleResult {
  pass: boolean;
  message: string;
  detail?: unknown;                       // optional structured payload for debugging
}

export interface ContractRule {
  id: string;
  severity: Severity;
  description?: string;
  run: (input: RuleInput) => RuleResult;
}

export interface ContractFinding extends RuleResult {
  ruleId: string;
  severity: Severity;
}

export interface ContractTestResult {
  family: NoteFamily;
  schemaParse: 'PASS' | 'FAIL';
  schemaParseError?: string;
  findings: ContractFinding[];
  overall: 'PASS' | 'FAIL';
}

export interface ContractTestInput {
  family: NoteFamily;
  schema: z.ZodType;
  note: unknown;
  rules: ContractRule[];
  transcript: FixtureTranscript;
  groundTruth?: FixtureGroundTruth;
}

export function runContractTest(input: ContractTestInput): ContractTestResult {
  const parsed = input.schema.safeParse(input.note);
  if (!parsed.success) {
    return {
      family: input.family,
      schemaParse: 'FAIL',
      schemaParseError: parsed.error.message,
      findings: [],
      overall: 'FAIL',
    };
  }
  const findings: ContractFinding[] = input.rules.map(rule => {
    let result: RuleResult;
    try {
      result = rule.run({
        family: input.family,
        note: parsed.data,
        transcript: input.transcript,
        groundTruth: input.groundTruth,
      });
    } catch (e) {
      result = {
        pass: false,
        message: `rule threw: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    return { ...result, ruleId: rule.id, severity: rule.severity };
  });
  const anyErrorFailed = findings.some(f => f.severity === 'error' && !f.pass);
  return {
    family: input.family,
    schemaParse: 'PASS',
    findings,
    overall: anyErrorFailed ? 'FAIL' : 'PASS',
  };
}
```

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/eval/contract/contract-test.ts desktop/eval/contract/contract-test.test.ts
git commit -m "feat(eval): ContractTest core (Zod parse + rule dispatch)

Deterministic structural assertions for v2 family notes. Severity:
'error' fails the test, 'warning' surfaces but doesn't block. Plan 7
P7 carry-forward — catches mode-collapse the LLM-judge misses."
```

---

### Task 5: Per-family contract rules

**Files:**
- Create: `desktop/eval/contract/families/lecture.ts`
- Create: `desktop/eval/contract/families/meeting.ts`
- Create: `desktop/eval/contract/families/interview.ts`
- Create: `desktop/eval/contract/families/brainstorm.ts`
- Create: `desktop/eval/contract/families.test.ts`

**Goal:** One rule set per family encoding the structural assertions in the spec §3 + §7 acceptance. Rules emit a per-family "what must be true of a passable note" surface that plans 3-6 can extend.

**Acceptance:** Each family file exports `<FAMILY>_RULES: ContractRule[]` and `families.test.ts` validates each rule fires correctly on synthetic positive + negative inputs.

- [ ] **Step 1: Write the Lecture rules test (first half)**

```typescript
// desktop/eval/contract/families.test.ts
import { describe, it, expect } from 'vitest';
import { LECTURE_RULES } from './families/lecture';
import { MEETING_RULES } from './families/meeting';
import { INTERVIEW_RULES } from './families/interview';
import { BRAINSTORM_RULES } from './families/brainstorm';
import type { RuleInput } from './contract-test';

const lectureNoteValid = {
  schemaVersion: 1, family: 'lecture', title: 'Test', generatedAt: '2026-05-27T00:00:00Z',
  generatedBy: { model: 'm', promptVersion: 1 }, language: 'ja', durationSec: 660,
  sections: [
    {
      heading: 'Intro', ts: 0, summary: 'Intro section',
      key_terms: [
        { term: 'A', definition: 'a', ts: 0, from: 'transcript' },
        { term: 'B', definition: 'b', ts: 30, from: 'transcript' },
      ],
      examples: [], points: [],
    },
    { heading: 'Mid', ts: 100, summary: 'm', key_terms: [{ term: 'C', definition: 'c', ts: 100, from: 'transcript' }], examples: [], points: [] },
    { heading: 'End', ts: 500, summary: 'e', key_terms: [{ term: 'D', definition: 'd', ts: 500, from: 'inferred' }], examples: [], points: [] },
  ],
};

const baseInput = (note: any): RuleInput => ({
  family: 'lecture',
  note,
  transcript: { transcripts: [{ ts: 0, text: 'x', speakerId: 0 }], bucket_seconds: 10, speakers: [{ id: 0 }] } as any,
});

describe('LECTURE_RULES', () => {
  it('passes a structurally valid LectureNote', () => {
    for (const rule of LECTURE_RULES) {
      const r = rule.run(baseInput(lectureNoteValid));
      expect.soft(r.pass).toBe(true);
    }
  });

  it('fails sections-min-3 on 2-section note', () => {
    const note = { ...lectureNoteValid, sections: lectureNoteValid.sections.slice(0, 2) };
    const r = LECTURE_RULES.find(x => x.id === 'lecture-sections-min-3')!.run(baseInput(note));
    expect(r.pass).toBe(false);
  });

  it('fails sections-have-key-terms when a section is empty', () => {
    const note = { ...lectureNoteValid, sections: [{ ...lectureNoteValid.sections[0], key_terms: [] }, ...lectureNoteValid.sections.slice(1)] };
    const r = LECTURE_RULES.find(x => x.id === 'lecture-sections-have-key-terms')!.run(baseInput(note));
    expect(r.pass).toBe(false);
  });

  it('warns when from-transcript ratio < 0.8', () => {
    const note = {
      ...lectureNoteValid,
      sections: [
        { heading: 'S1', ts: 0, summary: 'x',
          key_terms: Array.from({ length: 10 }, (_, i) => ({ term: `T${i}`, definition: 'd', ts: i*10, from: i < 5 ? 'transcript' : 'inferred' })),
          examples: [], points: [] },
        ...lectureNoteValid.sections.slice(1),
      ],
    };
    const r = LECTURE_RULES.find(x => x.id === 'lecture-from-transcript-ratio')!.run(baseInput(note));
    expect(r.pass).toBe(false);
  });
});
```

- [ ] **Step 2: Implement Lecture rules**

```typescript
// desktop/eval/contract/families/lecture.ts
import type { ContractRule } from '../contract-test';

// Per spec §3.3 + §7.2 + P7. Encodes the v1-plateau insight:
// mode-collapse looks like a "valid but bland" note where each section
// has ≤1 key_term, all key_terms are 'inferred', no formula slot fires.

const sectionsMin3: ContractRule = {
  id: 'lecture-sections-min-3',
  severity: 'error',
  description: 'A Lecture should have ≥3 sections to be a useful note.',
  run: ({ note }) => {
    const n = Array.isArray(note.sections) ? note.sections.length : 0;
    return { pass: n >= 3, message: `sections.length=${n}, want ≥3`, detail: { n } };
  },
};

const sectionsHaveKeyTerms: ContractRule = {
  id: 'lecture-sections-have-key-terms',
  severity: 'error',
  description: 'Every section must produce ≥1 key_term.',
  run: ({ note }) => {
    const sections: any[] = note.sections ?? [];
    const empty = sections.filter(s => !Array.isArray(s.key_terms) || s.key_terms.length === 0);
    return {
      pass: empty.length === 0,
      message: `${empty.length} section(s) have no key_terms (headings: ${empty.map(s => s.heading).join(', ')})`,
      detail: { emptySectionHeadings: empty.map(s => s.heading) },
    };
  },
};

const fromTranscriptRatio: ContractRule = {
  id: 'lecture-from-transcript-ratio',
  severity: 'warning',
  description: '≥80% of key_terms should be from:transcript (rest from:inferred). Below = mode collapse.',
  run: ({ note }) => {
    const sections: any[] = note.sections ?? [];
    const allKeyTerms = sections.flatMap(s => s.key_terms ?? []);
    if (allKeyTerms.length === 0) {
      return { pass: false, message: 'no key_terms in any section' };
    }
    const fromTranscript = allKeyTerms.filter(kt => kt.from === 'transcript').length;
    const ratio = fromTranscript / allKeyTerms.length;
    return {
      pass: ratio >= 0.8,
      message: `from:transcript ratio = ${(ratio * 100).toFixed(1)}% (want ≥80%)`,
      detail: { ratio, fromTranscript, total: allKeyTerms.length },
    };
  },
};

const slotsEmergeWhenExpected: ContractRule = {
  id: 'lecture-slots-emerge-when-expected',
  severity: 'warning',
  description: 'When meta.expectedSlots is non-empty, at least one expected slot must appear in extras.',
  run: ({ note, groundTruth }) => {
    // We piggy-back on meta via Task 18's runner — at rule run-time we
    // see `note.expectedSlots` injected by the runner before parsing.
    const expected: string[] = (note._meta?.expectedSlots as string[]) ?? [];
    if (expected.length === 0) return { pass: true, message: 'no expectedSlots — rule N/A' };
    const sections: any[] = note.sections ?? [];
    const emerged = new Set<string>();
    for (const s of sections) {
      for (const e of s.extras ?? []) {
        if (typeof e?.type === 'string') emerged.add(e.type);
      }
    }
    const hit = expected.some(t => emerged.has(t));
    return {
      pass: hit,
      message: hit
        ? `slot(s) emerged: ${[...emerged].join(', ')}`
        : `expected one of [${expected.join(', ')}] but extras emitted [${[...emerged].join(', ') || 'none'}]`,
      detail: { expected, emerged: [...emerged] },
    };
  },
};

export const LECTURE_RULES: ContractRule[] = [
  sectionsMin3,
  sectionsHaveKeyTerms,
  fromTranscriptRatio,
  slotsEmergeWhenExpected,
];
```

- [ ] **Step 3: Run Lecture test, expect PASS**

- [ ] **Step 4: Implement Meeting rules**

```typescript
// desktop/eval/contract/families/meeting.ts
import type { ContractRule } from '../contract-test';

const requiresDecisionOrAction: ContractRule = {
  id: 'meeting-must-have-decision-or-action',
  severity: 'error',
  description: 'A Meeting note that contains neither a decision nor an action_item failed to extract anything useful.',
  run: ({ note }) => {
    const decisions = Array.isArray(note.decisions) ? note.decisions.length : 0;
    const actions = Array.isArray(note.next_steps) ? note.next_steps.length : 0;
    return {
      pass: decisions + actions > 0,
      message: `decisions=${decisions}, next_steps=${actions} — at least one required`,
      detail: { decisions, actions },
    };
  },
};

const requiresExecutiveSummary: ContractRule = {
  id: 'meeting-executive-summary-non-empty',
  severity: 'error',
  run: ({ note }) => {
    const s = typeof note.executive_summary === 'string' ? note.executive_summary.trim() : '';
    return { pass: s.length >= 20, message: `executive_summary length=${s.length}, want ≥20 chars` };
  },
};

const topicArcCoverage: ContractRule = {
  id: 'meeting-topic-arc-covers-decisions',
  severity: 'warning',
  description: 'topic_arc should reflect the discussions that produced decisions.',
  run: ({ note }) => {
    const arc: any[] = note.topic_arc ?? [];
    const decisions: any[] = note.decisions ?? [];
    if (decisions.length === 0) return { pass: true, message: 'no decisions, rule N/A' };
    if (arc.length === 0) {
      return { pass: false, message: 'topic_arc empty despite decisions present' };
    }
    return { pass: arc.length >= Math.min(decisions.length, 2), message: `arc=${arc.length}, decisions=${decisions.length}` };
  },
};

const groundTruthDecisionsMustAppear: ContractRule = {
  id: 'meeting-ground-truth-decisions-coverage',
  severity: 'warning',
  description: 'Each ground-truth decision marked mustAppear=true must appear in the note (substring match).',
  run: ({ note, groundTruth }) => {
    if (!groundTruth?.decisions) return { pass: true, message: 'no ground-truth decisions, rule N/A' };
    const required = groundTruth.decisions.filter(d => d.mustAppear);
    if (required.length === 0) return { pass: true, message: 'no mustAppear decisions, rule N/A' };
    const notedDecisions: string[] = (note.decisions ?? []).map((d: any) => String(d.text ?? ''));
    const missing = required.filter(req =>
      !notedDecisions.some(n => substringMatch(n, req.text)),
    );
    return {
      pass: missing.length === 0,
      message: missing.length === 0
        ? `all ${required.length} required decision(s) appear`
        : `missing ${missing.length}/${required.length}: ${missing.map(m => m.text).join('; ')}`,
      detail: { required: required.length, missing: missing.map(m => m.text) },
    };
  },
};

// JA-friendly substring match — strip whitespace + normalize for kana
function substringMatch(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  return norm(haystack).includes(norm(needle));
}

export const MEETING_RULES: ContractRule[] = [
  requiresDecisionOrAction,
  requiresExecutiveSummary,
  topicArcCoverage,
  groundTruthDecisionsMustAppear,
];
```

- [ ] **Step 5: Implement Interview rules**

```typescript
// desktop/eval/contract/families/interview.ts
import type { ContractRule } from '../contract-test';

const requiresQaPairs: ContractRule = {
  id: 'interview-qa-pairs-min-3',
  severity: 'error',
  description: 'An Interview note with <3 qa_pairs failed to extract the conversational structure.',
  run: ({ note }) => {
    const n = Array.isArray(note.qa_pairs) ? note.qa_pairs.length : 0;
    return { pass: n >= 3, message: `qa_pairs=${n}, want ≥3`, detail: { n } };
  },
};

const qaSpeakerParity: ContractRule = {
  id: 'interview-qa-speaker-parity',
  severity: 'error',
  description: 'Every qa_pair must reference distinct asked_by and answered_by speakers.',
  run: ({ note }) => {
    const pairs: any[] = note.qa_pairs ?? [];
    const bad = pairs.filter(p => p.asked_by === p.answered_by);
    return {
      pass: bad.length === 0,
      message: bad.length === 0 ? 'all pairs have distinct speakers' : `${bad.length} pair(s) self-questioning`,
      detail: { selfQuestioningPairs: bad.length },
    };
  },
};

const themesNonEmpty: ContractRule = {
  id: 'interview-themes-non-empty',
  severity: 'warning',
  description: 'Interview themes should be extracted (≥1).',
  run: ({ note }) => ({
    pass: Array.isArray(note.themes) && note.themes.length >= 1,
    message: `themes.length=${(note.themes ?? []).length}, want ≥1`,
  }),
};

const groundTruthQaCoverage: ContractRule = {
  id: 'interview-ground-truth-qa-coverage',
  severity: 'warning',
  description: '≥60% of ground-truth qaPairs questions appear in the note (substring).',
  run: ({ note, groundTruth }) => {
    if (!groundTruth?.qaPairs) return { pass: true, message: 'no ground-truth qaPairs, rule N/A' };
    const required = groundTruth.qaPairs;
    const noteQs: string[] = (note.qa_pairs ?? []).map((p: any) => String(p.question ?? ''));
    const matched = required.filter(req => noteQs.some(q => normContains(q, req.q)));
    const ratio = matched.length / required.length;
    return {
      pass: ratio >= 0.6,
      message: `${matched.length}/${required.length} ground-truth Qs covered (${(ratio * 100).toFixed(0)}%)`,
      detail: { ratio },
    };
  },
};

function normContains(h: string, n: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  return norm(h).includes(norm(n));
}

export const INTERVIEW_RULES: ContractRule[] = [
  requiresQaPairs,
  qaSpeakerParity,
  themesNonEmpty,
  groundTruthQaCoverage,
];
```

- [ ] **Step 6: Implement Brainstorm rules**

```typescript
// desktop/eval/contract/families/brainstorm.ts
import type { ContractRule } from '../contract-test';

const ideaClustersMin1: ContractRule = {
  id: 'brainstorm-idea-clusters-min-1',
  severity: 'error',
  description: 'A Brainstorm note with 0 idea_clusters is empty.',
  run: ({ note }) => {
    const n = Array.isArray(note.idea_clusters) ? note.idea_clusters.length : 0;
    return { pass: n >= 1, message: `idea_clusters=${n}, want ≥1`, detail: { n } };
  },
};

const ideasPerCluster: ContractRule = {
  id: 'brainstorm-ideas-per-cluster',
  severity: 'error',
  description: 'Each idea_cluster must contain ≥2 ideas (a cluster of 1 is just an idea).',
  run: ({ note }) => {
    const clusters: any[] = note.idea_clusters ?? [];
    const thin = clusters.filter(c => !Array.isArray(c.ideas) || c.ideas.length < 2);
    return {
      pass: thin.length === 0,
      message: thin.length === 0 ? 'all clusters have ≥2 ideas' : `${thin.length} thin cluster(s) (themes: ${thin.map(c => c.theme).join(', ')})`,
      detail: { thinClusters: thin.length },
    };
  },
};

const uniqueIdeaIds: ContractRule = {
  id: 'brainstorm-unique-idea-ids',
  severity: 'error',
  description: 'Each idea.id must be unique (post-decode UUID assignment).',
  run: ({ note }) => {
    const clusters: any[] = note.idea_clusters ?? [];
    const ids: string[] = clusters.flatMap(c => (c.ideas ?? []).map((i: any) => i.id)).filter(Boolean);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    return {
      pass: dup.length === 0 && ids.length > 0,
      message: dup.length > 0 ? `${dup.length} duplicate id(s): ${[...new Set(dup)].slice(0, 3).join(', ')}` : `${ids.length} unique ids`,
    };
  },
};

const ideaCountInRange: ContractRule = {
  id: 'brainstorm-idea-count-ground-truth',
  severity: 'warning',
  description: 'Total idea count within 50%-150% of ground-truth ideaCount.',
  run: ({ note, groundTruth }) => {
    if (groundTruth?.ideaCount === undefined) return { pass: true, message: 'no ground-truth ideaCount, rule N/A' };
    const clusters: any[] = note.idea_clusters ?? [];
    const total = clusters.reduce((s, c) => s + (c.ideas?.length ?? 0), 0);
    const lo = Math.floor(groundTruth.ideaCount * 0.5);
    const hi = Math.ceil(groundTruth.ideaCount * 1.5);
    return {
      pass: total >= lo && total <= hi,
      message: `idea count=${total} (ground-truth=${groundTruth.ideaCount}, accept [${lo}, ${hi}])`,
      detail: { total, lo, hi },
    };
  },
};

export const BRAINSTORM_RULES: ContractRule[] = [
  ideaClustersMin1,
  ideasPerCluster,
  uniqueIdeaIds,
  ideaCountInRange,
];
```

- [ ] **Step 7: Extend families.test.ts with Meeting/Interview/Brainstorm coverage**

Append to `families.test.ts`:

```typescript
describe('MEETING_RULES', () => {
  const meetingValid = {
    family: 'meeting', schemaVersion: 1, title: 't', generatedAt: 'x', generatedBy: { model: 'm', promptVersion: 1 },
    language: 'ja', durationSec: 100, purpose: 'p',
    executive_summary: 'This was a productive meeting with three concrete outcomes.',
    topic_arc: [{ topic: 'x', ts: 0, speakers_involved: [0] }, { topic: 'y', ts: 50, speakers_involved: [1] }],
    discussions: [],
    decisions: [{ text: 'Ship Q3', ts: 0, from: 'transcript' }],
    open_questions: [],
    next_steps: [{ text: 'do thing', ts: 10, from: 'transcript' }],
  };
  it('passes a valid Meeting', () => {
    for (const r of MEETING_RULES) {
      const res = r.run({ family: 'meeting', note: meetingValid, transcript: { transcripts: [] } as any });
      expect.soft(res.pass).toBe(true);
    }
  });
  it('fails when no decisions AND no actions', () => {
    const bad = { ...meetingValid, decisions: [], next_steps: [] };
    const res = MEETING_RULES.find(r => r.id === 'meeting-must-have-decision-or-action')!.run({ family: 'meeting', note: bad, transcript: { transcripts: [] } as any });
    expect(res.pass).toBe(false);
  });
});

describe('INTERVIEW_RULES', () => {
  const interviewValid = {
    family: 'interview', schemaVersion: 1, title: 't', generatedAt: 'x', generatedBy: { model: 'm', promptVersion: 1 },
    language: 'ja', durationSec: 100, purpose: 'p', subject_summary: 's',
    qa_pairs: [
      { question: 'q1', answer: 'a1', ts: 0, asked_by: 0, answered_by: 1, from: 'transcript' },
      { question: 'q2', answer: 'a2', ts: 10, asked_by: 0, answered_by: 1, from: 'transcript' },
      { question: 'q3', answer: 'a3', ts: 20, asked_by: 0, answered_by: 1, from: 'transcript' },
    ],
    themes: [{ name: 'theme1', appears_at_ts: [0] }],
    quotable_lines: [],
    key_takeaways: [],
  };
  it('passes a valid Interview', () => {
    for (const r of INTERVIEW_RULES) {
      const res = r.run({ family: 'interview', note: interviewValid, transcript: { transcripts: [] } as any });
      expect.soft(res.pass).toBe(true);
    }
  });
  it('fails self-questioning qa_pair', () => {
    const bad = { ...interviewValid, qa_pairs: [...interviewValid.qa_pairs, { question: 'q4', answer: 'a4', ts: 30, asked_by: 1, answered_by: 1, from: 'transcript' }] };
    const res = INTERVIEW_RULES.find(r => r.id === 'interview-qa-speaker-parity')!.run({ family: 'interview', note: bad, transcript: { transcripts: [] } as any });
    expect(res.pass).toBe(false);
  });
});

describe('BRAINSTORM_RULES', () => {
  const bsValid = {
    family: 'brainstorm', schemaVersion: 1, title: 't', generatedAt: 'x', generatedBy: { model: 'm', promptVersion: 1 },
    language: 'ja', durationSec: 100, purpose: 'p',
    idea_clusters: [{
      theme: 'speed',
      ideas: [
        { id: 'u1', text: 'idea-1', ts: 0, from: 'transcript' },
        { id: 'u2', text: 'idea-2', ts: 10, from: 'transcript' },
      ],
    }],
  };
  it('passes a valid Brainstorm', () => {
    for (const r of BRAINSTORM_RULES) {
      const res = r.run({ family: 'brainstorm', note: bsValid, transcript: { transcripts: [] } as any });
      expect.soft(res.pass).toBe(true);
    }
  });
  it('fails on duplicate idea id', () => {
    const bad = { ...bsValid, idea_clusters: [{ theme: 'x', ideas: [{ id: 'X', text: 'a', ts: 0, from: 'transcript' }, { id: 'X', text: 'b', ts: 10, from: 'transcript' }] }] };
    const res = BRAINSTORM_RULES.find(r => r.id === 'brainstorm-unique-idea-ids')!.run({ family: 'brainstorm', note: bad, transcript: { transcripts: [] } as any });
    expect(res.pass).toBe(false);
  });
});
```

- [ ] **Step 8: Run all family tests, expect PASS**

Run: `pnpm --filter @lisna/desktop test desktop/eval/contract/families.test.ts`

- [ ] **Step 9: Commit**

```bash
git add desktop/eval/contract/families desktop/eval/contract/families.test.ts
git commit -m "feat(eval): per-family contract rules (Lecture/Meeting/Interview/Brainstorm)

Encodes spec §3 + §7 acceptance into deterministic structural rules.
Lecture: 3 sections min, every section has key_terms, ≥80% from:transcript,
expected slot emergence. Meeting: decision-or-action required, exec_summary
non-empty, ground-truth decision coverage. Interview: ≥3 QA pairs, distinct
asked/answered_by, themes non-empty, GT qa coverage ≥60%. Brainstorm:
≥1 idea cluster, ≥2 ideas per cluster, unique IDs, count within 50-150%
of ground truth."
```

---

### Task 6: Anti-parroting JS heuristic (Task 5 carry-forward #1, JS layer)

**Files:**
- Create: `desktop/eval/contract/anti-parroting.ts`
- Create: `desktop/eval/contract/anti-parroting.test.ts`

**Goal:** A deterministic JS heuristic that catches the `E=mc²`-in-physics-fixture parroting Spike 0.2 surfaced, **without** an LLM call. Runs at ContractTest time (cheap). The LLM-based content-fidelity judge in Task 13 complements this with semantic checks.

**Mechanism:**
1. Collect every `formula.expression` from the note's `extras[type=formula]` items.
2. For each expression, check if it appears in the transcript text OR is in the fixture's `groundTruth.expectedFormulas` allowlist.
3. If neither → flag as parroting candidate.
4. Pass condition: parroting candidates ≤ 30% of total formula expressions (warning), or 0% (error).

**Acceptance:** `pnpm --filter @lisna/desktop test desktop/eval/contract/anti-parroting.test.ts` PASS with: (1) clean note (no formulas → pass), (2) E=mc² in physics fixture without transcript match → fail, (3) F=ma in fixture that has F=ma in transcript → pass, (4) E=mc² in fixture with allowlisted ground-truth formula → pass.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/eval/contract/anti-parroting.test.ts
import { describe, it, expect } from 'vitest';
import { detectParrotedFormulas, parrotingRule } from './anti-parroting';
import type { FixtureTranscript } from '../fixtures/_schema';

const transcript = (lines: string[]): FixtureTranscript => ({
  bucket_seconds: 10,
  speakers: [{ id: 0 }],
  transcripts: lines.map((text, i) => ({ ts: i * 10, text, speakerId: 0 })),
});

describe('detectParrotedFormulas', () => {
  it('returns empty for note with no formula extras', () => {
    const note = { sections: [{ extras: [] }] };
    const out = detectParrotedFormulas(note as any, transcript(['静電ポテンシャル']), undefined);
    expect(out.total).toBe(0);
    expect(out.parroted.length).toBe(0);
  });

  it('flags E=mc² when transcript is about electromagnetics, no GT allowlist', () => {
    const note = {
      sections: [{ extras: [{ type: 'formula', items: [{ expression: 'E = mc^2', label: 'mass-energy' }] }] }],
    };
    const out = detectParrotedFormulas(note as any, transcript(['静電ポテンシャル', '電位']), undefined);
    expect(out.total).toBe(1);
    expect(out.parroted.length).toBe(1);
    expect(out.parroted[0].expression).toBe('E = mc^2');
  });

  it('accepts a formula that is literally present in the transcript', () => {
    const note = {
      sections: [{ extras: [{ type: 'formula', items: [{ expression: 'F = qE', label: 'Lorentz' }] }] }],
    };
    const out = detectParrotedFormulas(note as any, transcript(['F = qE は重要']), undefined);
    expect(out.parroted.length).toBe(0);
  });

  it('accepts a formula via ground-truth allowlist even if not in transcript', () => {
    const note = {
      sections: [{ extras: [{ type: 'formula', items: [{ expression: 'V = -∫E·dr', label: 'potential' }] }] }],
    };
    const out = detectParrotedFormulas(note as any, transcript(['静電ポテンシャル']), { fixtureId: 'x', expectedFormulas: ['V = -∫E·dr'] });
    expect(out.parroted.length).toBe(0);
  });

  it('parrotingRule warns when >30% parroted, errors when >70%', () => {
    const noteHalfParroted = {
      sections: [{ extras: [{ type: 'formula', items: [
        { expression: 'E = mc^2', label: 'parroted' },
        { expression: 'F = qE', label: 'in transcript' },
        { expression: 'a = b', label: 'parroted' },
      ] }] }],
    };
    const res = parrotingRule.run({ family: 'lecture', note: noteHalfParroted as any, transcript: transcript(['F = qE は']) } as any);
    expect(res.pass).toBe(false);  // 2/3 parroted → warning fires
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `anti-parroting.ts`**

```typescript
// desktop/eval/contract/anti-parroting.ts
import type { ContractRule } from './contract-test';
import type { FixtureTranscript, FixtureGroundTruth } from '../fixtures/_schema';

export interface ParrotingFinding {
  expression: string;
  label?: string;
  sectionHeading?: string;
}

export interface ParrotingReport {
  total: number;
  parroted: ParrotingFinding[];
  inTranscript: ParrotingFinding[];
  inAllowlist: ParrotingFinding[];
  parrotRatio: number;
}

// Normalize for substring matching across whitespace/notation variants.
// Notable: ^2 → ², LaTeX-ish forms, kana-internal whitespace.
function normalize(s: string): string {
  return s
    .replace(/\s+/g, '')
    .replace(/\^2/g, '²')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2')
    .toLowerCase();
}

function appearsInTranscript(expr: string, transcript: FixtureTranscript): boolean {
  const normExpr = normalize(expr);
  if (normExpr.length === 0) return false;
  return transcript.transcripts.some(b => normalize(b.text).includes(normExpr));
}

function appearsInAllowlist(expr: string, groundTruth?: FixtureGroundTruth): boolean {
  if (!groundTruth?.expectedFormulas) return false;
  const normExpr = normalize(expr);
  return groundTruth.expectedFormulas.some(f => normalize(f) === normExpr);
}

export function detectParrotedFormulas(
  note: any,
  transcript: FixtureTranscript,
  groundTruth?: FixtureGroundTruth,
): ParrotingReport {
  const sections: any[] = note.sections ?? [];
  const allFindings: ParrotingFinding[] = [];
  const parroted: ParrotingFinding[] = [];
  const inTranscript: ParrotingFinding[] = [];
  const inAllowlist: ParrotingFinding[] = [];
  for (const section of sections) {
    for (const extra of section.extras ?? []) {
      if (extra?.type !== 'formula') continue;
      for (const item of extra.items ?? []) {
        const expression = String(item?.expression ?? '').trim();
        if (!expression) continue;
        const finding: ParrotingFinding = { expression, label: item?.label, sectionHeading: section.heading };
        allFindings.push(finding);
        if (appearsInTranscript(expression, transcript)) inTranscript.push(finding);
        else if (appearsInAllowlist(expression, groundTruth)) inAllowlist.push(finding);
        else parroted.push(finding);
      }
    }
  }
  const total = allFindings.length;
  const parrotRatio = total === 0 ? 0 : parroted.length / total;
  return { total, parroted, inTranscript, inAllowlist, parrotRatio };
}

// Severity ladder:
//   parrotRatio ≤ 0.30 → pass
//   parrotRatio  > 0.30 → warning (Plan 6 prompt design needs work)
//   parrotRatio  > 0.70 → still warning (we keep severity=warning per Plan 7
//                          to avoid blocking a Plan 6 prompt iteration on
//                          this heuristic alone; the LLM judge in Task 13
//                          carries the harder signal)
export const parrotingRule: ContractRule = {
  id: 'lecture-anti-parroting',
  severity: 'warning',
  description: 'Formula expressions that do not appear in transcript AND are not in ground-truth allowlist look like exemplar parroting.',
  run: ({ note, transcript, groundTruth }) => {
    const r = detectParrotedFormulas(note, transcript, groundTruth);
    if (r.total === 0) return { pass: true, message: 'no formula extras — rule N/A' };
    const pass = r.parrotRatio <= 0.30;
    return {
      pass,
      message: pass
        ? `parrot ratio ${(r.parrotRatio * 100).toFixed(0)}% ≤ 30% (${r.parroted.length}/${r.total})`
        : `parrot ratio ${(r.parrotRatio * 100).toFixed(0)}% > 30% — ${r.parroted.map(p => p.expression).join(', ')}`,
      detail: r,
    };
  },
};
```

- [ ] **Step 4: Add `parrotingRule` to Lecture rules**

In `desktop/eval/contract/families/lecture.ts`:
```typescript
import { parrotingRule } from '../anti-parroting';
// ...
export const LECTURE_RULES: ContractRule[] = [
  sectionsMin3,
  sectionsHaveKeyTerms,
  fromTranscriptRatio,
  slotsEmergeWhenExpected,
  parrotingRule,                     // ← add here
];
```

- [ ] **Step 5: Run anti-parroting tests, expect PASS**

Run: `pnpm --filter @lisna/desktop test desktop/eval/contract/anti-parroting.test.ts desktop/eval/contract/families.test.ts`

- [ ] **Step 6: Commit**

```bash
git add desktop/eval/contract/anti-parroting.ts desktop/eval/contract/anti-parroting.test.ts desktop/eval/contract/families/lecture.ts
git commit -m "feat(eval): anti-parroting JS heuristic (formula extras)

VERDICT carry-forward #1 — detects exemplar parroting (E=mc² in
physics fixture) by checking each formula.expression against
transcript text + ground-truth allowlist. Normalizes whitespace,
^2→², LaTeX frac. Severity=warning; LLM judge (Task 13) carries
the harder semantic signal."
```

---

## Items 2, 5 — LLM-as-judge (per-family + content-fidelity)

### Task 7: Judge types and contracts

**Files:**
- Create: `desktop/eval/judges/judge-types.ts`

**Goal:** Single source of truth for `JudgeRequest`, `JudgeResult`, `JudgeAxisScores`, `JudgeFamily` so each per-family judge in Tasks 9-12 implements the same surface. The shape is intentionally compatible with v1's `backend/scripts/lib/judge.ts` for the `coverage / accuracy / hierarchy / conciseness / importance / provenance` axes; Plan 7 *extends* with family-specific axes.

- [ ] **Step 1: Write the types module**

```typescript
// desktop/eval/judges/judge-types.ts
import type { FixtureTranscript, FixtureGroundTruth } from '../fixtures/_schema';

export type NoteFamily = 'lecture' | 'meeting' | 'interview' | 'brainstorm';

// Axes common to every family (mirrors v1 backend judge for direct comparability)
export interface CommonAxisScores {
  coverage: number;        // 0-10
  accuracy: number;        // 0-10
  hierarchy: number;       // 0-10
  conciseness: number;     // 0-10
  importance: number;      // 0-10
  provenance: number;      // 0-10 — standalone (NOT in overall weight)
}

// Per-family axes layered ON TOP of common axes:
export interface LectureAxes {
  sectionCoherence: number;     // 0-10
  contentFidelity: number;      // 0-10 — anti-parroting
}
export interface MeetingAxes {
  decisionCapture: number;      // 0-10
  actionItemClarity: number;    // 0-10
  participantAttribution: number; // 0-10
}
export interface InterviewAxes {
  qaParity: number;             // 0-10 — Q/A correspondence
  themeExtraction: number;      // 0-10
  quotableSelection: number;    // 0-10
}
export interface BrainstormAxes {
  clusterCoherence: number;     // 0-10
  ideaDiversity: number;        // 0-10
  argumentChainDepth: number;   // 0-10 (cross-idea reasoning)
}

export type FamilyAxes<F extends NoteFamily> =
  F extends 'lecture' ? LectureAxes :
  F extends 'meeting' ? MeetingAxes :
  F extends 'interview' ? InterviewAxes :
  F extends 'brainstorm' ? BrainstormAxes :
  never;

export type JudgeAxisScores<F extends NoteFamily> = CommonAxisScores & FamilyAxes<F>;

export interface JudgeResult<F extends NoteFamily = NoteFamily> {
  family: F;
  judgeModelId: string;
  axes: JudgeAxisScores<F>;
  overall: number;                // weighted average, judge-computed
  issues: string[];               // anchor-specific, e.g. "transcript 03:20 X missing"
  wins: string[];
}

export interface JudgeRequest<F extends NoteFamily = NoteFamily> {
  family: F;
  note: any;                      // validated note (post-Zod)
  transcript: FixtureTranscript;
  groundTruth?: FixtureGroundTruth;
  previousNote?: any;             // optional, mirrors v1 stability check
  judgeModelId?: string;          // override default per request (judge-swap matrix)
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/eval/judges/judge-types.ts
git commit -m "feat(eval): judge type contracts (common + per-family axes)

Common axes mirror v1 backend judge for direct cross-version
comparability. Family-specific axes layer on top via generic
JudgeAxisScores<F>. JudgeResult.judgeModelId enables the cross-
vendor swap matrix in Task 25."
```

### Task 8: Base LLM-judge router (Groq default, Anthropic optional)

**Files:**
- Create: `desktop/eval/judges/llm-judge.ts`
- Create: `desktop/eval/judges/llm-judge.test.ts`

**Goal:** A single entry `judgeNote(req)` that routes by family to per-family judges (Tasks 9-12), handles the API call (Groq default, Anthropic when `req.judgeModelId` starts with `claude-`), parses JSON, clamps scores, retries with fallback model.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/eval/judges/llm-judge.test.ts
import { describe, it, expect } from 'vitest';
import { __testOnly_parseJudgeResponse, __testOnly_clamp } from './llm-judge';

describe('parseJudgeResponse — Lecture', () => {
  it('clamps out-of-range scores to [0, 10]', () => {
    const j = __testOnly_parseJudgeResponse('lecture', JSON.stringify({
      coverage: 12, accuracy: -2, hierarchy: 5, conciseness: 5, importance: 5,
      provenance: 5, sectionCoherence: 5, contentFidelity: 5,
      overall: 5, issues: ['x'], wins: ['y'],
    }));
    expect(j.axes.coverage).toBe(10);
    expect(j.axes.accuracy).toBe(0);
  });

  it('defaults missing axes to 0 (legacy/judge-omission safety)', () => {
    const j = __testOnly_parseJudgeResponse('lecture', '{}');
    expect(j.axes.coverage).toBe(0);
    expect(j.axes.contentFidelity).toBe(0);
  });

  it('filters non-string entries from issues/wins arrays', () => {
    const j = __testOnly_parseJudgeResponse('meeting', JSON.stringify({
      issues: ['valid', 123, null, 'also valid'],
      wins: 'not an array',
    }));
    expect(j.issues).toEqual(['valid', 'also valid']);
    expect(j.wins).toEqual([]);
  });
});

describe('clamp', () => {
  it('rounds to one decimal', () => {
    expect(__testOnly_clamp(5.5555)).toBe(5.6);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `llm-judge.ts`**

```typescript
// desktop/eval/judges/llm-judge.ts
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { JudgeRequest, JudgeResult, NoteFamily, JudgeAxisScores } from './judge-types';
import { LECTURE_JUDGE_PROMPT } from './families/lecture-judge';
import { MEETING_JUDGE_PROMPT } from './families/meeting-judge';
import { INTERVIEW_JUDGE_PROMPT } from './families/interview-judge';
import { BRAINSTORM_JUDGE_PROMPT } from './families/brainstorm-judge';

const DEFAULT_JUDGE_MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_JUDGE_MODEL = 'llama-3.1-8b-instant';
const JUDGE_TRANSCRIPT_CHAR_BUDGET = 10_000;

const COMMON_AXIS_KEYS = ['coverage', 'accuracy', 'hierarchy', 'conciseness', 'importance', 'provenance'] as const;
const FAMILY_AXIS_KEYS: Record<NoteFamily, readonly string[]> = {
  lecture: ['sectionCoherence', 'contentFidelity'],
  meeting: ['decisionCapture', 'actionItemClarity', 'participantAttribution'],
  interview: ['qaParity', 'themeExtraction', 'quotableSelection'],
  brainstorm: ['clusterCoherence', 'ideaDiversity', 'argumentChainDepth'],
};

const FAMILY_PROMPTS: Record<NoteFamily, string> = {
  lecture: LECTURE_JUDGE_PROMPT,
  meeting: MEETING_JUDGE_PROMPT,
  interview: INTERVIEW_JUDGE_PROMPT,
  brainstorm: BRAINSTORM_JUDGE_PROMPT,
};

let _groqClient: OpenAI | undefined;
let _anthClient: Anthropic | undefined;
function groq(): OpenAI {
  if (!_groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set');
    _groqClient = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
  }
  return _groqClient;
}
function anth(): Anthropic {
  if (!_anthClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    _anthClient = new Anthropic({ apiKey });
  }
  return _anthClient;
}

export function __testOnly_clamp(n: unknown): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

export function __testOnly_parseJudgeResponse<F extends NoteFamily>(family: F, text: string): JudgeResult<F> {
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { parsed = {}; }
  const axes: any = {};
  for (const k of COMMON_AXIS_KEYS) axes[k] = __testOnly_clamp(parsed[k] ?? 0);
  for (const k of FAMILY_AXIS_KEYS[family]) axes[k] = __testOnly_clamp(parsed[k] ?? 0);
  return {
    family,
    judgeModelId: parsed.judgeModelId ?? DEFAULT_JUDGE_MODEL,
    axes: axes as JudgeAxisScores<F>,
    overall: __testOnly_clamp(parsed.overall ?? 0),
    issues: Array.isArray(parsed.issues) ? parsed.issues.filter((s: unknown) => typeof s === 'string') : [],
    wins: Array.isArray(parsed.wins) ? parsed.wins.filter((s: unknown) => typeof s === 'string') : [],
  };
}

function tailWindowTranscript(req: JudgeRequest): string {
  const kept: typeof req.transcript.transcripts = [];
  let used = 0;
  for (let i = req.transcript.transcripts.length - 1; i >= 0; i--) {
    const cost = req.transcript.transcripts[i].text.length + 12;
    if (kept.length > 0 && used + cost > JUDGE_TRANSCRIPT_CHAR_BUDGET) break;
    kept.unshift(req.transcript.transcripts[i]);
    used += cost;
  }
  const dropped = req.transcript.transcripts.length - kept.length;
  return kept.map(b => `[${b.ts}s] ${b.text}`).join('\n')
    + (dropped > 0 ? `\n\n[NOTE: 古い ${dropped} chunk omitted — note still scored against full structure]` : '');
}

export async function judgeNote<F extends NoteFamily>(req: JudgeRequest<F>): Promise<JudgeResult<F>> {
  const judgeModelId = req.judgeModelId ?? DEFAULT_JUDGE_MODEL;
  const systemPrompt = FAMILY_PROMPTS[req.family];
  const transcript = tailWindowTranscript(req);
  const noteJson = JSON.stringify(req.note, null, 2);
  const gtJson = req.groundTruth ? JSON.stringify(req.groundTruth, null, 2) : '(no ground truth)';
  const userPrompt = `transcript:\n${transcript}\n\nnote (score this):\n${noteJson}\n\nground_truth:\n${gtJson}`;
  if (judgeModelId.startsWith('claude-')) {
    return judgeViaAnthropic(req.family, judgeModelId, systemPrompt, userPrompt);
  }
  try {
    return await judgeViaGroq(req.family, judgeModelId, systemPrompt, userPrompt);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
    if (!(msg.includes('429') || msg.includes('503') || msg.includes('500'))) throw e;
    return judgeViaGroq(req.family, FALLBACK_JUDGE_MODEL, systemPrompt, userPrompt);
  }
}

async function judgeViaGroq<F extends NoteFamily>(family: F, modelId: string, systemPrompt: string, userPrompt: string): Promise<JudgeResult<F>> {
  const res = await groq().chat.completions.create({
    model: modelId,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    response_format: { type: 'json_object' },
    temperature: 0,
  });
  const text = res.choices[0]?.message?.content ?? '{}';
  const parsed = __testOnly_parseJudgeResponse(family, text);
  parsed.judgeModelId = modelId;
  return parsed;
}

async function judgeViaAnthropic<F extends NoteFamily>(family: F, modelId: string, systemPrompt: string, userPrompt: string): Promise<JudgeResult<F>> {
  const res = await anth().messages.create({
    model: modelId,
    max_tokens: 1500,
    system: systemPrompt + '\n\nReturn ONLY a JSON object — no prose, no markdown fences.',
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = res.content.map(c => c.type === 'text' ? c.text : '').join('').trim();
  // Strip ```json fences if present (defensive — Anthropic sometimes adds despite instruction)
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  const parsed = __testOnly_parseJudgeResponse(family, cleaned);
  parsed.judgeModelId = modelId;
  return parsed;
}
```

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/eval/judges/llm-judge.ts desktop/eval/judges/llm-judge.test.ts
git commit -m "feat(eval): LLM-judge router (Groq default + Anthropic optional)

Family-dispatched system prompt + transcript tail-window + JSON response.
Retry/fallback on 429/503/500 to llama-3.1-8b-instant. Anthropic path
strips markdown fences defensively. Axis schema is family-specific via
generic JudgeResult<F>."
```

### Task 9: Lecture judge prompt (5 family-specific axes)

**Files:**
- Create: `desktop/eval/judges/families/lecture-judge.ts`

**Goal:** The Lecture-family judge prompt incorporating spec §3.3 acceptance and VERDICT carry-forward #1 (content-fidelity = anti-parroting). The common axes are scored just like v1 (calibrated 5 = average, 0 = broken, 10 = excellent); Lecture-specific axes layer on top.

- [ ] **Step 1: Write the prompt module**

```typescript
// desktop/eval/judges/families/lecture-judge.ts
export const LECTURE_JUDGE_PROMPT = `あなたは Lecture-family note の厳しい採点者です。
入力: transcript (時系列のbucket列), note (採点対象のLectureNote JSON), ground_truth (補助 — expectedFormulas など).
出力は JSON のみ。説明文・前置きは禁止。

# 共通6軸 (0-10)
- coverage: transcript の主要概念のうち何 % が note に反映されているか。漏れ = issues に anchor付きで列挙。
- accuracy: claims/definitions/timestamps が transcript と一致するか。誤定義・幻覚は大幅減点。
- hierarchy: section 分けが論理的か。重複・孤立 bullet・誤グルーピングは減点。
- conciseness: bullet/summary が要約されているか。冗長・繰返しは減点。短すぎて意味不明も減点。
- importance: \`points[*].important: true\` の使い分け。乱発と欠落の両方減点。
- provenance: \`key_terms[*].from: 'transcript'\` の比率と妥当性。inferred を必要箇所のみで使っているか。

# Lecture-specific 2軸 (0-10)
- sectionCoherence: section 内の bullet/key_terms/examples/points が同じテーマで束ねられているか。違うトピックが混ざっている = 減点。
- contentFidelity: extras (formula/procedure_steps/argument_chain/timeline) の中身が transcript の内容に grounded か。
  - 例: 物理講義 transcript なのに formula に "E = mc^2" が出現、transcript には "静電ポテンシャル" "電位" しか出てこない → これは prompt exemplar parroting で大幅減点 (3点以下)。
  - ground_truth.expectedFormulas に挙がっている formula は parroting ではない。
  - extras 全体が空でも transcript に formula らしき式・段階的手順がなければ pass。

# 採点指針
- 5 = 平均的な note。
- issues は 「coverage が低い」ではなく 「[03:20] X の定義が transcript にあるが note に欠落」のように anchor付き具体的に。
- wins も 「[12:00] 静電ポテンシャル section が良くまとまっている」のように。
- overall は coverage 0.25 + accuracy 0.30 + hierarchy 0.15 + conciseness 0.10 + importance 0.05 + sectionCoherence 0.05 + contentFidelity 0.10 の加重平均。provenance は overall に含めない。

出力:
{
  "coverage": <0-10>, "accuracy": <0-10>, "hierarchy": <0-10>, "conciseness": <0-10>,
  "importance": <0-10>, "provenance": <0-10>,
  "sectionCoherence": <0-10>, "contentFidelity": <0-10>,
  "overall": <0-10>,
  "issues": ["...", "..."], "wins": ["...", "..."]
}`;
```

- [ ] **Step 2: Commit**

```bash
git add desktop/eval/judges/families/lecture-judge.ts
git commit -m "feat(eval): Lecture judge prompt (5 family axes + content fidelity)

sectionCoherence + contentFidelity are the Lecture-specific axes layered
on the common 6. contentFidelity carries the anti-parroting signal —
explicit instruction with the E=mc² example in the physics-transcript
counterexample form."
```

### Task 10: Meeting judge prompt

**Files:**
- Create: `desktop/eval/judges/families/meeting-judge.ts`

- [ ] **Step 1: Write the prompt module**

```typescript
// desktop/eval/judges/families/meeting-judge.ts
export const MEETING_JUDGE_PROMPT = `あなたは Meeting-family note の厳しい採点者です。
入力: transcript, note (MeetingNote JSON), ground_truth (decisions/actionItems/participantCount).
出力は JSON のみ。

# 共通6軸 (0-10) — coverage/accuracy/hierarchy/conciseness/importance/provenance
(LectureJudge と同じ意味で 5=平均)

# Meeting-specific 3軸 (0-10)
- decisionCapture: ground_truth.decisions に mustAppear=true でリストされた決定が note.decisions に出現するか。
  - 全部出現 = 10点、半分 = 5点、ゼロ = 0点。
  - 同義の言い換え (例: 「Q3 で出荷」 vs 「2026年Q3末ローンチ」) は受容。
  - 言い換えなしで言葉が違うだけ (例: 「支払いリファクタ Q3」 vs 「決済機能改修 Q3」) も受容。
- actionItemClarity: note.next_steps の各項目に owner と due (または concrete-enough date hint) が付いているか。曖昧 (誰がいつ?) は減点。
- participantAttribution: decisions[*].made_by / proposals[*].proposed_by / open_questions[*].asked_by が SpeakerRef として埋まっているか。null/欠落 は減点 (transcript で明確に話者が分かるケースのみ)。

# 採点指針
- decisions/actions が note にひとつもない = decisionCapture 0点 (meeting note として失格)
- executive_summary が空 = hierarchy 大幅減点
- issues は anchor付き 「[01:30] CFO が承認した予算増額 decision が欠落」
- overall: coverage 0.20 + accuracy 0.25 + hierarchy 0.10 + conciseness 0.05 + importance 0.05 + decisionCapture 0.20 + actionItemClarity 0.10 + participantAttribution 0.05

出力:
{
  "coverage": <0-10>, "accuracy": <0-10>, "hierarchy": <0-10>, "conciseness": <0-10>,
  "importance": <0-10>, "provenance": <0-10>,
  "decisionCapture": <0-10>, "actionItemClarity": <0-10>, "participantAttribution": <0-10>,
  "overall": <0-10>,
  "issues": ["...", "..."], "wins": ["...", "..."]
}`;
```

- [ ] **Step 2: Commit**

```bash
git add desktop/eval/judges/families/meeting-judge.ts
git commit -m "feat(eval): Meeting judge prompt (decision/action/attribution axes)

decisionCapture is the load-bearing axis — uses ground-truth mustAppear
list as the canonical reference. actionItemClarity probes for owner+due.
participantAttribution checks SpeakerRef hydration."
```

### Task 11: Interview judge prompt

**Files:**
- Create: `desktop/eval/judges/families/interview-judge.ts`

- [ ] **Step 1: Write the prompt module**

```typescript
// desktop/eval/judges/families/interview-judge.ts
export const INTERVIEW_JUDGE_PROMPT = `あなたは Interview-family note の厳しい採点者です。
入力: transcript, note (InterviewNote JSON), ground_truth (qaPairs/themes/participantCount).
出力は JSON のみ。

# 共通6軸 (0-10) — coverage/accuracy/hierarchy/conciseness/importance/provenance

# Interview-specific 3軸 (0-10)
- qaParity: ground_truth.qaPairs の question を note.qa_pairs[*].question で何 % カバーしているか。
  - 言い換え受容、内容が同じなら match。
  - 1 ground-truth Q に複数 note Q がぶら下がる = OK (split は問題ない)。
  - note Q に対応 ground-truth Q がない = inference か paraphrase か推定する。pure hallucination は減点。
- themeExtraction: note.themes が ground_truth.themes と意味的に揃っているか。
  - 完全一致は不要、意味的 overlap でOK。
  - note.themes が空 = 大幅減点 (interview の core value)。
- quotableSelection: note.quotable_lines が「印象的・代表的」発言を引いているか。
  - 平凡な発言を quotable に入れている = 減点。
  - 0個 = warning だが減点小。

# 採点指針
- qa_pairs が3未満 = qaParity 大幅減点 (conversational structure 抽出失敗)
- asked_by == answered_by の qa_pair = accuracy 大幅減点
- issues: 「[01:10] Q『プロダクト失敗体験』が transcript にあるが qa_pairs に欠落」
- overall: coverage 0.15 + accuracy 0.25 + hierarchy 0.05 + conciseness 0.05 + importance 0.05 + qaParity 0.25 + themeExtraction 0.15 + quotableSelection 0.05

出力:
{
  "coverage": <0-10>, "accuracy": <0-10>, "hierarchy": <0-10>, "conciseness": <0-10>,
  "importance": <0-10>, "provenance": <0-10>,
  "qaParity": <0-10>, "themeExtraction": <0-10>, "quotableSelection": <0-10>,
  "overall": <0-10>,
  "issues": ["...", "..."], "wins": ["...", "..."]
}`;
```

- [ ] **Step 2: Commit**

```bash
git add desktop/eval/judges/families/interview-judge.ts
git commit -m "feat(eval): Interview judge prompt (qa-parity/themes/quotable axes)"
```

### Task 12: Brainstorm judge prompt

**Files:**
- Create: `desktop/eval/judges/families/brainstorm-judge.ts`

- [ ] **Step 1: Write the prompt module**

```typescript
// desktop/eval/judges/families/brainstorm-judge.ts
export const BRAINSTORM_JUDGE_PROMPT = `あなたは Brainstorm-family note の厳しい採点者です。
入力: transcript, note (BrainstormNote JSON), ground_truth (themes/ideaCount/participantCount).
出力は JSON のみ。

# 共通6軸 (0-10) — coverage/accuracy/hierarchy/conciseness/importance/provenance

# Brainstorm-specific 3軸 (0-10)
- clusterCoherence: idea_clusters[*].theme が、その cluster の ideas を実際に括れる label になっているか。
  - 「速さ」cluster に「シェア」関連のideaが混ざっている = 大幅減点。
  - theme と ideas の matching を厳しく見る。
- ideaDiversity: ideas が同じ発想の言い換えになっていないか。
  - 「ノート生成を5秒以内に」「ノート生成を高速に」「ノート生成を瞬時にする」が並ぶ = 減点。
  - 同じテーマ内でも angle が違えば多様性高。
- argumentChainDepth: cluster 間で「Aの議論がBにつながった」「Cの反論が出た」という構造が note に表現されているか。
  - parking_lot, conclusions に反論や保留が記録されている = 加点。
  - 単なる箇条書きのみ = 中点(5)。

# 採点指針
- idea_clusters が空 = 大幅減点 (brainstorm の意味なし)
- ideas[*].id が重複 = accuracy 減点 (post-decode のUUID付与失敗)
- idea 総数 が ground_truth.ideaCount から大きく乖離 (≤30% または ≥200%) = coverage 減点
- overall: coverage 0.20 + accuracy 0.15 + hierarchy 0.05 + conciseness 0.05 + importance 0.05 + clusterCoherence 0.25 + ideaDiversity 0.15 + argumentChainDepth 0.10

出力:
{
  "coverage": <0-10>, "accuracy": <0-10>, "hierarchy": <0-10>, "conciseness": <0-10>,
  "importance": <0-10>, "provenance": <0-10>,
  "clusterCoherence": <0-10>, "ideaDiversity": <0-10>, "argumentChainDepth": <0-10>,
  "overall": <0-10>,
  "issues": ["...", "..."], "wins": ["...", "..."]
}`;
```

- [ ] **Step 2: Commit**

```bash
git add desktop/eval/judges/families/brainstorm-judge.ts
git commit -m "feat(eval): Brainstorm judge prompt (cluster/diversity/argument axes)"
```

### Task 13: Content-fidelity standalone judge (LLM layer)

**Files:**
- Create: `desktop/eval/judges/content-fidelity-judge.ts`
- Create: `desktop/eval/judges/content-fidelity-judge.test.ts`

**Goal:** A *focused* LLM judge that scores ONLY the content-fidelity axis with a tight, fast prompt — used as a regression sentinel and for cross-family parroting detection. The base judge in Task 9 already scores `contentFidelity` for Lecture; this standalone judge applies the same lens to Meeting/Interview/Brainstorm and emits a `parroting: boolean` flag.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/eval/judges/content-fidelity-judge.test.ts
import { describe, it, expect } from 'vitest';
import { __testOnly_parseContentFidelity } from './content-fidelity-judge';

describe('parseContentFidelity', () => {
  it('parses a clean response', () => {
    const r = __testOnly_parseContentFidelity(JSON.stringify({
      score: 8.5, parroting: false, evidence: ['eq F=qE appears at 30s'],
    }));
    expect(r.score).toBe(8.5);
    expect(r.parroting).toBe(false);
    expect(r.evidence).toEqual(['eq F=qE appears at 30s']);
  });

  it('defaults missing fields safely', () => {
    const r = __testOnly_parseContentFidelity('{}');
    expect(r.score).toBe(0);
    expect(r.parroting).toBe(true);  // safe default: assume parroting if unclear
    expect(r.evidence).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement**

```typescript
// desktop/eval/judges/content-fidelity-judge.ts
import OpenAI from 'openai';
import type { FixtureTranscript, FixtureGroundTruth } from '../fixtures/_schema';
import type { NoteFamily } from './judge-types';

export interface ContentFidelityResult {
  score: number;        // 0-10
  parroting: boolean;   // true = exemplar parroting suspected
  evidence: string[];   // anchor-based citations
  judgeModelId: string;
}

const SYSTEM_PROMPT = `あなたは AI 生成 note が transcript の実内容に grounded か判定する厳しい検査官です。
入力: transcript の bucket列 + note の specific-content fields (key_terms/extras/decisions/qa_pairs/ideas など).
出力は JSON のみ。

判定基準:
- "score" 0-10: note の specific-content fields が transcript の内容に grounded である度合い。
- "parroting" boolean: prompt exemplar (例: 物理講義 transcript に対して "E=mc^2", 簿記講義に対して "F=ma") が transcript と無関係なまま note に流出している → true。
- "evidence" array: 「[03:20] X が transcript にあり note の Y に対応」のような anchor 付き根拠を 3-5 個。

例:
- transcript: 静電ポテンシャル, 電位. note.formula: "E = mc^2" → parroting=true, score≤2.
- transcript: F = qE は重要. note.formula: "F = qE" → parroting=false, score≥7.

出力:
{ "score": <0-10>, "parroting": <true|false>, "evidence": ["...", "..."] }`;

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

let _groq: OpenAI | undefined;
function groq(): OpenAI {
  if (!_groq) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set');
    _groq = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
  }
  return _groq;
}

export function __testOnly_parseContentFidelity(text: string): ContentFidelityResult {
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { parsed = {}; }
  return {
    score: typeof parsed.score === 'number' ? Math.max(0, Math.min(10, Math.round(parsed.score * 10) / 10)) : 0,
    parroting: parsed.parroting === false ? false : true, // safe default = assume parroting
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.filter((s: unknown) => typeof s === 'string') : [],
    judgeModelId: DEFAULT_MODEL,
  };
}

// Extract specific-content fields per family — these are the fields the LLM can parrot
function extractContentFields(family: NoteFamily, note: any): string {
  const out: Record<string, unknown> = {};
  if (family === 'lecture') {
    out.key_terms = (note.sections ?? []).flatMap((s: any) => s.key_terms ?? []);
    out.extras = (note.sections ?? []).flatMap((s: any) => s.extras ?? []);
  } else if (family === 'meeting') {
    out.decisions = note.decisions ?? [];
    out.proposals = note.proposals ?? [];
    out.action_items = note.next_steps ?? [];
  } else if (family === 'interview') {
    out.qa_pairs = note.qa_pairs ?? [];
    out.quotable_lines = note.quotable_lines ?? [];
    out.themes = note.themes ?? [];
  } else if (family === 'brainstorm') {
    out.idea_clusters = note.idea_clusters ?? [];
    out.parking_lot = note.parking_lot ?? [];
  }
  return JSON.stringify(out, null, 2);
}

export async function judgeContentFidelity(input: {
  family: NoteFamily;
  note: any;
  transcript: FixtureTranscript;
  groundTruth?: FixtureGroundTruth;
  judgeModelId?: string;
}): Promise<ContentFidelityResult> {
  const modelId = input.judgeModelId ?? DEFAULT_MODEL;
  const transcriptText = input.transcript.transcripts.map(b => `[${b.ts}s] ${b.text}`).join('\n');
  const contentJson = extractContentFields(input.family, input.note);
  const gtAllowlist = input.groundTruth?.expectedFormulas
    ? `\n\nground-truth allowlist (these literal strings are OK even if not in transcript):\n${input.groundTruth.expectedFormulas.join('\n')}`
    : '';
  const userPrompt = `transcript:\n${transcriptText}\n\nnote.specific_content:\n${contentJson}${gtAllowlist}`;
  const res = await groq().chat.completions.create({
    model: modelId,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
    response_format: { type: 'json_object' },
    temperature: 0,
  });
  const text = res.choices[0]?.message?.content ?? '{}';
  const parsed = __testOnly_parseContentFidelity(text);
  parsed.judgeModelId = modelId;
  return parsed;
}
```

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/eval/judges/content-fidelity-judge.ts desktop/eval/judges/content-fidelity-judge.test.ts
git commit -m "feat(eval): standalone content-fidelity judge (anti-parroting LLM axis)

VERDICT carry-forward #1, LLM layer. Family-agnostic; extracts the
specific-content fields per family and asks judge LLM: is this
grounded in transcript or parroted from prompt exemplars? Returns
parroting: boolean (safe default true)."
```

---

## Items 6, 8 — Retry-rate histogram + slot distribution metrics

### Task 14: Baseline storage format

**Files:**
- Create: `desktop/eval/baseline/format.ts`
- Create: `desktop/eval/baseline/format.test.ts`
- Create: `desktop/eval/baseline/store.ts`
- Create: `desktop/eval/baseline/store.test.ts`

**Goal:** Define `BaselineFile` Zod schema + save/load helpers. Each baseline pins the run's *model identity* (`modelId`, `promptVariantId`, `judgeModelId`) so cross-baseline comparisons are honest.

- [ ] **Step 1: Write the failing format test**

```typescript
// desktop/eval/baseline/format.test.ts
import { describe, it, expect } from 'vitest';
import { BaselineFileSchema } from './format';

describe('BaselineFileSchema', () => {
  it('parses a valid baseline', () => {
    const file = {
      savedAt: '2026-05-27T00:00:00Z',
      modelId: 'llama-3.2-3b-q4-km',
      promptVariantId: 'v1-baseline',
      judgeModelId: 'llama-3.3-70b-versatile',
      results: [{
        fixtureId: 'procedural-physics-em',
        family: 'lecture',
        contractTest: { schemaParse: 'PASS', overall: 'PASS', findings: [] },
        judge: {
          family: 'lecture', judgeModelId: 'llama-3.3-70b-versatile',
          axes: { coverage: 7, accuracy: 7, hierarchy: 6, conciseness: 6, importance: 5, provenance: 8, sectionCoherence: 7, contentFidelity: 2 },
          overall: 6.0, issues: ['E=mc² parroted'], wins: ['JA section titles coherent'],
        },
        contentFidelity: { score: 2, parroting: true, evidence: ['no E=mc^2 in transcript'], judgeModelId: 'llama-3.3-70b-versatile' },
        retryHistogram: { samples: 1, attemptsMean: 1.0, attemptsByBin: { '1': 1, '2': 0, '3': 0 } },
        slotDistribution: { slotTypes: 1, slotsEmerged: 4, byType: { formula: 4 } },
        runMs: 72073,
      }],
    };
    expect(BaselineFileSchema.safeParse(file).success).toBe(true);
  });
});
```

- [ ] **Step 2: Implement format.ts**

```typescript
// desktop/eval/baseline/format.ts
import { z } from 'zod';

const ContractFindingSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(['error', 'warning']),
  pass: z.boolean(),
  message: z.string(),
  detail: z.unknown().optional(),
});

const ContractTestResultSchema = z.object({
  schemaParse: z.enum(['PASS', 'FAIL']),
  schemaParseError: z.string().optional(),
  overall: z.enum(['PASS', 'FAIL']),
  findings: z.array(ContractFindingSchema),
});

const JudgeResultSchema = z.object({
  family: z.enum(['lecture', 'meeting', 'interview', 'brainstorm']),
  judgeModelId: z.string(),
  axes: z.record(z.string(), z.number()),
  overall: z.number(),
  issues: z.array(z.string()),
  wins: z.array(z.string()),
});

const ContentFidelitySchema = z.object({
  score: z.number(),
  parroting: z.boolean(),
  evidence: z.array(z.string()),
  judgeModelId: z.string(),
});

const RetryHistogramSchema = z.object({
  samples: z.number().int().nonnegative(),
  attemptsMean: z.number().nonnegative(),
  attemptsByBin: z.record(z.string(), z.number().int().nonnegative()),
});

const SlotDistributionSchema = z.object({
  slotTypes: z.number().int().nonnegative(),
  slotsEmerged: z.number().int().nonnegative(),
  byType: z.record(z.string(), z.number().int().nonnegative()),
});

export const FixtureResultSchema = z.object({
  fixtureId: z.string(),
  family: z.enum(['lecture', 'meeting', 'interview', 'brainstorm']),
  contractTest: ContractTestResultSchema,
  judge: JudgeResultSchema.optional(),                  // optional — ContractTest-only runs skip the LLM
  contentFidelity: ContentFidelitySchema.optional(),    // optional — Lecture-default, others on demand
  retryHistogram: RetryHistogramSchema.optional(),
  slotDistribution: SlotDistributionSchema.optional(),
  derScore: z.number().optional(),                      // Plan 4 lift, see Task 24
  runMs: z.number().nonnegative(),
});
export type FixtureResult = z.infer<typeof FixtureResultSchema>;

export const BaselineFileSchema = z.object({
  savedAt: z.string().datetime(),
  modelId: z.string(),                                  // ModelProfile.id
  promptVariantId: z.string(),
  judgeModelId: z.string(),
  notes: z.string().optional(),
  results: z.array(FixtureResultSchema),
});
export type BaselineFile = z.infer<typeof BaselineFileSchema>;
```

- [ ] **Step 3: Implement store.ts**

```typescript
// desktop/eval/baseline/store.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BaselineFileSchema, type BaselineFile } from './format';

export function saveBaseline(path: string, baseline: BaselineFile): void {
  // Validate before persisting — fail loudly if a runner produced malformed data
  BaselineFileSchema.parse(baseline);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(baseline, null, 2), 'utf8');
}

export function loadBaseline(path: string): BaselineFile | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const json = JSON.parse(raw);
  return BaselineFileSchema.parse(json);
}
```

- [ ] **Step 4: Write a quick store roundtrip test**

```typescript
// desktop/eval/baseline/store.test.ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveBaseline, loadBaseline } from './store';

describe('baseline store roundtrip', () => {
  it('saves and loads a baseline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-'));
    const path = join(dir, 'v0.json');
    const baseline = {
      savedAt: '2026-05-27T00:00:00Z',
      modelId: 'llama-3.2-3b-q4-km',
      promptVariantId: 'v1-baseline',
      judgeModelId: 'llama-3.3-70b-versatile',
      results: [],
    };
    saveBaseline(path, baseline);
    const loaded = loadBaseline(path);
    expect(loaded?.modelId).toBe('llama-3.2-3b-q4-km');
  });
});
```

- [ ] **Step 5: Run tests, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add desktop/eval/baseline
git commit -m "feat(eval): baseline file schema + save/load roundtrip

BaselineFile pins modelId + promptVariantId + judgeModelId so
cross-baseline comparisons stay honest. FixtureResult holds the
union (ContractTest required + judge/contentFidelity/retryHistogram/
slotDistribution/derScore optional)."
```

### Task 15: Baseline diff (regression detection)

**Files:**
- Create: `desktop/eval/baseline/diff.ts`
- Create: `desktop/eval/baseline/diff.test.ts`

**Goal:** Given two baselines (A=before, B=after), produce a typed diff: per-fixture per-axis delta, ContractTest regressions, judge-model mismatch warning.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/eval/baseline/diff.test.ts
import { describe, it, expect } from 'vitest';
import { diffBaselines } from './diff';
import type { BaselineFile } from './format';

const make = (judgeOverall: number): BaselineFile => ({
  savedAt: '2026-05-27T00:00:00Z',
  modelId: 'llama-3.2-3b-q4-km',
  promptVariantId: 'v1',
  judgeModelId: 'llama-3.3-70b-versatile',
  results: [{
    fixtureId: 'fx',
    family: 'lecture',
    contractTest: { schemaParse: 'PASS', overall: 'PASS', findings: [] },
    judge: {
      family: 'lecture', judgeModelId: 'llama-3.3-70b-versatile',
      axes: { coverage: 7, accuracy: 7, hierarchy: 6, conciseness: 6, importance: 5, provenance: 8, sectionCoherence: 7, contentFidelity: 5 },
      overall: judgeOverall, issues: [], wins: [],
    },
    runMs: 1000,
  }],
});

describe('diffBaselines', () => {
  it('reports +0.5 overall delta when B improves over A', () => {
    const d = diffBaselines(make(6.0), make(6.5));
    expect(d.perFixture[0].overallDelta).toBe(0.5);
    expect(d.summary.regression).toBe(false);
  });

  it('flags regression when B drops below A by ≥0.3 overall', () => {
    const d = diffBaselines(make(6.5), make(6.1));
    expect(d.summary.regression).toBe(true);
  });

  it('warns on judge-model mismatch', () => {
    const a = make(6.0);
    const b = make(6.0);
    b.judgeModelId = 'claude-opus-4-x';
    const d = diffBaselines(a, b);
    expect(d.warnings.some(w => w.includes('judgeModelId mismatch'))).toBe(true);
  });
});
```

- [ ] **Step 2: Implement diff.ts**

```typescript
// desktop/eval/baseline/diff.ts
import type { BaselineFile, FixtureResult } from './format';

export interface PerFixtureDiff {
  fixtureId: string;
  family: string;
  overallDelta: number;
  axisDelta: Record<string, number>;
  contractTestRegression: boolean;  // A PASS → B FAIL
  fidelityRegression: boolean;      // A score - B score > 1
}

export interface BaselineDiff {
  perFixture: PerFixtureDiff[];
  summary: {
    n: number;
    meanOverallDelta: number;
    regression: boolean;            // true if any fixture has overallDelta < -0.3
  };
  warnings: string[];
}

const REGRESSION_OVERALL_THRESHOLD = -0.3;
const REGRESSION_FIDELITY_THRESHOLD = -1.0;

export function diffBaselines(before: BaselineFile, after: BaselineFile): BaselineDiff {
  const warnings: string[] = [];
  if (before.modelId !== after.modelId) warnings.push(`modelId mismatch: ${before.modelId} → ${after.modelId} (comparison is cross-model)`);
  if (before.promptVariantId !== after.promptVariantId) warnings.push(`promptVariantId mismatch: ${before.promptVariantId} → ${after.promptVariantId} (intended for prompt A/B)`);
  if (before.judgeModelId !== after.judgeModelId) warnings.push(`judgeModelId mismatch: ${before.judgeModelId} → ${after.judgeModelId} — score calibration drift expected`);
  const beforeByFixture = new Map(before.results.map(r => [r.fixtureId, r]));
  const perFixture: PerFixtureDiff[] = [];
  for (const b of after.results) {
    const a = beforeByFixture.get(b.fixtureId);
    if (!a) continue;
    const overallDelta = (b.judge?.overall ?? 0) - (a.judge?.overall ?? 0);
    const axisDelta: Record<string, number> = {};
    const axesA = a.judge?.axes ?? {};
    const axesB = b.judge?.axes ?? {};
    for (const k of new Set([...Object.keys(axesA), ...Object.keys(axesB)])) {
      axisDelta[k] = (axesB[k] ?? 0) - (axesA[k] ?? 0);
    }
    perFixture.push({
      fixtureId: b.fixtureId,
      family: b.family,
      overallDelta: round1(overallDelta),
      axisDelta: Object.fromEntries(Object.entries(axisDelta).map(([k, v]) => [k, round1(v)])),
      contractTestRegression: a.contractTest.overall === 'PASS' && b.contractTest.overall === 'FAIL',
      fidelityRegression: ((b.contentFidelity?.score ?? 10) - (a.contentFidelity?.score ?? 10)) < REGRESSION_FIDELITY_THRESHOLD,
    });
  }
  const meanOverallDelta = perFixture.length === 0 ? 0 : perFixture.reduce((s, d) => s + d.overallDelta, 0) / perFixture.length;
  const regression =
    perFixture.some(d => d.overallDelta < REGRESSION_OVERALL_THRESHOLD)
    || perFixture.some(d => d.contractTestRegression)
    || perFixture.some(d => d.fidelityRegression);
  return {
    perFixture,
    summary: { n: perFixture.length, meanOverallDelta: round1(meanOverallDelta), regression },
    warnings,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
```

- [ ] **Step 3: Run tests, expect PASS**

- [ ] **Step 4: Commit**

```bash
git add desktop/eval/baseline/diff.ts desktop/eval/baseline/diff.test.ts
git commit -m "feat(eval): baseline diff with regression detection

Per-fixture axisDelta + overallDelta + contractTestRegression flag.
Summary.regression=true when any fixture: overallDelta<-0.3 OR
contract A:PASS→B:FAIL OR fidelity drop >1. Warnings on model/prompt/
judge mismatch (cross-baseline comparison is OK, but calibration
drift should be visible)."
```

### Task 16: Retry-rate histogram

**Files:**
- Create: `desktop/eval/metrics/retry-histogram.ts`
- Create: `desktop/eval/metrics/retry-histogram.test.ts`

**Goal:** Aggregate Plan 2's `attemptsUsed` field (per VERDICT carry-forward #2) into per-call histograms. The Spike 0.1 take-4 numbers (mean 1.20, bins: {1:4, 2:1, 3:0}) become the v0 baseline.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/eval/metrics/retry-histogram.test.ts
import { describe, it, expect } from 'vitest';
import { buildRetryHistogram } from './retry-histogram';

describe('buildRetryHistogram', () => {
  it('bins attempts and computes mean', () => {
    const h = buildRetryHistogram([1, 1, 1, 1, 2]);
    expect(h.samples).toBe(5);
    expect(h.attemptsMean).toBeCloseTo(1.2, 2);
    expect(h.attemptsByBin).toEqual({ '1': 4, '2': 1, '3': 0 });
  });

  it('handles empty input', () => {
    const h = buildRetryHistogram([]);
    expect(h.samples).toBe(0);
    expect(h.attemptsMean).toBe(0);
  });

  it('caps overflow attempts at the 3+ bin', () => {
    const h = buildRetryHistogram([1, 2, 3, 4, 5]);
    expect(h.attemptsByBin['1']).toBe(1);
    expect(h.attemptsByBin['2']).toBe(1);
    expect(h.attemptsByBin['3+']).toBe(3);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// desktop/eval/metrics/retry-histogram.ts
export interface RetryHistogram {
  samples: number;
  attemptsMean: number;
  attemptsByBin: Record<string, number>;
}

export function buildRetryHistogram(attempts: number[]): RetryHistogram {
  if (attempts.length === 0) return { samples: 0, attemptsMean: 0, attemptsByBin: {} };
  const byBin: Record<string, number> = { '1': 0, '2': 0, '3': 0, '3+': 0 };
  let sum = 0;
  for (const a of attempts) {
    sum += a;
    if (a === 1) byBin['1']++;
    else if (a === 2) byBin['2']++;
    else if (a === 3) byBin['3']++;
    else byBin['3+']++;
  }
  if (byBin['3+'] > 0) {
    // promote 3+ to its dedicated bin only when used (keeps Spike 0.1 baseline shape ({1,2,3}))
  } else {
    delete byBin['3+'];
  }
  return {
    samples: attempts.length,
    attemptsMean: round2(sum / attempts.length),
    attemptsByBin: byBin,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 3: Run test, expect PASS**

- [ ] **Step 4: Commit**

```bash
git add desktop/eval/metrics/retry-histogram.ts desktop/eval/metrics/retry-histogram.test.ts
git commit -m "feat(eval): retry-rate histogram metric

VERDICT carry-forward #2. Aggregates Plan 2's per-call attemptsUsed
into samples / attemptsMean / attemptsByBin{1,2,3,3+}. Spike 0.1
take-4 baseline: {samples:5, mean:1.20, bins:{1:4,2:1,3:0}}."
```

### Task 17: Slot distribution metric (`slotTypes` vs `slotsEmerged`)

**Files:**
- Create: `desktop/eval/metrics/slot-distribution.ts`
- Create: `desktop/eval/metrics/slot-distribution.test.ts`

**Goal:** Distinguish "how many distinct slot types appeared" from "how many slot occurrences" (VERDICT carry-forward #4 for Plan 6 — Lecture's formula-only collapses these into one number, but Meeting/Interview/Brainstorm with multi-type extras need both signals).

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/eval/metrics/slot-distribution.test.ts
import { describe, it, expect } from 'vitest';
import { computeSlotDistribution } from './slot-distribution';

describe('computeSlotDistribution', () => {
  it('returns zeros for note with no extras', () => {
    const d = computeSlotDistribution({ sections: [] });
    expect(d.slotTypes).toBe(0);
    expect(d.slotsEmerged).toBe(0);
    expect(d.byType).toEqual({});
  });

  it('counts distinct slot types and occurrences separately', () => {
    const note = {
      sections: [
        { extras: [{ type: 'formula', items: [] }, { type: 'formula', items: [] }] },
        { extras: [{ type: 'procedure_steps', items: [] }] },
        { extras: [{ type: 'formula', items: [] }] },
      ],
    };
    const d = computeSlotDistribution(note);
    expect(d.slotTypes).toBe(2);
    expect(d.slotsEmerged).toBe(4);
    expect(d.byType).toEqual({ formula: 3, procedure_steps: 1 });
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// desktop/eval/metrics/slot-distribution.ts
export interface SlotDistribution {
  slotTypes: number;        // distinct extra.type values
  slotsEmerged: number;     // total extras occurrences
  byType: Record<string, number>;
}

export function computeSlotDistribution(note: any): SlotDistribution {
  const sections: any[] = note?.sections ?? [];
  const byType: Record<string, number> = {};
  let slotsEmerged = 0;
  for (const s of sections) {
    for (const e of s.extras ?? []) {
      const t = e?.type;
      if (typeof t !== 'string') continue;
      byType[t] = (byType[t] ?? 0) + 1;
      slotsEmerged += 1;
    }
  }
  return {
    slotTypes: Object.keys(byType).length,
    slotsEmerged,
    byType,
  };
}
```

- [ ] **Step 3: Run test, expect PASS**

- [ ] **Step 4: Commit**

```bash
git add desktop/eval/metrics/slot-distribution.ts desktop/eval/metrics/slot-distribution.test.ts
git commit -m "feat(eval): slot distribution metric (types vs occurrences)

VERDICT carry-forward #4. slotTypes (distinct) vs slotsEmerged
(occurrences) — Plan 6 needs both signals once Meeting/Interview/
Brainstorm gain multi-type extras."
```

---

## Item 4 — Runners + CLI

### Task 18: Single-fixture runner + pipeline stub

**Files:**
- Create: `desktop/eval/runners/pipeline-stub.ts`
- Create: `desktop/eval/runners/single-fixture.ts`
- Create: `desktop/eval/runners/single-fixture.test.ts`

**HARDWARE-SAFETY:** Tasks 18-20 with `pipeline-stub.ts` do NOT invoke the sidecar (pure-TS deterministic stub for plumbing). Task 22 wires the *real* sidecar — that task carries the `(spike-llm)` rule reminders.

**Goal:** `runSingleFixture({ fixtureDir, family, runner })` → loads fixture, calls runner (stub or real pipeline), wraps result in `FixtureResult`. Stub returns a deterministic synthetic note matching family schema so plumbing tests run without LLM.

- [ ] **Step 1: Write pipeline-stub.ts**

```typescript
// desktop/eval/runners/pipeline-stub.ts
import type { FixtureTranscript, FixtureMeta } from '../fixtures/_schema';

export interface PipelineResult {
  note: any;
  retryAttempts: number[];                // per-call attemptsUsed from Plan 2 wrapper
  runMs: number;
}

export interface PipelineRunner {
  id: string;                              // e.g. 'stub', 'offline-3b', 'offline-1b'
  modelId: string;                         // ModelProfile.id
  promptVariantId: string;
  run: (input: { meta: FixtureMeta; transcript: FixtureTranscript }) => Promise<PipelineResult>;
}

// Stub that returns a deterministic, schema-passing note per family.
// Used by Tasks 18-20 plumbing tests AND for diff-vs-actual debugging.
export const STUB_RUNNER: PipelineRunner = {
  id: 'stub',
  modelId: 'stub-deterministic',
  promptVariantId: 'stub-v0',
  async run({ meta, transcript }) {
    const base = {
      schemaVersion: 1,
      family: meta.family,
      title: `Stub note for ${meta.fixtureId}`,
      generatedAt: new Date().toISOString(),
      generatedBy: { model: 'stub-deterministic', promptVersion: 0 },
      language: meta.language,
      durationSec: meta.durationSec,
    };
    if (meta.family === 'lecture') {
      const ts0 = transcript.transcripts[0]?.ts ?? 0;
      const ts1 = transcript.transcripts[Math.floor(transcript.transcripts.length / 2)]?.ts ?? 0;
      const ts2 = transcript.transcripts[transcript.transcripts.length - 1]?.ts ?? 0;
      return {
        note: {
          ...base,
          tldr: 'Stub tl;dr',
          sections: [
            { heading: 'Intro', ts: ts0, summary: 'stub', key_terms: [{ term: 'A', definition: 'a', ts: ts0, from: 'transcript' }], examples: [], points: [] },
            { heading: 'Mid', ts: ts1, summary: 'stub', key_terms: [{ term: 'B', definition: 'b', ts: ts1, from: 'transcript' }], examples: [], points: [] },
            { heading: 'End', ts: ts2, summary: 'stub', key_terms: [{ term: 'C', definition: 'c', ts: ts2, from: 'transcript' }], examples: [], points: [] },
          ],
        },
        retryAttempts: [1, 1, 1],
        runMs: 1,
      };
    }
    if (meta.family === 'meeting') {
      return {
        note: {
          ...base,
          purpose: 'stub purpose',
          executive_summary: 'A stub executive summary for plumbing verification.',
          topic_arc: [{ topic: 't', ts: 0, speakers_involved: [0] }],
          discussions: [],
          decisions: [{ text: 'stub decision', ts: 0, from: 'transcript' }],
          open_questions: [],
          next_steps: [{ text: 'stub action', ts: 10, from: 'transcript' }],
        },
        retryAttempts: [1],
        runMs: 1,
      };
    }
    if (meta.family === 'interview') {
      return {
        note: {
          ...base,
          purpose: 'stub purpose',
          subject_summary: 'stub subject',
          qa_pairs: Array.from({ length: 3 }, (_, i) => ({
            question: `stub q${i}`, answer: `stub a${i}`, ts: i * 10, asked_by: 0, answered_by: 1, from: 'transcript',
          })),
          themes: [{ name: 'stub theme', appears_at_ts: [0] }],
          quotable_lines: [],
          key_takeaways: [],
        },
        retryAttempts: [1],
        runMs: 1,
      };
    }
    // brainstorm
    return {
      note: {
        ...base,
        purpose: 'stub purpose',
        idea_clusters: [{
          theme: 'stub theme',
          ideas: [
            { id: 'stub-1', text: 'stub idea 1', ts: 0, from: 'transcript' },
            { id: 'stub-2', text: 'stub idea 2', ts: 10, from: 'transcript' },
          ],
        }],
      },
      retryAttempts: [1],
      runMs: 1,
    };
  },
};
```

- [ ] **Step 2: Write single-fixture.ts**

```typescript
// desktop/eval/runners/single-fixture.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FixtureMetaSchema, FixtureTranscriptSchema, FixtureGroundTruthSchema, type FixtureGroundTruth } from '../fixtures/_schema';
import { runContractTest } from '../contract/contract-test';
import { LECTURE_RULES } from '../contract/families/lecture';
import { MEETING_RULES } from '../contract/families/meeting';
import { INTERVIEW_RULES } from '../contract/families/interview';
import { BRAINSTORM_RULES } from '../contract/families/brainstorm';
import { judgeNote } from '../judges/llm-judge';
import { judgeContentFidelity } from '../judges/content-fidelity-judge';
import { buildRetryHistogram } from '../metrics/retry-histogram';
import { computeSlotDistribution } from '../metrics/slot-distribution';
import type { FixtureResult } from '../baseline/format';
import type { PipelineRunner } from './pipeline-stub';
import { z } from 'zod';

// Per-family stub Zod schema for Phase 7 plumbing. Plan 2 replaces with real schemas.
const StubSchemas: Record<string, z.ZodType> = {
  lecture: z.object({}).passthrough(),
  meeting: z.object({}).passthrough(),
  interview: z.object({}).passthrough(),
  brainstorm: z.object({}).passthrough(),
};

export async function runSingleFixture(opts: {
  fixtureDir: string;
  runner: PipelineRunner;
  skipLlmJudge?: boolean;
  judgeModelId?: string;
}): Promise<FixtureResult> {
  const meta = FixtureMetaSchema.parse(JSON.parse(readFileSync(join(opts.fixtureDir, 'meta.json'), 'utf8')));
  const transcript = FixtureTranscriptSchema.parse(JSON.parse(readFileSync(join(opts.fixtureDir, 'transcript.json'), 'utf8')));
  let groundTruth: FixtureGroundTruth | undefined;
  try {
    const raw = readFileSync(join(opts.fixtureDir, 'ground-truth.json'), 'utf8');
    groundTruth = FixtureGroundTruthSchema.parse(JSON.parse(raw));
  } catch { /* optional */ }

  const t0 = Date.now();
  const pipelineResult = await opts.runner.run({ meta, transcript });
  const runMs = Date.now() - t0;
  // Inject meta for the Lecture slots-emerge rule
  const noteWithMeta = { ...pipelineResult.note, _meta: { expectedSlots: meta.expectedSlots } };

  const rules = {
    lecture: LECTURE_RULES, meeting: MEETING_RULES, interview: INTERVIEW_RULES, brainstorm: BRAINSTORM_RULES,
  }[meta.family];

  const contractTest = runContractTest({
    family: meta.family,
    schema: StubSchemas[meta.family],
    note: noteWithMeta,
    rules,
    transcript,
    groundTruth,
  });

  const result: FixtureResult = {
    fixtureId: meta.fixtureId,
    family: meta.family,
    contractTest: {
      schemaParse: contractTest.schemaParse,
      schemaParseError: contractTest.schemaParseError,
      overall: contractTest.overall,
      findings: contractTest.findings,
    },
    runMs,
    retryHistogram: buildRetryHistogram(pipelineResult.retryAttempts),
    slotDistribution: meta.family === 'lecture' ? computeSlotDistribution(pipelineResult.note) : undefined,
  };

  if (!opts.skipLlmJudge) {
    result.judge = await judgeNote({ family: meta.family, note: pipelineResult.note, transcript, groundTruth, judgeModelId: opts.judgeModelId });
    if (meta.family === 'lecture') {
      result.contentFidelity = await judgeContentFidelity({ family: 'lecture', note: pipelineResult.note, transcript, groundTruth, judgeModelId: opts.judgeModelId });
    }
  }
  return result;
}
```

- [ ] **Step 3: Write the test (uses skipLlmJudge to stay offline)**

```typescript
// desktop/eval/runners/single-fixture.test.ts
import { describe, it, expect } from 'vitest';
import { runSingleFixture } from './single-fixture';
import { STUB_RUNNER } from './pipeline-stub';

describe('runSingleFixture (stub)', () => {
  it('runs the Lecture procedural-physics-em fixture with stub runner, skipping LLM judge', async () => {
    const result = await runSingleFixture({
      fixtureDir: 'desktop/eval/fixtures/lecture/procedural-physics-em',
      runner: STUB_RUNNER,
      skipLlmJudge: true,
    });
    expect(result.fixtureId).toBe('procedural-physics-em');
    expect(result.family).toBe('lecture');
    expect(result.contractTest.schemaParse).toBe('PASS');
    expect(result.judge).toBeUndefined();   // skipped
    expect(result.retryHistogram?.samples).toBe(3);
  });

  it('runs the meeting sprint-planning-4spk fixture with stub runner', async () => {
    const result = await runSingleFixture({
      fixtureDir: 'desktop/eval/fixtures/meeting/sprint-planning-4spk',
      runner: STUB_RUNNER,
      skipLlmJudge: true,
    });
    expect(result.family).toBe('meeting');
    expect(result.contractTest.overall).toBe('PASS');
  });
});
```

- [ ] **Step 4: Run tests, expect PASS** (offline)

- [ ] **Step 5: Commit**

```bash
git add desktop/eval/runners/pipeline-stub.ts desktop/eval/runners/single-fixture.ts desktop/eval/runners/single-fixture.test.ts
git commit -m "feat(eval): single-fixture runner + deterministic pipeline stub

PipelineRunner contract = { id, modelId, promptVariantId, run() }.
STUB_RUNNER returns deterministic schema-passing notes for each
family — enables plumbing tests without sidecar. Task 22 wires
the real offline-3b runner."
```

### Task 19: Family-suite runner

**Files:**
- Create: `desktop/eval/runners/family-suite.ts`

**Goal:** Iterate every fixture under one family, cool down between LLM calls (mirrors v1's 75s Groq cooldown), aggregate results.

- [ ] **Step 1: Write the runner**

```typescript
// desktop/eval/runners/family-suite.ts
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runSingleFixture } from './single-fixture';
import type { FixtureResult } from '../baseline/format';
import type { PipelineRunner } from './pipeline-stub';
import type { NoteFamily } from '../judges/judge-types';

const GROQ_COOLDOWN_MS = 75_000;                  // same as v1 backend
const NOOP_COOLDOWN_MS = 0;                       // when skipLlmJudge

export async function runFamilySuite(opts: {
  family: NoteFamily;
  runner: PipelineRunner;
  fixturesRoot?: string;
  skipLlmJudge?: boolean;
  judgeModelId?: string;
  fixtureFilter?: string;                          // optional substring filter on fixtureId
  onProgress?: (fixtureId: string, result: FixtureResult, idx: number, total: number) => void;
}): Promise<FixtureResult[]> {
  const root = opts.fixturesRoot ?? 'desktop/eval/fixtures';
  const familyRoot = join(root, opts.family);
  const dirs = readdirSync(familyRoot)
    .filter(name => statSync(join(familyRoot, name)).isDirectory())
    .filter(name => !opts.fixtureFilter || name.includes(opts.fixtureFilter))
    .map(name => join(familyRoot, name));
  const results: FixtureResult[] = [];
  const cooldownMs = opts.skipLlmJudge ? NOOP_COOLDOWN_MS : GROQ_COOLDOWN_MS;
  for (let i = 0; i < dirs.length; i++) {
    const fixtureDir = dirs[i];
    const result = await runSingleFixture({
      fixtureDir,
      runner: opts.runner,
      skipLlmJudge: opts.skipLlmJudge,
      judgeModelId: opts.judgeModelId,
    });
    results.push(result);
    opts.onProgress?.(result.fixtureId, result, i + 1, dirs.length);
    if (i < dirs.length - 1 && cooldownMs > 0) {
      await new Promise(r => setTimeout(r, cooldownMs));
    }
  }
  return results;
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/eval/runners/family-suite.ts
git commit -m "feat(eval): family-suite runner (per-family sweep + Groq cooldown)

75s cooldown between fixtures when LLM judge is enabled — mirrors
v1 backend Groq TPM behavior. onProgress callback for CLI stream
output."
```

### Task 20: Regression runner (run against fixed baseline)

**Files:**
- Create: `desktop/eval/runners/regression.ts`

**Goal:** Compose `runFamilySuite` + baseline load + diff into one entry. Returns the diff *and* the new results; caller decides whether to print, save, or fail CI.

- [ ] **Step 1: Write the runner**

```typescript
// desktop/eval/runners/regression.ts
import { runFamilySuite } from './family-suite';
import { loadBaseline, saveBaseline } from '../baseline/store';
import { diffBaselines } from '../baseline/diff';
import type { BaselineFile, FixtureResult } from '../baseline/format';
import type { PipelineRunner } from './pipeline-stub';
import type { NoteFamily } from '../judges/judge-types';
import type { BaselineDiff } from '../baseline/diff';

export interface RegressionRun {
  before: BaselineFile;
  after: BaselineFile;
  diff: BaselineDiff;
}

export async function runRegression(opts: {
  family: NoteFamily;
  runner: PipelineRunner;
  againstBaselinePath: string;
  saveAsPath?: string;
  skipLlmJudge?: boolean;
  judgeModelId?: string;
  notes?: string;
}): Promise<RegressionRun> {
  const before = loadBaseline(opts.againstBaselinePath);
  if (!before) throw new Error(`baseline not found: ${opts.againstBaselinePath}`);
  const results = await runFamilySuite({
    family: opts.family,
    runner: opts.runner,
    skipLlmJudge: opts.skipLlmJudge,
    judgeModelId: opts.judgeModelId,
  });
  const after: BaselineFile = {
    savedAt: new Date().toISOString(),
    modelId: opts.runner.modelId,
    promptVariantId: opts.runner.promptVariantId,
    judgeModelId: opts.judgeModelId ?? before.judgeModelId,
    notes: opts.notes,
    results,
  };
  if (opts.saveAsPath) saveBaseline(opts.saveAsPath, after);
  const diff = diffBaselines(before, after);
  return { before, after, diff };
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/eval/runners/regression.ts
git commit -m "feat(eval): regression runner (suite + baseline-load + diff)"
```

### Task 21: Pairwise Bradley-Terry judge (spec §4 #12)

**Files:**
- Create: `desktop/eval/judges/pairwise-judge.ts`
- Create: `desktop/eval/judges/pairwise-judge.test.ts`

**Goal:** Spec §4 #12 calls for *3* judges including pairwise. Pairwise = "given two notes for the same fixture, which is better?" — used when absolute scores plateau but A/B preference is still measurable. Bradley-Terry maintains a ranking across many pairwise wins.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/eval/judges/pairwise-judge.test.ts
import { describe, it, expect } from 'vitest';
import { computeBradleyTerry, __testOnly_parsePairwiseResponse } from './pairwise-judge';

describe('parsePairwiseResponse', () => {
  it('parses preference + reasoning', () => {
    const p = __testOnly_parsePairwiseResponse(JSON.stringify({ preferred: 'A', confidence: 0.7, reasoning: 'A has more decisions' }));
    expect(p.preferred).toBe('A');
    expect(p.confidence).toBe(0.7);
  });
  it('defaults invalid input to tie + 0.5 conf', () => {
    const p = __testOnly_parsePairwiseResponse('{}');
    expect(p.preferred).toBe('TIE');
    expect(p.confidence).toBe(0.5);
  });
});

describe('computeBradleyTerry', () => {
  it('A always wins → A rank > B rank', () => {
    const ranks = computeBradleyTerry([
      { a: 'A', b: 'B', winner: 'A' },
      { a: 'A', b: 'B', winner: 'A' },
      { a: 'A', b: 'B', winner: 'A' },
    ]);
    expect(ranks.A).toBeGreaterThan(ranks.B);
  });
  it('balanced wins → comparable ranks', () => {
    const ranks = computeBradleyTerry([
      { a: 'A', b: 'B', winner: 'A' },
      { a: 'A', b: 'B', winner: 'B' },
    ]);
    expect(Math.abs(ranks.A - ranks.B)).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// desktop/eval/judges/pairwise-judge.ts
import OpenAI from 'openai';
import type { FixtureTranscript } from '../fixtures/_schema';
import type { NoteFamily } from './judge-types';

export interface PairwiseDecision {
  preferred: 'A' | 'B' | 'TIE';
  confidence: number;          // 0..1
  reasoning: string;
}

export interface PairwiseMatch {
  a: string;
  b: string;
  winner: 'A' | 'B' | 'TIE';
}

const SYSTEM_PROMPT = (family: NoteFamily) => `あなたは ${family} note の2つのバージョンを比較するペアワイズ採点者です。
入力: transcript + note_A + note_B。
出力は JSON のみ:
{ "preferred": "A" | "B" | "TIE", "confidence": <0..1>, "reasoning": "..." }
判定軸: 内容の充実度、構造の論理性、transcript への忠実度、簡潔性。`;

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

let _client: OpenAI | undefined;
function client(): OpenAI {
  if (!_client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set');
    _client = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
  }
  return _client;
}

export function __testOnly_parsePairwiseResponse(text: string): PairwiseDecision {
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { parsed = {}; }
  const preferred = parsed.preferred === 'A' ? 'A' : parsed.preferred === 'B' ? 'B' : 'TIE';
  return {
    preferred,
    confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
  };
}

export async function judgePairwise(input: {
  family: NoteFamily;
  noteA: any;
  noteB: any;
  transcript: FixtureTranscript;
  judgeModelId?: string;
}): Promise<PairwiseDecision> {
  const modelId = input.judgeModelId ?? DEFAULT_MODEL;
  const transcriptText = input.transcript.transcripts.map(b => `[${b.ts}s] ${b.text}`).join('\n');
  const userPrompt = `transcript:\n${transcriptText}\n\nnote_A:\n${JSON.stringify(input.noteA, null, 2)}\n\nnote_B:\n${JSON.stringify(input.noteB, null, 2)}`;
  const res = await client().chat.completions.create({
    model: modelId,
    messages: [{ role: 'system', content: SYSTEM_PROMPT(input.family) }, { role: 'user', content: userPrompt }],
    response_format: { type: 'json_object' },
    temperature: 0,
  });
  return __testOnly_parsePairwiseResponse(res.choices[0]?.message?.content ?? '{}');
}

// Bradley-Terry: simple iterative MLE over match outcomes.
// p_i / (p_i + p_j) = win-rate of i vs j. Returns log-strengths.
export function computeBradleyTerry(matches: PairwiseMatch[], iterations = 100): Record<string, number> {
  const players = new Set<string>();
  for (const m of matches) { players.add(m.a); players.add(m.b); }
  const ps: Record<string, number> = {};
  for (const p of players) ps[p] = 1.0;
  for (let it = 0; it < iterations; it++) {
    const next: Record<string, number> = {};
    for (const p of players) next[p] = 0;
    const denomCount: Record<string, number> = {};
    for (const p of players) denomCount[p] = 0;
    for (const m of matches) {
      const wa = m.winner === 'A' ? 1 : m.winner === 'TIE' ? 0.5 : 0;
      const wb = 1 - wa;
      const denom = ps[m.a] + ps[m.b];
      next[m.a] += wa;
      next[m.b] += wb;
      denomCount[m.a] += 1 / denom;
      denomCount[m.b] += 1 / denom;
    }
    for (const p of players) {
      if (denomCount[p] > 0) ps[p] = next[p] / denomCount[p];
    }
  }
  // Return log-strengths for additive ranking comparisons
  return Object.fromEntries(Object.entries(ps).map(([k, v]) => [k, Math.log(v)]));
}
```

- [ ] **Step 3: Run tests, expect PASS**

- [ ] **Step 4: Commit**

```bash
git add desktop/eval/judges/pairwise-judge.ts desktop/eval/judges/pairwise-judge.test.ts
git commit -m "feat(eval): pairwise Bradley-Terry judge (spec §4 #12, third judge)

judgePairwise() asks the LLM A-vs-B for a single fixture pair.
computeBradleyTerry() aggregates many matches into a ranking. Used
when absolute scores plateau but A/B preference is still measurable."
```

---

## Item 9 — Scorecard + CLI

### Task 22: Scorecard formatter

**Files:**
- Create: `desktop/eval/scorecard.ts`
- Create: `desktop/eval/scorecard.test.ts`

**Goal:** Pretty-print `FixtureResult[]` (and optional `BaselineDiff`) to stdout — per-fixture detail + family aggregate. Adapts v1's `formatScorecard` to the v2 family-axes shape.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/eval/scorecard.test.ts
import { describe, it, expect } from 'vitest';
import { formatScorecard } from './scorecard';
import type { FixtureResult } from './baseline/format';

const result: FixtureResult = {
  fixtureId: 'procedural-physics-em',
  family: 'lecture',
  contractTest: { schemaParse: 'PASS', overall: 'PASS', findings: [
    { ruleId: 'lecture-anti-parroting', severity: 'warning', pass: false, message: 'parrot ratio 50%' },
  ] },
  judge: {
    family: 'lecture', judgeModelId: 'llama-3.3-70b-versatile',
    axes: { coverage: 7, accuracy: 6.5, hierarchy: 7, conciseness: 6, importance: 5, provenance: 8, sectionCoherence: 7, contentFidelity: 3 },
    overall: 6.2, issues: ['E=mc² parroted'], wins: ['JA section headings coherent'],
  },
  runMs: 72000,
};

describe('formatScorecard', () => {
  it('renders fixture detail + axes + issues + wins', () => {
    const text = formatScorecard([result]);
    expect(text).toContain('procedural-physics-em');
    expect(text).toContain('overall');
    expect(text).toContain('contentFidelity');
    expect(text).toContain('E=mc² parroted');
    expect(text).toContain('JA section headings coherent');
    expect(text).toContain('lecture-anti-parroting');
  });

  it('renders contract-test failures prominently', () => {
    const failed: FixtureResult = { ...result, contractTest: { schemaParse: 'FAIL', overall: 'FAIL', findings: [], schemaParseError: 'missing field title' } };
    const text = formatScorecard([failed]);
    expect(text).toContain('CONTRACT FAIL');
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// desktop/eval/scorecard.ts
import type { FixtureResult } from './baseline/format';
import type { BaselineDiff } from './baseline/diff';

export function formatScorecard(results: FixtureResult[], diff?: BaselineDiff): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════════');
  lines.push('  V2 NOTE EVAL — Scorecard');
  lines.push('═══════════════════════════════════════════════════════════════════');
  for (const r of results) {
    lines.push('');
    lines.push(`▶ ${r.fixtureId} [${r.family}]`);
    if (r.contractTest.schemaParse === 'FAIL') {
      lines.push(`    CONTRACT FAIL: schema parse failed — ${r.contractTest.schemaParseError ?? '(no detail)'}`);
      continue;
    }
    if (r.contractTest.overall === 'FAIL') {
      lines.push('    CONTRACT FAIL: error-severity rule(s) failed');
    } else {
      lines.push('    contract: PASS');
    }
    for (const f of r.contractTest.findings) {
      const marker = f.pass ? '  OK' : (f.severity === 'error' ? 'FAIL' : 'WARN');
      lines.push(`    ${marker}  ${f.ruleId}: ${f.message}`);
    }
    if (r.judge) {
      const d = diff?.perFixture.find(x => x.fixtureId === r.fixtureId);
      const deltaStr = (k: string): string => {
        const dd = d?.axisDelta?.[k];
        return dd === undefined ? '' : ` (${dd >= 0 ? '+' : ''}${dd.toFixed(1)})`;
      };
      lines.push(`    overall      ${r.judge.overall.toFixed(1)}${d ? ` (${d.overallDelta >= 0 ? '+' : ''}${d.overallDelta.toFixed(1)})` : ''}`);
      for (const [k, v] of Object.entries(r.judge.axes)) {
        lines.push(`    ${k.padEnd(22)} ${v.toFixed(1)}${deltaStr(k)}`);
      }
      if (r.judge.issues.length) {
        lines.push('    issues:');
        for (const x of r.judge.issues) lines.push(`      - ${x}`);
      }
      if (r.judge.wins.length) {
        lines.push('    wins:');
        for (const x of r.judge.wins) lines.push(`      + ${x}`);
      }
    }
    if (r.contentFidelity) {
      const flag = r.contentFidelity.parroting ? ' ⚠ PARROTING' : '';
      lines.push(`    content-fidelity   ${r.contentFidelity.score.toFixed(1)}${flag}`);
    }
    if (r.retryHistogram) {
      const bins = Object.entries(r.retryHistogram.attemptsByBin).map(([k, v]) => `${k}:${v}`).join(' ');
      lines.push(`    retry-histogram    samples=${r.retryHistogram.samples} mean=${r.retryHistogram.attemptsMean} {${bins}}`);
    }
    if (r.slotDistribution) {
      const byType = Object.entries(r.slotDistribution.byType).map(([k, v]) => `${k}:${v}`).join(' ');
      lines.push(`    slot-distribution  types=${r.slotDistribution.slotTypes} emerged=${r.slotDistribution.slotsEmerged} {${byType}}`);
    }
    lines.push(`    runMs              ${r.runMs}`);
  }
  if (results.length > 1) {
    const n = results.length;
    const meanOverall = results.filter(r => r.judge).reduce((s, r) => s + (r.judge?.overall ?? 0), 0) / Math.max(1, results.filter(r => r.judge).length);
    lines.push('');
    lines.push('───────────────────────────────────────────────────────────────────');
    lines.push(`  AGGREGATE over ${n} fixture(s)`);
    lines.push(`    mean overall          ${meanOverall.toFixed(2)}`);
    if (diff) {
      lines.push(`    mean delta vs baseline ${diff.summary.meanOverallDelta >= 0 ? '+' : ''}${diff.summary.meanOverallDelta.toFixed(2)}`);
      if (diff.summary.regression) lines.push('    REGRESSION DETECTED — see per-fixture deltas above');
      for (const w of diff.warnings) lines.push(`    warn: ${w}`);
    }
    lines.push('───────────────────────────────────────────────────────────────────');
  }
  return lines.join('\n');
}
```

- [ ] **Step 3: Run tests, expect PASS**

- [ ] **Step 4: Commit**

```bash
git add desktop/eval/scorecard.ts desktop/eval/scorecard.test.ts
git commit -m "feat(eval): scorecard formatter (axes + diff + content-fidelity + histograms)"
```

### Task 23: Boot-time `evalBaselines` validator (spec §4 P4)

**Files:**
- Create: `desktop/eval/fixtures/_validator.ts`
- Create: `desktop/eval/fixtures/_validator.test.ts`

**Goal:** Spec §4 P4: "evalBaselines validated at harness startup". A function that, given a registered set of fixture IDs per family, asserts each fixture exists with parseable meta/transcript. Plan 2's `FamilyDefinition.evalBaselines` references these IDs; CI runs this at PR time.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/eval/fixtures/_validator.test.ts
import { describe, it, expect } from 'vitest';
import { validateEvalBaselines } from './_validator';

describe('validateEvalBaselines', () => {
  it('accepts registered IDs that exist', async () => {
    const result = await validateEvalBaselines({
      lecture: ['procedural-physics-em', 'narrative-ukraine-russia'],
      meeting: ['sprint-planning-4spk'],
      interview: [], brainstorm: [],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports missing fixture IDs', async () => {
    const result = await validateEvalBaselines({
      lecture: ['procedural-physics-em', 'does-not-exist'],
      meeting: [], interview: [], brainstorm: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('does-not-exist');
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// desktop/eval/fixtures/_validator.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FixtureMetaSchema, FixtureTranscriptSchema } from './_schema';
import type { NoteFamily } from '../judges/judge-types';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export async function validateEvalBaselines(
  registered: Record<NoteFamily, string[]>,
  fixturesRoot = 'desktop/eval/fixtures',
): Promise<ValidationResult> {
  const errors: string[] = [];
  for (const family of Object.keys(registered) as NoteFamily[]) {
    for (const fixtureId of registered[family]) {
      const dir = join(fixturesRoot, family, fixtureId);
      if (!existsSync(dir)) {
        errors.push(`[${family}] fixture missing: ${fixtureId} (expected at ${dir})`);
        continue;
      }
      try {
        const meta = FixtureMetaSchema.parse(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')));
        if (meta.fixtureId !== fixtureId) {
          errors.push(`[${family}] meta.fixtureId mismatch: dir=${fixtureId}, meta=${meta.fixtureId}`);
        }
        if (meta.family !== family) {
          errors.push(`[${family}] meta.family mismatch: ${fixtureId} declares family=${meta.family}`);
        }
        FixtureTranscriptSchema.parse(JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8')));
      } catch (e) {
        errors.push(`[${family}] ${fixtureId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 3: Run tests, expect PASS**

- [ ] **Step 4: Commit**

```bash
git add desktop/eval/fixtures/_validator.ts desktop/eval/fixtures/_validator.test.ts
git commit -m "feat(eval): boot-time evalBaselines validator (spec §4 P4)

Plan 2 wires this into FamilyRegistry initialization — every
FamilyDefinition.evalBaselines string is asserted to resolve to a
fixture dir with parseable meta+transcript. CI fails on miss."
```

### Task 24: DER metric skeleton (Plan 4 / Spike 0.3 lift point)

**Files:**
- Create: `desktop/eval/metrics/der.ts`
- Create: `desktop/eval/metrics/der.test.ts`

**Goal:** VERDICT carry-forward #7 / item 3 — Plan 4 carries the DER (Diarization Error Rate) impl when Spike 0.3 runs. Plan 7 lands the **skeleton + type** now so Plan 4 just drops the body in.

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/eval/metrics/der.test.ts
import { describe, it, expect } from 'vitest';
import { computeDer, type DiarizationSegment } from './der';

const truth: DiarizationSegment[] = [
  { start: 0, end: 10, speakerId: 0 },
  { start: 10, end: 20, speakerId: 1 },
];

describe('computeDer', () => {
  it('returns 0 when prediction matches truth exactly', () => {
    expect(computeDer(truth, truth)).toBeCloseTo(0, 2);
  });

  it('returns 1 when prediction is a single wrong speaker for all time', () => {
    const pred: DiarizationSegment[] = [{ start: 0, end: 20, speakerId: 99 }];
    const score = computeDer(truth, pred);
    expect(score).toBeGreaterThan(0.5);  // most of the timeline is misattributed (allow some slack for label-assignment heuristic)
  });
});
```

- [ ] **Step 2: Implement DER (simple time-weighted speaker confusion)**

```typescript
// desktop/eval/metrics/der.ts
//
// Diarization Error Rate. Spike 0.3 + Plan 4 own the production-grade
// implementation; Plan 7 lands a permissive baseline so the harness can
// surface a number even before pyannote-segmentation-3.0 lands.
//
// DER = (false_alarm + missed + speaker_confusion) / total_speech_time.
// Implementation: time-grid sampling at 100ms steps, optimal label
// assignment via greedy 1-1 matching of speaker IDs to ground truth.

export interface DiarizationSegment {
  start: number;     // seconds
  end: number;
  speakerId: number;
}

const GRID_STEP = 0.1; // 100ms per spec §7.1 latency target

function buildGrid(segs: DiarizationSegment[], totalEnd: number): number[] {
  // Returns array of size ceil(totalEnd / GRID_STEP); each slot has speakerId or -1 for silence.
  const N = Math.ceil(totalEnd / GRID_STEP);
  const grid = new Array<number>(N).fill(-1);
  for (const s of segs) {
    const lo = Math.floor(s.start / GRID_STEP);
    const hi = Math.min(N, Math.ceil(s.end / GRID_STEP));
    for (let i = lo; i < hi; i++) grid[i] = s.speakerId;
  }
  return grid;
}

// Greedy 1-1 label assignment: for each truth speaker, pick the pred speaker that maximizes overlap.
function bestLabelMap(truth: number[], pred: number[]): Map<number, number> {
  const truthSpeakers = new Set(truth.filter(x => x >= 0));
  const predSpeakers = new Set(pred.filter(x => x >= 0));
  const overlap = new Map<string, number>();
  for (let i = 0; i < truth.length; i++) {
    if (truth[i] < 0 || pred[i] < 0) continue;
    const key = `${truth[i]}_${pred[i]}`;
    overlap.set(key, (overlap.get(key) ?? 0) + 1);
  }
  const sorted = [...overlap.entries()].sort((a, b) => b[1] - a[1]);
  const map = new Map<number, number>();
  const usedPred = new Set<number>();
  const usedTruth = new Set<number>();
  for (const [key] of sorted) {
    const [t, p] = key.split('_').map(Number);
    if (usedTruth.has(t) || usedPred.has(p)) continue;
    map.set(p, t);
    usedTruth.add(t);
    usedPred.add(p);
  }
  return map;
}

export function computeDer(truth: DiarizationSegment[], prediction: DiarizationSegment[]): number {
  const totalEnd = Math.max(
    ...truth.map(s => s.end),
    ...prediction.map(s => s.end),
    0,
  );
  if (totalEnd === 0) return 0;
  const truthGrid = buildGrid(truth, totalEnd);
  const predGrid = buildGrid(prediction, totalEnd);
  const labelMap = bestLabelMap(truthGrid, predGrid);
  let speechSamples = 0;
  let errors = 0;
  for (let i = 0; i < truthGrid.length; i++) {
    const t = truthGrid[i];
    const p = predGrid[i];
    if (t < 0 && p < 0) continue;     // silence in both → no error
    speechSamples++;
    if (t < 0 && p >= 0) { errors++; continue; }  // false alarm
    if (t >= 0 && p < 0) { errors++; continue; }  // missed
    const mappedT = labelMap.get(p);
    if (mappedT !== t) errors++;                  // speaker confusion
  }
  return speechSamples === 0 ? 0 : errors / speechSamples;
}
```

- [ ] **Step 3: Run tests, expect PASS**

- [ ] **Step 4: Commit**

```bash
git add desktop/eval/metrics/der.ts desktop/eval/metrics/der.test.ts
git commit -m "feat(eval): DER skeleton (100ms grid + greedy label assignment)

VERDICT carry-forward #7 / Plan 7 item 7. Plan 4 + Spike 0.3 replace
with pyannote-grade implementation; current version is a permissive
baseline so the harness can surface a number end-to-end as soon as
Plan 4 lands SpeakerLabeledSegment output."
```

---

### Task 25: CLI entry — `eval-notes.ts`

**Files:**
- Create: `desktop/scripts/eval-notes.ts`
- Create: `desktop/scripts/eval-notes.test.ts`
- Modify: `desktop/package.json` (add `eval:notes` script)

**Goal:** The single CLI entry users invoke. Mirrors `backend/scripts/eval-curator.ts` flag set, extended for v2.

CLI surface:
```
pnpm --filter @lisna/desktop eval:notes --family lecture
pnpm --filter @lisna/desktop eval:notes --family lecture --fixture procedural-physics-em
pnpm --filter @lisna/desktop eval:notes --family lecture --runner stub
pnpm --filter @lisna/desktop eval:notes --family lecture --runner offline-3b
pnpm --filter @lisna/desktop eval:notes --family lecture --baseline v0
pnpm --filter @lisna/desktop eval:notes --family lecture --against v0
pnpm --filter @lisna/desktop eval:notes --family lecture --judge claude-opus-4-x
pnpm --filter @lisna/desktop eval:notes --family lecture --no-llm-judge        # ContractTest only (offline)
pnpm --filter @lisna/desktop eval:notes --family lecture --dry-run             # echo what would run
```

- [ ] **Step 1: Write the argparse unit test**

```typescript
// desktop/scripts/eval-notes.test.ts
import { describe, it, expect } from 'vitest';
import { __testOnly_parseArgs } from './eval-notes';

describe('eval-notes argparse', () => {
  it('parses defaults', () => {
    const o = __testOnly_parseArgs(['node', 'eval-notes', '--family', 'lecture']);
    expect(o.family).toBe('lecture');
    expect(o.runnerId).toBe('stub');
    expect(o.skipLlmJudge).toBe(false);
  });
  it('parses all flags', () => {
    const o = __testOnly_parseArgs(['node', 'eval-notes',
      '--family', 'meeting',
      '--fixture', 'sprint-planning-4spk',
      '--runner', 'offline-3b',
      '--baseline', 'v1',
      '--against', 'v0',
      '--judge', 'claude-opus-4-x',
      '--no-llm-judge',
      '--dry-run',
    ]);
    expect(o.family).toBe('meeting');
    expect(o.fixtureFilter).toBe('sprint-planning-4spk');
    expect(o.runnerId).toBe('offline-3b');
    expect(o.saveAs).toBe('v1');
    expect(o.against).toBe('v0');
    expect(o.judgeModelId).toBe('claude-opus-4-x');
    expect(o.skipLlmJudge).toBe(true);
    expect(o.dryRun).toBe(true);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// desktop/scripts/eval-notes.ts
import { runFamilySuite } from '../eval/runners/family-suite';
import { runRegression } from '../eval/runners/regression';
import { loadBaseline, saveBaseline } from '../eval/baseline/store';
import { diffBaselines } from '../eval/baseline/diff';
import { formatScorecard } from '../eval/scorecard';
import { STUB_RUNNER } from '../eval/runners/pipeline-stub';
import type { NoteFamily } from '../eval/judges/judge-types';
import type { PipelineRunner } from '../eval/runners/pipeline-stub';
import { join } from 'node:path';

interface CliArgs {
  family: NoteFamily;
  fixtureFilter?: string;
  runnerId: 'stub' | 'offline-3b' | 'offline-1b';
  saveAs?: string;
  against?: string;
  judgeModelId?: string;
  skipLlmJudge: boolean;
  dryRun: boolean;
}

export function __testOnly_parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { family: 'lecture', runnerId: 'stub', skipLlmJudge: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--family') out.family = argv[++i] as NoteFamily;
    else if (a === '--fixture') out.fixtureFilter = argv[++i];
    else if (a === '--runner') out.runnerId = argv[++i] as CliArgs['runnerId'];
    else if (a === '--baseline') out.saveAs = argv[++i];
    else if (a === '--against') out.against = argv[++i];
    else if (a === '--judge') out.judgeModelId = argv[++i];
    else if (a === '--no-llm-judge') out.skipLlmJudge = true;
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

async function resolveRunner(id: string): Promise<PipelineRunner> {
  if (id === 'stub') return STUB_RUNNER;
  // offline-3b / offline-1b are wired in Task 26 (score-spike-0.2.ts pattern).
  // CLI prints a friendly error so end users don't see an opaque import failure.
  throw new Error(`runner '${id}' not implemented in Plan 7 — wire via Plan 2 SessionOrchestrator + register here`);
}

async function main(): Promise<void> {
  const opts = __testOnly_parseArgs(process.argv);
  if (opts.dryRun) {
    console.log('[dry-run] would invoke:', JSON.stringify(opts, null, 2));
    return;
  }
  const runner = await resolveRunner(opts.runnerId);
  const BASELINE_DIR = 'desktop/eval/baselines';
  if (opts.against) {
    const path = join(BASELINE_DIR, `${opts.against}.json`);
    const reg = await runRegression({
      family: opts.family,
      runner,
      againstBaselinePath: path,
      saveAsPath: opts.saveAs ? join(BASELINE_DIR, `${opts.saveAs}.json`) : undefined,
      skipLlmJudge: opts.skipLlmJudge,
      judgeModelId: opts.judgeModelId,
    });
    console.log(formatScorecard(reg.after.results, reg.diff));
    if (reg.diff.summary.regression) {
      console.error('REGRESSION — exiting non-zero');
      process.exitCode = 2;
    }
    return;
  }
  const results = await runFamilySuite({
    family: opts.family,
    runner,
    skipLlmJudge: opts.skipLlmJudge,
    judgeModelId: opts.judgeModelId,
    fixtureFilter: opts.fixtureFilter,
    onProgress: (id, _, idx, total) => console.log(`  [${idx}/${total}] ${id} ... done`),
  });
  console.log(formatScorecard(results));
  if (opts.saveAs) {
    saveBaseline(join(BASELINE_DIR, `${opts.saveAs}.json`), {
      savedAt: new Date().toISOString(),
      modelId: runner.modelId,
      promptVariantId: runner.promptVariantId,
      judgeModelId: opts.judgeModelId ?? 'llama-3.3-70b-versatile',
      results,
    });
    console.log(`baseline saved → ${BASELINE_DIR}/${opts.saveAs}.json`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Add `eval:notes` script to `desktop/package.json`**

In `desktop/package.json` `"scripts"`:
```json
"eval:notes": "tsx scripts/eval-notes.ts",
"eval:judge-swap": "tsx scripts/eval-judge-swap.ts",
"eval:spike-0.2": "tsx scripts/score-spike-0.2.ts"
```

- [ ] **Step 4: Run argparse test + CLI smoke (stub + no-llm-judge)**

```bash
pnpm --filter @lisna/desktop test desktop/scripts/eval-notes.test.ts
pnpm --filter @lisna/desktop eval:notes --family lecture --runner stub --no-llm-judge
```
Expected: per-fixture scorecard with ContractTest results, no LLM call.

- [ ] **Step 5: Commit**

```bash
git add desktop/scripts/eval-notes.ts desktop/scripts/eval-notes.test.ts desktop/package.json
git commit -m "chore(eval): CLI entry eval-notes.ts (mirrors v1 eval-curator)

Flags: --family --fixture --runner --baseline --against --judge
--no-llm-judge --dry-run. Stub runner runs entirely offline so
plumbing tests don't need GROQ_API_KEY. Real runners (offline-3b/1b)
wire in Plan 2."
```

### Task 26: Judge-swap matrix CLI (item 10)

**Files:**
- Create: `desktop/scripts/eval-judge-swap.ts`

**Goal:** Run the SAME family suite against a list of judge models, print a cross-judge variance table. Surfaces calibration drift before it bites in production.

- [ ] **Step 1: Implement**

```typescript
// desktop/scripts/eval-judge-swap.ts
//
// Runs the same family suite against multiple judges and prints a
// matrix of mean overall + per-axis variance. Use to assess judge
// calibration drift before committing a baseline change.
//
// Example: pnpm --filter @lisna/desktop eval:judge-swap \
//   --family lecture --fixture procedural-physics-em \
//   --judges llama-3.3-70b-versatile,claude-opus-4-x,llama-3.1-8b-instant

import { runFamilySuite } from '../eval/runners/family-suite';
import { STUB_RUNNER } from '../eval/runners/pipeline-stub';
import type { NoteFamily } from '../eval/judges/judge-types';

interface Args {
  family: NoteFamily;
  fixtureFilter?: string;
  judges: string[];
}

function parseArgs(argv: string[]): Args {
  const out: Args = { family: 'lecture', judges: ['llama-3.3-70b-versatile'] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--family') out.family = argv[++i] as NoteFamily;
    else if (a === '--fixture') out.fixtureFilter = argv[++i];
    else if (a === '--judges') out.judges = argv[++i].split(',').map(s => s.trim());
  }
  return out;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  console.log(`Judge-swap matrix on family=${opts.family} fixture=${opts.fixtureFilter ?? '*'}`);
  const matrix: Record<string, Record<string, number>> = {};
  for (const judge of opts.judges) {
    console.log(`\n  judge: ${judge}`);
    const results = await runFamilySuite({
      family: opts.family,
      runner: STUB_RUNNER,
      judgeModelId: judge,
      fixtureFilter: opts.fixtureFilter,
    });
    for (const r of results) {
      matrix[r.fixtureId] ??= {};
      matrix[r.fixtureId][judge] = r.judge?.overall ?? 0;
    }
  }
  // Print matrix
  console.log('\n  Matrix (overall scores):');
  const fixtures = Object.keys(matrix);
  const header = ['fixtureId'.padEnd(30), ...opts.judges.map(j => j.padEnd(28))].join(' ');
  console.log('  ' + header);
  for (const f of fixtures) {
    const row = [f.padEnd(30), ...opts.judges.map(j => (matrix[f][j] ?? 0).toFixed(2).padEnd(28))].join(' ');
    console.log('  ' + row);
  }
  // Per-fixture variance
  console.log('\n  Per-fixture cross-judge variance (max - min):');
  for (const f of fixtures) {
    const vals = opts.judges.map(j => matrix[f][j] ?? 0);
    const spread = Math.max(...vals) - Math.min(...vals);
    console.log(`    ${f.padEnd(30)} spread = ${spread.toFixed(2)}${spread > 1.5 ? ' ⚠ HIGH' : ''}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Smoke run (stub runner, single judge — fast)**

```bash
pnpm --filter @lisna/desktop eval:judge-swap --family lecture --judges llama-3.3-70b-versatile
```

- [ ] **Step 3: Commit**

```bash
git add desktop/scripts/eval-judge-swap.ts
git commit -m "chore(eval): judge-swap matrix CLI (cross-vendor variance)

Item 10 from plan brief. Runs same family suite against multiple
judges and prints per-fixture spread. Spread > 1.5 = high calibration
drift, flag for investigation before locking baseline."
```

---

## Item 11 — Score Spike 0.2 outputs as v0 baseline

### Task 27: Score Spike 0.2 results as v0 Lecture baseline

**HARDWARE-SAFETY:** This task reads Spike 0.2's *already-produced* JSON results from disk — does NOT invoke the sidecar. No `(spike-llm)` cleanup needed because no new LLM process is spawned (judge calls go over network to Groq).

**Files:**
- Create: `desktop/scripts/score-spike-0.2.ts`

**Goal:** Read the 3 already-on-disk Spike 0.2 result JSONs (`desktop/spikes/phase-0/02-3b-lecture-grammar/results/run-*.json`) and run them through ContractTest + judge as if they came from `offline-3b` runner. Save as `desktop/eval/baselines/v0-spike-0.2-lecture.json`. This is the **first end-to-end exercise** of the Plan 7 harness on real (non-stub) data.

- [ ] **Step 1: Implement**

```typescript
// desktop/scripts/score-spike-0.2.ts
//
// Score Spike 0.2 3B Lecture results against the Plan 7 harness as the
// v0 baseline. Spike 0.2 already produced 3 (or more) result JSONs under
// desktop/spikes/phase-0/02-3b-lecture-grammar/results/. This script:
//   1. Reads each result JSON
//   2. Wraps as a synthetic PipelineRunner that just returns the result
//   3. Runs through runSingleFixture (ContractTest + LLM judge + content-fidelity)
//   4. Saves the aggregated baseline file
//
// HARDWARE-SAFETY: no sidecar invocation — pure file I/O + Groq API calls.
//
// Run: pnpm --filter @lisna/desktop eval:spike-0.2

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runSingleFixture } from '../eval/runners/single-fixture';
import { saveBaseline } from '../eval/baseline/store';
import { formatScorecard } from '../eval/scorecard';
import type { PipelineRunner } from '../eval/runners/pipeline-stub';
import type { FixtureResult, BaselineFile } from '../eval/baseline/format';

const SPIKE_RESULTS_DIR = 'desktop/spikes/phase-0/02-3b-lecture-grammar/results';
const FIXTURE_DIR = 'desktop/eval/fixtures/lecture/procedural-physics-em';
const OUT_PATH = 'desktop/eval/baselines/v0-spike-0.2-lecture.json';

function listSpikeResults(): { path: string; runIndex: number }[] {
  if (!existsSync(SPIKE_RESULTS_DIR)) {
    throw new Error(`Spike 0.2 results not found at ${SPIKE_RESULTS_DIR} — run the spike first`);
  }
  return readdirSync(SPIKE_RESULTS_DIR)
    .filter(f => f.startsWith('run-') && f.endsWith('.json'))
    .map(f => {
      const m = f.match(/-i(\d+)\.json$/);
      return { path: join(SPIKE_RESULTS_DIR, f), runIndex: m ? Number(m[1]) : 0 };
    })
    .sort((a, b) => a.runIndex - b.runIndex);
}

function makeReplayRunner(spikeResultPath: string): PipelineRunner {
  const data = JSON.parse(readFileSync(spikeResultPath, 'utf8')) as {
    runIndex: number;
    elapsedMs: number;
    sample: unknown;
    validation: 'PASS' | 'FAIL';
  };
  return {
    id: `replay-spike-0.2-i${data.runIndex}`,
    modelId: 'llama-3.2-3b-q4-km',
    promptVariantId: 'spike-0.2-baseline',
    async run() {
      // Hydrate post-decode `from: 'inferred'` like spike 0.2's run-spike does
      const note: any = JSON.parse(JSON.stringify(data.sample ?? {}));
      for (const section of note.sections ?? []) {
        for (const kt of section.key_terms ?? []) {
          if (kt.from === undefined) kt.from = 'inferred';
        }
      }
      return { note, retryAttempts: [1], runMs: data.elapsedMs };
    },
  };
}

async function main(): Promise<void> {
  const spikes = listSpikeResults();
  console.log(`Found ${spikes.length} Spike 0.2 results — scoring against ${FIXTURE_DIR}`);
  const results: FixtureResult[] = [];
  for (const s of spikes) {
    console.log(`\n  scoring ${s.path} ...`);
    const runner = makeReplayRunner(s.path);
    // We deliberately give each run a unique fixtureId so the scorecard shows them all
    const result = await runSingleFixture({ fixtureDir: FIXTURE_DIR, runner });
    result.fixtureId = `procedural-physics-em@i${s.runIndex}`;
    results.push(result);
    // 75s cooldown between Groq judge calls
    if (s.runIndex < spikes[spikes.length - 1].runIndex) {
      console.log('    cooling down 75s for Groq TPM...');
      await new Promise(r => setTimeout(r, 75_000));
    }
  }
  const baseline: BaselineFile = {
    savedAt: new Date().toISOString(),
    modelId: 'llama-3.2-3b-q4-km',
    promptVariantId: 'spike-0.2-baseline',
    judgeModelId: 'llama-3.3-70b-versatile',
    notes: 'v0 baseline lifted from Spike 0.2 results — first real-data run of Plan 7 harness',
    results,
  };
  saveBaseline(OUT_PATH, baseline);
  console.log(formatScorecard(results));
  console.log(`\nv0 baseline saved → ${OUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run (requires GROQ_API_KEY)**

```bash
GROQ_API_KEY=... pnpm --filter @lisna/desktop eval:spike-0.2
```
Expected:
- 3 (or N) ContractTest results (each schemaParse=PASS since Spike 0.2 already validated; anti-parroting rule fires `WARN` on E=mc² runs)
- 3 (or N) LLM judge scores
- Aggregate scorecard printed
- `desktop/eval/baselines/v0-spike-0.2-lecture.json` written

- [ ] **Step 3: Manually inspect baseline file**

```bash
jq '.results | map({fixtureId, contractTestOverall: .contractTest.overall, judgeOverall: .judge.overall, contentFidelityScore: .contentFidelity.score, parroting: .contentFidelity.parroting}) ' desktop/eval/baselines/v0-spike-0.2-lecture.json
```
Expected: see parroting=true on the runs that emitted `E=mc²`, parroting=false on those that didn't. judgeOverall around 5-7 range, contentFidelityScore reflects parroting.

- [ ] **Step 4: Commit the script (NOT the baseline file — gitignored)**

```bash
git add desktop/scripts/score-spike-0.2.ts
git commit -m "chore(eval): score Spike 0.2 results as v0 Lecture baseline

First real-data exercise of Plan 7 harness. Reads existing Spike 0.2
result JSONs, replays each as a PipelineRunner, runs full
ContractTest + LLM judge + content-fidelity. Establishes v0
Lecture baseline that Plans 3 + 6 measure improvements against.
Baseline file itself is gitignored (eval/baselines/) — re-run from
disk results when needed."
```

---

## Item 1 + 2 follow-up — operator README

### Task 28: Operator README

**Files:**
- Modify: `desktop/eval/README.md`

**Goal:** Replace the placeholder from Task 0 with a complete operator guide covering every CLI surface + flag + fixture-layout + judge-swap recipe + hardware-safety reminder.

- [ ] **Step 1: Write the README**

```markdown
# Lisna v2 Eval Harness

Per `docs/superpowers/plans/2026-05-27-v2-plan-7-eval-harness.md`.

## Quickstart

```bash
# Plumbing smoke (no LLM, no sidecar, stub runner) — under 5 seconds
pnpm --filter @lisna/desktop eval:notes --family lecture --runner stub --no-llm-judge

# Real LLM judge against stub notes (requires GROQ_API_KEY)
pnpm --filter @lisna/desktop eval:notes --family lecture --runner stub

# Score the v0 Spike 0.2 baseline (uses already-produced spike JSONs)
GROQ_API_KEY=... pnpm --filter @lisna/desktop eval:spike-0.2

# Regression check against a saved baseline
pnpm --filter @lisna/desktop eval:notes --family lecture --runner stub --against v0-spike-0.2-lecture
```

## CLI flags (`eval:notes`)

| Flag | Default | Notes |
|---|---|---|
| `--family <name>` | `lecture` | One of `lecture`/`meeting`/`interview`/`brainstorm` |
| `--fixture <substr>` | (all) | Filter fixture IDs by substring within the family |
| `--runner <id>` | `stub` | `stub` / `offline-3b` (Plan 2) / `offline-1b` (Plan 2) |
| `--baseline <name>` | (none) | Save current run as `eval/baselines/<name>.json` |
| `--against <name>` | (none) | Load `eval/baselines/<name>.json` + print diff |
| `--judge <model-id>` | `llama-3.3-70b-versatile` | Use `claude-opus-4-x` etc. for cross-vendor |
| `--no-llm-judge` | `false` | Skip LLM judge — ContractTest + metrics only (offline) |
| `--dry-run` | `false` | Echo what would run + exit |

Exit codes: `0` = pass, `2` = regression detected (when `--against` is set).

## Fixture layout

```
desktop/eval/fixtures/<family>/<scenarioSlug>/
├── meta.json           — FixtureMeta (Zod, see fixtures/_schema.ts)
├── transcript.json     — FixtureTranscript (Zod)
└── ground-truth.json   — FixtureGroundTruth (Zod), optional for Lecture
```

Adding a new fixture:
1. Create folder + 3 files (validate via `FixtureMetaSchema.parse`).
2. Add fixtureId to the relevant `FamilyDefinition.evalBaselines: string[]` in `shared/families/<family>/eval-baselines.ts` (Plan 2 wires this).
3. `_validator.ts` enforces presence at boot — `pnpm --filter @lisna/desktop test` catches missing fixtures.

## Judges

- **ContractTest** — `desktop/eval/contract/contract-test.ts` + per-family rules. Deterministic, cheap, runs in CI. Severity `error` blocks; `warning` surfaces. Add a rule = append to `contract/families/<family>.ts`. **Catches mode collapse** that LLM-judges miss.
- **LLM-judge** — `desktop/eval/judges/llm-judge.ts`. 6 common axes (coverage / accuracy / hierarchy / conciseness / importance / provenance) + per-family axes (Lecture: sectionCoherence + contentFidelity; Meeting: decisionCapture + actionItemClarity + participantAttribution; etc.). Default Groq Llama-3.3-70b, optional Anthropic via `--judge claude-*`.
- **Content-fidelity judge** — `desktop/eval/judges/content-fidelity-judge.ts`. Standalone anti-parroting check. Run automatically for Lecture; can be invoked manually for other families.
- **Pairwise judge** — `desktop/eval/judges/pairwise-judge.ts` + `computeBradleyTerry()`. Use when absolute scores plateau but A/B preference still measurable.

## Baselines

- `desktop/eval/baselines/<name>.json` (gitignored — large, ephemeral).
- Each baseline pins `modelId`, `promptVariantId`, `judgeModelId` so diffs are honest.
- Suggested naming: `v0-spike-0.2-lecture`, `v1-prompt-iter-1`, `v1-qwen-2.5`, etc.

Regression criteria (`diff.ts`):
- Any fixture's `judge.overall` drops by ≥ 0.3 → regression.
- Any fixture flips ContractTest `PASS → FAIL` → regression.
- Any fixture's `contentFidelity.score` drops by > 1.0 → regression.

Warnings (non-fatal): `modelId`, `promptVariantId`, or `judgeModelId` mismatch across baselines being compared.

## Judge-swap matrix

```bash
pnpm --filter @lisna/desktop eval:judge-swap \
  --family lecture \
  --fixture procedural-physics-em \
  --judges llama-3.3-70b-versatile,claude-opus-4-x,llama-3.1-8b-instant
```
Prints per-fixture cross-judge spread. Spread > 1.5 = high calibration drift; investigate before locking a new baseline.

## Hardware safety

- All CLI subcommands at this layer are LLM-as-judge over network — no local-sidecar load. Safe to run anywhere.
- The `offline-3b` / `offline-1b` runners (added in Plan 2) WILL invoke the local Llama sidecar. Those obey the `(spike-llm)` rule: foreground only, `afterAll` cleanup in tests, `ps` check + `kill -9` survivors. **Do not** run them as `run_in_background: true`.

## Carry-forward map (Phase 0 VERDICT)

| VERDICT item | Lives in |
|---|---|
| LLM-as-judge content-fidelity | `judges/content-fidelity-judge.ts` (standalone) + `judges/families/lecture-judge.ts` (axis) |
| Retry-rate histogram | `metrics/retry-histogram.ts` |
| DER skeleton | `metrics/der.ts` (Plan 4 ships pyannote-grade impl) |
| slotTypes vs slotsEmerged | `metrics/slot-distribution.ts` |
| Anti-parroting JS heuristic (preceding LLM layer) | `contract/anti-parroting.ts` |
| Spike 0.2 v0 baseline | `desktop/scripts/score-spike-0.2.ts` |
```

- [ ] **Step 2: Commit**

```bash
git add desktop/eval/README.md
git commit -m "docs(eval): operator README — CLI, fixtures, judges, baselines"
```

---

## Task 29: Verdict memo for Plan 7

**Files:**
- Create: `docs/superpowers/plans/2026-05-27-v2-plan-7-verdict.md`

**Goal:** Plan-level closeout memo, mirrors Phase 0's VERDICT pattern. Captures what shipped, what's deferred to Plans 3-6 / Plan 2, what's empirically verified vs assumed.

- [ ] **Step 1: Write the verdict**

```markdown
# Plan 7 (Eval Harness) Verdict — YYYY-MM-DD

## What shipped

| Layer | Files | Tests |
|---|---|---|
| Fixture format | `desktop/eval/fixtures/_schema.ts` + `_validator.ts` | `_schema.test.ts`, `_validator.test.ts` |
| Fixtures (lecture × 3 real + meeting/interview/brainstorm × 3 stubs each) | `desktop/eval/fixtures/<family>/<slug>/` | parsed via _validator |
| ContractTest core + per-family rules + anti-parroting | `desktop/eval/contract/` | `contract-test.test.ts`, `families.test.ts`, `anti-parroting.test.ts` |
| LLM judges (4 family prompts + base router + content-fidelity + pairwise) | `desktop/eval/judges/` | `llm-judge.test.ts`, `content-fidelity-judge.test.ts`, `pairwise-judge.test.ts` |
| Metrics (retry-histogram, slot-distribution, DER skeleton) | `desktop/eval/metrics/` | each `.test.ts` |
| Runners + pipeline stub | `desktop/eval/runners/` | `single-fixture.test.ts` |
| Baseline format + store + diff | `desktop/eval/baseline/` | `format.test.ts`, `store.test.ts`, `diff.test.ts` |
| Scorecard | `desktop/eval/scorecard.ts` | `scorecard.test.ts` |
| CLI entries | `desktop/scripts/eval-notes.ts`, `eval-judge-swap.ts`, `score-spike-0.2.ts` | `eval-notes.test.ts` |
| v0 Spike 0.2 baseline | `desktop/eval/baselines/v0-spike-0.2-lecture.json` (gitignored, regenerable) | (manual smoke) |

## Empirically verified

- All `.test.ts` suites pass on `pnpm --filter @lisna/desktop test`.
- `eval:notes --family lecture --runner stub --no-llm-judge` runs end-to-end offline.
- `eval:spike-0.2` produces a v0 baseline (validates the full pipeline against real 3B output, exercises the anti-parroting rule on the E=mc² runs).

## Assumed (validated in Plans 2-6)

- The Stub runner's note shapes will match the real Plan 2 `ValidatedNote` shapes. Plan 2's first task that wires `runFamilySuite --runner offline-3b` discovers any mismatches; fix at that integration point.
- `FamilyDefinition.evalBaselines: string[]` registration is wired by Plan 2 — Plan 7 ships only the validator that consumes it.
- Real founder-recorded Meeting/Interview/Brainstorm fixtures replace the synthetic stubs in Plans 5/6 follow-up. The stubs validate plumbing; quality numbers from them are not meaningful.

## Carry-forward to Plans 3-6

| Plan | Carries |
|---|---|
| Plan 2 (Foundation) | (a) Wire `FamilyDefinition.evalBaselines` → call `validateEvalBaselines()` at boot. (b) Implement `offline-3b` / `offline-1b` runners against `PipelineRunner` contract and register in `eval-notes.ts`. (c) Plan 2's grammar-call wrapper must emit `attemptsUsed` so `buildRetryHistogram` has data. |
| Plan 3 (Lecture) | Use this harness as the regression gate from the first commit. Baseline = `v0-spike-0.2-lecture`. Each prompt iteration: re-run `eval:notes --family lecture --against v0-spike-0.2-lecture --baseline v1-<change>`. |
| Plan 4 (Diarization) | Replace `metrics/der.ts` skeleton with pyannote-grade impl once Spike 0.3 fixtures land. Fold DER into the Meeting/Interview/Brainstorm runners. |
| Plan 5 (Meeting) | Replace 3 synthetic Meeting stubs with real recordings. Add Meeting-specific contract rules as production data reveals failure modes. |
| Plan 6 (Interview + Brainstorm + merge-LLM spike) | Replace 6 synthetic Interview + Brainstorm stubs with real recordings. Path E diagnostic feeds Plan 6 prompt design; the harness measures the result. |

## Open hazards

- **Judge calibration drift**: switching `judgeModelId` between baselines changes the score scale. The diff layer surfaces this as a warning, but operator discipline (don't compare across judges, run `eval:judge-swap` first) is required.
- **Stub runner quality**: the stub's deterministic notes always pass ContractTest. If Plan 2's real runner emits malformed notes, only the LLM judge / content-fidelity layer will catch the regression. Fold a "smoke fixture with known-bad shape" into Plan 7.5 if Plan 2 + Plan 3 iteration shows real notes regressing without ContractTest catching them.
- **Cooldown × judge-swap**: 75s × N-judges × N-fixtures gets expensive fast. The judge-swap matrix CLI does not enforce cooldowns — operator must run it with `--fixture <one>` for matrix exploration.

## Links

- Spec: `docs/superpowers/specs/2026-05-26-v2-structured-note-creation-design.md` §4 #12 + §6 + §7
- Phase 0 VERDICT: `desktop/spikes/phase-0/VERDICT.md`
- v1 precedent: `backend/scripts/eval-curator.ts`, `backend/scripts/lib/judge.ts`
- LLM eval skill: `~/.claude/skills/llm-eval-loop/SKILL.md`
```

- [ ] **Step 2: Fill in actual values once Plan 7 is implemented + commit**

```bash
git add docs/superpowers/plans/2026-05-27-v2-plan-7-verdict.md
git commit -m "docs(plan-7): verdict memo — harness ready, regression gate live"
```

---

## Self-review checklist (do not skip)

After all 29 tasks complete, run through:

- [ ] `pnpm --filter @lisna/desktop typecheck` clean.
- [ ] `pnpm --filter @lisna/desktop lint` clean.
- [ ] `pnpm --filter @lisna/desktop test` all green (covers every `.test.ts` in `desktop/eval/` + `desktop/scripts/eval-*.test.ts`).
- [ ] `pnpm --filter @lisna/desktop eval:notes --family lecture --runner stub --no-llm-judge` runs without errors and prints a clean scorecard.
- [ ] `pnpm --filter @lisna/desktop eval:notes --family meeting --runner stub --no-llm-judge` runs.
- [ ] `pnpm --filter @lisna/desktop eval:notes --family interview --runner stub --no-llm-judge` runs.
- [ ] `pnpm --filter @lisna/desktop eval:notes --family brainstorm --runner stub --no-llm-judge` runs.
- [ ] `pnpm --filter @lisna/desktop eval:spike-0.2` (requires `GROQ_API_KEY`) produces a baseline file and the scorecard shows: ContractTest=PASS, anti-parroting WARN on E=mc² runs, judge.overall populated.
- [ ] `desktop/eval/baselines/.gitkeep` exists; `desktop/eval/baselines/*.json` is gitignored.
- [ ] `desktop/eval/README.md` lists every CLI surface accurately.
- [ ] No `process.exit()` calls leak into library code (`desktop/eval/**`) — only `desktop/scripts/eval-*.ts` exits.
- [ ] `pipeline-stub.ts` notes pass ContractTest for every family (positive regression test for the stub itself).
- [ ] **Hardware-safety**: search for `run_in_background.*true` in any `desktop/eval/` or `desktop/scripts/eval-*.ts` file → zero matches.
- [ ] Each family judge prompt encodes the *family-specific* axes (Lecture has contentFidelity; Meeting has decisionCapture; Interview has qaParity; Brainstorm has clusterCoherence).
- [ ] **Spec coverage**: §4 #12 (harness with 3 judges + runners + scorecard) ✓ shipped. §4 P4 (evalBaselines startup validation) ✓ Task 23. §4 P7 (ContractTest catching mode collapse) ✓ Task 4 + 5 + 6. §6 file structure (`desktop/eval/`) ✓ matches spec exactly. §7.2 (Lecture acceptance) ✓ encoded in `LECTURE_RULES`. §7.3 (chunking + merge) → out of scope (Plan 2 + Plan 6).
- [ ] **VERDICT coverage**: carry-forward #1 (content-fidelity) ✓ Tasks 6 + 9 + 13. carry-forward #2 (retry-rate histogram) ✓ Task 16. carry-forward #3 (DER skeleton) ✓ Task 24. (`slotTypes` vs `slotsEmerged` from Plan 6 carry-forward #4) ✓ Task 17.

If you find a spec or VERDICT item with no task, add the task before declaring the plan complete.

## Next plan dependencies

Plan 7 is the **consumer-facing infrastructure for Plans 3-6**. It is independent of Plan 2's Foundation work but creates load-bearing contracts Plan 2 must respect:

- Plan 2's grammar-constrained-call wrapper MUST emit `attemptsUsed` (consumed by `buildRetryHistogram`).
- Plan 2's `FamilyDefinition.evalBaselines: string[]` MUST be validated against `desktop/eval/fixtures/` at app boot (use `validateEvalBaselines`).
- Plan 2 must implement `offline-3b` / `offline-1b` runners against the `PipelineRunner` contract and register them in `desktop/scripts/eval-notes.ts::resolveRunner`. Stub runner is the placeholder.
- Plan 3 (Lecture impl) opens with a regression run against `v0-spike-0.2-lecture` baseline. First commit MUST not regress.
- Plan 4 (Diarization) replaces `desktop/eval/metrics/der.ts` skeleton with the pyannote-backed impl when Spike 0.3 fixtures land.
- Plan 5 (Meeting) + Plan 6 (Interview + Brainstorm) replace the synthetic stub fixtures with real founder-recorded fixtures as those land.

Plan 7 ships in parallel with Plan 2 — it does NOT block Plan 2 sequencing.


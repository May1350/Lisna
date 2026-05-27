# Lisna v2 — Plan 5: Meeting family (deterministic merge)

**Branch:** `spec/v2-note-creation-design`
**Depends on:** Plan 1 PASS, Plan 2 (Foundation), Plan 3 (Lecture pipeline — orchestrator/renderer/migration/eval patterns), Plan 4 (Diarization Phase A type contracts + runtime fallback)
**Independent of:** Plan 6 (different families), Plan 7 (Plan 5 produces its baselines for Plan 7 to consume)
**Unblocks:** Plan 7 Meeting judge + baseline lift

Plan 5 lands the SECOND family end-to-end. Meeting is the simplest multi-speaker family — speaker-aware schema, **deterministic merge** (no merge-LLM call, per spec §5.2b), graceful degradation when Plan 4 diarization fails. Once Plan 5 lands, Recording → Stop → Meeting picker → STT finalize + LLM load + diarization output → chunkTranscript → per-chunk grammar call → deterministic merge → Zod-validated `MeetingNote` → Markdown render with speaker prefixes works end-to-end.

Reuses every architectural primitive from Plan 3: `runPostDecodePipeline`, `deterministicMerge`, the orchestrator dispatcher, the `session/finalize` IPC, the renderer + migration patterns. Plan 5's new surface area is the schema + slots + prompts + a Meeting-specific renderer + the diarization consumption.

---

## Carry-forward → Task mapping

| # | Source | Task(s) |
|---|---|---|
| 1 | Spec §3.4 MeetingNote + §3.2 PurposeDrivenNote | Task 1 (Zod schema extends both) |
| 2 | Spec §3.4 + Path G `.max(N)` | Task 1 (every array bounded) |
| 3 | Spec §4 P1 FamilyRegistry register | Task 2 (MeetingFamily) |
| 4 | Anti-parroting + slot-trigger language (合意/決定/タスク/参加者) | Task 3 (prompt) |
| 5 | Spec §5.2b Meeting MergeStrategy (concat-only topic_arc/discussions + concat-dedup decisions/proposals/next_steps) | Task 4 (MergeStrategy) |
| 6 | Plan 4 Phase A type contracts (`requiresDiarization: true`, `SpeakerRef` resolver) | Task 2 + Task 6 + Task 7 |
| 7 | Plan 4 fallback ladder — degrade to single-speaker on G1 fail | Task 5 (`validation_warnings.defaulted_to_single_speaker`) |
| 8 | Spec §5.2 orchestrator extension + spec §5.3 renderer | Task 6 (orchestrator branch), Task 8 (renderer) |
| 9 | Inline-rename Speaker A → user name (spec §5.1 / §5.3 dereference) | Task 9 (SpeakerRenameDialog) |
| 10 | Plan 3 patterns — loadNote + migration chain reuse | Task 10 (Meeting migrations registry) |
| 11 | Plan 7 evalBaselines registration | Task 11 (baseline freeze) |
| 12 | Hardware-gated E2E (`LISNA_LLM_INTEGRATION=1` + diarization integration env) | Task 12 |
| 13 | Verification gate (typecheck + tests + skill discipline) | Task 13 |

---

## File structure (delta only)

```
desktop/src/shared/families/meeting/
├── index.ts                         (T2 — register MeetingFamily)
├── schema.ts                        (T1 — Zod MeetingNote + `.max(N)`)
├── prompts/
│   ├── v1.ts                        (T3 — PromptVariant: system + chunkUserTemplate; NO mergeUserTemplate)
│   └── index.ts                     (T3 — variant registry)
├── merge.ts                         (T4 — Meeting MergeStrategy)
├── renderer.tsx                     (T8 — speaker prefixes + decisions callout + action_items checkboxes)
└── migrations/
    ├── index.ts                     (T10 — empty for v1)
    └── v1-fixture.json              (T10 — Meeting v1 sample, exercises chain runner)

desktop/src/main/sidecar/
└── orchestrator.ts                  (T6 modify — `family === 'meeting'` branch dispatcher; reuses Plan 3 patterns)

desktop/src/main/diarization/
└── apply-speakers.ts                (T7 new — applies sherpa-onnx output to TranscriptSegment.speakerId; consumed by orchestrator)

desktop/src/renderer/components/
├── SpeakerChip.tsx                  (T9 new — rendered chip with rename trigger)
└── SpeakerRenameDialog.tsx          (T9 new — inline edit, mutates SessionTranscript.speakers[].name)

desktop/tests/fixtures/baselines/meeting/
└── synth-v0.baseline.json           (T11 — synthetic 2-speaker 4-decision baseline)

desktop/src/integration/
└── meeting-e2e.test.ts              (T12 — LISNA_LLM_INTEGRATION=1, requires 2-speaker JA fixture)
```

**Untouched** intentionally: Lecture family (Plan 3 untouched), `desktop/src/main/audio/` capture path, root `/shared/` HTTP-wire package.

---

## Pre-flight (Task 0)

### Task 0: Verify Plan 3 + Plan 4 Phase A on disk + branch state

**Files:** none (read + verification only).

- [ ] **Step 1: Verify branch + HEAD** — `git branch --show-current` shows `spec/v2-note-creation-design`; `git log -1 --oneline` shows Plan 3 OR later.

- [ ] **Step 2: Verify Plan 3 outputs**
```bash
ls desktop/src/shared/post-decode/pipeline.ts
ls desktop/src/shared/post-decode/deterministic-merge.ts
ls desktop/src/shared/note-schema/load-note.ts
ls desktop/src/main/sidecar/ipc/session-finalize.ts
ls desktop/src/shared/families/lecture/index.ts   # registration pattern
```

- [ ] **Step 3: Verify Plan 4 Phase A**
```bash
ls desktop/src/shared/note-schema/speaker-ref.ts       # Plan 4 Phase A
ls desktop/src/main/diarization/diarize-engine.ts      # Plan 4 Phase B (may be stub if Plan 4 runtime hasn't landed)
```

If Plan 4 Phase A is missing, **STOP**. Plan 5 needs `SpeakerRef` type + `requiresDiarization` flag minimum. If Plan 4 Phase B (native sidecar) hasn't landed, Plan 5 Task 7 (`apply-speakers.ts`) uses `NoOpDiarization` and emits `validation_warnings.defaulted_to_single_speaker` for every Meeting note. Document this in the orchestrator branch.

- [ ] **Step 4: Typecheck green at HEAD**
```bash
cd /Users/guntak/Lisna/desktop && pnpm exec tsc --noEmit 2>&1 | tail -5
```

**Commit:** none.

---

## Phase A — Schema + family registration (Tasks 1-2)

### Task 1: `MeetingNote` Zod schema (extends `PurposeDrivenNote`)

**Goal:** Zod schema for `MeetingNote` per spec §3.4, extending `PurposeDrivenNote` (which extends `NoteBase`), with `.max(N)` bounds on all arrays.

**Files:**
- Create: `desktop/src/shared/families/meeting/schema.ts`
- Create: `desktop/src/shared/families/meeting/schema.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// schema.test.ts
import { describe, it, expect } from 'vitest';
import { MeetingNoteSchema } from './schema';

describe('MeetingNoteSchema', () => {
  it('parses a minimal valid meeting note', () => {
    const minimal = {
      schemaVersion: 1, family: 'meeting',
      title: '週次計画ミーティング',
      generatedAt: '2026-05-27T12:00:00.000Z',
      generatedBy: { model: 'Llama-3.2-3B-Q4_K_M', promptVersion: 1 },
      language: 'ja', durationSec: 1800,
      purpose: '次週のスプリント計画',
      executive_summary: '佐藤と田中で議論し、A・Bの2タスクで合意。',
      topic_arc: [],
      discussions: [],
      decisions: [],
      open_questions: [],
    };
    expect(() => MeetingNoteSchema.parse(minimal)).not.toThrow();
  });

  it('rejects wrong family discriminator', () => {
    expect(() => MeetingNoteSchema.parse({ family: 'lecture', schemaVersion: 1 })).toThrow();
  });

  it('enforces .max(N) on decisions (Path G)', () => {
    const tooMany = { /* otherwise valid, but decisions has 21 items */ };
    expect(() => MeetingNoteSchema.parse(tooMany)).toThrow(/decisions/i);
  });

  it('enforces .max(N) on next_steps (Path G)', () => {
    const tooMany = { /* next_steps with 31 items */ };
    expect(() => MeetingNoteSchema.parse(tooMany)).toThrow(/next_steps/i);
  });

  it('atmosphere enum accepts the 4 valid values only', () => {
    const bad = { /* atmosphere: 'chaotic' */ };
    expect(() => MeetingNoteSchema.parse(bad)).toThrow();
  });

  it('SpeakerRef integer is enforced on decisions.made_by', () => {
    /* ... */
  });

  it('hydrates Provenance "inferred" on decisions/proposals/open_questions/risks (Stage 3 / Plan 2 Task 10)', () => {
    /* schema requires `from`; runtime post-decode fills it */
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```typescript
// schema.ts
import { z } from 'zod';
import { NoteBase, ProvenanceSchema, SpeakerRefSchema, PurposeDrivenNote } from '../../note-schema';

const MAX_PARTICIPANTS = 12;
const MAX_TOPIC_ARC = 30;
const MAX_DISCUSSIONS = 25;
const MAX_DECISIONS = 20;
const MAX_PROPOSALS = 25;
const MAX_OPEN_QUESTIONS = 25;
const MAX_RISKS = 20;
const MAX_KEY_POINTS_PER_DISCUSSION = 12;
const MAX_NEXT_STEPS = 30;
const MAX_CONCLUSIONS = 15;

export const MeetingNoteSchema = PurposeDrivenNote.extend({
  family: z.literal('meeting'),
  executive_summary: z.string().min(1),
  agenda: z.array(z.string().min(1)).max(20).optional(),
  participants: z
    .array(
      z.object({
        speakerRef: SpeakerRefSchema,
        role: z.string().optional(),
      }),
    )
    .max(MAX_PARTICIPANTS)
    .optional(),
  topic_arc: z
    .array(
      z.object({
        topic: z.string().min(1),
        ts: z.number().nonnegative(),
        speakers_involved: z.array(SpeakerRefSchema).max(MAX_PARTICIPANTS),
      }),
    )
    .max(MAX_TOPIC_ARC),
  discussions: z
    .array(
      z.object({
        topic: z.string().min(1),
        ts_start: z.number().nonnegative(),
        ts_end: z.number().nonnegative().optional(),
        summary: z.string().min(1),
        key_points: z.array(z.string()).max(MAX_KEY_POINTS_PER_DISCUSSION).optional(),
      }),
    )
    .max(MAX_DISCUSSIONS),
  decisions: z
    .array(
      z.object({
        text: z.string().min(1),
        rationale: z.string().optional(),
        ts: z.number().nonnegative(),
        made_by: SpeakerRefSchema.optional(),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_DECISIONS),
  proposals: z
    .array(
      z.object({
        text: z.string().min(1),
        proposed_by: SpeakerRefSchema.optional(),
        ts: z.number().nonnegative(),
        outcome: z.enum(['accepted', 'rejected', 'deferred', 'open']).optional(),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_PROPOSALS)
    .optional(),
  open_questions: z
    .array(
      z.object({
        text: z.string().min(1),
        ts: z.number().nonnegative(),
        asked_by: SpeakerRefSchema.optional(),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_OPEN_QUESTIONS),
  risks_or_concerns: z
    .array(
      z.object({
        text: z.string().min(1),
        raised_by: SpeakerRefSchema.optional(),
        ts: z.number().nonnegative(),
        from: ProvenanceSchema,
      }),
    )
    .max(MAX_RISKS)
    .optional(),
  atmosphere: z.enum(['collaborative', 'tense', 'enthusiastic', 'neutral']).optional(),

  // From PurposeDrivenNote, but override max bounds explicitly so spec is read in one place:
  conclusions: z
    .array(z.object({
      text: z.string().min(1),
      ts: z.number().nonnegative().optional(),
      from: ProvenanceSchema,
    }))
    .max(MAX_CONCLUSIONS)
    .optional(),
  next_steps: z
    .array(z.object({
      text: z.string().min(1),
      owner: SpeakerRefSchema.optional(),
      due: z.string().optional(),
      ts: z.number().nonnegative(),
      from: ProvenanceSchema,
    }))
    .max(MAX_NEXT_STEPS)
    .optional(),
}).strict();

export type MeetingNote = z.infer<typeof MeetingNoteSchema>;
```

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/shared/families/meeting/schema.ts \
        desktop/src/shared/families/meeting/schema.test.ts
git commit -m "feat(v2-meeting): MeetingNote schema (extends PurposeDrivenNote, .max(N) bounds)"
```

### Task 2: Meeting `FamilyDefinition` + registration

**Goal:** Register Meeting family in `FamilyRegistry`. `requiresDiarization: true` (Plan 4 consumes this).

**Files:**
- Create: `desktop/src/shared/families/meeting/index.ts`
- Create: `desktop/src/shared/families/meeting/family.test.ts`

- [ ] **Step 1: Failing registration test** (analogous to Plan 3 Task 3)

- [ ] **Step 2: Implement**

```typescript
// index.ts
import { registerFamily, FamilyDefinition } from '../index';
import { MeetingNoteSchema } from './schema';
import { meetingMergeStrategy } from './merge';          // T4 placeholder until lands
import { meetingPromptsV1 } from './prompts/v1';         // T3 placeholder until lands
import { MeetingRenderer } from './renderer';            // T8 placeholder until lands

export const MeetingFamily: FamilyDefinition = {
  family: 'meeting',
  schema: MeetingNoteSchema,
  slots: [],                                              // Meeting has no extras-slot system; decisions/proposals/etc. are first-class fields
  prompts: { default: meetingPromptsV1, v1: meetingPromptsV1 },
  mergeStrategy: meetingMergeStrategy,
  renderer: MeetingRenderer,
  requiresDiarization: true,                              // Plan 4 consumes
};

registerFamily(MeetingFamily);
```

- [ ] **Step 3: Commit** (with TODO scaffold for T3/T4/T8 if not yet landed).

```bash
git add desktop/src/shared/families/meeting/index.ts \
        desktop/src/shared/families/meeting/family.test.ts
git commit -m "feat(v2-meeting): FamilyDefinition (requiresDiarization=true)"
```

---

## Phase B — Prompts (Task 3)

### Task 3: Meeting `PromptVariant` v1 (system + chunkUserTemplate)

**Goal:** Plain-string system prompt + chunkUserTemplate. Anti-parroting (no literal exemplars). Slot-trigger Japanese cues for decisions / action_items / participants. Speaker-aware: prompt instructs LLM to identify `made_by`/`asked_by`/etc. as SpeakerRef integers, with the speakers[] map injected for reverse lookup (per spec §5.2 speaker-handling rule).

**Files:**
- Create: `desktop/src/shared/families/meeting/prompts/v1.ts`
- Create: `desktop/src/shared/families/meeting/prompts/index.ts`
- Create: `desktop/src/shared/families/meeting/prompts/v1.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// v1.test.ts
import { describe, it, expect } from 'vitest';
import { meetingPromptsV1 } from './v1';

describe('meetingPromptsV1', () => {
  it('variantId is meeting-v1', () => { /* ... */ });

  it('system prompt contains anti-parroting rule + no literal exemplars', () => {
    expect(meetingPromptsV1.system).toMatch(/never (use|invent|fabricate)/i);
    expect(meetingPromptsV1.system).not.toMatch(/田中が決定した/);    // not a canned exemplar
  });

  it('system prompt distinguishes decisions / conclusions / proposals / next_steps semantically', () => {
    expect(meetingPromptsV1.system).toContain('decision');
    expect(meetingPromptsV1.system).toContain('conclusion');
    expect(meetingPromptsV1.system).toContain('proposal');
    expect(meetingPromptsV1.system).toContain('next_step');
  });

  it('system prompt mentions JA slot triggers (合意/決定/タスク/参加者)', () => {
    expect(meetingPromptsV1.system).toContain('合意');
    expect(meetingPromptsV1.system).toContain('決定');
    expect(meetingPromptsV1.system).toContain('タスク');
    expect(meetingPromptsV1.system).toContain('参加者');
  });

  it('chunkUserTemplate injects speakers map', () => {
    const out = meetingPromptsV1.chunkUserTemplate({
      chunkIndex: 0,
      totalChunks: 2,
      transcript: '[00:00] [Speaker 0] テスト',
      speakers: [{ id: 0, name: '佐藤' }, { id: 1, name: '田中' }],
    });
    expect(out).toContain('Speaker 0 = 佐藤');
    expect(out).toContain('Speaker 1 = 田中');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```typescript
// v1.ts
import { PromptVariant } from '../../../note-schema/prompt-variant';

const SYSTEM = `You are a meeting note writer producing structured JSON for a Japanese business meeting. You receive a transcript chunk with speaker prefixes and timestamps; output a JSON note matching the MeetingNote schema.

Hard rules:
- All user-visible text in the JSON MUST be Japanese unless the meeting itself uses English.
- Output ONLY valid JSON. No markdown, no commentary, no preamble.

Semantic distinctions (CRITICAL — these four fields overlap; keep them strictly separate):
- **decision** (field: \`decisions\`): an EXPLICIT CHOICE made by the group (e.g. 「A案で進める」, 「金曜日リリース」). Triggers in JA: 合意/決定/採用/承認.
- **conclusion** (field: \`conclusions\`): an INSIGHT or FINDING that emerged but is NOT a chosen action (e.g. 「現状のテストカバレッジは不足している」). Triggers: 結論として/つまり.
- **proposal** (field: \`proposals\`): a SUGGESTION made but not yet accepted as a decision. Tracks outcome (accepted/rejected/deferred/open). Triggers: 提案/案/かもしれない.
- **next_step** (field: \`next_steps\`): a CONCRETE ASSIGNED ACTION with an owner (\`owner: SpeakerRef\`). Triggers: タスク/担当/やる/対応する.

Speaker references:
- The user message injects a speakers map (e.g. "Speaker 0 = 佐藤, Speaker 1 = 田中").
- For \`decisions.made_by\`, \`open_questions.asked_by\`, \`next_steps.owner\`, etc., output the integer SpeakerRef (NOT the name string).
- If you cannot identify who made a decision/asked a question, OMIT that field entirely — do not invent a SpeakerRef.

Slot triggers (Japanese cues to look for):
- 合意/決定 → emit a \`decision\`
- タスク/担当/やる → emit a \`next_step\` (also action_item is folded here per spec §3.4)
- 提案/案 → emit a \`proposal\`
- 質問/疑問 → emit an \`open_question\`
- リスク/懸念/問題 → emit a \`risks_or_concerns\` item

CRITICAL anti-parroting rule:
- NEVER invent a decision or action_item that wasn't in the transcript. An empty \`decisions: []\` is CORRECT when no decision was made.
- Do NOT use placeholder decision text like 「タスクA」 or 「次のステップを決定する」. Use the actual text from the transcript.
- Same applies to participants/topics/proposals: identify them from the transcript or omit.

Provenance:
- The schema expects \`from: "transcript" | "inferred"\` on every Provenance-bearing field. Output \`"transcript"\` for items directly stated. The pipeline fills \`"inferred"\` post-hoc for paraphrased content — if uncertain, prefer \`"transcript"\`.

Atmosphere (optional): one of collaborative / tense / enthusiastic / neutral, based on overall tone.`;

export const meetingPromptsV1: PromptVariant = {
  variantId: 'meeting-v1',
  system: SYSTEM,
  chunkUserTemplate: ({ chunkIndex, totalChunks, transcript, speakers }) => {
    const speakerMap = (speakers ?? [])
      .map((s) => `Speaker ${s.id} = ${s.name ?? `話者${s.id}`}`)
      .join(', ');
    return [
      `Chunk ${chunkIndex + 1} of ${totalChunks}`,
      `Speaker map: ${speakerMap}`,
      '',
      'Transcript:',
      transcript,
      '',
      'Produce the MeetingNote JSON for this chunk only.',
    ].join('\n');
  },
  // No mergeUserTemplate — Meeting uses deterministic merge.
};
```

`prompts/index.ts`:
```typescript
import { meetingPromptsV1 } from './v1';
export const meetingPromptVariants = { default: meetingPromptsV1, v1: meetingPromptsV1 };
```

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/shared/families/meeting/prompts/
git commit -m "feat(v2-meeting): v1 prompt with semantic-distinction rules + speaker-map injection"
```

---

## Phase C — Merge + diarization wiring + orchestrator (Tasks 4-7)

### Task 4: Meeting `MergeStrategy`

**Goal:** Per spec §5.2b — `scalarPolicy: 'longest'`, `arrayPolicy: 'concat-dedup'`, with `topic_arc / discussions: 'concat-only' + sortByTs`, `decisions / proposals / next_steps: 'concat-dedup'`. Zero second LLM call (deterministic).

**Files:**
- Create: `desktop/src/shared/families/meeting/merge.ts`
- Create: `desktop/src/shared/families/meeting/merge.test.ts`

- [ ] **Step 1: Failing tests** — same 5 cases as Plan 3 Task 6 adapted for Meeting fields.

- [ ] **Step 2: Implement**

```typescript
// merge.ts
import type { MergeStrategy } from '../../note-schema';

export const meetingMergeStrategy: MergeStrategy = {
  scalarPolicy: 'longest',
  arrayPolicy: 'concat-dedup',
  sortByTs: true,
  fieldOverrides: {
    topic_arc: { policy: 'concat-only' },               // temporal arc — order preserved
    discussions: { policy: 'concat-only' },             // discussions are unique per ts_start
    decisions: { policy: 'concat-dedup' },              // dedup duplicate decisions across chunks
    proposals: { policy: 'concat-dedup' },
    next_steps: { policy: 'concat-dedup' },
    open_questions: { policy: 'concat-dedup' },
    risks_or_concerns: { policy: 'concat-dedup' },
    conclusions: { policy: 'concat-dedup' },
    participants: { policy: 'concat-dedup' },           // dedup by speakerRef
    agenda: { policy: 'concat-dedup' },
  },
};
```

- [ ] **Step 3: Run tests, expect PASS.**

- [ ] **Step 4: Commit.**

```bash
git add desktop/src/shared/families/meeting/merge.ts \
        desktop/src/shared/families/meeting/merge.test.ts
git commit -m "feat(v2-meeting): MergeStrategy — concat-only topic_arc/discussions + concat-dedup decisions/etc."
```

### Task 5: `validation_warnings.defaulted_to_single_speaker` (Plan 4 fallback consumption)

**Goal:** When Plan 4 diarization fails (G1 DER > 15% empirically, OR runtime error, OR `DIARIZATION_ENABLED=false`), Meeting note should still produce — but with all segments labeled Speaker 0 and a user-visible warning in `validation_warnings`.

**Files:**
- Modify: `desktop/src/main/sidecar/orchestrator.ts` (the meeting branch path — see Task 6)
- Create: `desktop/src/shared/families/meeting/degrade-to-single-speaker.ts`
- Create: `desktop/src/shared/families/meeting/degrade-to-single-speaker.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// degrade-to-single-speaker.test.ts
import { describe, it, expect } from 'vitest';
import { degradeToSingleSpeaker } from './degrade-to-single-speaker';

describe('degradeToSingleSpeaker', () => {
  it('relabels every TranscriptSegment.speakerId to 0', () => {
    const t = /* multi-speaker SessionTranscript */;
    const out = degradeToSingleSpeaker(t);
    for (const seg of out.transcript.transcriptSegments) expect(seg.speakerId).toBe(0);
    expect(out.transcript.speakers).toEqual([{ id: 0, name: '話者' }]);
    expect(out.warning).toMatch(/Speaker labels disabled/);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// degrade-to-single-speaker.ts
import type { SessionTranscript } from '../../note-schema';

export function degradeToSingleSpeaker(
  transcript: SessionTranscript,
): { transcript: SessionTranscript; warning: string } {
  return {
    transcript: {
      ...transcript,
      speakers: [{ id: 0, name: '話者' }],
      transcriptSegments: transcript.transcriptSegments.map((s) => ({ ...s, speakerId: 0 })),
    },
    warning:
      'Speaker labels disabled — diarization unavailable for this session (Plan 4 fallback). All segments labeled as 話者 (Speaker 0).',
  };
}
```

- [ ] **Step 3: Commit.**

```bash
git add desktop/src/shared/families/meeting/degrade-to-single-speaker.ts \
        desktop/src/shared/families/meeting/degrade-to-single-speaker.test.ts
git commit -m "feat(v2-meeting): degrade-to-single-speaker fallback (Plan 4 G1 fail handling)"
```

### Task 6: Orchestrator `family === 'meeting'` branch

**Goal:** Extend orchestrator with `finalizeMeeting(...)`. Reuses Plan 3 patterns (`chunkTranscript`, `runGrammarCallWithRetry`, `deterministicMerge`, `runPostDecodePipeline`) — adds speaker-map injection into the prompt + diarization-fallback handling.

**Files:**
- Modify: `desktop/src/main/sidecar/orchestrator.ts`
- Create: `desktop/src/main/sidecar/meeting-orchestrator.test.ts`

- [ ] **Step 1: Failing test** (analogous to Plan 3 Task 9 — mocked sidecar, 3-chunk transcript, dedup verification on decisions across chunks, fallback path test)

- [ ] **Step 2: Implement** (delta on orchestrator.ts)

```typescript
// orchestrator.ts (delta)
import { familyRegistry } from '../../shared/families';
import { degradeToSingleSpeaker } from '../../shared/families/meeting/degrade-to-single-speaker';

export async function finalizeMeeting(args: {
  sessionId: string;
  transcript: SessionTranscript;
  diarizationStatus: 'ok' | 'fallback' | 'disabled';
  sidecar: SidecarClient;
  modelProfile: ModelProfile;
  promptVariantId: string;
  onProgress?: (e: ProgressEvent) => void;
}): Promise<{ note: MeetingNote; telemetry: GenerationTelemetry }> {
  const fam = familyRegistry.get('meeting');
  const tuning = args.modelProfile.perFamily.meeting;

  // 1) Apply diarization fallback if needed
  let activeTranscript = args.transcript;
  const validationWarnings: string[] = [];
  if (args.diarizationStatus !== 'ok') {
    const degraded = degradeToSingleSpeaker(args.transcript);
    activeTranscript = degraded.transcript;
    validationWarnings.push(degraded.warning);
  }

  // 2) Chunk
  const chunks = chunkTranscript(activeTranscript, tuning.recommendedChunkTokens);
  if (chunks.length === 0) throw new Error('EMPTY_TRANSCRIPT');

  // 3) Generate grammar
  const grammarPath = await args.sidecar.writeTempGrammar(zodToGbnf(fam.schema, 'MeetingNote'));

  // 4) Per-chunk grammar call
  const prompt = fam.prompts[args.promptVariantId] ?? fam.prompts.default;
  const partials: Partial<MeetingNote>[] = [];
  for (let i = 0; i < chunks.length; i++) {
    args.onProgress?.({ phase: 'chunk', chunkIndex: i, totalChunks: chunks.length });
    const userMsg = prompt.chunkUserTemplate({
      chunkIndex: i,
      totalChunks: chunks.length,
      transcript: renderTranscriptWithSpeakers(chunks[i], activeTranscript.speakers),
      speakers: activeTranscript.speakers,
    });
    const rawJson = await runGrammarCallWithRetry({
      sidecar: args.sidecar,
      grammarPath,
      systemPrompt: prompt.system,
      userPrompt: userMsg,
      maxTokens: tuning.maxGenTokens,
      temperature: tuning.temperature,
      maxAttempts: 3,
      baseSeed: 6000 + i,
    });
    const validated = runPostDecodePipeline(rawJson, fam, activeTranscript);
    partials.push(validated as Partial<MeetingNote>);
  }

  // 5) Deterministic merge — NO merge-LLM call
  args.onProgress?.({ phase: 'merge' });
  const merged = deterministicMerge(partials, fam.mergeStrategy);
  // Bubble up the diarization-fallback warning
  if (validationWarnings.length > 0) {
    merged.validation_warnings = [...(merged.validation_warnings ?? []), ...validationWarnings];
  }

  const note = fam.schema.parse(merged);

  // 6) Telemetry
  // ... (same shape as Plan 3 Task 9)
  return { note, telemetry };
}

function renderTranscriptWithSpeakers(
  chunk: SessionTranscript,
  speakers: SessionTranscript['speakers'],
): string {
  const lookup = new Map(speakers.map((s) => [s.id, s.name ?? `話者${s.id}`]));
  return chunk.transcriptSegments
    .map((s) => `[${fmtTs(s.ts)}] [${lookup.get(s.speakerId) ?? 'Speaker ?'}] ${s.text}`)
    .join('\n');
}
```

Wire into `session/finalize` dispatcher:
```typescript
if (args.family === 'meeting') {
  const result = await finalizeMeeting({/* session context + diarization status from session registry */});
  return { noteId: persistMeeting(result) };
}
```

- [ ] **Step 3: Run tests, expect PASS.**

- [ ] **Step 4: Commit.**

```bash
git add desktop/src/main/sidecar/orchestrator.ts \
        desktop/src/main/sidecar/meeting-orchestrator.test.ts
git commit -m "feat(v2-meeting): orchestrator branch — chunked-at-end + speaker-map + diarization-fallback"
```

### Task 7: `applySpeakers()` — diarization output → TranscriptSegment.speakerId

**Goal:** Plan 4 produces speaker turns (sherpa-onnx-native or Node fallback); Plan 5 consumes them. `applySpeakers(transcript, turns)` maps each segment's `ts` to the speaker whose turn overlaps. Used in the orchestrator AT THE END of recording, before chunking.

**Files:**
- Create: `desktop/src/main/diarization/apply-speakers.ts`
- Create: `desktop/src/main/diarization/apply-speakers.test.ts`

- [ ] **Step 1: Failing test** (heuristic: pick the speaker whose turn includes >50% of the segment's ts range; tie-break = prior speaker)

- [ ] **Step 2: Implement**

```typescript
// apply-speakers.ts
import type { SessionTranscript } from '../../shared/note-schema';
import type { SpeakerTurn } from '../../shared/note-schema/speaker-ref';   // Plan 4 Phase A

export function applySpeakers(
  transcript: SessionTranscript,
  turns: SpeakerTurn[],
): SessionTranscript {
  return {
    ...transcript,
    transcriptSegments: transcript.transcriptSegments.map((seg) => ({
      ...seg,
      speakerId: pickSpeaker(seg, turns),
    })),
  };
}

function pickSpeaker(seg: { ts: number; endTs?: number }, turns: SpeakerTurn[]): number {
  const segEnd = seg.endTs ?? seg.ts + 0.5;   // tiny window fallback for legacy segments without endTs (Plan 2 T8)
  let bestSpeaker = 0;
  let bestOverlap = -1;
  for (const t of turns) {
    const overlap = Math.max(0, Math.min(segEnd, t.endSec) - Math.max(seg.ts, t.startSec));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestSpeaker = t.speakerId;
    }
  }
  return bestSpeaker;
}
```

- [ ] **Step 3: Commit.**

```bash
git add desktop/src/main/diarization/apply-speakers.ts \
        desktop/src/main/diarization/apply-speakers.test.ts
git commit -m "feat(v2-meeting): applySpeakers — diarization turns → TranscriptSegment.speakerId"
```

---

## Phase D — Renderer + UI (Tasks 8-9)

### Task 8: `MeetingRenderer` (Markdown / JSX)

**Goal:** Pure renderer. Sections: header (purpose + executive_summary + atmosphere + participants), topic_arc (timeline), discussions (per-topic blocks with key_points), decisions callout block, proposals (with outcome chips), open_questions, risks, conclusions, next_steps (checkbox list with @speaker chip + ts). `※ inferred` markers on Provenance leaves where `from === 'inferred'`. Speaker references rendered via `<SpeakerChip>` (Task 9) so renames propagate.

**Files:**
- Create: `desktop/src/shared/families/meeting/renderer.tsx`
- Create: `desktop/src/shared/families/meeting/renderer.test.tsx`

- [ ] **Step 1: Failing test** (snapshot/DOM probes for each section)

```typescript
// renderer.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MeetingRenderer } from './renderer';

describe('MeetingRenderer', () => {
  it('renders executive_summary at top', () => { /* ... */ });
  it('renders decisions in callout block with ※ inferred markers', () => { /* ... */ });
  it('renders next_steps as checkboxes with @speaker chips + ts anchor', () => { /* ... */ });
  it('renders proposals with outcome chip (accepted/rejected/deferred/open)', () => { /* ... */ });
  it('renders atmosphere as a badge when set', () => { /* ... */ });
  it('falls back gracefully when participants is empty (no diarization or fallback)', () => { /* ... */ });
  it('shows validation_warnings banner when diarization fell back', () => { /* ... */ });
});
```

- [ ] **Step 2: Implement** (~150 lines of TSX following Plan 3 Task 11 patterns)

```tsx
// renderer.tsx
import type { MeetingNote } from './schema';
import type { SessionTranscript } from '../../note-schema';
import { fmtTs } from '../../utils/fmt-ts';
import { SpeakerChip } from '../../../renderer/components/SpeakerChip';

export function MeetingRenderer({ note, transcript }: { note: MeetingNote; transcript: SessionTranscript }) {
  return (
    <article className="meeting-note">
      <header>
        <h1>{note.title}</h1>
        <p className="purpose"><strong>目的:</strong> {note.purpose}</p>
        <p className="executive-summary">{note.executive_summary}</p>
        {note.atmosphere && <span className="atmosphere">{note.atmosphere}</span>}
        {note.participants?.length ? (
          <section className="participants">
            <h3>参加者</h3>
            <ul>
              {note.participants.map((p, i) => (
                <li key={i}>
                  <SpeakerChip speakerId={p.speakerRef} transcript={transcript} />
                  {p.role && <span className="role"> · {p.role}</span>}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </header>

      {note.agenda?.length ? (
        <section className="agenda">
          <h2>議題</h2>
          <ol>{note.agenda.map((a, i) => <li key={i}>{a}</li>)}</ol>
        </section>
      ) : null}

      {note.topic_arc?.length ? (
        <section className="topic-arc">
          <h2>話題の流れ</h2>
          <ol>
            {note.topic_arc.map((t, i) => (
              <li key={i}>
                <span className="ts-anchor">[{fmtTs(t.ts)}]</span> {t.topic}
                {t.speakers_involved.map((sid, j) => <SpeakerChip key={j} speakerId={sid} transcript={transcript} />)}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {note.discussions?.length ? (
        <section className="discussions">
          <h2>議論</h2>
          {note.discussions.map((d, i) => (
            <article key={i}>
              <h3>{d.topic} <span className="ts-anchor">[{fmtTs(d.ts_start)}{d.ts_end ? '-' + fmtTs(d.ts_end) : ''}]</span></h3>
              <p>{d.summary}</p>
              {d.key_points?.length ? <ul>{d.key_points.map((kp, j) => <li key={j}>{kp}</li>)}</ul> : null}
            </article>
          ))}
        </section>
      ) : null}

      {note.decisions.length > 0 && (
        <section className="decisions callout">
          <h2>決定事項</h2>
          <ul>
            {note.decisions.map((d, i) => (
              <li key={i}>
                <strong>{d.text}</strong>
                {d.rationale && <p className="rationale"><em>{d.rationale}</em></p>}
                {d.made_by !== undefined && <SpeakerChip speakerId={d.made_by} transcript={transcript} />}
                <span className="ts-anchor">[{fmtTs(d.ts)}]</span>
                {d.from === 'inferred' && <span className="provenance-inferred" title="AI-inferred">※</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {note.proposals?.length ? (
        <section className="proposals">
          <h2>提案</h2>
          <ul>
            {note.proposals.map((p, i) => (
              <li key={i}>
                {p.text}
                {p.outcome && <span className={`outcome outcome-${p.outcome}`}>{p.outcome}</span>}
                {p.proposed_by !== undefined && <SpeakerChip speakerId={p.proposed_by} transcript={transcript} />}
                <span className="ts-anchor">[{fmtTs(p.ts)}]</span>
                {p.from === 'inferred' && <span className="provenance-inferred">※</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {note.next_steps?.length ? (
        <section className="next-steps">
          <h2>アクション</h2>
          <ul className="checkbox-list">
            {note.next_steps.map((step, i) => (
              <li key={i}>
                <input type="checkbox" disabled /> {step.text}
                {step.owner !== undefined && <SpeakerChip speakerId={step.owner} transcript={transcript} />}
                {step.due && <span className="due"> · 期限 {step.due}</span>}
                <span className="ts-anchor">[{fmtTs(step.ts)}]</span>
                {step.from === 'inferred' && <span className="provenance-inferred">※</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {note.open_questions.length > 0 && (
        <section className="open-questions">
          <h2>未解決の質問</h2>
          <ul>
            {note.open_questions.map((q, i) => (
              <li key={i}>
                {q.text}
                {q.asked_by !== undefined && <SpeakerChip speakerId={q.asked_by} transcript={transcript} />}
                <span className="ts-anchor">[{fmtTs(q.ts)}]</span>
                {q.from === 'inferred' && <span className="provenance-inferred">※</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {note.risks_or_concerns?.length ? (
        <section className="risks">
          <h2>リスク・懸念</h2>
          <ul>
            {note.risks_or_concerns.map((r, i) => (
              <li key={i}>
                {r.text}
                {r.raised_by !== undefined && <SpeakerChip speakerId={r.raised_by} transcript={transcript} />}
                <span className="ts-anchor">[{fmtTs(r.ts)}]</span>
                {r.from === 'inferred' && <span className="provenance-inferred">※</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {note.conclusions?.length ? (
        <section className="conclusions">
          <h2>結論・所見</h2>
          <ul>
            {note.conclusions.map((c, i) => (
              <li key={i}>
                {c.text}
                {c.ts !== undefined && <span className="ts-anchor">[{fmtTs(c.ts)}]</span>}
                {c.from === 'inferred' && <span className="provenance-inferred">※</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {note.validation_warnings?.length ? (
        <aside className="validation-warnings">
          {note.validation_warnings.map((w, i) => <p key={i}>{w}</p>)}
        </aside>
      ) : null}
    </article>
  );
}
```

- [ ] **Step 3: Run tests, expect PASS.**

- [ ] **Step 4: Commit.**

```bash
git add desktop/src/shared/families/meeting/renderer.tsx \
        desktop/src/shared/families/meeting/renderer.test.tsx
git commit -m "feat(v2-meeting): renderer with speaker chips + decisions callout + checkbox actions"
```

### Task 9: `SpeakerChip` + inline-rename `SpeakerRenameDialog`

**Goal:** Reusable speaker chip (renders the user-friendly name from `transcript.speakers[id].name`, falls back to "Speaker {id}"). Click → opens `SpeakerRenameDialog` → user types new name → mutates `transcript.speakers[id].name` → renderer re-runs with updated name everywhere.

Used by both Meeting renderer (Task 8) and future Interview / Brainstorm renderers (Plan 6).

**Files:**
- Create: `desktop/src/renderer/components/SpeakerChip.tsx`
- Create: `desktop/src/renderer/components/SpeakerRenameDialog.tsx`
- Create: `desktop/src/renderer/components/SpeakerChip.test.tsx`

- [ ] **Step 1: Failing test** (click triggers dialog, submit calls onRename with new name, render reflects)

- [ ] **Step 2: Implement**

```tsx
// SpeakerChip.tsx
import { useState } from 'react';
import type { SessionTranscript } from '../../shared/note-schema';
import { SpeakerRenameDialog } from './SpeakerRenameDialog';

export function SpeakerChip({
  speakerId,
  transcript,
  onRename,
}: {
  speakerId: number;
  transcript: SessionTranscript;
  onRename?: (id: number, newName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const speaker = transcript.speakers.find((s) => s.id === speakerId);
  const label = speaker?.name ?? `話者${speakerId}`;
  return (
    <>
      <button
        className="speaker-chip"
        type="button"
        onClick={() => setEditing(true)}
        title={`Click to rename Speaker ${speakerId}`}
      >
        {label}
      </button>
      {editing && (
        <SpeakerRenameDialog
          speakerId={speakerId}
          currentName={speaker?.name ?? ''}
          onClose={() => setEditing(false)}
          onRename={(newName) => {
            onRename?.(speakerId, newName);
            setEditing(false);
          }}
        />
      )}
    </>
  );
}
```

```tsx
// SpeakerRenameDialog.tsx
export function SpeakerRenameDialog({
  speakerId,
  currentName,
  onClose,
  onRename,
}: {
  speakerId: number;
  currentName: string;
  onClose: () => void;
  onRename: (newName: string) => void;
}) {
  const [value, setValue] = useState(currentName);
  return (
    <div className="speaker-rename-dialog">
      <h3>Speaker {speakerId} の名前</h3>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="例: 佐藤"
        autoFocus
      />
      <button onClick={() => onRename(value)} disabled={value.trim().length === 0}>保存</button>
      <button onClick={onClose}>キャンセル</button>
    </div>
  );
}
```

- [ ] **Step 3: Wire `onRename` in `App.tsx`** — updates the in-memory `transcript.speakers[]` and writes back to `sessions/<id>/transcript.json` on each rename.

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/renderer/components/SpeakerChip.tsx \
        desktop/src/renderer/components/SpeakerRenameDialog.tsx \
        desktop/src/renderer/components/SpeakerChip.test.tsx
git commit -m "feat(v2-meeting): SpeakerChip + inline-rename dialog (mutates transcript.speakers[])"
```

---

## Phase E — Migration + Eval + E2E + Verify (Tasks 10-13)

### Task 10: Meeting v1 migration chain + fixture

**Goal:** Append Meeting to the `loadNote()` discriminator + register `meetingMigrations` (empty for v1) + ship a v1 fixture exercising the chain runner.

**Files:**
- Create: `desktop/src/shared/families/meeting/migrations/index.ts`
- Create: `desktop/src/shared/families/meeting/migrations/v1-fixture.json`
- Modify: `desktop/src/shared/note-schema/load-note.test.ts` (add Meeting case)

- [ ] **Step 1: Hand-curate a v1 Meeting fixture** (~50 lines JSON, realistic 2-speaker JA scenario — sprint-planning meeting with 3 decisions + 4 next_steps + 2 open_questions + 1 risk).

- [ ] **Step 2: Add `loadNote` test case** to verify dispatch by `family: 'meeting'` discriminator works.

- [ ] **Step 3: Commit.**

```bash
git add desktop/src/shared/families/meeting/migrations/ \
        desktop/src/shared/note-schema/load-note.test.ts
git commit -m "feat(v2-meeting): v1 migration chain + fixture (loadNote dispatcher coverage)"
```

### Task 11: Eval baseline freeze for Meeting

**Goal:** Synthesize a Meeting baseline from a 2-speaker fixture run + register in `evalBaselines`.

**Files:**
- Create: `desktop/tests/fixtures/baselines/meeting/synth-v0.baseline.json`
- Modify: `desktop/scripts/lib/eval-baselines.ts`

- [ ] **Step 1: Source the baseline** — either:
  - (a) Run the orchestrator against a 2-speaker JA fixture (15-30 min realistic content) and freeze the result, OR
  - (b) Hand-curate a baseline that represents the floor (cleanest decisions/action_items the LLM can plausibly produce on this fixture).

Plan 7 ContractTest + judge score against this baseline; regression flagged when slot emergence drops or content fidelity degrades.

- [ ] **Step 2: Register** in `eval-baselines.ts`:
  ```typescript
  export const evalBaselines: string[] = [
    'lecture/spike-0.2-v0',           // Plan 3 Task 14
    'meeting/synth-v0',               // ← this task
    // Interview / Brainstorm land in Plan 6
  ];
  ```

- [ ] **Step 3: Verify** Plan 7 startup validator picks it up.

- [ ] **Step 4: Commit.**

```bash
git add desktop/tests/fixtures/baselines/meeting/synth-v0.baseline.json \
        desktop/scripts/lib/eval-baselines.ts
git commit -m "test(v2-meeting): freeze synth-v0 baseline + register in eval startup"
```

### Task 12: Hardware-gated E2E for Meeting

**Goal:** End-to-end test running real LLM + (optionally) real diarization. Gated behind `LISNA_LLM_INTEGRATION=1` + `LISNA_DIAR_INTEGRATION=1` (latter optional; falls back to `degradeToSingleSpeaker` if not set).

**Files:**
- Create: `desktop/src/integration/meeting-e2e.test.ts`
- Create: `desktop/src/integration/fixtures/meeting-2spk-3min.transcript.json`
- (Optional) Create: `desktop/src/integration/fixtures/meeting-2spk-3min.wav` (gitignored; founder action — recorded fixture)

- [ ] **Step 1: Failing test**

```typescript
// meeting-e2e.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { finalizeMeeting } from '../main/sidecar/orchestrator';

const HARD_GATED = process.env.LISNA_LLM_INTEGRATION === '1';

afterAll(() => {
  try { execSync('pkill -9 -f llama-completion', { stdio: 'ignore' }); } catch {}
});

describe.skipIf(!HARD_GATED)('Meeting E2E (real LLM, hardware gated)', () => {
  it('produces a valid MeetingNote with diarization-fallback when LISNA_DIAR_INTEGRATION unset', async () => {
    const transcript = /* load 2-speaker fixture */;
    const result = await finalizeMeeting({
      sessionId: 'e2e-meeting',
      transcript,
      diarizationStatus: 'fallback',
      sidecar: /* spawn 3B */,
      modelProfile: /* 3B */,
      promptVariantId: 'meeting-v1',
    });
    expect(result.note.family).toBe('meeting');
    expect(result.note.validation_warnings?.some((w) => /Speaker labels disabled/.test(w))).toBe(true);
    expect(result.note.decisions.length + result.note.next_steps?.length || 0).toBeGreaterThan(0);
  }, 240_000);

  it.skipIf(process.env.LISNA_DIAR_INTEGRATION !== '1')('produces speaker-aware MeetingNote with real diarization', async () => {
    /* run real sherpa-onnx, then finalizeMeeting */
    expect(result.note.participants?.length).toBeGreaterThanOrEqual(2);
  }, 360_000);
});
```

- [ ] **Step 2: Run** without env — expect SKIP. With `LISNA_LLM_INTEGRATION=1` — expect PASS (fallback path). With both envs — expect PASS (diarization path).

- [ ] **Step 3: Commit.**

```bash
git add desktop/src/integration/meeting-e2e.test.ts \
        desktop/src/integration/fixtures/meeting-2spk-3min.transcript.json
git commit -m "test(v2-meeting): hardware-gated E2E (fallback + diarization paths)"
```

### Task 13: Verification gate

**Goal:** Run the full verification cycle before declaring Plan 5 DONE.

- [ ] **Step 1: Typecheck** — `pnpm exec tsc --noEmit`.
- [ ] **Step 2: Meeting test sweep** — `pnpm exec vitest run src/shared/families/meeting/ src/main/diarization/ src/main/sidecar/meeting-orchestrator.test.ts src/renderer/components/SpeakerChip.test.tsx`.
- [ ] **Step 3: Regression** — Plan 3 Lecture tests + Phase 0 spike tests still pass.
- [ ] **Step 4: Hardware-gated smoke** — `LISNA_LLM_INTEGRATION=1 pnpm exec vitest run src/integration/meeting-e2e.test.ts` (at least fallback path).
- [ ] **Step 5: Self-review** (checklist below).
- [ ] **Step 6: VERDICT.md update** for Plan 5 completion.
- [ ] **Step 7: Commit verdict** — `docs(v2-meeting): Plan 5 verification gate cleared`.

---

## Self-review checklist

- [ ] `MeetingNote` schema matches spec §3.4 exactly (decisions, conclusions, proposals, next_steps, open_questions, risks_or_concerns, topic_arc, discussions, agenda, atmosphere, executive_summary, participants).
- [ ] All Meeting arrays carry `.max(N)` per Path G.
- [ ] System prompt enforces semantic distinction (decision vs conclusion vs proposal vs next_step) — 4 explicit definitions + JA triggers (合意/結論として/提案/タスク).
- [ ] Speaker map injected via `chunkUserTemplate` for every chunk; LLM emits integer SpeakerRef (validated by closure check).
- [ ] No literal placeholder exemplars in prompt (no canned 「タスクA」 or 「次のステップを決定する」).
- [ ] `MergeStrategy` matches spec §5.2b Meeting exactly (concat-only on topic_arc/discussions, concat-dedup on the rest).
- [ ] Diarization fallback path tested — `degradeToSingleSpeaker` produces a 1-speaker transcript with the user-visible warning bubbled into `validation_warnings`.
- [ ] `applySpeakers()` heuristic correct: pick the speaker turn with > 50% overlap of the segment's ts range; defensive for legacy segments lacking `endTs`.
- [ ] Orchestrator branch reuses Plan 3 patterns (`runPostDecodePipeline`, `deterministicMerge`, `runGrammarCallWithRetry`).
- [ ] `session/finalize` IPC dispatches Meeting; Interview / Brainstorm still throw "not yet implemented" (Plan 6 territory).
- [ ] Renderer is pure (`({note, transcript}) => JSX`), uses `SpeakerChip` for every SpeakerRef render.
- [ ] `SpeakerChip` rename mutates `transcript.speakers[].name` and triggers persist of `transcript.json`.
- [ ] `※ inferred` markers shown on every Provenance-bearing leaf when `from === 'inferred'`.
- [ ] No `§` U+00A7 in user-facing output.
- [ ] `loadNote()` dispatches Meeting + Lecture; future schemaVersion 2 will append to migrations registries.
- [ ] Meeting baseline registered in Plan 7's `evalBaselines`.
- [ ] Hardware-gated E2E runs fallback path cleanly; diarization path optional but documented.
- [ ] All commits use allowed conventional-commits prefixes.

---

## Next plan dependencies

Plan 6 (Interview / Brainstorm / merge-LLM) unblocks once:
- [ ] Task 2 lands (FamilyRegistry pattern; Interview/Brainstorm follow)
- [ ] Task 4 lands (MergeStrategy pattern with `concat-dedup`; Interview/Brainstorm extend with `merge-llm` overrides per spec §5.2b)
- [ ] Task 6 lands (orchestrator branch pattern; Interview/Brainstorm add their branches + merge-LLM-call between per-chunk loop and final merge)
- [ ] Task 7 lands (`applySpeakers`; Interview/Brainstorm reuse)
- [ ] Task 8/9 land (renderer pattern + SpeakerChip; both reused)

Plan 7 (Eval harness) gets one more frozen baseline (Meeting). Plan 7's Meeting judge (Task 10 in Plan 7) can be implemented as soon as Plan 5 Task 11 lands.

Plan 4 (Diarization) — Plan 5 is a primary consumer. Plan 5 Task 5/7 work with both `DIARIZATION_ENABLED=true` (Plan 4 runtime) and `DIARIZATION_ENABLED=false` (Plan 4 not landed runtime — fallback). Plan 5 design freezes BEFORE Plan 4 runtime lands; integration test (Task 12) optionally runs with diarization on.

---

## Open questions / decisions deferred to execution

1. **Speaker turn merging across chunks** — sherpa-onnx outputs per-chunk speaker turns. The orchestrator concatenates them across chunks but speaker IDs are local to each chunk. Plan 5 Task 7 assumes `apply-speakers.ts` receives globally-numbered turns; the global-numbering step is Plan 4's responsibility (Plan 4 Phase B `diarize-engine` runs a single online-clustering pass across the whole session). Plan 5 documents this dependency.

2. **Atmosphere classification accuracy** — `atmosphere` is a 4-value enum. 3B may not reliably classify; consider whether to mark it as `inferred` always (since it's never literally stated in transcript). For alpha, accept as-is; Plan 7 measures atmosphere accuracy as a separate eval axis.

3. **Decisions dedup heuristic** — trigram Jaccard > 0.7 on `text`. Two semantically-similar decisions ("ABCを採用" / "ABCで進める") may NOT clear the trigram threshold (different surface form). Plan 7 Meeting judge measures this; if false-negative dedup is too common, consider escalating to embedding-based similarity in v2.1.

4. **Renderer rendering of empty sections** — same as Plan 3; if all top-level arrays are empty, show "minimal meeting note" hint per spec §5.3 fallback.

5. **`SpeakerChip` rename UX on legacy notes** — if a user opens a v2-rendered note and renames Speaker 1, the note JSON is untouched (only `transcript.json` mutates per spec §5.3). When re-rendering, the new name propagates everywhere. If `transcript.json` is missing (corrupted), `SpeakerChip` falls back to `話者${id}` with a debug log — not a user-blocking error.

6. **`agenda` extraction reliability** — explicit agenda extraction is hard on JA business meetings where agenda often isn't explicit ("じゃあ、今日は何の話?"). Prompt allows omission; renderer hides the section when empty.

---

## Hardware safety summary

| Task | LLM touched? | Discipline |
|---|---|---|
| 0-7, 9-11, 13 | NO (mocked or pure) | Standard unit-test |
| 8 (renderer) | NO | DOM probes via @testing-library |
| 12 (E2E) | YES (real 3B + optional sherpa-onnx) | `LISNA_LLM_INTEGRATION=1` + `LISNA_DIAR_INTEGRATION=1` gates + `afterAll pkill` + foreground vitest + post-task `ps` check |

All real-LLM activity gated behind explicit env. `(spike-llm)` rule applies to Task 12.

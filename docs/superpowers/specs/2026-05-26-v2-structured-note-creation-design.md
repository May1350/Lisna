# Lisna v2 — Structured Note Creation Design

**Status**: APPROVED — spec-reviewer round 2 (2026-05-26)
**Brainstorm session**: 2026-05-25 / 2026-05-26
**Reviewers**:
- product-reviewer (round 1, 2026-05-25)
- llm-systems-reviewer (round 1, 2026-05-25)
- structure-reviewer (rounds 1 + 2, 2026-05-25 / 2026-05-26) — APPROVED round 2
- spec-reviewer (rounds 1 + 2, 2026-05-26) — APPROVED round 2

**Plan-author risks to keep top-of-mind** (from spec-reviewer round 2):
1. **Spike 7.4 (`zod-to-gbnf` converter) is on the critical path** — sequence as Phase 1 hard go/no-go gate. Every Zod construct the schemas use (DiscriminatedUnion for extras, post-decode marker stripping, recursive cluster shapes) must round-trip cleanly.
2. **Merge LLM call for Interview/Brainstorm is the highest single quality risk** — input is structured JSON, output is structured JSON; 3B's behavior in this distribution is empirically unmeasured. Add a merge-specific spike using 3 known-good partials before relying on it; deterministic-everywhere fallback is a 30-min change.
3. **Diarization packaging (§2.4) interacts with existing first-run model picker** (`v2_step5_task1_complete_2026-05-17`) — adding 2 more models on top of LLM+STT is either a 4-model picker UX revision or a separate advanced-features download flow. Make this an early phase decision, not a late surprise.

**Project tag**: F-N-12 (v2 post-alpha note quality)

---

## 1. Goal & yardstick

Lift v2 desktop note generation from current single-shot JA plain-text (`【要点】/【次のアクション】/【決定事項】` × `<pre>` render, [ja-note-v1.ts](desktop/src/main/sidecar/prompts/ja-note-v1.ts)) to a **situation-aware, structured, modifiable** note pipeline. Four conversation types ("families") with optimized schemas, live speaker diarization with user-assignable names, chunked-at-end LLM processing that never loses information to context limits, and an extensibility infrastructure that makes future iteration (new family, new prompt, new model, new slot) a single-folder change.

PRD §Concept anchor: *"every spoken sound, structured on the user's own device."* This spec realises the **structured** half of that concept; STT + diarization realise the *spoken sound* and *on the user's own device* halves.

PRD §Stack stage: v2 = desktop native, on-device primary. All decisions in this spec respect on-device constraints (M1 8GB floor, no cloud fallback for note generation).

---

## 2. Locked architectural decisions

These were settled in brainstorming and are not open for re-litigation inside this spec. Reasons captured for future readers.

### 2.1 Four-family taxonomy
Six audio situations the user identified (LMS lecture, in-room lecture, video conference, in-room meeting, 1:1 interview, brainstorm) collapse into four note families:

- **Lecture** — single-speaker academic content (LMS + in-room collapse: same note shape, different audio source)
- **Meeting** — multi-speaker business meeting (video-conf + in-room meeting collapse)
- **Interview** — 1:1 Q&A (channel-agnostic)
- **Brainstorm** — small-group ideation (decision-free by design)

**Not in scope**: personal dictation, phone calls, podcast-style content. User explicitly excluded these; can be added later via FamilyRegistry (see §4.8).

### 2.2 User picks family at Stop (post-recording)
After Stop, while STT unloads and LLM loads (~3-5s combined), the user sees a 4-button family picker. Their selection is latency-overlapped with model load — no perceived friction. **Not auto-detected**: classifier complexity not justified when the user has perfect knowledge at recording end.

**Edge cases**:
- *Very short recording (< 30s)*: still show picker. Result will be small (single chunk, ≤ N seconds of transcript) but schema is identical.
- *User dismisses picker without choosing* (Esc / window close / app crash during picker): orchestrator falls back to last-used family, or `lecture` on first use. Recorded in `generatedBy` metadata as a `defaulted: true` flag so eval can filter.
- *User re-picks after note is generated*: covered in non-goals §9 (alpha = run pipeline again with new family; v2.1 = cached-transcript reuse).

### 2.3 Chunked-at-end LLM processing
Recording runs STT + diarization only (no LLM). At Stop, the LLM processes the transcript in **token-budget chunks (~8K each)**, with chunk boundaries snapped to silence (>1.5s) within ±30s of the threshold. Each chunk → partial structured JSON. If multiple chunks: a final merge LLM call combines partials into the cohesive note.

**Why not rolling-during-recording (X2 variant from brainstorming)**: on M1 8GB, STT and LLM cannot coexist. Rolling = repeated swap = 15-25s STT pause every 10 min during recording. Chunked-at-end concentrates the cost in one post-Stop block where the user is already in "wait for result" mode. Trade-off: ~60-110s post-Stop for a 60-min Meeting recording, vs 6× 15-25s during recording. The concentrated cost is far less disruptive than recurring pauses.

**16GB+ Mac path**: STT + LLM can coexist. Eventual optimization = run merge LLM in parallel with continued STT (post-Stop, for the trailing audio buffer). Out of scope for alpha.

### 2.4 Diarization runs always-parallel during recording
sherpa-onnx + pyannote-segmentation-3.0 + 3D-Speaker eres2net (or NeMo TitaNet small as fallback). Online clustering with ~10-30s warm-up. Speaker labels visible in live captions; user can inline-edit a speaker label (`Speaker 1 ✎ → 田中`) and the new name propagates to all past and future captions sharing that speaker ID.

**Family is not known during recording** (Flow 5: picker at Stop, §2.2). Therefore diarization always runs during recording, regardless of what family the user eventually picks. If the user picks Lecture at Stop and diarization produced only one speaker centroid anyway (single-speaker reality), the schema records `speakers: [{id: 0}]` and renderer simply doesn't show speaker chips.

**`NoOpDiarization` use case**: testing / future feature where the user marks "this will definitely be single-speaker" before recording (opt-in performance switch). Not part of the default alpha flow.

**Phase 0 spike required**: JA performance of sherpa-onnx models is not empirically verified. Spike runs 3 JA fixtures (2-speaker / 4-speaker / 6-speaker) and measures DER, warm-up time, chunk latency, RAM. Acceptance: DER < 15%, warm-up < 30s, chunk latency < 1s. Fallback paths documented in §7.

**Packaging**: diarization models (~60-150MB total: segmentation 13MB + embedding 25-150MB) ship via the existing first-run model picker flow (§5.1 from `v2_step5_task1_complete_2026-05-17` memory). Either bundled with the DMG (one-shot install) or downloaded after STT/LLM pick — decision deferred to plan stage. Storage budget: ≤ 200MB additional vs current alpha.

### 2.5 Output format: grammar-constrained JSON
LLM emits structured JSON validated by family-specific Zod schemas. llama.cpp `--grammar` flag enforces JSON validity at decoding time (output is *guaranteed* parseable regardless of model size). Content quality is model-bound (3B is at the lower end of reliability for structured output, but grammar removes the format-validity dimension of risk entirely).

**Default model**: Llama 3.2 3B Q4_K_M (current v2 alpha). Model swap is a ModelProfile lookup (§4.10) — no pipeline rewrite.

### 2.6 Inline-edit speaker rename UX
Live caption rows show speaker label as a clickable chip (`Speaker 1 ✎`). Click → inline input → type name → all past and future segments with that speaker_id render with the new name immediately. Centroid (the diarization speaker embedding) ↔ name mapping is durable; even if diarization confidence drops, the label assignment is by centroid distance.

### 2.7 Provenance computed post-hoc, not LLM-emitted
v1 backend observation (gpt-4o-mini, 2026-05-16): 17/17 items labeled `from: 'transcript'`, 0 `inferred`. 3B is expected to be worse. **Decision**: do not ask the LLM to emit `from`. Instead, after LLM decode, run a pure function `computeProvenance(item, transcript, config)` that checks if `item.ts` falls within any transcriptSegment ±3s (configurable). Inside → `transcript`. Outside or `ts` missing → `inferred`.

This preserves the UX value (visual marker distinguishing AI-supplied content from speaker-spoken content) without forcing the LLM to make a judgement it cannot reliably make.

### 2.8 Grammar schema ⊂ Validated-note schema (post-decode enrichment)
A consequence of §2.7 and §3.6 (Brainstorm `idea.id: string` UUID post-decode): the schema the LLM sees (via GBNF grammar) is a **strict subset** of the schema `loadNote()` returns. Two surfaces, one Zod source of truth.

**Implementation**: Zod fields meant only for post-decode use are tagged via `.meta({ postDecodeOnly: true })`. The `zod-to-gbnf` converter strips any field with that meta marker. The `loadNote()` validator runs post-decode transforms — `computeProvenance()` fills `from` on every leaf with a `ts`; a UUID assigner stamps `BrainstormNote.idea_clusters[].ideas[].id` — and then runs Zod parse against the full schema (with `from` and `id` now present).

```typescript
// shared/note-schema/base.ts
const ProvenanceSchema = z.enum(['transcript', 'inferred']).meta({ postDecodeOnly: true });
const IdeaIdSchema = z.string().meta({ postDecodeOnly: true });

// In each leaf with provenance:
const KeyTerm = z.object({
  term: z.string(),
  definition: z.string(),
  ts: z.number(),
  from: ProvenanceSchema,  // grammar: ABSENT. post-decode: FILLED.
});

// loadNote() flow:
//   1. parse raw LLM JSON against GRAMMAR-schema (no `from`, no `id`)
//   2. fill `from` via computeProvenance for every leaf with ts
//   3. fill `id` via uuid() for every Brainstorm idea
//   4. parse against FULL-schema (now valid)
//   5. run referential closure superRefine (clamp violations)
```

**Why this approach**: keeps "Zod single source of truth" (§4 #2) intact. The two schemas are mechanically derived from one Zod definition — no parallel maintenance. The `postDecodeOnly` marker is the explicit fork point.

---

## 3. Schema design

All schemas are Zod-defined in `shared/note-schema/` (see §4 for file structure). Below shows the TypeScript-equivalent shape; the canonical source is Zod.

### 3.1 NoteBase (common to all four families)

```typescript
interface NoteBase {
  schemaVersion: number;                  // migration anchor
  family: 'lecture' | 'meeting' | 'interview' | 'brainstorm';
  title: string;                          // LLM-extracted from transcript
  generatedAt: string;                    // ISO datetime
  generatedBy: { model: string; promptVersion: number };
  language: 'ja' | 'en' | 'ko';
  durationSec: number;
  experimentArmId?: string;               // e.g. 'prompt-ab-2026-06' — longitudinal anchor (see lifecycle note below)
  validation_warnings?: string[];         // user-visible: short human-readable summaries of significant clamps (e.g. "Dropped 2 invalid speaker references"). Empty/undefined for clean notes.
}
// `experimentArmId` lifecycle: assigned by orchestrator at generation time as `${ModelProfile.id}/${PromptVariant.variantId}` by default;
// overridden via env var `LISNA_EXPERIMENT_ARM_ID` when running formal experiments. Persisted with the note; never mutated post-write.
// `validation_warnings` (user-facing) vs `GenerationTelemetry.validationWarnings` (ops, verbose) vs `GenerationTelemetry.postDecodeMutations` (ops, structured per-field log):
//   - `NoteBase.validation_warnings` = renderer may show as a subtle "AI cleaned up some fields" hint
//   - `telemetry.validationWarnings` = full text log for debugging
//   - `telemetry.postDecodeMutations` = structured `{field, reason}` for filtering/reporting
```

**Sibling artifacts** (NOT inside the note):

```typescript
// session.transcript.json — durable source of truth, never re-LLM'd
interface SessionTranscript {
  sessionId: string;
  speakers: { id: number; name?: string }[];   // diarization + user-assigned
  transcriptSegments: {
    ts: number;
    text: string;
    speakerId: number;
    meta?: Record<string, unknown>;             // extensible for future hook metadata (e.g. noSpeechProb, marker flags)
  }[];
}

// session.telemetry.json — generation observability
interface GenerationTelemetry {
  noteId: string;
  modelId: string;                              // ModelProfile.id
  promptVariantId: string;                      // PromptVariant.variantId
  schemaVersion: number;
  generationStartedAt: string;
  generationDurationMs: number;
  chunkCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  validationWarnings: string[];
  dedupHits: { field: string; count: number }[];
  postDecodeMutations: { field: string; reason: string }[];
}
```

**Filesystem layout** (locked per concern #3 / NH-1):
```
~/Library/Application Support/@lisna/desktop/sessions/<sessionId>/
├── note.json
├── transcript.json
├── telemetry.json
└── audio.wav   (optional — retention policy is an open question, §10.2)
```

Folder-per-session: future additions (`attachments/`, `audio.wav` if retained) land naturally without restructuring.

### 3.2 PurposeDrivenNote (Meeting / Interview / Brainstorm shared)

```typescript
interface PurposeDrivenNote extends NoteBase {
  purpose: string;                              // WHY this conversation happened (1-2 sentences)
  conclusions?: { text: string; ts?: number; from: Provenance }[];   // insights distinct from decisions
  next_steps?: {
    text: string;
    owner?: SpeakerRef;
    due?: string;                               // free-text date hint
    ts: number;
    from: Provenance;
  }[];
}

type SpeakerRef = number;                       // references SessionTranscript.speakers[].id
type Provenance = 'transcript' | 'inferred';   // computed post-hoc
```

Lecture extends `NoteBase` directly — lectures are not "purpose-driven" in the conversational sense (lecturer educates, doesn't seek decisions).

### 3.3 LectureNote

```typescript
interface LectureNote extends NoteBase {
  family: 'lecture';
  course?: string;
  lecturer?: string;
  tldr?: string;                                // 1-2 sentence whole-lecture summary
  sections: {
    heading: string;
    ts: number;
    summary: string;
    takeaway?: string;                          // 1-line core point
    key_terms: { term: string; definition: string; ts: number; from: Provenance }[];
    examples: { text: string; ts: number; from: Provenance }[];
    points: { text: string; ts: number; important: boolean; from: Provenance }[];
    extras?: SlotInstance[];                    // discriminated union over registered Lecture slots
  }[];
}

// extras is plug-able via shared/families/lecture/slots/*.ts
// Initial slots registered:
//   - procedure_steps (簿記·math·code lecture)
//   - argument_chain  (philosophy·strategy)
//   - formula         (math·physics·accounting)
//   - timeline        (history·narrative)
//
// Static-grammar semantics (per §4 P2): the GBNF grammar always allows
// every registered slot type. Slot.triggers strings affect only which
// prompt hints get *injected* into the system prompt for that session,
// not the grammar surface. This keeps grammar regen cost zero.
```

**Cut from earlier drafts** (per Reviewer 1 + 2):
- `related_lectures` — 3B has no semantic recall capability across sessions
- `check_question` — study-mode bias; users wanted notes, not quizzes
- `related_terms` per section — same reason as `related_lectures`

### 3.4 MeetingNote

```typescript
interface MeetingNote extends PurposeDrivenNote {
  family: 'meeting';
  executive_summary: string;                    // 2-3 sentences — bigger-picture narrative
  agenda?: string[];                            // extracted if explicit
  participants?: { speakerRef: SpeakerRef; role?: string }[];   // name + role ("PM", "QA lead")
  topic_arc: { topic: string; ts: number; speakers_involved: SpeakerRef[] }[];
  discussions: { topic: string; ts_start: number; ts_end?: number; summary: string; key_points?: string[] }[];
  decisions: { text: string; rationale?: string; ts: number; made_by?: SpeakerRef; from: Provenance }[];
  proposals?: { text: string; proposed_by?: SpeakerRef; ts: number; outcome?: 'accepted'|'rejected'|'deferred'|'open'; from: Provenance }[];
  open_questions: { text: string; ts: number; asked_by?: SpeakerRef; from: Provenance }[];
  risks_or_concerns?: { text: string; raised_by?: SpeakerRef; ts: number; from: Provenance }[];
  atmosphere?: 'collaborative' | 'tense' | 'enthusiastic' | 'neutral';
  // action_items folded into PurposeDrivenNote.next_steps
}
```

**Semantic differentiation** (in prompt + UI):
- `decisions` = explicit choices made
- `conclusions` (inherited) = insights/findings distinct from decisions
- `proposals` = suggestions before convergence (may or may not become decisions, tracked via `outcome`)
- `executive_summary` = bigger-picture narrative recap
- `next_steps` (inherited) = concrete actions assigned

These four touch overlapping territory and the prompt must enforce the distinction. Reviewer 1 flagged the collision risk; resolution = strict semantic rules in prompt + concrete examples in few-shot.

**Cut**:
- `quotable_lines` from Meeting (kept on Interview only) — Meeting's `decisions.rationale` captures notable phrasing

### 3.5 InterviewNote

```typescript
interface InterviewNote extends PurposeDrivenNote {
  family: 'interview';
  // Schema field name = `conclusions` (inherited from PurposeDrivenNote, consistent across families).
  // UI label for Interview specifically = "Interviewer observations" with an explicit
  // "AI-derived, user-editable" badge. This linguistic framing bounds bias/legal risk
  // in hiring contexts without forking the schema.
  subject_summary: string;
  participants?: { speakerRef: SpeakerRef; role: 'interviewer' | 'interviewee' }[];
  qa_pairs: {
    question: string;
    answer: string;
    ts: number;
    asked_by: SpeakerRef;
    answered_by: SpeakerRef;
    themes?: string[];                          // tag list
    from: Provenance;
  }[];
  themes: { name: string; description?: string; appears_at_ts: number[] }[];
  quotable_lines: { text: string; speakerRef: SpeakerRef; ts: number; why_notable?: string }[];
  key_takeaways: { text: string; from: Provenance }[];
  // biographical[] cut — résumé covers it; 3B unreliable at extracting personal facts
}
```

### 3.6 BrainstormNote

```typescript
interface BrainstormNote extends PurposeDrivenNote {
  family: 'brainstorm';
  // inherited `purpose` acts as the brainstorm prompt/question
  idea_clusters: {
    theme: string;
    ideas: {
      id: string;                               // UUID assigned post-decode (3B can't generate unique ints)
      text: string;
      contributed_by?: SpeakerRef;
      ts: number;
      from: Provenance;
    }[];
  }[];
  parking_lot?: { text: string; ts: number; from: Provenance }[];
  atmosphere?: 'collaborative' | 'energetic' | 'subdued';
  // builds_on, cross_connections cut from v1 — both need embedding-based similarity which is v2.1 R&D
  // intentionally no `decisions` — brainstorm is divergent by nature
}
```

---

## 4. Modifiability infrastructure (15 pieces + 8 polish)

The user's explicit mandate: *"future improvements to note creation methods must be EASY and SAFE."* The infrastructure below makes a single-folder or single-config change the path for the 95% of future iterations.

### 4.0 Core interfaces (load-bearing contracts)

These TypeScript interfaces are the primary surfaces the modifiability story rests on. All other §4 pieces reference these. Plan author should implement these first (Phase 1 candidates).

```typescript
// shared/families/util/prompts.ts
export interface PromptVariant {
  version: number;                    // monotonic per family
  variantId: string;                  // e.g. 'v1-baseline', 'v2-experimental'
  systemTemplate: string;             // injected into LLM system role
  chunkUserTemplate: string;          // per-chunk user role; receives transcript slice
  mergeUserTemplate: string;          // for merge call; receives partial JSONs
  exemplars?: ChatMessage[];          // optional few-shot
  recommendedTemp: number;
  notes: string;                      // human-readable changelog/intent
}

// shared/families/util/slot.ts
export interface SlotDefinition<T> {
  type: string;                       // unique within family (e.g. 'timeline')
  schema: z.ZodType<T>;
  renderer: ComponentType<{ items: T[] }>;
  promptHint: string;                 // injected into systemTemplate when slot is active
  triggers?: string[];                // optional regex strings — affects promptHint injection ONLY,
                                      // NOT grammar surface (grammar always allows all registered slots)
}

// shared/families/index.ts
export type NoteFamily = 'lecture' | 'meeting' | 'interview' | 'brainstorm';

export interface FamilyDefinition<T extends NoteBase> {
  id: NoteFamily;
  schema: z.ZodType<T>;               // full validated-note schema; converter derives grammar subset
  prompts: PromptVariant[];           // available variants
  defaultPromptVariant: string;       // variantId, fallback when env/setting not set
  renderer: ComponentType<{ note: T }>;          // PURE: (note) => JSX. Zero IPC, fetch, LLM access.
  streamingRenderer?: ComponentType<{ partial: Partial<T> }>;  // reserved for future, see P5
  picker: {
    labelKey: string;                 // i18n key
    icon: ComponentType;              // SVG component
    descriptionKey: string;
    visibility: 'production' | 'experimental';
  };
  evalBaselines: string[];            // fixture IDs validated at harness startup (see P4)
  inferProvenance?: ProvenanceComputer;  // optional family-level override of default (see §4 P8)
  slots?: SlotDefinition<unknown>[];  // present for families with extras (Lecture only at alpha)
  mergeStrategy: MergeStrategy;       // see §5.2b
}

export type ProvenanceComputer = (
  item: { ts?: number },
  transcript: SessionTranscript,
  config?: ProvenanceConfig,
) => Provenance;

export type ValidatedNote = LectureNote | MeetingNote | InterviewNote | BrainstormNote;
// (return type of loadNote() after migration + post-decode enrichment + closure validation)

// shared/models/profiles.ts
export interface ModelProfile {
  id: string;                         // e.g. 'llama-3.2-3b-q4-km'
  displayName: string;                // user-facing
  filename: string;                   // for model-resolver / sidecar load
  chatTemplate: 'llama-3.2' | 'qwen-2.5' | 'phi-3.5' | 'auto';
  contextWindow: number;              // n_ctx for sidecar
  recommendedChunkTokens: number;     // pipeline reads this for chunking budget
  grammarDialect: 'llama-cpp' | 'llama-cpp-strict';   // for future llama.cpp variants
  bosTokenFix?: 'dormant-bos';        // workarounds, per project_metal_cold_cache_first_run memory
  recommendedTemp: number;
  warmupRequired: boolean;            // sidecar runs warmup generation if true
  ramBudgetMB: number;                // for tier selection (8GB vs 16GB+)
}

// shared/engine-interfaces.ts (extends existing STTEngine + LLMEngine)
export interface DiarizationEngine {
  loadModel(segmentationPath: string, embeddingPath: string): Promise<void>;
  unloadModel(): Promise<void>;
  /**
   * Process a 10s audio chunk + STT segments from the same chunk.
   * Returns segments with speakerId assigned (online clustering).
   * Caller is responsible for re-ordering/coalescing across chunks.
   */
  processChunk(
    audio: Float32Array,
    sttSegments: TranscriptSegment[],
  ): Promise<SpeakerLabeledSegment[]>;
}

export interface SpeakerLabeledSegment extends TranscriptSegment {
  speakerId: number;
  tentative?: boolean;                // true during warm-up window
}

// desktop/src/main/sidecar/orchestrator.ts
export interface PipelineHooks {
  // Order of execution (each may be sync or async; default = identity passthrough):
  afterTranscribe?: (segs: TranscriptSegment[]) => TranscriptSegment[] | Promise<TranscriptSegment[]>;
  beforeDiarize?: (segs: TranscriptSegment[]) => TranscriptSegment[];
  afterDiarize?: (segs: SpeakerLabeledSegment[]) => SpeakerLabeledSegment[];
  beforeChunk?: (transcript: SessionTranscript) => SessionTranscript;
  afterLLM?: (parsedJson: unknown, chunkIndex: number) => unknown;   // already JSON.parsed; raw text never passed
  afterValidate?: (note: ValidatedNote) => ValidatedNote;
  afterMerge?: (note: ValidatedNote) => ValidatedNote;
}

// Error semantics: hooks that throw → caught + logged to validation_warnings,
// pipeline continues with pre-hook value. Opt-in fail-fast via hook config (future).
```

These 6 interfaces (PromptVariant, SlotDefinition, FamilyDefinition, ModelProfile, DiarizationEngine, PipelineHooks) are the minimum vocabulary the rest of §4 uses.

### Original 7 pieces

1. **`NoteBase.schemaVersion: number` from day 1.** Every breaking schema change bumps. Persists with the note. Reader switches on version.

2. **Zod is the single source of truth.** All schemas defined in Zod; TypeScript types, JSON Schema (documentation), GBNF grammar, prompt-side schema description, and validator all derive from one canonical source.

3. **`shared/note-schema/zod-to-gbnf.ts` converter** (~150 LOC). Auto-generates llama.cpp grammar from any Zod schema. Runtime-cached in-memory per family. Build-time CI check (`pnpm test:grammar`) verifies every family's generated grammar passes `llama_grammar_init` round-trip.

4. **Versioned migrations.** `migrations: Record<number, (oldNote: any) => any>` — pure functions, applied as v1→v2→…→current chain on read.

5. **Backward-compat read path.** `loadNote(json)` → parse version → run migration chain → validate via Zod. Old notes always readable.

6. **Deprecation grace.** Removed fields stay `.optional()` for 2-3 versions before final removal.

7. **Transcript as sibling artifact.** Note schema changes never churn transcript storage.

### 8 added pieces (round 1 structure review)

8. **`FamilyRegistry`** (`shared/families/index.ts`). Single binding point per family — schema + prompts + renderer + picker + eval baselines + slots. Adding a family = `mkdir shared/families/<name>/` + 1 line in the registry map.

9. **`PromptRegistry`** (per-family `prompts/` folder). Prompts are first-class versioned artifacts. Variant selection runtime order: env var → user pref → family default. No code change for A/B testing.

10. **`ModelProfile` registry** (`shared/models/profiles.ts`). Bundles model-specific concerns: chat template, context window, recommended chunk tokens, grammar dialect, warmup requirement, BOS token fix, recommended temperature. Model swap = profile entry + new gguf shipping.

11. **`DiarizationEngine` interface + `NoOpDiarization` impl.** Mirrors existing `STTEngine` / `LLMEngine`. Lecture family uses `NoOpDiarization` for RAM/battery savings.

12. **Eval harness** (`desktop/eval/`). Fixtures per family/scenario + 3 judges (deterministic, LLM-as-judge, pairwise Bradley-Terry) + runners (single-fixture, family-suite, regression) + scorecard output. CLI: `pnpm eval:notes --family lecture --variant v1-baseline` etc.

13. **Migration test fixtures + `ForwardIncompatNoteError`.** Each migration version has a committed fixture; tests run the chain end-to-end. Forward-version (note from newer app opened in older) returns clear "update Lisna" error.
   **At landing**: `schemaVersion: 1` IS this new structured shape (the framework starts trivial — no migrations registered). The `__tests__/fixtures/v1-{family}-sample.json` files are committed *as part of landing* (one sample per family, hand-curated) so the chain-test infrastructure is exercised from day 1. First actual migration (`v1-to-v2.ts`) lands only when first breaking change ships.
   **Existing v2 alpha notes** (the plain-text `【要点】/【次のアクション】/【決定事項】` format from current `ja-note-v1.ts`) are *not* in the migration chain — they're legacy and handled separately per §10.1 (recommended: coexist as read-only).

14. **`SessionOrchestrator` pipeline hooks.** 7 hook points (afterTranscribe, beforeDiarize, afterDiarize, beforeChunk, afterLLM, afterValidate, afterMerge). Custom transcript pre-processing (PII redaction, abbreviation expansion, etc.) registers as hooks — no orchestrator fork.

15. **Per-slot modularity for Lecture `extras`** (`shared/families/lecture/slots/<slot>.ts`). Each slot has `SlotDefinition` with schema + renderer + prompt hint + (optional) content triggers. Slot triggers affect *prompt hints only* — grammar always permits all registered slots (locked semantics per concern #2).

### 8 polish items (round 2 structure review)

P1. **`TranscriptSegment.meta?: Record<string, unknown>`** — extensible per-segment metadata, no fork when first hook needs to attach data.

P2. **Slot triggers documented as static** — they inject prompt hints; grammar surface includes all registered slots always. Prevents future contributor from inferring dynamic grammar regen.

P3. **Sessions filesystem layout locked**: `sessions/<id>/{note,transcript,telemetry}.json` (folder-per-session). Future `audio.wav` / `attachments/` add naturally.

P4. **`evalBaselines: string[]` validated at harness startup.** Each fixture ID must resolve to an actual fixture directory; CI fails on miss.

P5. **`streamingRenderer?` design note**: reserving the slot is correct, but partial-JSON parsing during grammar-constrained decode is non-trivial (needs `partial-json` lib or GBNF derivation tree streaming). Document that "add streaming renderer" implies "build partial-JSON layer first" so future implementer plans accordingly.

P6. **`NoteBase.experimentArmId?: string`** — single optional tag in base schema. Enables longitudinal filtering ("show all notes from prompt-v2 + Qwen 2.5 combo") via one filter rather than a join. Cheap to add now, painful migration later.

P7. **`ContractTest` per family in eval harness** — deterministic structural assertions (e.g. "Lecture must produce ≥3 sections; each section ≥1 key_term; ≥80% `from:transcript` in key_terms"). Catches mode-collapse failures that LLM-judges miss (the v1 plateau pattern).

P8. **Explicit referential closure rules + `computeProvenance()` as a pure tested function + `ProvenanceConfig`.** All `SpeakerRef` referencing fields validated post-decode; violations dropped + logged to `validation_warnings`; telemetry records the mutation. `computeProvenance` is tested in isolation with table-driven cases.

```typescript
// shared/families/util/provenance.ts
export interface ProvenanceConfig {
  matchWindowSec: number;             // default 3
  emptyTranscriptDefault: Provenance; // default 'inferred' — if transcript has 0 segments
}
const DEFAULT_CONFIG: ProvenanceConfig = { matchWindowSec: 3, emptyTranscriptDefault: 'inferred' };

export function computeProvenance(
  item: { ts?: number },
  transcript: SessionTranscript,
  config: ProvenanceConfig = DEFAULT_CONFIG,
): Provenance {
  if (item.ts === undefined) return 'inferred';            // no anchor → inferred
  if (transcript.transcriptSegments.length === 0) return config.emptyTranscriptDefault;
  // Match if any segment's [ts, ts + estimated_duration] overlaps [item.ts ± window]
  const within = transcript.transcriptSegments.some(seg => Math.abs(seg.ts - item.ts!) <= config.matchWindowSec);
  return within ? 'transcript' : 'inferred';
}
// item.ts === 0 (start of recording) matches the first segment trivially → 'transcript'. Correct.
// Multi-segment overlap → 'transcript' on first hit (no speaker disambiguation at this stage; that's done by SpeakerRef closure validation).
```

### Result

Adding a single field to MeetingNote = edit `shared/families/meeting/schema.ts`. Grammar, types, prompt-side schema description all regenerate automatically. Adding a new family = `mkdir` + 1 registry line. Swapping a model = profile entry + gguf ship. A/B testing prompts = env var + eval comparison. Replacing diarization model = new `DiarizationEngine` impl + injection point swap. Adding a slot = `mkdir slots/<name>.ts` + register.

---

## 5. Pipeline architecture

### 5.1 Recording phase
```
microphone / system audio
  ↓
ChunkAccumulator → 10s WAV chunks
  ↓ (parallel fanout)
  ├─→ STT (kotoba-whisper-v2) ──→ TranscriptSegment[]
  └─→ Diarization (sherpa-onnx + online clustering) ──→ speaker_id per segment
  ↓
SessionTranscript (continuously appended to sessions/<id>/transcript.json)
  ↓
Renderer: live captions UI with speaker chips (inline-rename enabled)
```

Family-aware optimization: if user has *not* picked a family yet (recording-time), diarization always runs. If user has picked family at session start (which they don't in current design), and family = Lecture, NoOpDiarization could be used. **Current decision**: always run diarization during recording (family unknown until Stop).

### 5.2 Stop phase
```
User clicks Stop
  ↓ (parallel)
  ├─→ STT unload (mach_vm reclamation, ~1-2s)
  ├─→ Family picker shown (1-2s user time) — emits family via new IPC session/finalize(family)
  └─→ LLM load (Llama 3.2 3B Q4_K_M with grammar, ~3-5s)
  ↓ (after BOTH: picker resolved AND LLM loaded)
chunkTranscript(transcript, modelProfile.recommendedChunkTokens)
  ↓ (see §5.2a — algorithm)
chunks: SessionTranscript[]
  ↓
for each chunk:
  // Speaker handling: render the chunk transcript with user-assigned names in [Name]: text form,
  // AND inject the globally-resolved speakers[] map ("Speaker 0 = 田中, Speaker 1 = 鈴木, ...") in
  // the system prompt so the LLM can reverse-lookup name → speakerId when emitting SpeakerRef
  // integers in output JSON. Grammar constrains SpeakerRef to known ids; closure validator clamps
  // bad refs post-decode (see §4 P8).
  call LLM with family.prompts[variantId].chunkUserTemplate + chunk → partial JSON
  ↓
if chunks.length > 1:
  merge LLM call (see §5.2b)
else:
  final = partials[0]
  ↓
Post-decode pipeline (per §2.8 grammar ⊂ validated split):
  Stage 1: parse LLM output against GRAMMAR-schema (no `from`, no `id` fields yet)
  Stage 2: fill `id` for Brainstorm ideas (uuid())
  Stage 3: fill `from` via computeProvenance() for every leaf with `ts`
  Stage 4: Zod.parse() against FULL schema with referential closure superRefine (clamp-not-throw, see §4 P8)
  Stage 5: deterministic dedup (trigram Jaccard > 0.7) on decisions/open_questions/key_takeaways
  ↓
LLM unload
  ↓
Persist:
  sessions/<id>/note.json
  sessions/<id>/telemetry.json (already accumulating during pipeline)
  transcript.json (already accumulated during recording)
  ↓
Render: family.renderer({ note: ValidatedNote })
```

**Picker → orchestrator IPC**: a new IPC channel `session/finalize` replaces the current `session/stop` (which currently takes no args, see `desktop/src/main/sidecar/orchestrator.ts:87`). Signature: `session/finalize({ family: NoteFamily, promptVariant?: string }) → Promise<{ noteId: string }>`. The existing `session/stop` is renamed/redirected during migration.

### 5.2a Chunking algorithm (`chunkTranscript`)
**Input**: `SessionTranscript` with `transcriptSegments[]` (each with `ts`, `text`, `speakerId`), `maxTokens: number` (from `modelProfile.recommendedChunkTokens`), `slackSec: number` (default 30).

**Goal**: split the transcript into chunks where each chunk's tokenized length ≤ `maxTokens`, with chunk boundaries preferring natural silence (>1.5s gap between adjacent segments).

```
function chunkTranscript(transcript, maxTokens, slackSec = 30):
  chunks = []
  cursor_idx = 0                                  // start segment index
  while cursor_idx < transcript.segments.length:
    // Greedy: accumulate segments from cursor until tokens exceed budget
    soft_end_idx = findTokenBudgetEnd(cursor_idx, maxTokens)
    if soft_end_idx >= transcript.segments.length - 1:
      // Remaining fits → final chunk
      chunks.push(slice(cursor_idx, transcript.segments.length))
      break

    soft_end_ts = transcript.segments[soft_end_idx].ts
    // Look for a silence > 1.5s within ±slackSec of soft_end_ts
    candidate_silences = findSilenceGaps(transcript, soft_end_ts - slackSec, soft_end_ts + slackSec, minGapSec = 1.5)
    if candidate_silences.length > 0:
      // Snap to closest silence
      best_silence = minBy(candidate_silences, gap => abs(gap.center_ts - soft_end_ts))
      hard_end_idx = indexOfSegmentEndingBefore(best_silence.start_ts)
    else:
      // No silence found — hard cut at soft_end_idx (token budget enforced)
      hard_end_idx = soft_end_idx

    chunks.push(slice(cursor_idx, hard_end_idx + 1))
    cursor_idx = hard_end_idx + 1
  return chunks

// findSilenceGaps: gaps between segment[i].endTs and segment[i+1].ts where gap >= minGapSec
// (endTs derived from segment text length + ts proxy if STT didn't emit explicit end)
```

**Edge cases handled**:
- No silence in ±slack window → hard cut at token budget (slight overshoot acceptable on slack budget)
- Remaining transcript fits in one final chunk → no further splits
- Single-segment transcript shorter than budget → returns `[transcript]` (one chunk, single LLM call, merge skipped)
- Empty transcript → returns `[]` (orchestrator short-circuits; renderer shows "empty session" via existing `EMPTY_TRANSCRIPT` path)

**Tokenizer**: chunks measured against the LLM's tokenizer (loaded with model). For JA, ~0.6 tokens/char; for EN, ~0.25 tokens/char. The tokenizer call is on the sidecar (same binary as model).

### 5.2b Merge contract
The merge call combines N partial JSONs (one per chunk) into a single final note matching the same family schema. **Per-family logic** lives in `FamilyDefinition.mergeStrategy`. The default strategy ("structured merge") is shared across families; overrides specified inline below.

```typescript
export interface MergeStrategy {
  // Top-level scalars (title, executive_summary, purpose, etc.):
  // 'longest' = pick longest non-empty across partials (cheap, no LLM)
  // 'first' = pick from chunk 0 (preserves opening framing)
  // 'merge-llm' = call LLM to synthesize
  scalarPolicy: 'longest' | 'first' | 'merge-llm';

  // Array fields:
  // 'concat-dedup' = concatenate, deterministic dedup via trigram Jaccard > 0.7
  // 'merge-llm' = pass full concatenated array to merge LLM call for semantic dedup
  // 'concat-only' = no dedup (e.g. for inherently ordered arrays like qa_pairs)
  arrayPolicy: 'concat-dedup' | 'merge-llm' | 'concat-only';

  // Ordering policy for arrays with `ts` field:
  sortByTs?: boolean;                  // default true for sections/topic_arc/discussions

  // Per-family overrides for fields with structural semantics:
  fieldOverrides?: {
    [field: string]: {
      policy: 'longest' | 'first' | 'concat-dedup' | 'concat-only' | 'merge-llm' | 'custom';
      handler?: (partials: any[]) => any;   // for 'custom'
    };
  };
}

// Default per-family strategies (alpha):
// Lecture:
//   scalarPolicy: 'longest', arrayPolicy: 'concat-dedup', sortByTs: true
//   fieldOverrides:
//     sections: { policy: 'concat-only', sortByTs: true }  // sections are unique per ts range
//     extras: { policy: 'concat-dedup' }                    // dedup typed slots across chunks
// Meeting:
//   scalarPolicy: 'longest', arrayPolicy: 'concat-dedup'
//   fieldOverrides:
//     topic_arc: { policy: 'concat-only', sortByTs: true } // arc is temporal
//     discussions: { policy: 'concat-only', sortByTs: true }
//     decisions: { policy: 'concat-dedup' }
//     proposals: { policy: 'concat-dedup' }
//     action_items (next_steps): { policy: 'concat-dedup' }
// Interview:
//   scalarPolicy: 'longest', arrayPolicy: 'concat-dedup'
//   fieldOverrides:
//     qa_pairs: { policy: 'concat-only', sortByTs: true }   // Q&A order matters
//     themes: { policy: 'merge-llm' }                       // semantic clustering of themes across chunks
// Brainstorm:
//   scalarPolicy: 'longest', arrayPolicy: 'concat-only'
//   fieldOverrides:
//     idea_clusters: { policy: 'merge-llm' }                // cluster merging needs LLM (clusters with similar themes across chunks)
```

**Decision rationale**: the spec deliberately defaults most merging to **deterministic** (`concat-dedup` + `longest`) rather than LLM-based. Reasons: (a) determinism = no second-LLM-call cost for typical sessions; (b) 3B is unreliable at meta-merge tasks; (c) reviewer 2 (round 1) flagged LLM-based dedup as lossy (loses nuance). Only `themes` (Interview) and `idea_clusters` (Brainstorm) use `merge-llm` because semantic clustering is the explicit core value of those fields.

**Merge LLM call (only when at least one field uses `merge-llm`)**:
- Input: serialized partial JSONs concatenated (only for the fields requiring merge-llm)
- Prompt: `family.prompts[variantId].mergeUserTemplate`
- Grammar: SAME family schema (full validated-note grammar)
- Output: merged note JSON; deterministic fields populated from partials, `merge-llm` fields populated from this call

**For Lecture & Meeting (no `merge-llm` overrides)**: zero second LLM call. Final merge is pure deterministic. Latency ≈ 0.

**For Interview / Brainstorm**: one additional LLM call (~5-12s) at the merge stage. Documented in latency budgets.

### 5.3 Render phase

```
loadNote(json):
  parse schemaVersion
  if schemaVersion > CURRENT → throw ForwardIncompatNoteError (UI shows "update Lisna")
  if schemaVersion < CURRENT → run migration chain v(n)→v(n+1)→...→v(CURRENT)
  Zod.parse() against current family schema with referential closure check
  return ValidatedNote
  ↓
loadTranscript(json) — sibling file, separate load. Renderer receives both via session loader:
  { note: ValidatedNote, transcript: SessionTranscript } = loadSession(sessionId)
  ↓
family.renderer({ note, transcript }) — pure ({ note, transcript }) => JSX. Zero IPC, zero fetch, zero LLM access.
```

**Speaker resolution at render time**: `SpeakerRef` values in the note are *integer indices* into `SessionTranscript.speakers[].id`. Renderer dereferences at JSX time — if the user renames Speaker 1 → 田中 in a re-opened note, it mutates `transcript.speakers[1].name`, the renderer re-runs, and every `made_by: 1` / `asked_by: 1` / etc. instantly displays "田中". The note JSON itself never embeds the name string. This makes renames cheap and consistent. (If the speaker is removed from transcript — never expected — the renderer falls back to "Speaker {id}" with a debug log.)

### 5.4 Pipeline hook points
(Canonical typed signatures in §4.0 `PipelineHooks`.) Registered at app boot, applied in pipeline:
- `afterTranscribe` — operate on STT output before diarization
- `beforeDiarize` / `afterDiarize` — bracketing diarization
- `beforeChunk` — operate on full SessionTranscript before chunking
- `afterLLM(rawJson, chunkIndex)` — operate on raw LLM JSON per chunk
- `afterValidate(note)` — operate on validated note
- `afterMerge(note)` — operate on merged note before persist

Use cases: PII redaction, abbreviation expansion, domain-specific normalization, custom dedup rules.

---

## 6. File structure

```
shared/
├── note-schema/
│   ├── base.ts                  # NoteBase, SpeakerRef, Provenance, ProvenanceSchema
│   ├── transcript.ts            # SessionTranscript
│   ├── telemetry.ts             # GenerationTelemetry
│   ├── migrations/
│   │   ├── index.ts             # MigrationChain runner
│   │   ├── v1-to-v2.ts          # (placeholder until first breaking change)
│   │   └── __tests__/
│   │       ├── fixtures/
│   │       │   ├── v1-lecture-sample.json
│   │       │   ├── v1-meeting-sample.json
│   │       │   ├── v1-interview-sample.json
│   │       │   └── v1-brainstorm-sample.json
│   │       └── migration-chain.test.ts
│   ├── validators/
│   │   ├── referential.ts       # SpeakerRef closure, ts bounds, ts_start ≤ ts_end
│   │   └── ts-bounds.ts
│   ├── zod-to-gbnf.ts           # runtime converter, cached per family
│   └── index.ts                 # loadNote(), ForwardIncompatNoteError, family discriminated union
├── families/
│   ├── index.ts                 # families: Record<NoteFamily, FamilyDefinition<any>>
│   ├── util/
│   │   ├── provenance.ts        # computeProvenance() + ProvenanceConfig
│   │   ├── prompts.ts           # PromptVariant type + selection logic
│   │   └── slot.ts              # SlotDefinition
│   ├── lecture/
│   │   ├── schema.ts            # LectureNoteSchema (Zod)
│   │   ├── prompts/
│   │   │   ├── v1-baseline.ts
│   │   │   └── (future variants)
│   │   ├── renderer.tsx
│   │   ├── slots/
│   │   │   ├── procedure-steps.ts
│   │   │   ├── argument-chain.ts
│   │   │   ├── formula.ts
│   │   │   └── timeline.ts
│   │   ├── eval-baselines.ts    # fixture IDs registered for this family
│   │   └── index.ts             # LECTURE_FAMILY: FamilyDefinition<LectureNote>
│   ├── meeting/                 # (same shape, no slots/ folder)
│   ├── interview/               # (same shape, no slots/ folder)
│   └── brainstorm/              # (same shape, no slots/ folder)
├── models/
│   └── profiles.ts              # modelProfiles: Record<string, ModelProfile>
└── engine-interfaces.ts         # STTEngine + LLMEngine + DiarizationEngine

desktop/
├── src/main/sidecar/
│   ├── orchestrator.ts          # SessionOrchestrator + PipelineHooks
│   └── engines/
│       └── noop-diarization.ts  # for Lecture single-speaker fast path
├── eval/
│   ├── fixtures/
│   │   ├── lecture/<scenario>/{transcript.json, meta.json, baselines/}
│   │   ├── meeting/<scenario>/
│   │   ├── interview/<scenario>/
│   │   └── brainstorm/<scenario>/
│   ├── judges/
│   │   ├── deterministic-judge.ts     # contract tests + schema validity + slot coverage
│   │   ├── llm-judge.ts                # cross-vendor LLM-as-judge
│   │   └── pairwise-judge.ts           # Bradley-Terry
│   ├── runners/
│   │   ├── single-fixture.ts
│   │   ├── family-suite.ts
│   │   └── regression.ts
│   └── scorecard.ts
└── scripts/eval-notes.ts        # CLI entry
```

---

## 7. Phase 0 spike — empirical validation before commit

Several architectural assumptions need empirical verification before locking implementation. Do these BEFORE writing implementation plan. Per the `feedback_spec_assumption_empirical_smoke` rule: spec assumptions about external systems (ML models) must be verified by smoke before spec freeze.

### Spike 7.1 — Diarization on JA audio
Three JA fixtures, recorded by founder or sourced:
- 2-speaker interview, 30 min, clean office audio
- 4-speaker meeting, 30 min, conference room
- 6-speaker brainstorm, 20 min, energetic discussion

Run sherpa-onnx + pyannote-segmentation-3.0 + 3D-Speaker eres2net. Measure:
- DER (Diarization Error Rate) per fixture
- Warm-up time to label stability
- Per-chunk inference latency
- Peak RAM during recording

**Acceptance**: DER < 15%, warm-up < 30s, chunk latency < 1s on M1 8GB.

**Fallback ladder if fail**:
- Swap embedding model: 3D-Speaker → NeMo TitaNet small → WeSpeaker ResNet34
- If all sherpa-onnx options fail: drop diarization to v2.1 R&D; alpha ships single-speaker labels only ("Speaker 1" for everything) and uses inline-rename UX only for marking who's speaking now (manual, not auto-clustered)

### Spike 7.2 — Llama 3.2 3B + grammar-constrained JSON on Lecture schema
Take an existing v1 lecture transcript (11-min JA physics fixture from v1 backend eval). Wrap with LectureNote Zod schema. Generate via Llama 3.2 3B Q4_K_M + GBNF grammar. Measure:
- Latency for full generation
- Zod validation pass/fail
- Slot emergence rate (procedure_steps / argument_chain / formula / timeline)
- Referential closure violations
- Subjective quality vs v1 backend gpt-4o-mini output

**Acceptance**: validation passes, slot emergence > 0 (at least one slot in fixtures where triggers apply), latency < 30s per chunk on M1 8GB.

**Fallback if fail**:
- Tune prompt (especially few-shot exemplars) — iterate
- If structural failure persists: consider Qwen 2.5 3B (32K context, may handle complex schema better) via ModelProfile swap
- If quality unacceptable: tier the experience — 8GB Mac uses Lecture-only with simpler schema; 16GB+ Mac uses 7B model

### Spike 7.3 — Token-budget chunking + final merge
Synthesize a 90-min transcript by concatenating 3 v1 fixtures. Run chunked pipeline. Measure:
- Chunk count
- Per-chunk latency
- Final merge latency
- Information loss across chunk boundaries (manual review)
- Speaker_id consistency across chunks

**Acceptance**: total pipeline < 120s for 90-min recording, no speaker_id drift, no duplicate decisions in final.

### Spike 7.4 — `zod-to-gbnf` converter
Implement minimal converter for one family schema (Lecture). Verify:
- Generated grammar passes `llama_grammar_init` (no parse error)
- LLM generates 10 sample outputs against the grammar; **100%** must Zod-parse without error (round-trip integrity)
- Converter execution time per family schema

**Acceptance**: (a) `llama_grammar_init` returns success on every family's generated grammar; (b) 10/10 LLM outputs Zod-parse; (c) converter < 100ms first-call, < 10ms cached subsequent calls per family.

**Fallback if (b) < 100%**: bug in converter — handle that Zod construct (Optional / Discriminated Union / Tuple / etc.) explicitly. Reviewer 2 estimated ~150 LOC for the converter; expect a few iterations to cover all Zod constructs the schema actually uses.

---

## 8. Known limitations

Documented for honest user UX framing and to scope what's *not* fixable in alpha.

### Audio / STT / diarization
- **Cross-talk (simultaneous speech)**: diarization assigns one speaker to the dominant voice; the other is missed. Common in heated meetings. v2.1 R&D: overlap detection via pyannote-segmentation-3.0 features.
- **Very short utterances (<1s "はい", "ええ")**: speaker embedding unreliable; may attribute to wrong speaker. Real-world impact small.
- **First ~10-30s warm-up**: speaker labels tentative until clustering stabilizes. UI shows `?` suffix during warm-up.
- **Diarization without pause (continuous speaker change mid-sentence)**: Whisper STT may produce one segment for content from two speakers. Alpha falls back to "dominant speaker for the segment." v2.1: WhisperX-style word-level alignment.

### LLM / schema
- **3B Q4 reliability ceiling**: complex schema fields (deep nested arrays, referential IDs, conditional emergence) hit accuracy ceiling. v1 observation: 17/17 `transcript` (no inferred). Mitigations: post-hoc provenance, post-decode referential closure clamp, deterministic dedup, NoOpDiarization for Lecture.
- **Mode collapse risk**: 3B may default to bland generic output that scores OK on LLM-as-judge but feels unsatisfying. Mitigated by ContractTest in eval harness (deterministic structural assertions catch this).
- **Latency at long sessions**: 60-min Meeting ≈ 60-110s post-Stop processing. 2-hour Lecture ≈ ~3 min. User sees "Finalizing note…" spinner.

### Storage / migration
- Forward-version notes (created in newer app, opened in older) refuse with clear error — no auto-downgrade.
- Migration chain is monotonic; no rollback.

---

## 9. Non-goals (alpha)

Explicitly out of scope for v2 alpha implementation. May land in v2.1+ as separate specs.

- **Auto family detection.** User picks at Stop. Classifier is a v2.1 R&D candidate.
- **Multi-language note output beyond JA.** EN/KO defined in schema language enum but not implemented in prompts.
- **Streaming render of partial JSON during generation.** Slot reserved (`streamingRenderer?`), implementation deferred (needs partial-JSON parsing layer first).
- **Cross-session semantic recall** (`related_lectures`, `related_terms`, `cross_connections`, `builds_on`). All require embedding-based similarity, deferred to v2.1 with sentence embedding model packaging.
- **User editing of generated notes.** v2 alpha = read-only render. v2.1 = inline edit with `user_edited?: boolean` per field to prevent re-curate clobbering.
- **Family mis-pick recovery.** v2 alpha: pick a different family + Stop → re-run from scratch (cost: another full pipeline). v2.1: cached transcript reuse.
- **Cloud LLM fallback.** v2 is on-device only. Cloud is v1.

---

## 10. Open questions / decisions deferred to plan stage

These need answers before or during writing-plans, not as part of design:

1. **Migration of existing v2 alpha notes** (the 3-section `【要点】/【次のアクション】/【決定事項】` plain-text format). Options: (a) coexist (old notes read-only, new notes use new schema) — recommended for alpha simplicity; (b) one-shot migration script that re-curates from preserved audio (requires audio retention, currently not guaranteed).
2. **Audio retention policy.** Currently desktop alpha discards audio post-Stop. For v2.1 features (re-curate, multiple-view, edit-and-regenerate), audio needs retention. Storage cost: ~1MB/min. Decision: opt-in setting at user level, default off for alpha.
3. **Inline-edit speaker name persistence across sessions.** If user names Speaker 1 = 田中 in one meeting, does the next meeting auto-suggest 田中 if a similar voice appears? Cross-session speaker identification = a real R&D project; alpha = per-session only.
4. **Picker UX details.** Modal? Floating overlay? Default = last-used family? User-settable default in settings? Spec defers; design system + UX session needed.
5. **Renderer architecture.** Replace `<pre>` `NoteView` with typed React components per family. Component library shared with Lisna marketing site's `frontend-design` skill, or fresh build? Defers to a separate spec.

---

## 11. References

### Memory files (project context)
- `[[v2_alpha_merged_2026-05-18]]` — v2 alpha is live, current `ja-note-v1.ts` design baseline
- `[[curator_phase_fgh_handoff_2026-05-16]]` — v1 backend curator provenance + typed slots (gpt-4o-mini, JSON schema, the reference for this spec's Lecture family)
- `[[feedback_llm_chat_template_sidecar]]` — M1 8GB n_ctx 16K limit, chat template architecture
- `[[feedback_spec_assumption_empirical_smoke]]` — why §7 Phase 0 spike is mandatory
- `[[feedback_4stage_governance]]` — review structure that yielded round 1/2 of this spec
- `[[project_metal_cold_cache_first_run]]` — Metal warm-up requirement that ModelProfile.warmupRequired captures

### Code references
- Current v2 LLM prompt: [desktop/src/main/sidecar/prompts/ja-note-v1.ts](desktop/src/main/sidecar/prompts/ja-note-v1.ts)
- Current v2 orchestrator (single-shot at Stop): [desktop/src/main/sidecar/orchestrator.ts](desktop/src/main/sidecar/orchestrator.ts)
- v2 engine interfaces (extends with DiarizationEngine in §4.11): [desktop/src/shared/engine-interfaces.ts](desktop/src/shared/engine-interfaces.ts)
- v1 backend curator (Lecture schema source-of-record): [backend/src/lib/curator.ts](backend/src/lib/curator.ts)
- v1 backend session handler (chunked-at-end inspiration): [backend/src/handlers/session-curate.ts](backend/src/handlers/session-curate.ts)
- Current v2 renderer (replaced in §5.3): [desktop/src/renderer/routes/NoteView.tsx](desktop/src/renderer/routes/NoteView.tsx)

### Brainstorming artifacts (visual companion mockups, retained for design lineage)
Two sessions were run consecutively (server timeout between them).

Session 1 — `.superpowers/brainstorm/56812-1779696211/content/`:
- `q1-situations.html` — 6 situation enumeration
- `q2-format-grouping.html` — 4-family grouping decision
- `q3-detection-flow.html` — picker-at-Stop chosen
- `q4-diarization-arch.html` — always-parallel architecture
- `q5-rename-ux.html` — inline-edit picked
- `q6-output-bundle.html` — 3B + grammar JSON bundle picked
- `q7-family-timing-with-rolling.html` — superseded by chunked-at-end pivot
- `q8-window-merge.html` — superseded by chunked-at-end pivot
- `q9-rolling-ux-states.html` — superseded by chunked-at-end pivot

Session 2 — `.superpowers/brainstorm/74860-1779717614/content/`:
- `q10-schemas.html` — initial 4-schema draft
- `q11-purpose-fields.html` — purpose-driven 4-dimension framework
- `q12-refined-schema.html` — schema diff after round 1 reviewers

### Rules / conventions
- [.claude/rules/architecture.md](.claude/rules/architecture.md) — module layering rules
- [.claude/rules/testing.md](.claude/rules/testing.md) — fixture + baseline conventions for eval harness §4.12
- [.claude/rules/pitfalls.md](.claude/rules/pitfalls.md) — battle scars including v1 curator history

---

**End of design.** Plan to be written in writing-plans skill after user approval.

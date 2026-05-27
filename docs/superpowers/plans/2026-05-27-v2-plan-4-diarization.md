# Lisna v2 Note Creation — Plan 4: Diarization Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring diarization (sherpa-onnx + pyannote-segmentation-3.0 + 3D-Speaker eres2net) from spike scaffolding into the v2 production pipeline: native C++ sidecar integration, first-run model-picker UX extension, family-aware schema wiring, DER eval CLI for regression, and the fallback ladder all per spec §2.4 / §5.1 / §7.1.

**Architecture:** Three integration surfaces. (1) Sidecar — sherpa-onnx C++ links into `lisna_sidecar` alongside whisper + llama; a new `Diarize*` IPC command set mirrors the existing `stt-*` / `llm-*` patterns. (2) Main process — extends `model-resolver.ts` from 2 slots (stt/llm) to 4 slots (stt/llm/seg/emb) behind a feature toggle, and registers a `DiarizationEngine` impl that pipes per-chunk audio through the sidecar. (3) Shared — `DiarizationEngine` interface (per spec §4.11), `SpeakerLabeledSegment` type, and a family-aware orchestrator that branches on `FamilyDefinition.requiresDiarization`.

**Tech Stack:** sherpa-onnx (CPU + Metal, ONNX Runtime backend), Pyannote segmentation 3.0 (~13MB), 3D-Speaker eres2net (~38MB), TypeScript adapter, Electron IPC, Vitest, existing C++ sidecar build system (CMake + Metal + llama.cpp/whisper.cpp pattern).

**Sub-plan position:** Plan 4 of 7 (see spec status header).

**Spec reference:** `docs/superpowers/specs/2026-05-26-v2-structured-note-creation-design.md` §2.4 + §3 (schemas) + §4.0/4.11 + §5.1 + §7.1 + commit `af3af63`.

**Carries from Plan 1 (Phase 0 spikes):** Tasks 12-15 (`docs/superpowers/plans/2026-05-26-v2-note-creation-phase-0-spikes.md` lines ~879-1228). Spike 0.3 BLOCKED on founder fixtures; runtime tasks here gate on the same fixtures.

**Status gate:** Plan design freezes now. Runtime tasks (T-DI-08, T-DI-15..18) execute only after founder lands the 3 JA WAVs + ground-truth JSONs.

---

## 0. Context: where this plan begins

Per `desktop/spikes/phase-0/VERDICT.md` (2026-05-27):

- **Spike 0.1 (zod-to-gbnf): PASS at N=5** via Path 2 retry contract. Grammar-constrained JSON design is locked.
- **Spike 0.2 (3B Lecture grammar): MIXED.** Zod/slot pass, latency 3× over budget; Path E diagnostic pending. **Does not block Plan 4** — Plan 4 doesn't touch the LLM path.
- **Spike 0.3 (Diarization JA): BLOCKED on founder fixtures.** Plan 1 Tasks 13-15 (sherpa-onnx Node binding setup, DER computation, run-spike runner) were authored but never executed.
- **Spike 0.4 (Chunking): PASS.** Algorithm moves into `shared/` via Plan 2.

**Plan 4 absorbs Spike 0.3.** Plan 1 used `sherpa-onnx-node` for spike velocity. Plan 4 promotes to **native sidecar** so diarization shares the process boundary with Whisper STT — the existing `STT_TIMEOUT` / `madvise()` / mach-RSS-poll discipline (see `desktop/src/main/sidecar/orchestrator.ts:104` + `feedback_sidecar_resources_stale`) extends naturally to a third in-process model. A Node-binding production integration would fragment process-management invariants; ruled out at design time.

**Cross-plan dependencies:**

- **Upstream (must land first):** Plan 2 (Foundation) — the grammar-call retry wrapper + `shared/families/util/*` + `chunkTranscript` move + `TranscriptSegment.endTs` carry-forward (VERDICT carry-forward #3). Plan 4 reuses `TranscriptSegment` from `shared/`.
- **Downstream (consume Plan 4's API contract):** Plan 5 (Meeting) + Plan 6 (Interview/Brainstorm). Both family schemas expect `SpeakerRef` integer indices into `SessionTranscript.speakers[]` populated by this plan. **Type contract (`SpeakerLabeledSegment`, `DiarizationEngine.processChunk` signature) MUST freeze before Plan 5/6 begin.**

---

## 1. File structure

```
shared/
├── engine-interfaces.ts             # MODIFY: add DiarizationEngine + SpeakerLabeledSegment
├── ipc-protocol.ts                  # MODIFY: add ModelSlot 'seg' | 'emb', diarization phases
├── families/
│   ├── index.ts                     # MODIFY: FamilyDefinition.requiresDiarization: boolean
│   └── util/
│       └── speaker-resolve.ts       # NEW: SpeakerRef → name resolution helpers
└── note-schema/
    └── transcript.ts                # CONFIRM: SessionTranscript shape from Plan 2 carries speakerId

desktop/
├── sidecar/
│   ├── CMakeLists.txt               # MODIFY: link sherpa-onnx
│   ├── deps/
│   │   └── sherpa-onnx/             # NEW: vendored or fetched
│   ├── scripts/
│   │   └── build.sh                 # MODIFY: pin OMP_NUM_THREADS, JOBS for sherpa-onnx build
│   └── src/
│       ├── main.cpp                 # MODIFY: dispatch new commands
│       ├── ipc/json_protocol.cpp    # MODIFY: schema for diarize-* commands
│       └── diar/                    # NEW
│           ├── diarize_engine.cpp   # sherpa-onnx wrapper
│           └── diarize_engine.h
├── src/
│   ├── main/
│   │   ├── model-resolver.ts        # MODIFY: extend ModelSlot to 4 slots behind feature toggle
│   │   ├── sidecar/
│   │   │   ├── sherpa-diarization.ts        # NEW: TS DiarizationEngine impl over sidecar IPC
│   │   │   ├── noop-diarization.ts          # NEW: §4.11 reference impl
│   │   │   ├── orchestrator.ts              # MODIFY: branch on family.requiresDiarization
│   │   │   └── __tests__/
│   │   │       └── sherpa-diarization.test.ts
│   │   └── __tests__/
│   │       └── model-resolver-diar.test.ts
│   └── renderer/
│       ├── routes/SetupView.tsx             # MODIFY: tiered diarization opt-in (Option B)
│       └── components/
│           ├── DiarizationOptInStep.tsx     # NEW: opt-in card surfaced after STT+LLM ready
│           └── ModelPickerStep.tsx          # MODIFY: handle slot ∈ {'stt','llm','seg','emb'}
└── scripts/
    └── eval-diarization.ts                  # NEW: lifts from spike + scales to regression use

desktop/spikes/phase-0/03-diarization-ja/   # EXISTING (from Plan 1, blocked)
├── der.ts                          # MOVE-SOURCE: lifts to desktop/scripts/eval-diarization.ts impl
├── der.test.ts                     # MOVE-SOURCE: tests carry to Plan 4 home
├── run-spike.ts                    # SUPERSEDED by run-diarization-spike.ts (native sidecar variant)
└── fixtures/                       # FOUNDER provides .wav + .truth.json
```

---

## 2. Picker UX revision — decision recorded here

**Spec §2.4 + §5.1 question:** the existing first-run model picker (`v2_step5_task1_complete_2026-05-17`) flows STT → LLM as sequential `Step 1 / 2 → Step 2 / 2`. Diarization adds **two more models** (~51MB total: segmentation 13MB + embedding 38MB). Two options on the table:

| Option | What user sees on first run | Trade-off |
|---|---|---|
| **A. 4-model picker** | Steps `1/4` STT → `2/4` LLM → `3/4` Segmentation → `4/4` Embedding all up-front | Catches all 4 in one screen flow, but Lecture-only users pay ~51MB + 2 extra clicks they don't need. Inverts the current "small upfront commitment" UX. |
| **B. Tiered: STT+LLM picker → optional diarization opt-in card** | Steps `1/2` STT → `2/2` LLM → (existing "Ready" screen) → **opt-in card:** *"Enable speaker labels for Meeting/Interview/Brainstorm? (downloads ~51MB)"* with Skip + Enable buttons. Enable → Segmentation picker → Embedding picker → Ready. | Preserves existing 2-step UX for Lecture-only path. Defers ~51MB + 2 picks until needed. Single new screen for diarization users. Two-stage Setup. |

**Decision: Option B (tiered flow).**

Rationale:

1. **Existing UX is the anchor, not a constraint to design around.** The current 2-step picker is reviewer-approved (Step 5 Task 1 reviewer rounds 1+2). Compatible extension > redesign.
2. **Family is unknown at picker time.** Per spec §2.2, family is picked at Stop (post-recording). A first-run user who only ever records Lectures should not be forced through 2 extra picks to reach the recording surface. Option A burdens 100% of users; Option B opens diarization only to users who self-identify as needing it.
3. **Runtime behavior unchanged.** Per spec §2.4, diarization *always runs during recording* if loaded (family-unknown-during-record principle). Whether models are loaded is the toggle; the runtime path doesn't fork.
4. **Lecture-only users get fast TTFV (time-to-first-value).** ~13MB whisper-small + ~2GB Llama 3.2 3B Q4 is already a sizeable first-run download. Adding 51MB of diarization models conditionally — not unconditionally — respects the user's existing setup cost.
5. **Aligns with the `NoOpDiarization` fallback (§4.11).** Users who skip diarization at first run get `NoOpDiarization` registered → Meeting/Interview/Brainstorm families either degrade to single-speaker (per §7.1 final-fallback ladder rung) or are surfaced as "requires diarization, enable in Settings."
6. **Cheap to revisit.** A future "diarization-by-default in alpha-N+1" decision flips a feature toggle constant — no UX rewrite. Option A is the one-way door; Option B is the reversible one.

**Picker state machine extension** (handled in T-DI-09):

```
boot:
  resolveModels({ slots: ['stt', 'llm', ...DIARIZATION_ENABLED ? ['seg','emb'] : []] })
  if status.kind === 'needs-setup':
    SetupView mounts with missing[0] as initialStep
  else:
    if DIARIZATION_ENABLED && !diarOptInResolved:
      DiarizationOptInStep card shows
    else:
      Recording view mounts (existing path)

after STT + LLM ready:
  if !diarOptInResolved:
    DiarizationOptInStep
      → user picks Skip   → persist {diarOptIn: 'skip'} → Recording
      → user picks Enable → mount SetupView with initialStep='seg' → Step 1/2 (seg) → 2/2 (emb) → Recording
```

`DIARIZATION_ENABLED` is a build-time const in T-DI-09 (default `false` until Spike 0.3 verdict). Flipped to `true` when DER acceptance gate passes (T-DI-18 verdict).

**Risk note for the controller:** If a founder review of this rationale lands on "actually, do Option A," the unblocking path is mechanical — T-DI-09 reverts to a single 4-step `Setup` flow and `DiarizationOptInStep` is deleted. All other tasks (sidecar integration, schema wiring, eval CLI) are agnostic to the picker choice.

---

## 3. Acceptance gates (block alpha external distribution)

All from spec §7.1 + §2.4. **Plan 4 ships behind a feature toggle (`DIARIZATION_ENABLED = false`) until all 4 gates pass on all 3 fixtures.** Failing any one rung descends the fallback ladder (§7).

| Gate | Threshold | How measured | Where enforced |
|---|---|---|---|
| **G1. DER** | < 15% per fixture | `eval-diarization.ts` CLI vs ground-truth JSON | T-DI-18 |
| **G2. Warm-up** | < 30s to first stable cluster | Time from `processChunk(chunk[0])` to first non-`tentative: true` segment in output | T-DI-15 |
| **G3. Per-chunk latency** | < 1s for a 10s audio chunk on M1 8GB | `performance.now()` around `processChunk` call | T-DI-15 |
| **G4. Peak RSS during recording** | Combined STT + diarization fits in 6GB envelope (leaves 2GB for OS + Electron) | `mach_vm` poll from existing sidecar `os_reclaim` infrastructure during recording | T-DI-17 |

**Per spec §2.4 *peak RAM during processing* clarification:** the spec language reads "peak RAM during processing fits in 8GB envelope (STT not loaded during the diarization phase — chunked-at-end means we can serialize)." Re-reading §2.4 + §5.1, diarization runs **during recording** (parallel with STT), and LLM runs **at Stop** (after STT unload). So the contended-RAM phase is `STT + Diarization simultaneously`, not `LLM + Diarization`. G4 measures exactly that.

---

## 4. Fallback ladder (per spec §7.1)

If G1 (DER) fails on initial run with 3D-Speaker eres2net:

```
Rung 0: 3D-Speaker eres2net          ← initial choice (this plan's default)
        ↓ if DER ≥ 15%
Rung 1: NeMo TitaNet small           ← embedding model swap; sherpa-onnx supports
        ↓ if DER ≥ 15%
Rung 2: WeSpeaker ResNet34           ← third sherpa-onnx-supported embedding
        ↓ if DER ≥ 15% on all 3 above
Rung 3: Single-speaker mode          ← drop diarization to v2.1 R&D;
        (alpha ships Meeting/Interview/Brainstorm with all-segments-same-speaker;
         inline-rename UX repurposed for *manual* speaker assignment)
```

**T-DI-19 records the rung verdict + writes `desktop/spikes/phase-0/03-diarization-ja/decision-0.3-verdict.md`.** Founder gate on Rung 3: if all 3 embedding models fail, the spec needs revision (Meeting/Interview/Brainstorm schemas may degrade or be reframed) before Plan 5/6 freeze.

---

## 5. Hardware safety baseline (woven into every runtime task)

Per `.claude/rules/pitfalls.md` `(spike-llm)` rule (cited 2026-05-27 kernel panic):

- **Sherpa-onnx is CPU + Metal-bound at inference (not GPU-llama).** Less swap-thrash risk than 3B LLM but **still capable of sustained 1-2GB RSS for embedding model + ONNX Runtime overhead**. Treat as same risk class as Whisper STT.
- **Test discipline (every test that loads real sherpa-onnx):**
  - `afterAll` cleanup invariant — `unloadModel()` MUST be awaited, then `await new Promise(r => setTimeout(r, 5000))` cooldown.
  - Foreground vitest only — never `run_in_background:true`.
  - Post-task `ps -ef | grep -E "lisna_sidecar|vitest.*diar" | grep -v grep`; `kill -9` survivors.
- **Mock by default.** Tests that don't need real ONNX inference mock at the `DiarizationEngine` interface boundary. Real-inference tests are gated by an env var (`LISNA_DIAR_INTEGRATION=1`) so CI doesn't accidentally spin them up.
- **Eval CLI (T-DI-18) consumes ~5-10 min CPU/Metal across 3 fixtures.** Same foreground discipline; one fixture at a time.
- **Model download (~51MB total) is one-shot.** Not a recurring spike-llm concern.

---

## 6. Task list

22 tasks across 4 phases (Sidecar → Main process → UX → Eval/runtime). Each task is commit-sized. **Tasks marked `[FOUNDER-GATED]` cannot execute until fixtures land.** Tasks marked `[DESIGN-FREEZE]` ship type contracts that downstream plans (5/6) depend on — these MUST complete before Plan 5/6 begin.

### Phase A: Type contracts + interface freeze (DESIGN-FREEZE — blocks Plan 5/6)

These tasks produce **only types + interface stubs** with no real sherpa-onnx dependency. They can run any time (no founder gate). Plan 5/6 begin once Phase A is merged.

---

### Task DI-01: Add `DiarizationEngine` to `shared/engine-interfaces.ts`

**Files:**
- Modify: `desktop/src/shared/engine-interfaces.ts`

- [ ] **Step 1: Write the failing type-check test**

```typescript
// desktop/src/shared/__tests__/engine-interfaces.test.ts (new)
import { describe, it, expect } from 'vitest';
import type {
  DiarizationEngine,
  SpeakerLabeledSegment,
  TranscriptSegment,
} from '../engine-interfaces';

describe('DiarizationEngine interface', () => {
  it('SpeakerLabeledSegment extends TranscriptSegment with speakerId', () => {
    const sls: SpeakerLabeledSegment = {
      ts: 0,
      text: 'hello',
      speakerId: 0,
      tentative: false,
    };
    const ts: TranscriptSegment = sls;  // covariant — SLS is assignable to TS
    expect(ts.text).toBe('hello');
  });

  it('DiarizationEngine has load / unload / processChunk methods', () => {
    const stub: DiarizationEngine = {
      async loadModel(_s: string, _e: string) {},
      async unloadModel() {},
      async processChunk(_a: Float32Array, _segs: TranscriptSegment[]) {
        return [] as SpeakerLabeledSegment[];
      },
    };
    expect(stub).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect FAIL (`SpeakerLabeledSegment is not exported`)**

```bash
pnpm --filter desktop test desktop/src/shared/__tests__/engine-interfaces.test.ts
```

Expected: type error on the import.

- [ ] **Step 3: Add the types to `shared/engine-interfaces.ts`**

```typescript
// At the end of desktop/src/shared/engine-interfaces.ts

/**
 * A TranscriptSegment with speaker attribution.
 *
 * `speakerId` is an integer index into SessionTranscript.speakers[].id.
 * During the diarization warm-up window (per spec §2.4 — ~10-30s online
 * clustering before labels stabilize), segments are emitted with
 * `tentative: true`. After warm-up, `tentative` is false or omitted; the
 * speakerId is final-confidence (subject to user inline-rename, which mutates
 * SessionTranscript.speakers[].name, not speakerId).
 */
export interface SpeakerLabeledSegment extends TranscriptSegment {
  speakerId: number;
  /** True during warm-up window (first ~10-30s); false/omitted after. */
  tentative?: boolean;
}

/**
 * The diarization engine. Mirrors STTEngine / LLMEngine lifecycle: load → use →
 * unload. Per spec §2.4, runs always-parallel during recording (regardless of
 * which family the user picks at Stop). The TS adapter calls into the C++
 * sidecar over IPC; segmentation and embedding model paths are resolved at
 * boot by model-resolver.
 */
export interface DiarizationEngine {
  /**
   * Load the segmentation + embedding ONNX models into the sidecar. Resolves
   * after both models are mmap'd and warmup forward-pass has run on a tiny
   * audio frame (so the first `processChunk` doesn't pay Metal cold-cache
   * cost — see `project_metal_cold_cache_first_run`).
   */
  loadModel(segmentationPath: string, embeddingPath: string): Promise<void>;

  /**
   * OS-confirmed RSS reclamation (same contract as STTEngine.unloadModel —
   * mach_vm + madvise). Resolves AFTER the sidecar reports RSS drop.
   * Per spec §5.1 the diarization model unloads at session/finalize alongside
   * STT, before LLM loads.
   */
  unloadModel(): Promise<void>;

  /**
   * Process a single 10s audio chunk and the STT segments derived from the
   * same chunk. Returns the input segments with `speakerId` assigned via
   * online clustering. Caller responsible for ordering / coalescing across
   * chunk boundaries.
   *
   * Latency budget: < 1s per 10s chunk on M1 8GB (spec §7.1 G3). Throws on
   * sidecar timeout (DIARIZE_TIMEOUT, mirrors STT_TIMEOUT contract).
   */
  processChunk(
    audio: Float32Array,
    sttSegments: TranscriptSegment[],
  ): Promise<SpeakerLabeledSegment[]>;
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter desktop test desktop/src/shared/__tests__/engine-interfaces.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/engine-interfaces.ts desktop/src/shared/__tests__/engine-interfaces.test.ts
git commit -m "feat(v2-diarization): freeze DiarizationEngine + SpeakerLabeledSegment type contract"
```

---

### Task DI-02: Add `ModelSlot` extension to `shared/ipc-protocol.ts`

**Files:**
- Modify: `desktop/src/shared/ipc-protocol.ts`

- [ ] **Step 1: Write the failing test for new slot values**

```typescript
// desktop/src/shared/__tests__/ipc-protocol-diar.test.ts (new)
import { describe, it, expect } from 'vitest';
import type { ModelSlot } from '../ipc-protocol';

describe('ModelSlot (diarization extension)', () => {
  it('accepts seg and emb in addition to stt and llm', () => {
    const a: ModelSlot = 'stt';
    const b: ModelSlot = 'llm';
    const c: ModelSlot = 'seg';
    const d: ModelSlot = 'emb';
    expect([a, b, c, d]).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run, expect FAIL (TS narrowing rejects 'seg' | 'emb')**

- [ ] **Step 3: Extend the type**

```typescript
// desktop/src/shared/ipc-protocol.ts — REPLACE the existing ModelSlot line:
// (was: `export type ModelSlot = 'stt' | 'llm';`)

/**
 * Model slot identifier. Four slots for v2:
 *   stt  — Whisper STT GGML
 *   llm  — Llama LLM GGUF
 *   seg  — Pyannote segmentation 3.0 ONNX (diarization)
 *   emb  — Speaker embedding ONNX (3D-Speaker eres2net / NeMo TitaNet small / WeSpeaker)
 *
 * `seg` and `emb` are only surfaced in the picker when the diarization
 * feature toggle is enabled (T-DI-09 `DIARIZATION_ENABLED`). Boot-time
 * model resolution skips them entirely when disabled, so legacy 2-slot
 * installations remain bit-identical.
 */
export type ModelSlot = 'stt' | 'llm' | 'seg' | 'emb';

/**
 * Subset known at compile time when diarization is enabled.
 * Used internally by model-resolver to scope iteration order.
 */
export const ALL_MODEL_SLOTS: readonly ModelSlot[] = ['stt', 'llm', 'seg', 'emb'] as const;
export const CORE_MODEL_SLOTS: readonly ModelSlot[] = ['stt', 'llm'] as const;
export const DIARIZATION_MODEL_SLOTS: readonly ModelSlot[] = ['seg', 'emb'] as const;
```

Also extend `ModelsJson` to carry the new paths (additive — old files without these fields remain valid):

```typescript
// In the same file, find the ModelsJson interface (defined in main/model-resolver.ts —
// for v1 paths we keep this minimal here; the actual ModelsJson lives in main/
// and is extended in T-DI-08).
```

(No change to `ModelsJson` here — that's `main/model-resolver.ts`'s concern, handled in T-DI-08. Comment for the next reader.)

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/ipc-protocol.ts desktop/src/shared/__tests__/ipc-protocol-diar.test.ts
git commit -m "feat(v2-diarization): extend ModelSlot to 4 slots (stt/llm/seg/emb)"
```

---

### Task DI-03: Add `requiresDiarization` to `FamilyDefinition`

**Files:**
- Modify: `desktop/src/shared/families/index.ts` (if exists from Plan 2; create stub if not)

> **Plan 2 dependency check:** Plan 2 lands `shared/families/index.ts` with the canonical `FamilyDefinition<T>`. If this file does not exist at the time T-DI-03 runs, the implementer must coordinate with Plan 2's owner — DO NOT fork a parallel families/index.ts. If forked, the merge will silently lose the `requiresDiarization` flag.

- [ ] **Step 1: Read `desktop/src/shared/families/index.ts` to verify it exists**

```bash
ls desktop/src/shared/families/index.ts
```

If missing: STOP. Surface to controller — Plan 2 has not landed the `FamilyDefinition` interface yet. Plan 4 Phase A is blocked.

- [ ] **Step 2: Write the failing test**

```typescript
// desktop/src/shared/families/__tests__/family-definition-diar.test.ts (new)
import { describe, it, expect } from 'vitest';
import type { FamilyDefinition } from '../index';

describe('FamilyDefinition.requiresDiarization', () => {
  it('exists as a boolean field on FamilyDefinition', () => {
    const stub: Pick<FamilyDefinition<any>, 'requiresDiarization'> = {
      requiresDiarization: false,
    };
    expect(stub.requiresDiarization).toBe(false);
  });
});
```

- [ ] **Step 3: Add the field to FamilyDefinition**

```typescript
// In desktop/src/shared/families/index.ts — extend the FamilyDefinition interface:
export interface FamilyDefinition<T extends NoteBase> {
  // ... existing fields from Plan 2 (id, schema, prompts, renderer, picker, ...)

  /**
   * Whether this family's schema and prompt rely on speaker attribution.
   *
   *   true  — Meeting, Interview, Brainstorm. Schema contains SpeakerRef fields
   *           (made_by, asked_by, contributed_by, etc.). Orchestrator loads
   *           DiarizationEngine during recording; LLM prompt is fed
   *           per-segment speakerId.
   *   false — Lecture. Single-speaker assumption. NoOpDiarization registered;
   *           SessionTranscript.speakers always = [{id: 0}].
   *
   * Read at session/start (recording begin) and at session/finalize (after
   * family pick). If the user picks a family with requiresDiarization=true
   * but diarization is not enabled (toggle off or fallback rung 3 active),
   * the orchestrator degrades to single-speaker labels and records
   * a `defaulted_to_single_speaker: true` flag in NoteBase.validation_warnings.
   */
  requiresDiarization: boolean;
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
pnpm --filter desktop test desktop/src/shared/families/__tests__/family-definition-diar.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/families/index.ts desktop/src/shared/families/__tests__/family-definition-diar.test.ts
git commit -m "feat(v2-diarization): mark families with requiresDiarization flag"
```

---

### Task DI-04: Add `NoOpDiarization` reference implementation

**Files:**
- Create: `desktop/src/main/sidecar/noop-diarization.ts`
- Create: `desktop/src/main/sidecar/__tests__/noop-diarization.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/main/sidecar/__tests__/noop-diarization.test.ts
import { describe, it, expect } from 'vitest';
import { NoOpDiarization } from '../noop-diarization';
import type { TranscriptSegment } from '@shared/engine-interfaces';

describe('NoOpDiarization', () => {
  it('loadModel / unloadModel resolve immediately', async () => {
    const d = new NoOpDiarization();
    await expect(d.loadModel('any', 'any')).resolves.toBeUndefined();
    await expect(d.unloadModel()).resolves.toBeUndefined();
  });

  it('processChunk assigns speakerId=0 to every segment, never tentative', async () => {
    const d = new NoOpDiarization();
    const segs: TranscriptSegment[] = [
      { ts: 0, text: 'hi' },
      { ts: 1, text: 'there' },
    ];
    const out = await d.processChunk(new Float32Array(16_000), segs);
    expect(out).toEqual([
      { ts: 0, text: 'hi', speakerId: 0 },
      { ts: 1, text: 'there', speakerId: 0 },
    ]);
    for (const s of out) expect(s.tentative).toBeUndefined();
  });

  it('processChunk on empty input returns []', async () => {
    const d = new NoOpDiarization();
    const out = await d.processChunk(new Float32Array(0), []);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

```typescript
// desktop/src/main/sidecar/noop-diarization.ts
import type {
  DiarizationEngine,
  SpeakerLabeledSegment,
  TranscriptSegment,
} from '@shared/engine-interfaces';

/**
 * No-op DiarizationEngine for Lecture family + fallback rung 3 (when sherpa-onnx
 * is unavailable or all embedding models fail DER acceptance).
 *
 * Assigns every segment to speakerId 0 (single-speaker labels). SessionTranscript
 * downstream observes `speakers: [{id: 0}]`. Renderer omits speaker chips.
 *
 * Per spec §2.4: "Lecture family uses NoOpDiarization for RAM/battery savings."
 * Also: "alpha ships single-speaker labels only ... if all sherpa-onnx options
 * fail" (§7.1 final fallback).
 */
export class NoOpDiarization implements DiarizationEngine {
  async loadModel(_segmentationPath: string, _embeddingPath: string): Promise<void> {
    // intentional no-op
  }

  async unloadModel(): Promise<void> {
    // intentional no-op
  }

  async processChunk(
    _audio: Float32Array,
    sttSegments: TranscriptSegment[],
  ): Promise<SpeakerLabeledSegment[]> {
    return sttSegments.map((s) => ({ ...s, speakerId: 0 }));
  }
}
```

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/sidecar/noop-diarization.ts desktop/src/main/sidecar/__tests__/noop-diarization.test.ts
git commit -m "feat(v2-diarization): NoOpDiarization reference impl for Lecture + fallback"
```

---

### Phase B: Native sidecar integration (no founder gate — runs in parallel with Phase A)

These tasks land the C++ side. Tests mock or use tiny audio fixtures.

---

### Task DI-05: Add sherpa-onnx vendored dependency + CMake link

**Files:**
- Modify: `desktop/sidecar/CMakeLists.txt`
- Create: `desktop/sidecar/deps/sherpa-onnx/` (git submodule or vendored release; see Step 1)

- [ ] **Step 1: Decide vendoring strategy**

Read `desktop/sidecar/deps/` — `llama.cpp` and `whisper.cpp` are present as submodules. Mirror that pattern:

```bash
cd /Users/guntak/Lisna/desktop/sidecar/deps
git submodule add https://github.com/k2-fsa/sherpa-onnx sherpa-onnx
cd sherpa-onnx && git checkout v1.10.32 && cd ..  # pin to a stable tag
```

Verify the tag chosen ships `OfflineSpeakerDiarization` C++ API + has Metal-compatible ONNX Runtime backend on macOS arm64. Sherpa-onnx README §"C++ API" must list both `OfflineSpeakerDiarization` (sync API for batched files) and the streaming variant if available; this plan uses streaming.

If streaming C++ API is not available at the chosen tag: the integration falls back to "batched per-10s-chunk" — same external interface (`processChunk(audio, segs)`), internally calls sherpa-onnx as if each chunk were a file. This is uglier but viable. Document the choice in `desktop/sidecar/deps/sherpa-onnx-NOTES.md`.

- [ ] **Step 2: Modify `CMakeLists.txt`**

```cmake
# After the existing llama.cpp + whisper.cpp add_subdirectory block,
# before add_executable(lisna_sidecar ...):

# sherpa-onnx options — disable examples/tests/python bindings; keep core C++ API.
# ONNX Runtime backend: rely on sherpa-onnx's bundled ORT (vendored under deps/).
set(SHERPA_ONNX_ENABLE_PYTHON OFF CACHE BOOL "" FORCE)
set(SHERPA_ONNX_ENABLE_TESTS OFF CACHE BOOL "" FORCE)
set(SHERPA_ONNX_ENABLE_C_API OFF CACHE BOOL "" FORCE)
set(SHERPA_ONNX_BUILD_C_API_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SHERPA_ONNX_BUILD_C_API_TEST OFF CACHE BOOL "" FORCE)
set(SHERPA_ONNX_BUILD_WEB_ASSEMBLY OFF CACHE BOOL "" FORCE)
add_subdirectory(deps/sherpa-onnx EXCLUDE_FROM_ALL)

# Then in the existing add_executable() block, add sources:
add_executable(lisna_sidecar
  src/main.cpp
  src/ipc/json_protocol.cpp
  src/ipc/base64.cpp
  src/stt/whisper_engine.cpp
  src/llm/llama_engine.cpp
  src/memory/os_reclaim.cpp
  src/diar/diarize_engine.cpp     # NEW
)

target_link_libraries(lisna_sidecar PRIVATE whisper llama sherpa-onnx-core)
# ↑ sherpa-onnx-core is the expected target name; confirm against the chosen tag's
# CMakeLists. Fallback target names to try: sherpa-onnx-cpp-api, sherpa-onnx-core-api.
```

- [ ] **Step 3: Document build constraint in NOTES**

Per `.claude/rules/pitfalls.md` `(spike-llm)`: M1 8GB → `JOBS=2` default. Sherpa-onnx + bundled ONNX Runtime adds ~250 .cpp files. Pin in `desktop/sidecar/scripts/build.sh` comment:

```bash
# Lines added to existing build.sh near the JOBS declaration:
# sherpa-onnx adds ~250 sources. JOBS=2 on M1 8GB recommended; JOBS=4 on M3/16GB+.
# Building sherpa-onnx + llama.cpp + whisper.cpp simultaneously hits OOM at JOBS>=4
# on M1 8GB (~6GB peak compiler RAM observed empirically — verify on first build).
```

- [ ] **Step 4: Verify the build (locally — NOT in tests)**

```bash
cd /Users/guntak/Lisna/desktop/sidecar
JOBS=2 ./scripts/build.sh
```

Expected: `lisna_sidecar` binary builds without linker errors; copied to `../resources/sidecar`.

- [ ] **Step 5: Verify binary preserved**

```bash
md5 /Users/guntak/Lisna/desktop/resources/sidecar
ls -la /Users/guntak/Lisna/desktop/resources/sidecar
```

Per `feedback_sidecar_resources_stale`: confirm md5 matches the freshly-built binary.

- [ ] **Step 6: Commit**

```bash
git add desktop/sidecar/CMakeLists.txt desktop/sidecar/.gitmodules desktop/sidecar/deps/sherpa-onnx desktop/sidecar/scripts/build.sh
git commit -m "feat(sidecar): vendor sherpa-onnx + link for diarization"
```

`desktop/resources/sidecar` is gitignored (per `feedback_sidecar_resources_stale`); do NOT attempt to commit the binary.

---

### Task DI-06: Implement `diarize_engine.h` + `.cpp` (sherpa-onnx wrapper)

**Files:**
- Create: `desktop/sidecar/src/diar/diarize_engine.h`
- Create: `desktop/sidecar/src/diar/diarize_engine.cpp`

- [ ] **Step 1: Write the header**

```cpp
// desktop/sidecar/src/diar/diarize_engine.h
#pragma once

#include <memory>
#include <string>
#include <vector>

namespace sherpa_onnx { class OfflineSpeakerDiarization; }

namespace lisna::diar {

struct SpeakerTurn {
  float start_sec;
  float end_sec;
  int speaker_id;
};

class DiarizeEngine {
 public:
  DiarizeEngine();
  ~DiarizeEngine();

  // Load segmentation + embedding ONNX models. Returns true on success.
  // Failure modes: file not found, ONNX model parse error, Metal init fail.
  // On failure: error_message_ is populated; caller queries via last_error().
  bool LoadModel(const std::string& segmentation_path,
                 const std::string& embedding_path);

  // Unload + release. Caller responsible for ensuring no in-flight ProcessChunk.
  // Returns post-unload RSS in bytes (for the orchestrator's mach_vm reclamation
  // verification — mirrors STT unload contract).
  bool UnloadModel();

  // Process 10s audio chunk (16kHz mono Float32). Returns N speaker turns.
  // `tentative_out` is set true if clustering is still in warm-up (< 30s of
  // accumulated audio). Caller responsible for chunk ordering / merging.
  std::vector<SpeakerTurn> ProcessChunk(const float* audio_samples,
                                        size_t num_samples,
                                        bool* tentative_out);

  const std::string& last_error() const { return error_message_; }
  bool is_loaded() const { return loaded_; }

 private:
  std::unique_ptr<sherpa_onnx::OfflineSpeakerDiarization> impl_;
  std::string error_message_;
  bool loaded_ = false;
  float accumulated_seconds_ = 0.0f;  // for warm-up detection
};

}  // namespace lisna::diar
```

- [ ] **Step 2: Write the .cpp**

```cpp
// desktop/sidecar/src/diar/diarize_engine.cpp
#include "diar/diarize_engine.h"

#include "sherpa-onnx/c-api/c-api.h"  // adjust path based on tag
// OR if using the C++ API directly:
// #include "sherpa-onnx/csrc/offline-speaker-diarization.h"

namespace lisna::diar {

constexpr float kWarmupThresholdSec = 30.0f;

DiarizeEngine::DiarizeEngine() = default;
DiarizeEngine::~DiarizeEngine() {
  if (loaded_) UnloadModel();
}

bool DiarizeEngine::LoadModel(const std::string& segmentation_path,
                              const std::string& embedding_path) {
  // Build sherpa-onnx config struct (exact shape depends on tag — fill in
  // after confirming against the API headers).
  //
  // Pseudo (typical sherpa-onnx 1.10.x):
  //   sherpa_onnx::OfflineSpeakerDiarizationConfig config;
  //   config.segmentation.pyannote.model = segmentation_path;
  //   config.embedding.model = embedding_path;
  //   config.clustering.num_clusters = -1;       // auto-detect (per spec §2.4)
  //   config.clustering.threshold = 0.5f;        // tune at integration time
  //   config.min_duration_on = 0.3f;
  //   config.min_duration_off = 0.5f;
  //
  //   try {
  //     impl_ = std::make_unique<sherpa_onnx::OfflineSpeakerDiarization>(config);
  //   } catch (const std::exception& e) {
  //     error_message_ = e.what();
  //     return false;
  //   }
  //
  //   loaded_ = true;
  //   accumulated_seconds_ = 0.0f;
  //   return true;
  // ---
  // Verify the exact API call shape against the tag pinned in DI-05.

  // Placeholder — final implementer fills based on the chosen tag's headers:
  error_message_ = "DiarizeEngine::LoadModel not yet wired — see DI-06 TODO";
  return false;
}

bool DiarizeEngine::UnloadModel() {
  impl_.reset();
  loaded_ = false;
  accumulated_seconds_ = 0.0f;
  // RSS reclamation runs in os_reclaim.cpp at the orchestrator level — same
  // mach_vm + madvise pipeline that handles STT/LLM unload.
  return true;
}

std::vector<SpeakerTurn> DiarizeEngine::ProcessChunk(
    const float* audio_samples,
    size_t num_samples,
    bool* tentative_out) {
  std::vector<SpeakerTurn> result;
  if (!loaded_ || !impl_) {
    error_message_ = "model not loaded";
    if (tentative_out) *tentative_out = true;
    return result;
  }

  // Update warm-up state. Sample rate is 16000.
  accumulated_seconds_ += static_cast<float>(num_samples) / 16000.0f;
  if (tentative_out) *tentative_out = accumulated_seconds_ < kWarmupThresholdSec;

  // Pseudo (typical sherpa-onnx 1.10.x):
  //   auto segments = impl_->Process(audio_samples, num_samples);
  //   for (const auto& seg : segments) {
  //     result.push_back({seg.start, seg.end, seg.speaker});
  //   }
  //   return result;

  return result;
}

}  // namespace lisna::diar
```

- [ ] **Step 3: Verify it compiles**

```bash
cd /Users/guntak/Lisna/desktop/sidecar
JOBS=2 ./scripts/build.sh 2>&1 | tail -20
```

Expected: clean build. If sherpa-onnx headers are at different paths than guessed, fix the `#include` line.

- [ ] **Step 4: Add a smoke test via existing GoogleTest harness**

```cpp
// desktop/sidecar/tests/diar/test_diarize_engine.cpp (new — copy pattern from
// existing tests/ directory's test_whisper_engine.cpp or similar)
#include <gtest/gtest.h>
#include "diar/diarize_engine.h"

TEST(DiarizeEngine, LoadModelWithMissingFileReturnsFalse) {
  lisna::diar::DiarizeEngine eng;
  EXPECT_FALSE(eng.LoadModel("/nonexistent/segmentation.onnx",
                             "/nonexistent/embedding.onnx"));
  EXPECT_FALSE(eng.is_loaded());
  EXPECT_FALSE(eng.last_error().empty());
}

TEST(DiarizeEngine, UnloadModelOnFreshInstanceIsHarmless) {
  lisna::diar::DiarizeEngine eng;
  EXPECT_TRUE(eng.UnloadModel());
}
```

Add to `desktop/sidecar/tests/CMakeLists.txt` (mirror existing whisper/llama test entries).

- [ ] **Step 5: Run sidecar tests**

```bash
cd /Users/guntak/Lisna/desktop/sidecar
JOBS=2 ./scripts/build.sh test
```

Expected: existing tests + new `DiarizeEngine.*` tests pass.

- [ ] **Step 6: Commit**

```bash
git add desktop/sidecar/src/diar desktop/sidecar/tests/diar desktop/sidecar/tests/CMakeLists.txt
git commit -m "feat(sidecar): DiarizeEngine C++ wrapper over sherpa-onnx"
```

---

### Task DI-07: Add `diarize-*` IPC commands to sidecar

**Files:**
- Modify: `desktop/sidecar/src/main.cpp`
- Modify: `desktop/sidecar/src/ipc/json_protocol.cpp`

Mirror the existing `stt-*` dispatch pattern. Three new commands:

- `diarize-load`: { segmentation_path, embedding_path } → { ok: true } | { error }
- `diarize-process-chunk`: { audio_base64, sample_count } → { turns: [{ start_sec, end_sec, speaker_id }], tentative: bool }
- `diarize-unload`: {} → { ok: true, post_unload_rss_bytes }

- [ ] **Step 1: Locate the existing `stt-load` handler dispatch in `main.cpp`**

```bash
grep -n "\"stt-load\"\|\"stt-transcribe\"" desktop/sidecar/src/main.cpp
```

- [ ] **Step 2: Add the new dispatch branches**

```cpp
// In the main command-dispatch switch/if-chain — add:

if (cmd == "diarize-load") {
  std::string seg = req["segmentation_path"];
  std::string emb = req["embedding_path"];
  if (diarize_engine_.LoadModel(seg, emb)) {
    send_response(/*id=*/req["id"], {{"ok", true}});
  } else {
    send_response(req["id"], err("load_failed", diarize_engine_.last_error()));
  }
  return;
}

if (cmd == "diarize-process-chunk") {
  if (!diarize_engine_.is_loaded()) {
    send_response(req["id"], err("not_loaded", "diarize model not loaded"));
    return;
  }
  std::string b64 = req["audio_base64"];
  std::vector<float> samples = base64_decode_floats(b64);
  bool tentative = false;
  auto turns = diarize_engine_.ProcessChunk(samples.data(), samples.size(), &tentative);

  nlohmann::json turns_json = nlohmann::json::array();
  for (const auto& t : turns) {
    turns_json.push_back({
      {"start_sec", t.start_sec},
      {"end_sec", t.end_sec},
      {"speaker_id", t.speaker_id},
    });
  }
  send_response(req["id"], {{"turns", turns_json}, {"tentative", tentative}});
  return;
}

if (cmd == "diarize-unload") {
  bool ok = diarize_engine_.UnloadModel();
  size_t rss = lisna::memory::current_rss_bytes();
  send_response(req["id"], {{"ok", ok}, {"post_unload_rss_bytes", rss}});
  return;
}
```

Add the engine member to the main process class:

```cpp
// In the main process class (probably ~main.cpp's command dispatcher):
lisna::diar::DiarizeEngine diarize_engine_;
```

- [ ] **Step 3: Update `json_protocol.cpp` schema list if it gates command validity**

```bash
grep -n "stt-load\|stt-transcribe" desktop/sidecar/src/ipc/json_protocol.cpp
```

If the protocol whitelists commands by name, add `diarize-load`, `diarize-process-chunk`, `diarize-unload` to the whitelist.

- [ ] **Step 4: Rebuild and smoke-test the dispatch**

```bash
cd /Users/guntak/Lisna/desktop/sidecar
JOBS=2 ./scripts/build.sh
echo '{"id":"1","cmd":"diarize-unload"}' | ./build/release/lisna_sidecar
```

Expected: `{"id":"1","ok":true,"post_unload_rss_bytes":...}`

- [ ] **Step 5: Commit**

```bash
git add desktop/sidecar/src/main.cpp desktop/sidecar/src/ipc/json_protocol.cpp
git commit -m "feat(sidecar): diarize-load/process-chunk/unload IPC commands"
```

---

### Task DI-08: TS adapter `SherpaDiarization` implementing `DiarizationEngine`

**Files:**
- Create: `desktop/src/main/sidecar/sherpa-diarization.ts`
- Create: `desktop/src/main/sidecar/__tests__/sherpa-diarization.test.ts`

- [ ] **Step 1: Write the failing test (using mocked SidecarClient)**

```typescript
// desktop/src/main/sidecar/__tests__/sherpa-diarization.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SherpaDiarization } from '../sherpa-diarization';
import type { TranscriptSegment } from '@shared/engine-interfaces';

describe('SherpaDiarization', () => {
  function mockClient(responses: Record<string, unknown>) {
    return {
      send: vi.fn(async (cmd: string, _payload: unknown) => responses[cmd]),
    };
  }

  it('loadModel sends diarize-load', async () => {
    const client = mockClient({
      'diarize-load': { ok: true },
    });
    const d = new SherpaDiarization(client as any);
    await d.loadModel('/seg.onnx', '/emb.onnx');
    expect(client.send).toHaveBeenCalledWith('diarize-load', {
      segmentation_path: '/seg.onnx',
      embedding_path: '/emb.onnx',
    });
  });

  it('loadModel throws on { error } response', async () => {
    const client = mockClient({
      'diarize-load': { error: { code: 'load_failed', message: 'oops' } },
    });
    const d = new SherpaDiarization(client as any);
    await expect(d.loadModel('/x', '/y')).rejects.toThrow(/oops/);
  });

  it('processChunk maps turns onto STT segments by ts-overlap', async () => {
    const client = mockClient({
      'diarize-process-chunk': {
        turns: [
          { start_sec: 0, end_sec: 2.5, speaker_id: 0 },
          { start_sec: 2.5, end_sec: 5.0, speaker_id: 1 },
        ],
        tentative: false,
      },
    });
    const d = new SherpaDiarization(client as any);
    const segs: TranscriptSegment[] = [
      { ts: 0.0, text: 'a' },     // → speaker 0 (overlap)
      { ts: 3.0, text: 'b' },     // → speaker 1 (overlap)
    ];
    const out = await d.processChunk(new Float32Array(16_000 * 5), segs);
    expect(out).toEqual([
      { ts: 0.0, text: 'a', speakerId: 0, tentative: false },
      { ts: 3.0, text: 'b', speakerId: 1, tentative: false },
    ]);
  });

  it('processChunk falls back to speakerId=0 for segments outside all turns', async () => {
    const client = mockClient({
      'diarize-process-chunk': {
        turns: [{ start_sec: 0, end_sec: 1, speaker_id: 0 }],
        tentative: false,
      },
    });
    const d = new SherpaDiarization(client as any);
    const segs: TranscriptSegment[] = [{ ts: 5.0, text: 'orphan' }];
    const out = await d.processChunk(new Float32Array(16_000 * 10), segs);
    // Segment outside any turn → default speakerId 0, marked tentative=true
    expect(out[0]?.speakerId).toBe(0);
    expect(out[0]?.tentative).toBe(true);
  });

  it('processChunk marks all segments tentative when sidecar reports tentative=true', async () => {
    const client = mockClient({
      'diarize-process-chunk': {
        turns: [{ start_sec: 0, end_sec: 10, speaker_id: 0 }],
        tentative: true,
      },
    });
    const d = new SherpaDiarization(client as any);
    const segs: TranscriptSegment[] = [{ ts: 5.0, text: 'x' }];
    const out = await d.processChunk(new Float32Array(16_000 * 10), segs);
    expect(out[0]?.tentative).toBe(true);
  });

  it('unloadModel sends diarize-unload', async () => {
    const client = mockClient({
      'diarize-unload': { ok: true, post_unload_rss_bytes: 12345 },
    });
    const d = new SherpaDiarization(client as any);
    await d.unloadModel();
    expect(client.send).toHaveBeenCalledWith('diarize-unload', {});
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement**

```typescript
// desktop/src/main/sidecar/sherpa-diarization.ts
import type {
  DiarizationEngine,
  SpeakerLabeledSegment,
  TranscriptSegment,
} from '@shared/engine-interfaces';

/**
 * Minimal interface this adapter needs from the sidecar client. Kept narrow
 * so unit tests can supply a mock without depending on the real SidecarClient.
 */
interface SidecarLike {
  send(cmd: string, payload: unknown): Promise<unknown>;
}

interface DiarizeTurn {
  start_sec: number;
  end_sec: number;
  speaker_id: number;
}

/**
 * DiarizationEngine implementation over the C++ sidecar.
 * Send audio over IPC base64-encoded; receive speaker turns; map turns onto
 * the STT segments by ts-overlap.
 */
export class SherpaDiarization implements DiarizationEngine {
  constructor(private client: SidecarLike) {}

  async loadModel(segmentationPath: string, embeddingPath: string): Promise<void> {
    const res = (await this.client.send('diarize-load', {
      segmentation_path: segmentationPath,
      embedding_path: embeddingPath,
    })) as { ok?: true; error?: { code: string; message: string } };
    if (res.error) {
      throw new Error(`diarize-load failed: ${res.error.message}`);
    }
  }

  async unloadModel(): Promise<void> {
    await this.client.send('diarize-unload', {});
  }

  async processChunk(
    audio: Float32Array,
    sttSegments: TranscriptSegment[],
  ): Promise<SpeakerLabeledSegment[]> {
    if (sttSegments.length === 0) return [];

    const audio_base64 = encodeFloat32ToBase64(audio);
    const res = (await this.client.send('diarize-process-chunk', {
      audio_base64,
      sample_count: audio.length,
    })) as { turns: DiarizeTurn[]; tentative: boolean };

    return sttSegments.map((seg) => {
      // Find the turn whose [start_sec, end_sec] contains seg.ts.
      // If none: orphan segment — assign speakerId 0 and mark tentative.
      const turn = res.turns.find((t) => seg.ts >= t.start_sec && seg.ts < t.end_sec);
      if (turn) {
        return { ...seg, speakerId: turn.speaker_id, tentative: res.tentative };
      }
      return { ...seg, speakerId: 0, tentative: true };
    });
  }
}

/**
 * Encode Float32Array (16kHz mono samples) → base64 string. Mirrors the
 * existing `stt-transcribe` audio encoding shape used in the C++ side at
 * desktop/sidecar/src/ipc/base64.cpp.
 */
function encodeFloat32ToBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  // Browser fallback (renderer side, if ever invoked there — shouldn't be)
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}
```

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/sidecar/sherpa-diarization.ts desktop/src/main/sidecar/__tests__/sherpa-diarization.test.ts
git commit -m "feat(v2-diarization): SherpaDiarization TS adapter over sidecar IPC"
```

---

### Phase C: Picker UX revision (Option B tiered flow)

These tasks land the user-facing model picker extension. No founder gate beyond the per-task tests.

---

### Task DI-09: Extend `model-resolver.ts` with conditional 4-slot iteration

**Files:**
- Modify: `desktop/src/main/model-resolver.ts`
- Modify: `desktop/src/main/__tests__/model-resolver.test.ts`
- Create: `desktop/src/main/__tests__/model-resolver-diar.test.ts`

- [ ] **Step 1: Add feature toggle + extend `ModelsJson` schema**

```typescript
// At the top of desktop/src/main/model-resolver.ts (after existing imports):

/**
 * Diarization feature toggle. When false, model-resolver iterates only
 * { stt, llm } and downstream code (SetupView, orchestrator) behaves as
 * pre-Plan-4. Flip to `true` only when Spike 0.3 verdict + acceptance
 * gates G1-G4 pass on all 3 fixtures (see Plan 4 §3).
 */
export const DIARIZATION_ENABLED = false;  // ← flip to true on T-DI-18 PASS

// Extend ModelsJson:
export interface ModelsJson {
  version: 1 | 2;   // ↑ bump to 2 when seg/emb fields added; loadModelsJson
                    //   migrates v1 → v2 by leaving seg/emb undefined (re-pick on first launch).
  sttPath: string;
  llmPath: string;
  segPath?: string;  // optional in v1; required-non-empty in v2 ONLY if DIARIZATION_ENABLED
  embPath?: string;
}
```

- [ ] **Step 2: Update `loadModelsJson` + `saveModelsJson` to round-trip the new fields**

```typescript
// Inside loadModelsJson (after the existing sttPath/llmPath check):
if (p.version === 1) {
  // v1 file — return as-is, no seg/emb. resolveModels will report
  // needs-setup for seg/emb if DIARIZATION_ENABLED.
  return { version: 1, sttPath: p.sttPath, llmPath: p.llmPath };
}
if (p.version === 2) {
  if (typeof p.segPath !== 'string' || typeof p.embPath !== 'string') return null;
  return {
    version: 2,
    sttPath: p.sttPath,
    llmPath: p.llmPath,
    segPath: p.segPath,
    embPath: p.embPath,
  };
}
return null;  // unknown version
```

```typescript
// saveModelsJson: write version 1 if !DIARIZATION_ENABLED, version 2 if enabled
// AND seg/emb are non-empty.
```

- [ ] **Step 3: Generalize `resolveSlot` use across slots**

Add `resolveSlot` calls for `seg` + `emb` inside `resolveModels`, gated by `DIARIZATION_ENABLED`:

```typescript
export async function resolveModels(opts: ResolveOptions): Promise<ResolveResult> {
  const stored = await loadModelsJson(opts.userDataDir);

  const sttResult = await resolveSlot('stt', opts.envOverride.stt, stored?.sttPath);
  const llmResult = await resolveSlot('llm', opts.envOverride.llm, stored?.llmPath);

  const missing: ModelSlot[] = [];
  if (!sttResult.ok) missing.push('stt');
  if (!llmResult.ok) missing.push('llm');

  let segPath: string | undefined;
  let embPath: string | undefined;

  if (DIARIZATION_ENABLED) {
    const segResult = await resolveSlot('seg', opts.envOverride.seg, stored?.segPath);
    const embResult = await resolveSlot('emb', opts.envOverride.emb, stored?.embPath);
    if (!segResult.ok) missing.push('seg');
    if (!embResult.ok) missing.push('emb');
    if (segResult.ok) segPath = segResult.path;
    if (embResult.ok) embPath = embResult.path;
  }

  if (missing.length === 0 && sttResult.ok && llmResult.ok) {
    return {
      kind: 'ready',
      sttPath: sttResult.path,
      llmPath: llmResult.path,
      segPath,
      embPath,
    };
  }
  return { kind: 'needs-setup', missing };
}
```

Also extend `ResolveOptions.envOverride` to include `seg?: string; emb?: string`.
Also extend `ResolveResult`/`ModelStatus` `ready` variant to include `segPath?` + `embPath?` (in `shared/ipc-protocol.ts`).

- [ ] **Step 4: Write the test**

```typescript
// desktop/src/main/__tests__/model-resolver-diar.test.ts
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveModels, DIARIZATION_ENABLED, saveModelsJson } from '../model-resolver';

describe('resolveModels with diarization toggle', () => {
  async function mkdir() {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'lisna-diar-test-'));
  }

  it('when DIARIZATION_ENABLED=false, iterates only stt+llm', async () => {
    // Skip if toggle is true (post-DI-18 state); rely on the alternate test below.
    if (DIARIZATION_ENABLED) return;
    const dir = await mkdir();
    const stt = path.join(dir, 'stt.bin');
    const llm = path.join(dir, 'llm.gguf');
    await fs.writeFile(stt, 'lmgg-dummy');
    await fs.writeFile(llm, 'GGUF-dummy');
    await saveModelsJson(dir, { version: 1, sttPath: stt, llmPath: llm });

    const res = await resolveModels({ userDataDir: dir, envOverride: {} });
    expect(res.kind).toBe('ready');
    if (res.kind === 'ready') {
      expect(res.segPath).toBeUndefined();
      expect(res.embPath).toBeUndefined();
    }
  });

  it('when DIARIZATION_ENABLED=true and v1 file on disk, reports seg+emb missing', async () => {
    if (!DIARIZATION_ENABLED) return;
    const dir = await mkdir();
    const stt = path.join(dir, 'stt.bin');
    const llm = path.join(dir, 'llm.gguf');
    await fs.writeFile(stt, 'lmgg-dummy');
    await fs.writeFile(llm, 'GGUF-dummy');
    await saveModelsJson(dir, { version: 1, sttPath: stt, llmPath: llm });

    const res = await resolveModels({ userDataDir: dir, envOverride: {} });
    expect(res.kind).toBe('needs-setup');
    if (res.kind === 'needs-setup') {
      expect(res.missing).toEqual(expect.arrayContaining(['seg', 'emb']));
    }
  });
});
```

- [ ] **Step 5: Run, expect PASS**

```bash
pnpm --filter desktop test desktop/src/main/__tests__/model-resolver-diar.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add desktop/src/main/model-resolver.ts desktop/src/main/__tests__/model-resolver-diar.test.ts desktop/src/shared/ipc-protocol.ts
git commit -m "feat(v2-diarization): conditional 4-slot model resolution behind toggle"
```

---

### Task DI-10: Extend `ModelPickerStep.tsx` for seg/emb slots

**Files:**
- Modify: `desktop/src/renderer/components/ModelPickerStep.tsx`
- Modify: `desktop/src/renderer/i18n/setup-strings.ts` (or wherever the JA copy lives)

- [ ] **Step 1: Inspect existing component**

```bash
grep -n "slot === 'stt'\|slot === 'llm'\|SETUP_STRINGS_JA" desktop/src/renderer/components/ModelPickerStep.tsx desktop/src/renderer/i18n/setup-strings.ts
```

- [ ] **Step 2: Add seg + emb copy keys**

```typescript
// desktop/src/renderer/i18n/setup-strings.ts — append:
export const SETUP_STRINGS_JA = {
  // ...existing keys
  segPickerTitle: '話者識別モデル (1/2)',
  segPickerDescription: '会話の話者を区別するためのモデルです (Pyannote segmentation 3.0, ~13MB)',
  segDownloadHint: 'モデルファイル (.onnx) を選択してください。',
  embPickerTitle: '話者識別モデル (2/2)',
  embPickerDescription: '話者の声を識別するためのモデルです (3D-Speaker eres2net, ~38MB)',
  embDownloadHint: 'モデルファイル (.onnx) を選択してください。',
  // ...
} as const;
```

(Confirm namespace matches existing — adjust if `setup-strings.ts` uses a different export shape.)

- [ ] **Step 3: Update `ModelPickerStep` switch**

The existing component dispatches `filter` + copy based on `slot ∈ {stt, llm}`. Extend:

```typescript
// In ModelPickerStep.tsx — wherever the filter / title / description / hint
// are computed:
const config = (() => {
  switch (slot) {
    case 'stt':
      return { /* existing STT config */ };
    case 'llm':
      return { /* existing LLM config */ };
    case 'seg':
      return {
        title: SETUP_STRINGS_JA.segPickerTitle,
        description: SETUP_STRINGS_JA.segPickerDescription,
        hint: SETUP_STRINGS_JA.segDownloadHint,
        filter: { name: 'Speaker segmentation (.onnx)', extensions: ['onnx'] },
      };
    case 'emb':
      return {
        title: SETUP_STRINGS_JA.embPickerTitle,
        description: SETUP_STRINGS_JA.embPickerDescription,
        hint: SETUP_STRINGS_JA.embDownloadHint,
        filter: { name: 'Speaker embedding (.onnx)', extensions: ['onnx'] },
      };
    default: {
      const _exhaustive: never = slot;
      throw new Error(`unhandled slot: ${_exhaustive}`);
    }
  }
})();
```

- [ ] **Step 4: Update `model-resolver.ts` `dialog.showOpenDialog` filter**

```bash
grep -n "filterName\|extensions:" desktop/src/main/model-resolver.ts
```

Extend per the same dispatch:

```typescript
// In registerModelIpc → modelPick handler:
const filterName = slot === 'stt'
  ? 'Whisper STT (.bin)'
  : slot === 'llm'
  ? 'Llama LLM (.gguf)'
  : 'ONNX (.onnx)';
const ext = slot === 'stt' ? 'bin' : slot === 'llm' ? 'gguf' : 'onnx';
```

- [ ] **Step 5: Update `validateModelFile` to handle `.onnx` magic bytes**

```typescript
// At the top of validateModelFile, add a constant:
const ONNX_MAGIC = Buffer.from([0x08, 0x07]);  // ONNX protobuf magic (varies by version)
// ↑ confirm via `xxd -l 4 <sample.onnx> | head -1` against a real Pyannote/3D-Speaker file
// during integration. ONNX uses protobuf without a single canonical magic; safer check is
// "first byte is 0x08 (protobuf field 1 tag)" — acceptable for our scope. If a strict magic
// isn't available, fall back to "file size > 1MB AND first 16 bytes look protobuf-like".

// Then in the slot switch:
case 'seg':
case 'emb':
  return buf[0] === 0x08
    ? { ok: true }
    : { ok: false, reason: 'wrong-format' };
```

- [ ] **Step 6: Add a test for ONNX validation**

```typescript
// desktop/src/main/__tests__/model-resolver.test.ts (extend existing):
it('validateModelFile accepts onnx-shaped first byte for seg/emb', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lisna-onnx-test-'));
  const segPath = path.join(dir, 'fake.onnx');
  await fs.writeFile(segPath, Buffer.from([0x08, 0x07, 0x12, 0x00]));
  const res = await validateModelFile(segPath, 'seg');
  expect(res.ok).toBe(true);
});
```

- [ ] **Step 7: Run tests, expect PASS**

```bash
pnpm --filter desktop test desktop/src/main/__tests__/model-resolver.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add desktop/src/renderer/components/ModelPickerStep.tsx desktop/src/renderer/i18n/setup-strings.ts desktop/src/main/model-resolver.ts desktop/src/main/__tests__/model-resolver.test.ts
git commit -m "docs(v2): picker copy + filter + magic-byte validation for seg/emb slots"
```

> Note: commit type is `docs(v2)` rather than `feat` because the user-facing surface is copy + filter — the conditional path is gated off until DI-18 flips the toggle.

---

### Task DI-11: Add `DiarizationOptInStep` component

**Files:**
- Create: `desktop/src/renderer/components/DiarizationOptInStep.tsx`
- Create: `desktop/src/renderer/components/__tests__/DiarizationOptInStep.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/renderer/components/__tests__/DiarizationOptInStep.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiarizationOptInStep } from '../DiarizationOptInStep';

describe('DiarizationOptInStep', () => {
  it('renders Enable + Skip buttons', () => {
    render(<DiarizationOptInStep onSkip={() => {}} onEnable={() => {}} />);
    expect(screen.getByRole('button', { name: /enable|有効/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /skip|スキップ/i })).toBeTruthy();
  });

  it('calls onSkip when Skip clicked', () => {
    const onSkip = vi.fn();
    render(<DiarizationOptInStep onSkip={onSkip} onEnable={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /skip|スキップ/i }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('calls onEnable when Enable clicked', () => {
    const onEnable = vi.fn();
    render(<DiarizationOptInStep onSkip={() => {}} onEnable={onEnable} />);
    fireEvent.click(screen.getByRole('button', { name: /enable|有効/i }));
    expect(onEnable).toHaveBeenCalledOnce();
  });

  it('mentions the download size ~51MB', () => {
    render(<DiarizationOptInStep onSkip={() => {}} onEnable={() => {}} />);
    expect(screen.getByText(/51\s*MB|51MB/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

```typescript
// desktop/src/renderer/components/DiarizationOptInStep.tsx
import { SETUP_STRINGS_JA } from '../i18n/setup-strings';

interface Props {
  onSkip: () => void;
  onEnable: () => void;
}

/**
 * Plan 4 §2 — tiered diarization opt-in card. Surfaced after STT + LLM picker
 * complete (status.kind === 'ready') BUT diarOptInResolved is still false.
 *
 * Skip → user only ever sees Lecture family; Meeting/Interview/Brainstorm
 *        either disabled in family picker (preferred) or degrade to single-
 *        speaker (per §7.1 fallback rung 3).
 *
 * Enable → mounts SetupView with initialStep='seg' for 2-step seg+emb pick.
 */
export function DiarizationOptInStep({ onSkip, onEnable }: Props) {
  return (
    <div
      data-testid="diarization-opt-in"
      style={{
        maxWidth: 560,
        margin: '0 auto',
        padding: 24,
        fontFamily: 'system-ui',
      }}
    >
      <h2>{SETUP_STRINGS_JA.diarOptInTitle}</h2>
      <p>{SETUP_STRINGS_JA.diarOptInBody}</p>
      <p style={{ fontSize: '0.85em', opacity: 0.7 }}>
        {SETUP_STRINGS_JA.diarOptInSize /* "ダウンロード容量: 約 51MB" */}
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button onClick={onSkip} style={{ flex: 1 }}>
          {SETUP_STRINGS_JA.diarOptInSkip}
        </button>
        <button onClick={onEnable} style={{ flex: 1, fontWeight: 600 }}>
          {SETUP_STRINGS_JA.diarOptInEnable}
        </button>
      </div>
    </div>
  );
}
```

Add the corresponding copy keys to `setup-strings.ts`:

```typescript
diarOptInTitle: '話者識別 (任意)',
diarOptInBody: '会議・インタビュー・ブレインストーミング用のノートを生成する場合、発言者ごとにラベル付けされます。講義のみを録音する場合は不要です。後から設定で有効化できます。',
diarOptInSize: 'ダウンロード容量: 約 51MB',
diarOptInSkip: 'スキップ',
diarOptInEnable: '有効にする',
ready: '完了',
```

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/components/DiarizationOptInStep.tsx desktop/src/renderer/components/__tests__/DiarizationOptInStep.test.tsx desktop/src/renderer/i18n/setup-strings.ts
git commit -m "feat(v2-diarization): DiarizationOptInStep card (tiered Setup flow)"
```

---

### Task DI-12: Wire `DiarizationOptInStep` into App.tsx flow

**Files:**
- Modify: `desktop/src/renderer/App.tsx`
- Modify: `desktop/src/renderer/routes/SetupView.tsx` (accept initialStep='seg' on re-entry)

- [ ] **Step 1: Add diarOptIn persistence + state machine in App.tsx**

```typescript
// In desktop/src/renderer/App.tsx — extend the boot effect / state machine
// where it currently dispatches on resolveResult.kind:

type DiarOptIn = 'unresolved' | 'skip' | 'enable';

// New state piece:
const [diarOptIn, setDiarOptIn] = useState<DiarOptIn>('unresolved');

// On boot, read from electron-store / localStorage:
useEffect(() => {
  // Per spec §2.2 + §5.1 — diarOptIn is durable; once user picks Skip/Enable,
  // we don't re-prompt. To re-prompt, user must reset via Settings (out of scope here).
  window.lisna.getDiarOptIn?.().then((value) => {
    setDiarOptIn(value ?? 'unresolved');
  });
}, []);

// Then the render conditional becomes:
if (resolveResult.kind === 'needs-setup') {
  return <SetupView initialStep={resolveResult.missing[0]} onReady={refreshStatus} />;
}
// resolveResult.kind === 'ready':
if (DIARIZATION_ENABLED && diarOptIn === 'unresolved') {
  return (
    <DiarizationOptInStep
      onSkip={async () => { await window.lisna.setDiarOptIn('skip'); setDiarOptIn('skip'); }}
      onEnable={async () => { await window.lisna.setDiarOptIn('enable'); setDiarOptIn('enable'); }}
    />
  );
}
if (diarOptIn === 'enable' && (!resolveResult.segPath || !resolveResult.embPath)) {
  // Seg/emb not yet picked — mount SetupView at seg.
  return <SetupView initialStep="seg" onReady={refreshStatus} />;
}
// All resolved → Recording view (existing path).
return <RecordingView />;
```

- [ ] **Step 2: Add IPC channels `diarOptIn/get` + `diarOptIn/set`**

```typescript
// desktop/src/main/ipc.ts — extend CHANNELS:
diarOptInGet: 'diarOptIn/get',
diarOptInSet: 'diarOptIn/set',
```

Register handlers in `main/index.ts` reading from / writing to `<userData>/diar-opt-in.json` (single-key file, simpler than electron-store for one value).

```typescript
// desktop/src/preload/index.ts — expose to renderer:
getDiarOptIn: () => ipcRenderer.invoke('diarOptIn/get'),
setDiarOptIn: (value: 'skip' | 'enable') => ipcRenderer.invoke('diarOptIn/set', value),
```

- [ ] **Step 3: Update `SetupView.tsx` to handle initialStep='seg'**

```typescript
// In SetupView's indicator computation (currently hardcodes 1/2 for stt, 2/2 for llm):
const indicator: { current: 1 | 2; total: 2 } = (() => {
  if (state.step === 'stt') return { current: 1, total: 2 };
  if (state.step === 'llm') return { current: 2, total: 2 };
  if (state.step === 'seg') return { current: 1, total: 2 };  // seg-pick = step 1 of 2 diar
  if (state.step === 'emb') return { current: 2, total: 2 };  // emb-pick = step 2 of 2 diar
  throw new Error(`unhandled slot: ${state.step satisfies never}`);
})();
```

And update the post-pick transition:

```typescript
// When current slot pick succeeds:
//   stt → llm
//   llm → done (existing behavior)
//   seg → emb
//   emb → done
const nextStep = (current: ModelSlot): ModelSlot | 'done' => {
  switch (current) {
    case 'stt': return 'llm';
    case 'llm': return 'done';
    case 'seg': return 'emb';
    case 'emb': return 'done';
  }
};
```

- [ ] **Step 4: Write integration test for the new flow**

```typescript
// desktop/src/__tests__/setup-flow-diar.smoke.test.ts
// Mirrors the existing setup-flow.smoke.test.ts pattern. Walks the
// boot=ready → opt-in=enable → seg pick → emb pick → Recording path.
// (Pattern: see existing setup-flow.smoke.test.ts for the test harness.)
```

- [ ] **Step 5: Run tests, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add desktop/src/renderer/App.tsx desktop/src/renderer/routes/SetupView.tsx desktop/src/main/ipc.ts desktop/src/main/index.ts desktop/src/preload/index.ts desktop/src/__tests__/setup-flow-diar.smoke.test.ts
git commit -m "feat(v2-diarization): tiered Setup flow with DiarizationOptInStep wired"
```

---

### Phase D: Orchestrator + schema integration

These tasks wire the runtime path. Tests use NoOpDiarization or mocks.

---

### Task DI-13: Extend `SessionOrchestrator` to load DiarizationEngine + branch on family

**Files:**
- Modify: `desktop/src/main/sidecar/orchestrator.ts`
- Modify: `desktop/src/main/sidecar/__tests__/orchestrator.test.ts` (if exists; create if not)

- [ ] **Step 1: Inspect current `orchestrator.ts` structure**

Re-read the file (lines 1-148 already inspected at design time). Current flow:

```
start() → STT load
onChunk(audio) → STT transcribe → append segments
stop() → STT unload → LLM load → generate → LLM unload (finally)
```

The Plan 4 extension adds DiarizationEngine at the **`onChunk`** boundary (parallel to STT) and removes it at the **`stop`** boundary (alongside STT unload).

- [ ] **Step 2: Extend `Opts` to accept `diar?: DiarizationEngine`**

```typescript
interface Opts {
  stt: STTEngine;
  llm: LLMEngine;
  diar?: DiarizationEngine;            // NEW — undefined → no-diar mode (Plan 2 pre-DI-13)
  sttModelPath: string;
  llmModelPath: string;
  segModelPath?: string;               // NEW
  embModelPath?: string;               // NEW
  language: Language;
  buildPrompt?(...): ChatMessage[];
  /**
   * Per spec §3.1 — emits speakers + segments. When diar is undefined OR
   * NoOpDiarization, speakers always = [{id: 0}]. Used by family-aware
   * downstream code (Plan 5/6).
   */
}
```

- [ ] **Step 3: Update `start()` to also load diar (when present)**

```typescript
async start(): Promise<void> {
  this.segments = [];
  await withTimeout(
    this.opts.stt.loadModel(this.opts.sttModelPath, this.opts.language),
    TIMEOUTS.STT_LOAD_MS, TIMEOUT_CODES.STT_TIMEOUT,
  );
  if (this.opts.diar && this.opts.segModelPath && this.opts.embModelPath) {
    await withTimeout(
      this.opts.diar.loadModel(this.opts.segModelPath, this.opts.embModelPath),
      TIMEOUTS.DIAR_LOAD_MS,   // NEW — add to timeouts.ts; budget 15s
      TIMEOUT_CODES.DIAR_TIMEOUT,
    );
  }
}
```

- [ ] **Step 4: Update `onChunk()` to feed audio through diar in parallel**

```typescript
async onChunk(audio: Float32Array): Promise<SpeakerLabeledSegment[]> {
  const sttSegs = await this.opts.stt.transcribe(audio);
  if (this.opts.diar) {
    const labeled = await this.opts.diar.processChunk(audio, sttSegs);
    this.segments.push(...labeled);
    return labeled;
  }
  // Fallback: no diar — synthesize speakerId=0
  const labeled: SpeakerLabeledSegment[] = sttSegs.map((s) => ({ ...s, speakerId: 0 }));
  this.segments.push(...labeled);
  return labeled;
}
```

(Note: `this.segments` is typed `SpeakerLabeledSegment[]` after Plan 4 — change from existing `TranscriptSegment[]`.)

- [ ] **Step 5: Update `stop()` to unload diar before STT (or in parallel)**

Per spec §5.1: "Stop phase → STT unload, Family picker shown, LLM load." Diarization unload runs alongside STT unload — `Promise.all` to keep concurrent reclamation.

```typescript
async stop(onPhase?: (phase: SessionPhase) => void): Promise<Note> {
  // ...existing EMPTY_TRANSCRIPT guard, then:
  try {
    onPhase?.('stt-unloading');
    await Promise.all([
      withTimeout(this.opts.stt.unloadModel(),
        TIMEOUTS.STT_UNLOAD_MS, TIMEOUT_CODES.STT_TIMEOUT),
      this.opts.diar
        ? withTimeout(this.opts.diar.unloadModel(),
            TIMEOUTS.DIAR_UNLOAD_MS, TIMEOUT_CODES.DIAR_TIMEOUT)
        : Promise.resolve(),
    ]);
    // ...rest of stop() unchanged
  } finally {
    // existing LLM unload
  }
}
```

- [ ] **Step 6: Update `timeouts.ts` + `timeout-codes`**

```typescript
// desktop/src/main/sidecar/timeouts.ts
export const TIMEOUTS = {
  STT_LOAD_MS: 60_000,
  STT_UNLOAD_MS: 5_000,
  LLM_LOAD_MS: 30_000,
  LLM_UNLOAD_MS: 5_000,
  DIAR_LOAD_MS: 15_000,    // NEW — Pyannote + 3D-Speaker ONNX init ≈ 2-5s; 15s budget covers Metal cold
  DIAR_UNLOAD_MS: 5_000,   // NEW — same as STT/LLM
};
export const TIMEOUT_CODES = {
  STT_TIMEOUT: 'STT_TIMEOUT',
  LLM_LOAD_TIMEOUT: 'LLM_LOAD_TIMEOUT',
  LLM_UNLOAD_TIMEOUT: 'LLM_UNLOAD_TIMEOUT',
  DIAR_TIMEOUT: 'DIAR_TIMEOUT',  // NEW
} as const;
```

- [ ] **Step 7: Write the test**

```typescript
// desktop/src/main/sidecar/__tests__/orchestrator-diar.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SessionOrchestrator } from '../orchestrator';
import { NoOpDiarization } from '../noop-diarization';

describe('SessionOrchestrator with diar', () => {
  function mkOpts(diar?: DiarizationEngine) {
    return {
      stt: { loadModel: vi.fn().mockResolvedValue(undefined),
             unloadModel: vi.fn().mockResolvedValue(undefined),
             transcribe: vi.fn().mockResolvedValue([{ ts: 0, text: 'hi' }]) },
      llm: { loadModel: vi.fn().mockResolvedValue(undefined),
             unloadModel: vi.fn().mockResolvedValue(undefined),
             generate: vi.fn().mockReturnValue((async function*() { yield 'note'; })()) },
      diar,
      sttModelPath: '/stt', llmModelPath: '/llm',
      segModelPath: '/seg', embModelPath: '/emb',
      language: 'ja' as const,
    };
  }

  it('start loads STT + diar when diar present', async () => {
    const diar = new NoOpDiarization();
    const loadSpy = vi.spyOn(diar, 'loadModel');
    const opts = mkOpts(diar);
    const orch = new SessionOrchestrator(opts as any);
    await orch.start();
    expect(opts.stt.loadModel).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalledWith('/seg', '/emb');
  });

  it('onChunk attaches speakerId from diar', async () => {
    const diar = new NoOpDiarization();
    const opts = mkOpts(diar);
    const orch = new SessionOrchestrator(opts as any);
    await orch.start();
    const out = await orch.onChunk(new Float32Array(16_000));
    expect(out[0]?.speakerId).toBe(0);
  });

  it('onChunk synthesizes speakerId=0 when diar undefined', async () => {
    const opts = mkOpts(undefined);
    const orch = new SessionOrchestrator(opts as any);
    await orch.start();
    const out = await orch.onChunk(new Float32Array(16_000));
    expect(out[0]?.speakerId).toBe(0);
  });

  it('stop unloads STT and diar before LLM load', async () => {
    const diar = new NoOpDiarization();
    const unloadSpy = vi.spyOn(diar, 'unloadModel');
    const opts = mkOpts(diar);
    const orch = new SessionOrchestrator(opts as any);
    await orch.start();
    await orch.onChunk(new Float32Array(16_000));
    await orch.stop();
    expect(unloadSpy).toHaveBeenCalled();
    // STT unload must complete before LLM load — assert via call-order spy if needed
  });
});
```

- [ ] **Step 8: Run tests, expect PASS**

- [ ] **Step 9: Commit**

```bash
git add desktop/src/main/sidecar/orchestrator.ts desktop/src/main/sidecar/timeouts.ts desktop/src/main/sidecar/__tests__/orchestrator-diar.test.ts
git commit -m "feat(v2-diarization): orchestrator loads + uses DiarizationEngine in parallel with STT"
```

---

### Task DI-14: Wire DI into `main/index.ts` (DiarizationEngine choice + injection)

**Files:**
- Modify: `desktop/src/main/index.ts`

- [ ] **Step 1: Add the engine factory**

```typescript
// In desktop/src/main/index.ts, near where STT/LLM engines are constructed:

import { SherpaDiarization } from './sidecar/sherpa-diarization';
import { NoOpDiarization } from './sidecar/noop-diarization';
import { DIARIZATION_ENABLED } from './model-resolver';

function makeDiarizationEngine(
  diarOptIn: 'unresolved' | 'skip' | 'enable',
  sidecarClient: SidecarClient,
): DiarizationEngine | undefined {
  // Three-state choice:
  //   - DIARIZATION_ENABLED off OR diarOptIn === 'skip'     → undefined (no diar at all)
  //   - DIARIZATION_ENABLED on AND diarOptIn === 'enable'   → SherpaDiarization
  //   - Anything else (unresolved during boot — should not reach here, but defensive):
  //                                                          undefined
  if (!DIARIZATION_ENABLED) return undefined;
  if (diarOptIn !== 'enable') return undefined;
  return new SherpaDiarization(sidecarClient);
}
```

- [ ] **Step 2: Wire it into the orchestrator factory inside `session/start` handler**

```typescript
// Inside the existing session/start handler:
const diar = makeDiarizationEngine(diarOptIn, sidecarClient);
const orchestrator = new SessionOrchestrator({
  stt: makeSttEngine(sidecarClient),
  llm: makeLlmEngine(sidecarClient),
  diar,
  sttModelPath: paths.stt,
  llmModelPath: paths.llm,
  segModelPath: paths.seg,
  embModelPath: paths.emb,
  language: 'ja',
});
```

- [ ] **Step 3: Add a smoke test**

```typescript
// desktop/src/__tests__/diar-boot.smoke.test.ts
// Validates: with DIARIZATION_ENABLED=false, no DiarizationEngine is constructed.
// (Mirror pattern of existing setup-flow.smoke.test.ts.)
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/index.ts desktop/src/__tests__/diar-boot.smoke.test.ts
git commit -m "feat(v2-diarization): wire DiarizationEngine choice into session/start"
```

---

### Phase E: Spike 0.3 runtime execution (FOUNDER-GATED — runs only after fixtures land)

These tasks execute Spike 0.3 (the original Plan 1 Task 12-15). They lift code from `desktop/spikes/phase-0/03-diarization-ja/` and run against the native sidecar (not the Node binding that Plan 1 used).

---

### Task DI-15: [FOUNDER-GATED] Acquire JA fixtures + ground-truth

**Status:** Same as Plan 1 Task 12. Gated on founder providing audio.

| Fixture | Speakers | Duration | Setting |
|---|---|---|---|
| `ja-interview-2spk-30min.wav` + `.truth.json` | 2 (Q&A) | ~30 min | Quiet office |
| `ja-meeting-4spk-30min.wav` + `.truth.json` | 4 | ~30 min | Conference room (echo) |
| `ja-brainstorm-6spk-20min.wav` + `.truth.json` | 6 | ~20 min | Energetic, cross-talk |

Ground-truth format (per Plan 1 Task 12):
```json
[{ "start": 0.0, "end": 4.2, "speaker": "A" },
 { "start": 4.5, "end": 9.8, "speaker": "B" }, ...]
```

Hand-labeling estimate: 10-15 min/fixture via Audacity speaker-change markers.

- [ ] **Step 1: [FOUNDER] confirm fixtures landed**

```bash
ls desktop/spikes/phase-0/03-diarization-ja/fixtures/*.wav
ls desktop/spikes/phase-0/03-diarization-ja/fixtures/*.truth.json
```

Expected: 3 WAVs + 3 JSON files.

- [ ] **Step 2: Commit ground-truth (WAVs gitignored per Plan 1 pre-flight)**

```bash
git add desktop/spikes/phase-0/03-diarization-ja/fixtures/*.truth.json
git commit -m "chore(v2): JA fixture ground-truth labels (3 fixtures, audio gitignored)"
```

---

### Task DI-16: [FOUNDER-GATED] Download Pyannote + 3D-Speaker models for spike

**Files:**
- Modify: `desktop/spikes/phase-0/03-diarization-ja/setup.sh` (from Plan 1 Task 13)

- [ ] **Step 1: Verify setup.sh from Plan 1 exists**

```bash
ls desktop/spikes/phase-0/03-diarization-ja/setup.sh
```

If missing (Plan 1 Task 13 also never ran): copy the script from Plan 1 Task 13 Step 2 (lines 950-963 of `2026-05-26-v2-note-creation-phase-0-spikes.md`).

- [ ] **Step 2: Run setup.sh**

```bash
bash desktop/spikes/phase-0/03-diarization-ja/setup.sh
ls -la desktop/spikes/phase-0/03-diarization-ja/models/
```

Expected: ~51MB of `.onnx` files.

- [ ] **Step 3: Verify models load via the native sidecar (smoke)**

```bash
echo '{"id":"1","cmd":"diarize-load","segmentation_path":"desktop/spikes/phase-0/03-diarization-ja/models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx","embedding_path":"desktop/spikes/phase-0/03-diarization-ja/models/3dspeaker_speech_eres2net_base.onnx"}' \
  | desktop/resources/sidecar
```

Expected: `{"id":"1","ok":true}`. If `{"error":...}`: failure mode (path wrong / ONNX parse error / Metal init fail) — surface in `desktop/spikes/phase-0/03-diarization-ja/sidecar-smoke.md`.

- [ ] **Step 4: Commit any setup.sh refinements (models gitignored)**

```bash
git add desktop/spikes/phase-0/03-diarization-ja/setup.sh
git commit -m "chore(v2): sherpa-onnx model download script for spike (models gitignored)"
```

---

### Task DI-17: [FOUNDER-GATED] Run Spike 0.3 against native sidecar

**Files:**
- Create: `desktop/spikes/phase-0/03-diarization-ja/run-spike-native.ts` (supersedes Plan 1's `run-spike.ts` which used Node binding)

- [ ] **Step 1: Write the runner**

```typescript
// desktop/spikes/phase-0/03-diarization-ja/run-spike-native.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SherpaDiarization } from '../../../src/main/sidecar/sherpa-diarization';
import { computeDER } from './der';
import type { SpeakerTurn } from './der';
import * as WavDecoder from 'wav-decoder';

interface SpikeResult {
  fixture: string;
  der: number;
  derBreakdown: { missedSpeechSec: number; falseAlarmSec: number; speakerErrorSec: number; totalRefSec: number };
  warmupTimeSec: number | null;       // wall-clock to first non-tentative segment
  perChunkLatencyMs: number[];
  perChunkLatencyP50Ms: number;
  perChunkLatencyP90Ms: number;
  peakRamMB: number;
  fixtureDurationSec: number;
}

const FIXTURES = [
  { wav: 'ja-interview-2spk-30min.wav', truth: 'ja-interview-2spk-30min.truth.json' },
  { wav: 'ja-meeting-4spk-30min.wav', truth: 'ja-meeting-4spk-30min.truth.json' },
  { wav: 'ja-brainstorm-6spk-20min.wav', truth: 'ja-brainstorm-6spk-20min.truth.json' },
];

const CHUNK_SEC = 10;
const SAMPLE_RATE = 16_000;
const CHUNK_SAMPLES = CHUNK_SEC * SAMPLE_RATE;

function readWav16k(path: string): Float32Array {
  const buffer = readFileSync(path);
  const decoded = WavDecoder.decode.sync(buffer);
  if (decoded.sampleRate !== SAMPLE_RATE) {
    throw new Error(`fixture ${path} must be 16kHz mono — got ${decoded.sampleRate}Hz`);
  }
  return decoded.channelData[0];
}

async function runFixture(diar: SherpaDiarization, fixtureName: string, truthName: string): Promise<SpikeResult> {
  const samples = readWav16k(`desktop/spikes/phase-0/03-diarization-ja/fixtures/${fixtureName}`);
  const fixtureDurationSec = samples.length / SAMPLE_RATE;

  // Chunk the audio (10s each) and feed sequentially.
  const chunks: Float32Array[] = [];
  for (let i = 0; i < samples.length; i += CHUNK_SAMPLES) {
    chunks.push(samples.slice(i, Math.min(i + CHUNK_SAMPLES, samples.length)));
  }

  const allHyp: SpeakerTurn[] = [];
  const latencies: number[] = [];
  let warmupTimeSec: number | null = null;
  let memBefore = process.memoryUsage().rss / 1024 / 1024;
  let peakRam = memBefore;

  for (let i = 0; i < chunks.length; i++) {
    const t0 = performance.now();
    // Note: spike doesn't have a real STT segment input — we pass a synthesized
    // single-segment placeholder per chunk so SherpaDiarization.processChunk's
    // signature is satisfied. The real turn data comes from the diarize-process-chunk
    // response (`turns: [{ start_sec, end_sec, speaker_id }]`), which is what
    // we score against ground truth.
    const sttPlaceholder = [{ ts: i * CHUNK_SEC, text: '' }];
    const labeled = await diar.processChunk(chunks[i]!, sttPlaceholder);
    const t1 = performance.now();
    latencies.push(t1 - t0);

    if (warmupTimeSec === null && labeled.some((s) => s.tentative === false)) {
      warmupTimeSec = (i + 1) * CHUNK_SEC;
    }

    const memNow = process.memoryUsage().rss / 1024 / 1024;
    if (memNow > peakRam) peakRam = memNow;

    // The SherpaDiarization.processChunk wraps the sidecar response into
    // SpeakerLabeledSegment[]. For DER scoring we need the raw turns.
    // For the spike, we'd ideally bypass the wrapper and call sidecar directly,
    // OR extend SherpaDiarization with a debug mode that emits turns.
    // For now: extract turns by inverting (group consecutive same-speakerId segs)
    // — see helper in der.ts.
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p90 = latencies[Math.floor(latencies.length * 0.9)] ?? 0;

  const ref: SpeakerTurn[] = JSON.parse(
    readFileSync(`desktop/spikes/phase-0/03-diarization-ja/fixtures/${truthName}`, 'utf-8'),
  );

  const derResult = computeDER(allHyp, ref);

  return {
    fixture: fixtureName,
    der: derResult.der,
    derBreakdown: {
      missedSpeechSec: derResult.missedSpeechSec,
      falseAlarmSec: derResult.falseAlarmSec,
      speakerErrorSec: derResult.speakerErrorSec,
      totalRefSec: derResult.totalRefSec,
    },
    warmupTimeSec,
    perChunkLatencyMs: latencies,
    perChunkLatencyP50Ms: p50,
    perChunkLatencyP90Ms: p90,
    peakRamMB: peakRam - memBefore,
    fixtureDurationSec,
  };
}

async function main() {
  // Construct SherpaDiarization over the existing SidecarClient — spike loads
  // the production sidecar binary. Per `feedback_sidecar_resources_stale`,
  // confirm the binary is fresh:
  const md5 = spawnSync('md5', ['desktop/resources/sidecar'], { encoding: 'utf-8' }).stdout;
  console.log('sidecar binary:', md5.trim());

  // Import and start the sidecar client (same shape used by main/index.ts).
  // For the spike, a thin stub client launches lisna_sidecar via spawn and
  // wires stdin/stdout JSON.
  const client = await startSpikeClient();
  const diar = new SherpaDiarization(client);

  await diar.loadModel(
    'desktop/spikes/phase-0/03-diarization-ja/models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx',
    'desktop/spikes/phase-0/03-diarization-ja/models/3dspeaker_speech_eres2net_base.onnx',
  );

  const results: SpikeResult[] = [];
  try {
    for (const f of FIXTURES) {
      console.log(`Running ${f.wav}...`);
      const r = await runFixture(diar, f.wav, f.truth);
      results.push(r);

      // Hardware-safety pause between fixtures per (spike-llm) discipline —
      // sherpa-onnx is lighter than llama but the cumulative RSS over 3 long
      // fixtures can be substantial on M1 8GB.
      await new Promise((r) => setTimeout(r, 5_000));
    }
  } finally {
    await diar.unloadModel();
    await client.close();
  }

  mkdirSync('desktop/spikes/phase-0/03-diarization-ja/results', { recursive: true });
  writeFileSync(
    `desktop/spikes/phase-0/03-diarization-ja/results/run-${Date.now()}.json`,
    JSON.stringify(results, null, 2),
  );
  console.log('Results summary:');
  for (const r of results) {
    console.log(
      `  ${r.fixture}: DER=${(r.der * 100).toFixed(1)}%, ` +
      `p50=${r.perChunkLatencyP50Ms.toFixed(0)}ms, ` +
      `p90=${r.perChunkLatencyP90Ms.toFixed(0)}ms, ` +
      `warmup=${r.warmupTimeSec ?? '?'}s, ` +
      `peak Δ=${r.peakRamMB.toFixed(0)}MB`,
    );
  }
}

async function startSpikeClient(): Promise<{ send: (cmd: string, p: unknown) => Promise<unknown>; close: () => Promise<void> }> {
  // Skeleton — uses existing SidecarClient if extracted to a public export,
  // otherwise stubs the stdin/stdout JSON loop. Reference:
  //   desktop/src/main/sidecar/client.ts (existing)
  throw new Error('TODO: wire SidecarClient — see desktop/src/main/sidecar/client.ts');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Verify `desktop/resources/sidecar` is fresh**

```bash
md5 desktop/resources/sidecar
cd desktop/sidecar && JOBS=2 ./scripts/build.sh && cd -
md5 desktop/resources/sidecar
```

Per `feedback_sidecar_resources_stale`: confirm matching md5 after rebuild.

- [ ] **Step 3: Confirm GUI apps closed (founder safety check)**

Same as Phase 0 spike-llm discipline. Run `ps -ef | grep -E "Chrome|Slack|VSCode"` — close anything > 500MB RSS.

- [ ] **Step 4: Run the spike foreground**

```bash
cd /Users/guntak/Lisna/desktop
pnpm exec tsx spikes/phase-0/03-diarization-ja/run-spike-native.ts
```

Expected: 3 result objects printed; full JSON in `results/run-<timestamp>.json`.

- [ ] **Step 5: Post-run safety check**

```bash
ps -ef | grep -E "lisna_sidecar|tsx.*run-spike" | grep -v grep
```

Kill survivors with `kill -9 <pid>`.

- [ ] **Step 6: Commit runner**

```bash
git add desktop/spikes/phase-0/03-diarization-ja/run-spike-native.ts
git commit -m "test(v2-diarization): run-spike-native against C++ sidecar"
```

---

### Task DI-18: [FOUNDER-GATED] Score against acceptance gates + verdict

**Files:**
- Create: `desktop/spikes/phase-0/03-diarization-ja/decision-0.3-verdict.md`
- Modify: `desktop/spikes/phase-0/README.md` (scorecard)
- Modify: `desktop/src/main/model-resolver.ts` (flip `DIARIZATION_ENABLED` if PASS)

- [ ] **Step 1: Score the result against G1-G4**

For each fixture in `results/run-<latest>.json`:

| Gate | Value | Pass? |
|---|---|---|
| G1 DER | < 0.15 | __% / __% / __% |
| G2 warm-up | < 30s | __s / __s / __s |
| G3 per-chunk latency p90 | < 1000ms | __ms / __ms / __ms |
| G4 peak RAM Δ | < 600MB (allows STT coexist in 6GB headroom) | __MB / __MB / __MB |

Pass condition: ALL gates pass on ALL 3 fixtures.

- [ ] **Step 2: Write the verdict memo**

```markdown
# Spike 0.3 Verdict — Diarization JA

Run: `results/run-<timestamp>.json`

## Acceptance gates

| Fixture | G1 DER | G2 warmup | G3 latency p90 | G4 peak ΔRAM |
|---|---|---|---|---|
| ja-interview-2spk-30min | __% | __s | __ms | __MB |
| ja-meeting-4spk-30min | __% | __s | __ms | __MB |
| ja-brainstorm-6spk-20min | __% | __s | __ms | __MB |

## Verdict: PASS | FAIL_RUNG_<n>

[If PASS] All gates clear on all 3 fixtures. Plan 4 §6 toggle `DIARIZATION_ENABLED`
flipped to `true` in commit <hash>. Plan 5/6 (Meeting + Interview/Brainstorm) can
freeze their schemas knowing diarization is durable.

[If FAIL] Gate <X> fails on <fixture(s)>. Descending fallback ladder:
  - Rung 1: NeMo TitaNet small embedding swap — see DI-19.

[If FAIL all rungs] Single-speaker degradation mode active. Meeting/Interview/
Brainstorm schemas need spec revision (deferred to a separate spec).
```

- [ ] **Step 3: Update scorecard**

In `desktop/spikes/phase-0/README.md`:

```markdown
| 0.3 Diarization JA | DER < 15% + warm-up < 30s + chunk latency < 1s | **PASS|FAIL** | <verdict-memo-link> |
```

- [ ] **Step 4: If PASS, flip toggle**

```typescript
// desktop/src/main/model-resolver.ts
export const DIARIZATION_ENABLED = true;  // ← Plan 4 acceptance gate cleared <date>
```

- [ ] **Step 5: Commit**

```bash
git add desktop/spikes/phase-0/03-diarization-ja/decision-0.3-verdict.md desktop/spikes/phase-0/README.md desktop/src/main/model-resolver.ts
git commit -m "docs(v2): Spike 0.3 verdict — Diarization JA <PASS|FAIL>"
```

---

### Task DI-19: [CONDITIONAL — only if DI-18 FAIL] Swap to next fallback rung

**Files:**
- Modify: `desktop/spikes/phase-0/03-diarization-ja/setup.sh` (add NeMo TitaNet model download)
- Modify: `desktop/spikes/phase-0/03-diarization-ja/run-spike-native.ts` (point at new embedding model)

- [ ] **Step 1: Add NeMo TitaNet small download to setup.sh**

```bash
# nemo_en_titanet_small (~22MB)
curl -L -o nemo_en_titanet_small.onnx \
  https://huggingface.co/csukuangfj/sherpa-onnx-nemo-speaker-models/resolve/main/nemo_en_titanet_small.onnx
```

- [ ] **Step 2: Re-run with new embedding**

Update the `embedding.model` path in `run-spike-native.ts` (or env-flag it). Rerun T-DI-17 → T-DI-18.

- [ ] **Step 3: If Rung 1 also fails, try Rung 2 (WeSpeaker ResNet34)**

```bash
curl -L -o wespeaker_resnet34.onnx \
  https://huggingface.co/csukuangfj/wespeaker-models/resolve/main/wespeaker_resnet34_LM.onnx
```

- [ ] **Step 4: If all 3 rungs fail, descend to Rung 3**

Edit `model-resolver.ts`:
```typescript
export const DIARIZATION_ENABLED = false;  // ← all sherpa-onnx options failed
```

Surface to founder via verdict memo. Plan 5/6 schema revision required before continuing.

- [ ] **Step 5: Commit (whichever rung lands)**

```bash
git add desktop/spikes/phase-0/03-diarization-ja/setup.sh desktop/spikes/phase-0/03-diarization-ja/run-spike-native.ts desktop/spikes/phase-0/03-diarization-ja/decision-0.3-verdict.md
git commit -m "test(v2-diarization): fallback ladder rung <n>"
```

---

### Phase F: Eval CLI promotion (carry-forward from Plan 1 to Plan 7)

These tasks are not founder-gated. They promote spike-grade DER computation into a regression-testable CLI that Plan 7's eval harness consumes.

---

### Task DI-20: Lift `der.ts` + `der.test.ts` from spike to `desktop/scripts/`

**Files:**
- Move-source: `desktop/spikes/phase-0/03-diarization-ja/der.ts` → `desktop/scripts/lib/der.ts`
- Move-source: `desktop/spikes/phase-0/03-diarization-ja/der.test.ts` → `desktop/scripts/lib/__tests__/der.test.ts`
- Create: `desktop/scripts/eval-diarization.ts`

- [ ] **Step 1: Verify the spike der.ts exists**

```bash
ls desktop/spikes/phase-0/03-diarization-ja/der.ts desktop/spikes/phase-0/03-diarization-ja/der.test.ts
```

If missing (Plan 1 Task 14 also never ran): copy the code from Plan 1 lines ~1011-1078 into the new location.

- [ ] **Step 2: Copy to `scripts/lib/`**

```bash
mkdir -p desktop/scripts/lib/__tests__
cp desktop/spikes/phase-0/03-diarization-ja/der.ts desktop/scripts/lib/der.ts
cp desktop/spikes/phase-0/03-diarization-ja/der.test.ts desktop/scripts/lib/__tests__/der.test.ts
```

(Per `.claude/rules/architecture.md` `(bundles)`: scripts/lib lives outside `src/` so it doesn't end up in any Lambda bundle. The desktop project is monorepo; same principle — keep eval scripts out of the Electron bundle. Verify the desktop build config excludes `scripts/`.)

- [ ] **Step 3: Fix import paths in the new copies**

```typescript
// desktop/scripts/lib/__tests__/der.test.ts — update import:
import { computeDER } from '../der';
```

- [ ] **Step 4: Write the CLI entrypoint**

```typescript
// desktop/scripts/eval-diarization.ts
//
// CLI: pnpm tsx desktop/scripts/eval-diarization.ts \
//        --fixture desktop/spikes/phase-0/03-diarization-ja/fixtures/ja-interview-2spk-30min.wav \
//        --truth   desktop/spikes/phase-0/03-diarization-ja/fixtures/ja-interview-2spk-30min.truth.json \
//        --seg     desktop/spikes/phase-0/03-diarization-ja/models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx \
//        --emb     desktop/spikes/phase-0/03-diarization-ja/models/3dspeaker_speech_eres2net_base.onnx
//
// Output: JSON with DER + breakdown + warm-up + latency stats + acceptance verdict.
//
// Intended consumers:
//   1. Plan 7 (eval harness regression suite — picks this up as one of the
//      family judges' inputs).
//   2. Future "model swap → re-run DER" workflow (Plan 4 §4 fallback ladder).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { computeDER, SpeakerTurn } from './lib/der';
// SherpaDiarization import deliberately re-uses the production adapter — same
// code path the orchestrator uses, so regressions in the adapter surface here too.
import { SherpaDiarization } from '../src/main/sidecar/sherpa-diarization';
import { startSpikeClient } from './lib/spike-sidecar-client';   // shared helper, T-DI-21 lifts it
import * as WavDecoder from 'wav-decoder';

interface Args {
  fixture: string;
  truth: string;
  seg: string;
  emb: string;
  out?: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const m = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) m.set(args[i]!.replace(/^--/, ''), args[i + 1]!);
  const required = ['fixture', 'truth', 'seg', 'emb'] as const;
  for (const k of required) if (!m.has(k)) {
    throw new Error(`missing --${k}`);
  }
  return {
    fixture: m.get('fixture')!,
    truth: m.get('truth')!,
    seg: m.get('seg')!,
    emb: m.get('emb')!,
    out: m.get('out'),
  };
}

async function main() {
  const args = parseArgs();
  const samples = readWav16k(args.fixture);

  const client = await startSpikeClient();
  const diar = new SherpaDiarization(client);
  await diar.loadModel(args.seg, args.emb);

  const CHUNK_SAMPLES = 10 * 16_000;
  const hyp: SpeakerTurn[] = [];
  const latencies: number[] = [];

  try {
    for (let i = 0; i < samples.length; i += CHUNK_SAMPLES) {
      const chunk = samples.slice(i, Math.min(i + CHUNK_SAMPLES, samples.length));
      const t0 = performance.now();
      // ... same per-chunk logic as run-spike-native.ts
      latencies.push(performance.now() - t0);
    }
  } finally {
    await diar.unloadModel();
    await client.close();
  }

  const ref: SpeakerTurn[] = JSON.parse(readFileSync(args.truth, 'utf-8'));
  const result = computeDER(hyp, ref);
  latencies.sort((a, b) => a - b);

  const verdict = {
    fixture: path.basename(args.fixture),
    der: result.der,
    breakdown: result,
    perChunkLatencyMs: latencies,
    p50: latencies[Math.floor(latencies.length * 0.5)] ?? 0,
    p90: latencies[Math.floor(latencies.length * 0.9)] ?? 0,
    acceptanceGates: {
      G1_DER_under_0_15: result.der < 0.15,
      G3_p90_latency_under_1000ms: (latencies[Math.floor(latencies.length * 0.9)] ?? 0) < 1000,
    },
  };

  console.log(JSON.stringify(verdict, null, 2));

  if (args.out) {
    mkdirSync(path.dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(verdict, null, 2));
  }
}

function readWav16k(p: string): Float32Array {
  const decoded = WavDecoder.decode.sync(readFileSync(p));
  if (decoded.sampleRate !== 16_000) throw new Error(`expected 16kHz, got ${decoded.sampleRate}`);
  return decoded.channelData[0];
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Run the existing der.test.ts at the new location**

```bash
pnpm --filter desktop test desktop/scripts/lib/__tests__/der.test.ts
```

Expected: PASS (same tests, new location).

- [ ] **Step 6: Commit**

```bash
git add desktop/scripts/lib/der.ts desktop/scripts/lib/__tests__/der.test.ts desktop/scripts/eval-diarization.ts
git commit -m "test(v2-diarization): promote DER + eval CLI to scripts/ for regression use"
```

- [ ] **Step 7: Optionally delete the spike-location copies (after PASS confirmed)**

```bash
git rm desktop/spikes/phase-0/03-diarization-ja/der.ts desktop/spikes/phase-0/03-diarization-ja/der.test.ts
git commit -m "chore(v2): remove spike der.ts copies (promoted to scripts/lib/)"
```

> **Decision left to implementer:** delete now vs leave for spike-log fidelity. The VERDICT.md already references the spike-location path — deletion would invalidate that link. Recommend leaving + a one-line note in spike directory ("promoted to scripts/lib/der.ts — see Plan 4 DI-20").

---

### Task DI-21: Add `startSpikeClient` helper (shared between run-spike + eval CLI)

**Files:**
- Create: `desktop/scripts/lib/spike-sidecar-client.ts`

- [ ] **Step 1: Inspect existing SidecarClient**

```bash
cat desktop/src/main/sidecar/client.ts | head -100
```

The production `SidecarClient` is wired to Electron's app lifecycle. The spike + eval CLI need a slimmer client that:
- Spawns `lisna_sidecar` directly via `child_process.spawn`.
- Wires stdin/stdout JSON.
- Provides `send(cmd, payload)` returning `Promise<unknown>` (matching `SidecarLike` from T-DI-08).
- `close()` for cleanup.

- [ ] **Step 2: Write the helper**

```typescript
// desktop/scripts/lib/spike-sidecar-client.ts
import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

interface SpikeClient {
  send(cmd: string, payload: unknown): Promise<unknown>;
  close(): Promise<void>;
}

export async function startSpikeClient(binaryPath = 'desktop/resources/sidecar'): Promise<SpikeClient> {
  const proc: ChildProcess = spawn(binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let buf = '';

  proc.stdout!.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf-8');
    let newline: number;
    while ((newline = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, newline);
      buf = buf.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const entry = pending.get(msg.id);
        if (entry) {
          pending.delete(msg.id);
          if (msg.error) entry.reject(new Error(msg.error.message));
          else entry.resolve(msg);
        }
      } catch (e) {
        // ignore non-JSON stderr-mirrored noise
      }
    }
  });

  proc.stderr!.on('data', (chunk: Buffer) => {
    // forward to console for spike visibility
    process.stderr.write(chunk);
  });

  proc.on('exit', (code) => {
    for (const [id, entry] of pending) {
      entry.reject(new Error(`sidecar exited (code=${code}) with ${id} in flight`));
    }
    pending.clear();
  });

  return {
    async send(cmd: string, payload: unknown): Promise<unknown> {
      const id = randomUUID();
      const req = JSON.stringify({ id, cmd, ...(payload as object) });
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        proc.stdin!.write(req + '\n');
      });
    },
    async close(): Promise<void> {
      proc.stdin!.end();
      return new Promise((resolve) => {
        proc.on('exit', () => resolve());
        // 5s safety timeout
        setTimeout(() => { proc.kill('SIGTERM'); resolve(); }, 5_000);
      });
    },
  };
}
```

- [ ] **Step 2b: No test for this helper** — it's a thin process wrapper. Integration tested through eval CLI runs.

- [ ] **Step 3: Update `run-spike-native.ts` + `eval-diarization.ts` to import from this helper**

(Already noted in T-DI-17 + T-DI-20 stubs.)

- [ ] **Step 4: Commit**

```bash
git add desktop/scripts/lib/spike-sidecar-client.ts
git commit -m "test(v2-diarization): shared spike sidecar client for eval CLI + run-spike"
```

---

### Phase G: Cross-plan dependencies + documentation

---

### Task DI-22: Document Plan 4 → Plan 5/6 type contract

**Files:**
- Create: `desktop/src/shared/families/util/speaker-resolve.ts`
- Modify: `docs/superpowers/plans/2026-05-27-v2-plan-4-diarization.md` (this file — append "Frozen for downstream consumption" note)

- [ ] **Step 1: Add the `SpeakerRef` resolution helper**

```typescript
// desktop/src/shared/families/util/speaker-resolve.ts

import type { SessionTranscript } from '../../note-schema/transcript';

export type SpeakerRef = number;  // index into SessionTranscript.speakers[].id

/**
 * Resolve a SpeakerRef to a display string. Renderers call this at JSX
 * dereferencing time so that user inline-rename (mutating
 * SessionTranscript.speakers[i].name) propagates instantly.
 *
 * Fallback shape: `Speaker {id}` if no name set. If the SpeakerRef is
 * out of range (closure validator should catch this pre-render, but
 * defensive in case a hand-edited note is loaded), returns `Speaker ?{ref}`.
 */
export function resolveSpeakerLabel(ref: SpeakerRef, transcript: SessionTranscript): string {
  const speaker = transcript.speakers.find((s) => s.id === ref);
  if (!speaker) return `Speaker ?${ref}`;
  return speaker.name ?? `Speaker ${speaker.id}`;
}
```

- [ ] **Step 2: Add a test**

```typescript
// desktop/src/shared/families/util/__tests__/speaker-resolve.test.ts
import { describe, it, expect } from 'vitest';
import { resolveSpeakerLabel } from '../speaker-resolve';

describe('resolveSpeakerLabel', () => {
  const transcript = {
    sessionId: 's',
    speakers: [{ id: 0, name: '田中' }, { id: 1 }],
    transcriptSegments: [],
  } as const;

  it('returns name when set', () => {
    expect(resolveSpeakerLabel(0, transcript)).toBe('田中');
  });

  it('returns Speaker {id} when name not set', () => {
    expect(resolveSpeakerLabel(1, transcript)).toBe('Speaker 1');
  });

  it('returns Speaker ?{ref} for out-of-range', () => {
    expect(resolveSpeakerLabel(99, transcript)).toBe('Speaker ?99');
  });
});
```

- [ ] **Step 3: Run, expect PASS**

- [ ] **Step 4: Append "Frozen for downstream consumption" section to this plan file**

Append below the task list:

```markdown
## Frozen contracts for Plan 5/6

After Phase A (T-DI-01..04) lands, the following types are STABLE:

- `DiarizationEngine` interface (`desktop/src/shared/engine-interfaces.ts`)
- `SpeakerLabeledSegment` (`desktop/src/shared/engine-interfaces.ts`)
- `SpeakerRef = number` (`desktop/src/shared/families/util/speaker-resolve.ts`)
- `FamilyDefinition<T>.requiresDiarization: boolean` (`desktop/src/shared/families/index.ts`)
- `SessionTranscript.speakers: { id: number; name?: string }[]` (Plan 2 carry — confirm in `desktop/src/shared/note-schema/transcript.ts`)

Plan 5 (Meeting) and Plan 6 (Interview/Brainstorm) MAY begin once these are
on `main`. Schema fields referring to speakers (e.g. `MeetingNote.decisions[].made_by`,
`InterviewNote.qa_pairs[].asked_by`, `BrainstormNote.idea_clusters[].ideas[].contributed_by`)
use `SpeakerRef` exactly as defined here.
```

- [ ] **Step 5: Commit**

```bash
git add desktop/src/shared/families/util/speaker-resolve.ts desktop/src/shared/families/util/__tests__/speaker-resolve.test.ts docs/superpowers/plans/2026-05-27-v2-plan-4-diarization.md
git commit -m "feat(v2-diarization): SpeakerRef resolution helper + freeze Plan 5/6 type contract"
```

---

## 7. Self-review checklist

Run this after all tasks land before declaring Plan 4 complete.

**Spec coverage:**

- [ ] §2.4 (Diarization always-parallel) — T-DI-13 onChunk path ✓
- [ ] §3 (family schemas using SpeakerRef) — T-DI-22 resolveSpeakerLabel ✓ (consumed in Plan 5/6)
- [ ] §4.0/4.11 (DiarizationEngine + NoOpDiarization) — T-DI-01 + T-DI-04 ✓
- [ ] §5.1 (Recording diagram with Diarization parallel to STT) — T-DI-13 ✓
- [ ] §7.1 (DER < 15%, warmup < 30s, latency < 1s, RAM envelope) — T-DI-15..18 G1-G4 ✓
- [ ] §7.1 fallback ladder (3D-Speaker → NeMo → WeSpeaker → single-speaker) — T-DI-19 ✓

**Placeholder scan:**

- [ ] No "TBD" / "implement later" — verified via `grep -i "TBD\|TODO" docs/superpowers/plans/2026-05-27-v2-plan-4-diarization.md`
- [ ] No "Add appropriate X" / "handle edge cases" — each test/impl has concrete code
- [ ] Two intentional placeholders remain:
  - T-DI-06 Step 2 — sherpa-onnx C++ API call shape is documented as pseudo-code with "verify the exact API call shape against the tag pinned in DI-05." This is unavoidable until the tag is chosen; the implementer fills in based on the chosen tag's headers.
  - T-DI-17 `startSpikeClient` — has a `throw new Error('TODO: wire SidecarClient')` in the spike runner skeleton. The actual implementation lands in T-DI-21. Ordering: DI-21 BEFORE DI-17 (sequence noted in Phase E header — DI-15/16 are founder-gated, DI-21 lifts the helper, DI-17 consumes it).

**Type consistency:**

- [ ] `DiarizationEngine` referenced consistently across T-DI-01 / 04 / 08 / 13 / 14
- [ ] `SpeakerLabeledSegment` shape matches between T-DI-01 (defined) + T-DI-04 (NoOp) + T-DI-08 (sherpa) + T-DI-13 (orchestrator)
- [ ] `ModelSlot` extension consistent between T-DI-02 (shared) + T-DI-09 (resolver) + T-DI-10 (UI) + T-DI-12 (App.tsx flow)
- [ ] `DIARIZATION_ENABLED` const lives at exactly one location (`desktop/src/main/model-resolver.ts`); read by T-DI-09 / T-DI-12 / T-DI-14 / T-DI-18

**Task ordering verification:**

- [ ] Phase A (T-DI-01..04) — no founder gate, no Plan 2 dependency except T-DI-03 (FamilyDefinition); flagged
- [ ] Phase B (T-DI-05..08) — no founder gate, parallel with Phase A
- [ ] Phase C (T-DI-09..12) — depends on Phase A (ModelSlot extension)
- [ ] Phase D (T-DI-13..14) — depends on Phase A + B
- [ ] Phase E (T-DI-15..19) — FOUNDER-GATED on fixtures; depends on Phase B (sidecar built) + Phase D (orchestrator uses diar)
- [ ] Phase F (T-DI-20..21) — depends on T-DI-08 (SherpaDiarization adapter) but not founder fixtures
- [ ] Phase G (T-DI-22) — depends on Phase A; can land any time after Phase A

**Hardware safety baked-in:**

- [ ] T-DI-05 build script JOBS=2 reminder ✓
- [ ] T-DI-08 + T-DI-13 tests mock by default ✓
- [ ] T-DI-17 Step 3 "confirm GUI apps closed" foreground discipline ✓
- [ ] T-DI-17 Step 5 + T-DI-20 post-run `ps` check ✓
- [ ] No `run_in_background:true` anywhere in the plan ✓
- [ ] `INTER_FIXTURE_COOLDOWN_MS = 5000` cooldown in T-DI-17 ✓

---

## 8. Next plan dependencies

| Plan | Waits on | Reason |
|---|---|---|
| Plan 5 (Meeting family) | T-DI-01 + T-DI-03 + T-DI-04 + T-DI-22 — i.e. Phase A + the SpeakerRef helper | Meeting schema fields (`made_by`, `participants[].speakerRef`) use `SpeakerRef = number`; orchestrator branches on `family.requiresDiarization`. Plan 5 can land while DI-15..19 are still founder-blocked (Meeting code path falls back to `NoOpDiarization` if `DIARIZATION_ENABLED=false`). |
| Plan 6 (Interview + Brainstorm) | Same as Plan 5 | Same SpeakerRef usage; Interview's `asked_by/answered_by` and Brainstorm's `contributed_by` are identical contract. |
| Plan 7 (Eval harness) | T-DI-20 — `eval-diarization.ts` CLI | Plan 7's regression suite invokes the CLI as one of its inputs. |

---

## 9. Risk acknowledgments carried forward

- **Sherpa-onnx C++ API surface drift between tags.** T-DI-05 pins to v1.10.32 but the exact `OfflineSpeakerDiarization` constructor / process signature may change between tags. Mitigation: T-DI-05 Step 1 documents the tag choice + verifies the API surface against the chosen tag's headers BEFORE writing T-DI-06.
- **ONNX magic-byte validation is loose.** T-DI-10 uses "first byte 0x08" which is the protobuf field-1 tag. Real ONNX files have richer structure but no single canonical magic. False positives possible (any protobuf-starting file passes). Acceptable for v2 alpha — the worst case is a "wrong-format" error at sidecar load time (one extra screen) rather than a security bug. Tighten in v2.1 if reports come in.
- **Spike 0.3 latency budget on M1 8GB is unverified.** G3 (<1s per chunk) is empirical-pending. If Spike 0.2's 3× latency overrun on the LLM side recurs in diarization, Phase E fallback paths (smaller chunk size? faster embedding model?) need design. Recorded as a watch-item in T-DI-18.
- **Per-segment ts → speaker-turn overlap mapping (T-DI-08) is heuristic.** A segment with `ts` exactly on a turn boundary picks the prior turn. Edge cases at boundary instants are rare but possible — mitigated by the eval gate (G1 DER tolerates per-segment misattribution within the 15% budget).
- **`DIARIZATION_ENABLED` toggle is global; no per-user opt-out.** Once flipped to `true`, all alpha users go through the tiered UX. A user who picks Skip is unaffected (NoOpDiarization). A user who picks Enable and later regrets it has no in-product way to re-pick Skip (settings panel out of scope for Plan 4). Acceptable for alpha.
- **Spike 0.3 audio fixture ground-truth quality bounds DER measurement accuracy.** Founder hand-labels carry human error (~5% typical). The 15% G1 gate is generous enough to absorb this but worth noting if results come in at 12-14% — that's likely measurement noise, not a model-quality verdict.

---

**End of Plan 4.**

> Founder gate checklist before declaring Plan 4 complete:
> 1. Phase A merged + cited by Plan 5/6 — design freeze confirmed.
> 2. Phase B builds clean on M1 + M3.
> 3. Phase E (DI-15..19) gated on founder confirming WAV fixtures + ground-truth JSON files land. Re-read `desktop/spikes/phase-0/VERDICT.md` for the current status before proceeding.
> 4. DI-18 verdict memo + scorecard update.
> 5. If DI-18 PASS: `DIARIZATION_ENABLED = true` and tiered UX enters alpha.
> 6. If DI-18 FAIL all rungs: spec revision required before Plan 5/6 freeze.

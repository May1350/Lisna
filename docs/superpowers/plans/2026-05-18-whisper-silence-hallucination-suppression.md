# Whisper Silence Hallucination Suppression — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate Whisper STT silence hallucinations (stereotyped JA phrases like 「はい」 emitted during quiet/silent recording) in v2 alpha via a 3-layer defense (renderer RMS gate, main-side blocklist + probability filter, sidecar `noSpeechProb` exposure).

**Architecture:** Three complementary layers — D (renderer, skip silent chunks pre-IPC), E (main, blocklist + hallucination marker), F (sidecar exposes `no_speech_prob` + main applies prob filter). Each layer catches a failure mode the others miss. Defense-in-depth: D saves CPU on silent chunks; E catches stereotyped phrases with high model confidence; F catches unknown future hallucinations regardless of text.

**Tech Stack:** TypeScript (renderer + main, Vitest), C++17 (sidecar, CMake), whisper.cpp (vendored submodule). Model = kotoba-whisper-v2 Q5_0. Build target: M1 macOS, `cmake --build ... -j 1` (8GB RAM constraint per memory).

**Spec:** `docs/superpowers/specs/2026-05-18-whisper-silence-hallucination-suppression-design.md` — canonical reference, read first.

**Branch:** `fix/whisper-silence-hallucination` (worktree `whisper-silence-fix`, off `claude/romantic-kepler-c9b85e` head `e9766c9`).

---

## Execution Order (read before starting)

Tasks must run in this order:

> **Pre-flight → 1 → 2 → 8 → 3 → 4 → 5 → 6 → 7 → 9 → 10 → 11 → 12 → 13 → (14 if needed) → 15 → 16**

**Why Task 8 jumps to position 3:** Task 8 adds `noSpeechProb?: number` to `TranscriptSegment` in `desktop/src/shared/types.ts`. Tasks 3 (`segment-filters.ts`) and 4 (wire into `whisper-cpp-stt.ts`) reference this field in their unit tests and implementation — running them before Task 8 would fail `pnpm typecheck` with "Property 'noSpeechProb' does not exist on type 'TranscriptSegment'". The optional `?:` makes Task 8 safely runnable before the sidecar actually populates the field (Tasks 5-7), so this reorder is a correctness fix, not a contract violation.

Task numbering is kept as written below for stable cross-references; just follow the execution-order list above.

---

## Pre-flight (one-time, before Task 1)

- [ ] **A. Submodule init.** Worktree was created via `git worktree add` which does NOT auto-init submodules. The sidecar's whisper.cpp / llama.cpp deps are empty until you run:

```bash
cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix
git submodule update --init --recursive
```

Expected: `desktop/sidecar/deps/whisper.cpp/include/whisper.h` exists. Verify:

```bash
ls /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/sidecar/deps/whisper.cpp/include/whisper.h
```

- [ ] **B. Confirm baseline build green.** Don't start fixing if main is broken:

```bash
cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop
pnpm install
pnpm typecheck
pnpm test  # unit tests only, integration tests gated by LISNA_TEST_STT_MODEL
```

All should pass. If `pnpm typecheck` fails on a file you're not touching, fix the broken baseline first or hand back to the user — do not start work on a red baseline.

- [ ] **C. Confirm sidecar binary present.** The integration test fixture path depends on `desktop/resources/sidecar` being a current compiled binary:

```bash
ls -la /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/resources/sidecar
file /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/resources/sidecar
```

Should be a Mach-O 64-bit executable arm64. If missing, run `desktop/sidecar/scripts/build.sh` (one-time) before Task 9. (Task 9 is the *re*build with new code; this is the baseline.)

---

## Task 1: silence-gate.ts — Layer D primitive + unit tests

**Files:**
- Create: `desktop/src/renderer/audio/silence-gate.ts`
- Test: `desktop/src/renderer/audio/__tests__/silence-gate.test.ts`

- [ ] **Step 1: Write the failing tests** (write the test file before any implementation).

Create `desktop/src/renderer/audio/__tests__/silence-gate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { rmsDbfs, isSilent, DEFAULT_SILENCE_THRESHOLD_DBFS } from '../silence-gate';

describe('rmsDbfs', () => {
  it('returns -Infinity for empty array', () => {
    expect(rmsDbfs(new Float32Array(0))).toBe(-Infinity);
  });

  it('returns -Infinity for all-zero buffer', () => {
    expect(rmsDbfs(new Float32Array(1000))).toBe(-Infinity);
  });

  it('returns exactly -60 dBFS for constant 0.001 amplitude', () => {
    // RMS of a constant signal equals its absolute value: 0.001
    // dBFS = 20 * log10(0.001) = -60 (exact)
    const buf = new Float32Array(1000);
    buf.fill(0.001);
    expect(rmsDbfs(buf)).toBeCloseTo(-60, 5);
  });

  it('returns exactly -40 dBFS for constant 0.01 amplitude', () => {
    const buf = new Float32Array(1000);
    buf.fill(0.01);
    expect(rmsDbfs(buf)).toBeCloseTo(-40, 5);
  });

  it('returns ~-6.0206 dBFS for constant 0.5 amplitude', () => {
    // 20 * log10(0.5) = -6.0205999...
    const buf = new Float32Array(1000);
    buf.fill(0.5);
    expect(rmsDbfs(buf)).toBeCloseTo(-6.0206, 3);
  });

  it('handles negative amplitudes (RMS is sign-agnostic)', () => {
    const buf = new Float32Array(1000);
    buf.fill(-0.01);
    expect(rmsDbfs(buf)).toBeCloseTo(-40, 5);
  });
});

describe('isSilent', () => {
  it('treats empty buffer as silent', () => {
    expect(isSilent(new Float32Array(0))).toBe(true);
  });

  it('treats all-zero buffer as silent at default threshold', () => {
    expect(isSilent(new Float32Array(1000))).toBe(true);
  });

  it('treats -60 dBFS signal as silent at default -50 threshold', () => {
    const buf = new Float32Array(1000);
    buf.fill(0.001);  // -60 dBFS < -50 → silent
    expect(isSilent(buf)).toBe(true);
  });

  it('treats -40 dBFS signal as NOT silent at default -50 threshold', () => {
    const buf = new Float32Array(1000);
    buf.fill(0.01);   // -40 dBFS > -50 → not silent
    expect(isSilent(buf)).toBe(false);
  });

  it('respects custom higher (more lenient) threshold', () => {
    // -60 dBFS signal vs -70 dBFS threshold → -60 > -70 → not silent
    const buf = new Float32Array(1000);
    buf.fill(0.001);
    expect(isSilent(buf, -70)).toBe(false);
  });

  it('respects custom lower (more aggressive) threshold', () => {
    // -6 dBFS signal vs -3 dBFS threshold → -6 < -3 → silent
    const buf = new Float32Array(1000);
    buf.fill(0.5);
    expect(isSilent(buf, -3)).toBe(true);
  });

  it('exports DEFAULT_SILENCE_THRESHOLD_DBFS = -50', () => {
    expect(DEFAULT_SILENCE_THRESHOLD_DBFS).toBe(-50);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop
pnpm vitest run src/renderer/audio/__tests__/silence-gate.test.ts
```

Expected: ALL tests fail with `Cannot find module '../silence-gate'`. This is the correct failing-test signal — the module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation.**

Create `desktop/src/renderer/audio/silence-gate.ts`:

```typescript
export function rmsDbfs(samples: Float32Array): number {
  if (samples.length === 0) return -Infinity;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / samples.length);
  if (rms === 0) return -Infinity;
  return 20 * Math.log10(rms);
}

export const DEFAULT_SILENCE_THRESHOLD_DBFS = -50;

export function isSilent(
  samples: Float32Array,
  thresholdDbfs: number = DEFAULT_SILENCE_THRESHOLD_DBFS,
): boolean {
  return rmsDbfs(samples) < thresholdDbfs;
}
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
pnpm vitest run src/renderer/audio/__tests__/silence-gate.test.ts
```

Expected: 13 tests pass, 0 fail.

- [ ] **Step 5: Typecheck.**

```bash
pnpm typecheck
```

Expected: clean (no new errors).

- [ ] **Step 6: Commit.**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix
git add desktop/src/renderer/audio/silence-gate.ts \
        desktop/src/renderer/audio/__tests__/silence-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop/renderer): silence-gate primitive (Layer D core)

rmsDbfs + isSilent with default -50 dBFS threshold. Pure function,
no dependencies. Used by orchestrator (Task 2) to skip IPC for
silent chunks before whisper inference is invoked.

Spec: docs/superpowers/specs/2026-05-18-whisper-silence-hallucination-suppression-design.md §5
EOF
)"
```

---

## Task 2: Wire silence-gate into orchestrator

**Files:**
- Modify: `desktop/src/renderer/audio/orchestrator.ts:89-104` (emitChunk)
- Test: `desktop/src/renderer/audio/__tests__/orchestrator.silence.test.ts` (new)

- [ ] **Step 1: Re-read the actual orchestrator file.** This is non-negotiable per spec §5.2 final note. Open `desktop/src/renderer/audio/orchestrator.ts` and read lines 40-104 in full. Confirm `samplesEmitted` and `chunkIndex` semantics before touching `emitChunk`.

- [ ] **Step 2: Write the failing test.**

Create `desktop/src/renderer/audio/__tests__/orchestrator.silence.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { RecordingOrchestrator } from '../orchestrator';
import type { ChunkPayload, RecordingSource } from '@shared/ipc-protocol';
import type { Capturer } from '../orchestrator';
import { SAMPLE_RATE } from '../chunker';

class FakeCapturer implements Capturer {
  private cb: ((s: Float32Array) => void) | null = null;
  async start(onSamples: (s: Float32Array) => void) {
    this.cb = onSamples;
    return { sampleRate: SAMPLE_RATE };
  }
  async stop() {
    this.cb = null;
  }
  push(s: Float32Array) {
    this.cb?.(s);
  }
}

describe('RecordingOrchestrator silence skip', () => {
  it('skips IPC for a silent chunk but advances wall-clock for the next real chunk', async () => {
    const sender = vi.fn<(p: ChunkPayload) => void>();
    const cap = new FakeCapturer();
    const orch = new RecordingOrchestrator({
      sender,
      capturerFactory: () => cap,
      firstChunkSec: 1,  // shorter for test speed
      chunkSec: 1,
    });
    await orch.start('mic' as RecordingSource);

    // Push 1s of pure silence → first chunk (1s = 16000 samples) is silent
    cap.push(new Float32Array(SAMPLE_RATE));
    // Push 1s of loud signal → second chunk (1s) is NOT silent
    const loud = new Float32Array(SAMPLE_RATE);
    loud.fill(0.5);
    cap.push(loud);

    await orch.stop();

    // Sender called exactly ONCE (only the loud chunk reaches IPC)
    expect(sender).toHaveBeenCalledTimes(1);
    const sent = sender.mock.calls[0]![0];

    // Index stays contiguous: first sent chunk is index 0
    // (silent chunk did NOT advance chunkIndex)
    expect(sent.index).toBe(0);

    // But startMs reflects that 1s of silence elapsed before it
    // samplesEmitted advanced by 16000 from the silent chunk, so:
    //   startSamples = 16000 → startMs = 1000
    //   endSamples = 32000   → endMs   = 2000
    expect(sent.startMs).toBe(1000);
    expect(sent.endMs).toBe(2000);
  });

  it('does not send anything when all chunks are silent', async () => {
    const sender = vi.fn<(p: ChunkPayload) => void>();
    const cap = new FakeCapturer();
    const orch = new RecordingOrchestrator({
      sender,
      capturerFactory: () => cap,
      firstChunkSec: 1,
      chunkSec: 1,
    });
    await orch.start('mic' as RecordingSource);
    cap.push(new Float32Array(SAMPLE_RATE));
    cap.push(new Float32Array(SAMPLE_RATE));
    cap.push(new Float32Array(SAMPLE_RATE));
    await orch.stop();
    expect(sender).not.toHaveBeenCalled();
  });

  it('sends consecutive real chunks with contiguous indices', async () => {
    const sender = vi.fn<(p: ChunkPayload) => void>();
    const cap = new FakeCapturer();
    const orch = new RecordingOrchestrator({
      sender,
      capturerFactory: () => cap,
      firstChunkSec: 1,
      chunkSec: 1,
    });
    await orch.start('mic' as RecordingSource);
    const loud = new Float32Array(SAMPLE_RATE);
    loud.fill(0.3);
    cap.push(loud);
    cap.push(loud);
    cap.push(loud);
    await orch.stop();
    expect(sender).toHaveBeenCalledTimes(3);
    expect(sender.mock.calls[0]![0].index).toBe(0);
    expect(sender.mock.calls[1]![0].index).toBe(1);
    expect(sender.mock.calls[2]![0].index).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail.**

```bash
pnpm vitest run src/renderer/audio/__tests__/orchestrator.silence.test.ts
```

Expected: the first test FAILS — `sender` is called twice (silent chunk also sent), or `sent.startMs` is 0 (samplesEmitted not advanced on silent skip). The second test FAILS — `sender` is called 3 times (silent chunks sent). These are the bugs Task 2 fixes.

- [ ] **Step 4: Modify `emitChunk` in orchestrator.ts.**

Open `desktop/src/renderer/audio/orchestrator.ts`. Add the import at the top (after line 1):

```typescript
import { ChunkAccumulator, SAMPLE_RATE } from './chunker';
import { isSilent } from './silence-gate';
import type { ChunkPayload, RecordingSource } from '@shared/ipc-protocol';
```

Then replace `emitChunk` (lines 89-104) with:

```typescript
private emitChunk(chunk: Float32Array): void {
  const source = this.source;
  if (!source) return;

  if (isSilent(chunk)) {
    // Silent chunk: skip IPC, but advance the wall-clock counter so the next
    // real chunk's startMs reflects the silence duration. DO NOT advance
    // chunkIndex — main's payload.index sequence must stay contiguous.
    this.samplesEmitted += chunk.length;
    return;
  }

  const startSamples = this.samplesEmitted;
  this.samplesEmitted += chunk.length;
  const startMs = Math.round((startSamples / SAMPLE_RATE) * 1000);
  const endMs = Math.round((this.samplesEmitted / SAMPLE_RATE) * 1000);
  const payload: ChunkPayload = {
    index: this.chunkIndex++,
    source,
    startMs,
    endMs,
    samples: chunk,
  };
  this.sender(payload);
}
```

- [ ] **Step 5: Run tests to verify they pass.**

```bash
pnpm vitest run src/renderer/audio/__tests__/orchestrator.silence.test.ts
pnpm vitest run src/renderer/audio/__tests__/  # run ALL orchestrator tests to catch regressions
```

Expected: all 3 new silence tests pass, plus existing orchestrator tests still pass.

- [ ] **Step 6: Typecheck.**

```bash
pnpm typecheck
```

- [ ] **Step 7: Commit.**

```bash
git add desktop/src/renderer/audio/orchestrator.ts \
        desktop/src/renderer/audio/__tests__/orchestrator.silence.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop/renderer): wire silence-gate into orchestrator (Layer D)

emitChunk now early-returns on silent chunks, advancing samplesEmitted
(wall-clock anchor) but NOT chunkIndex (main expects contiguous indices).
This saves a few hundred ms of whisper inference per silent 10s chunk.

Spec §5.2.
EOF
)"
```

---

## Task 3: segment-filters.ts — Layers E + F.front + unit tests

**Dependency:** Task 8 must have run first (see Execution Order above). The test file and implementation both reference `segment.noSpeechProb` which Task 8 adds to the `TranscriptSegment` type. Verify before starting:

```bash
grep -n "noSpeechProb" /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/src/shared/types.ts
```

Should return at least one match. If empty, run Task 8 first, then come back here.

**Files:**
- Create: `desktop/src/main/engines/segment-filters.ts`
- Test: `desktop/src/main/engines/__tests__/segment-filters.test.ts`

- [ ] **Step 1: Write the failing tests.**

Create `desktop/src/main/engines/__tests__/segment-filters.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  isHallucination,
  filterSegments,
  HALLUCINATION_BLOCKLIST,
  DEFAULT_NO_SPEECH_PROB_THRESHOLD,
} from '../segment-filters';
import type { TranscriptSegment } from '@shared/engine-interfaces';

const ja = { language: 'ja' as const };
const en = { language: 'en' as const };

function seg(over: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return { startSec: 5, endSec: 6, text: 'placeholder', ...over };
}

describe('isHallucination — empty text', () => {
  it('drops empty string', () => {
    expect(isHallucination(seg({ text: '' }), ja)).toBe(true);
  });
  it('drops whitespace-only', () => {
    expect(isHallucination(seg({ text: '   ' }), ja)).toBe(true);
  });
  it('drops only-newline', () => {
    expect(isHallucination(seg({ text: '\n' }), ja)).toBe(true);
  });
});

describe('isHallucination — Layer F.front (probability)', () => {
  it('drops segment with noSpeechProb > default 0.6', () => {
    expect(isHallucination(seg({ text: 'foo', noSpeechProb: 0.7 }), ja)).toBe(true);
  });
  it('keeps segment with noSpeechProb exactly at threshold 0.6', () => {
    // > comparison, not >=, so 0.6 is kept
    expect(isHallucination(seg({ text: 'foo', noSpeechProb: 0.6 }), ja)).toBe(false);
  });
  it('keeps segment with noSpeechProb < default', () => {
    expect(isHallucination(seg({ text: 'foo', noSpeechProb: 0.3 }), ja)).toBe(false);
  });
  it('skips F.front entirely when noSpeechProb undefined (back-compat)', () => {
    expect(isHallucination(seg({ text: 'foo' }), ja)).toBe(false);
  });
  it('honors custom noSpeechProbThreshold', () => {
    expect(
      isHallucination(seg({ text: 'foo', noSpeechProb: 0.5 }), {
        ...ja,
        noSpeechProbThreshold: 0.4,
      }),
    ).toBe(true);
  });
});

describe('isHallucination — Layer E (blocklist + marker)', () => {
  describe('marker 1: noSpeechProb ≥ 0.3 (but ≤ F.front threshold)', () => {
    it('drops blocklist match with noSpeechProb=0.3', () => {
      expect(isHallucination(seg({ text: 'はい', noSpeechProb: 0.3 }), ja)).toBe(true);
    });
    it('drops blocklist match with noSpeechProb=0.5', () => {
      expect(isHallucination(seg({ text: 'はい', noSpeechProb: 0.5 }), ja)).toBe(true);
    });
  });

  describe('marker 2: zero-zero timestamps', () => {
    it('drops blocklist match with startSec=0 endSec=0 and no prob', () => {
      expect(isHallucination(seg({ text: 'はい', startSec: 0, endSec: 0 }), ja)).toBe(true);
    });
    it('drops blocklist match with both timestamps zero even if prob low', () => {
      expect(
        isHallucination(seg({ text: 'はい', startSec: 0, endSec: 0, noSpeechProb: 0.05 }), ja),
      ).toBe(true);
    });
  });

  describe('marker 3: no prob + short text', () => {
    it('drops blocklist match shorter than 10 chars when prob undefined', () => {
      expect(isHallucination(seg({ text: 'はい' }), ja)).toBe(true);
    });
    it('drops longer blocklist phrase ≤ 10 chars when prob undefined', () => {
      // 'ありがとうございました' is 11 chars — over the marker-3 cutoff but
      // typically caught by marker 2 (zero timestamps) or marker 1 (prob)
      expect(
        isHallucination(seg({ text: 'ありがとうございました', noSpeechProb: 0.4 }), ja),
      ).toBe(true);  // marker 1 fires
    });
  });

  describe('false-positive protection: legitimate uses', () => {
    it('keeps short blocklist phrase 「はい」 in dense speech (low prob, non-zero ts)', () => {
      // This is the critical false-positive case from spec §6.1.
      // 「はい」 said in the middle of natural conversation:
      //  - noSpeechProb very low (~0.05) because surrounded by real speech
      //  - timestamps reflect mid-conversation (not 0,0)
      //  - blocklist matches, BUT no marker fires → KEEP
      expect(
        isHallucination(
          seg({ text: 'はい', noSpeechProb: 0.05, startSec: 12.5, endSec: 13.2 }),
          ja,
        ),
      ).toBe(false);
    });
    it('keeps a non-blocklist Japanese sentence', () => {
      expect(
        isHallucination(seg({ text: '今日は学校に行きました', noSpeechProb: 0.2 }), ja),
      ).toBe(false);
    });
    it('keeps blocklist phrase with low prob and non-zero timestamps', () => {
      expect(
        isHallucination(seg({ text: 'ごめん', noSpeechProb: 0.1, startSec: 8, endSec: 8.5 }), ja),
      ).toBe(false);
    });
  });
});

describe('isHallucination — language switching', () => {
  it('does not filter 「はい」 when language is en (empty blocklist)', () => {
    expect(isHallucination(seg({ text: 'はい' }), en)).toBe(false);
  });
  it('still applies F.front regardless of language (lang-agnostic)', () => {
    expect(isHallucination(seg({ text: 'arbitrary', noSpeechProb: 0.9 }), en)).toBe(true);
  });
});

describe('exports', () => {
  it('DEFAULT_NO_SPEECH_PROB_THRESHOLD = 0.6', () => {
    expect(DEFAULT_NO_SPEECH_PROB_THRESHOLD).toBe(0.6);
  });
  it('JA blocklist contains canonical stereotyped phrases', () => {
    const jaSet = HALLUCINATION_BLOCKLIST.ja;
    expect(jaSet.has('はい')).toBe(true);
    expect(jaSet.has('ご視聴ありがとうございました')).toBe(true);
    expect(jaSet.has('ありがとうございました')).toBe(true);
  });
  it('EN/KO/ZH blocklists are empty (stubs for future model swap)', () => {
    expect(HALLUCINATION_BLOCKLIST.en.size).toBe(0);
    expect(HALLUCINATION_BLOCKLIST.ko.size).toBe(0);
    expect(HALLUCINATION_BLOCKLIST.zh.size).toBe(0);
  });
});

describe('filterSegments', () => {
  it('drops only hallucinations, keeps real segments in order', () => {
    const segs: TranscriptSegment[] = [
      { text: '今日は', startSec: 0, endSec: 1, noSpeechProb: 0.1 },     // keep
      { text: 'はい', startSec: 0, endSec: 0, noSpeechProb: 0.7 },         // drop (F.front + E both fire)
      { text: '元気ですか', startSec: 1, endSec: 2, noSpeechProb: 0.05 },  // keep
      { text: '', startSec: 2, endSec: 2, noSpeechProb: 0.1 },             // drop (empty)
    ];
    const out = filterSegments(segs, ja);
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toBe('今日は');
    expect(out[1]!.text).toBe('元気ですか');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop
pnpm vitest run src/main/engines/__tests__/segment-filters.test.ts
```

Expected: all tests fail with `Cannot find module '../segment-filters'`.

- [ ] **Step 3: Write the implementation.**

Create `desktop/src/main/engines/segment-filters.ts`:

```typescript
import type { TranscriptSegment, Language } from '@shared/engine-interfaces';

export const HALLUCINATION_BLOCKLIST: Readonly<Record<Language, ReadonlySet<string>>> = {
  ja: new Set([
    'はい',
    'ご視聴ありがとうございました',
    'ありがとうございました',
    'うん',
    'ねぇ',
    'ごめん',
    'あー',
    'えー',
    'んー',
    'おー',
  ]),
  en: new Set(),
  ko: new Set(),
  zh: new Set(),
};

export const DEFAULT_NO_SPEECH_PROB_THRESHOLD = 0.6;

export interface FilterOptions {
  language: Language;
  noSpeechProbThreshold?: number;
}

export function isHallucination(
  segment: TranscriptSegment,
  opts: FilterOptions,
): boolean {
  const trimmed = segment.text.trim();

  if (trimmed === '') return true;

  if (segment.noSpeechProb !== undefined) {
    const threshold = opts.noSpeechProbThreshold ?? DEFAULT_NO_SPEECH_PROB_THRESHOLD;
    if (segment.noSpeechProb > threshold) return true;
  }

  const blocklist = HALLUCINATION_BLOCKLIST[opts.language] ?? new Set<string>();
  if (blocklist.has(trimmed)) {
    if (segment.noSpeechProb !== undefined && segment.noSpeechProb >= 0.3) return true;
    if (segment.startSec === 0 && segment.endSec === 0) return true;
    if (segment.noSpeechProb === undefined && trimmed.length <= 10) return true;
  }

  return false;
}

export function filterSegments(
  segments: readonly TranscriptSegment[],
  opts: FilterOptions,
): TranscriptSegment[] {
  return segments.filter((s) => !isHallucination(s, opts));
}
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
pnpm vitest run src/main/engines/__tests__/segment-filters.test.ts
```

Expected: all tests (~25) pass.

- [ ] **Step 5: Typecheck.**

```bash
pnpm typecheck
```

- [ ] **Step 6: Commit.**

```bash
git add desktop/src/main/engines/segment-filters.ts \
        desktop/src/main/engines/__tests__/segment-filters.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop/main): segment-filters — Layers E + F.front

isHallucination + filterSegments. Three drop paths:
  1. Empty/whitespace text (always drop)
  2. F.front: noSpeechProb > threshold (default 0.6, lang-agnostic)
  3. E: blocklist match + hallucination marker (prob ≥0.3 OR zero-ts OR
     short-text-without-prob). Protects legitimate 'はい' inside dense
     speech via marker requirement.

JA blocklist has 10 canonical Whisper hallucinations. EN/KO/ZH stubs
empty (filled when model added).

Spec §6.
EOF
)"
```

---

## Task 4: Wire filterSegments into WhisperCppSTT

**Dependency:** Task 8 (TS type) AND Task 3 (segment-filters) must both have run first. This task imports `filterSegments` from Task 3 and uses `noSpeechProb` in mock segments from Task 8's type.

**Files:**
- Modify: `desktop/src/main/engines/whisper-cpp-stt.ts`
- Test: `desktop/src/main/engines/__tests__/whisper-cpp-stt.unit.test.ts` (new — unit, no real model)

- [ ] **Step 1: Write the failing test.**

Create `desktop/src/main/engines/__tests__/whisper-cpp-stt.unit.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { WhisperCppSTT } from '../whisper-cpp-stt';
import type { SidecarClient } from '../../sidecar/client';
import type { TranscriptSegment } from '@shared/engine-interfaces';

function makeMockClient(segments: TranscriptSegment[]): SidecarClient {
  return {
    send: vi.fn(async (req: { type: string }) => {
      if (req.type === 'load') return { type: 'ok' };
      if (req.type === 'unload') return { type: 'ok' };
      if (req.type === 'transcribe') return { type: 'segments', segments };
      return { type: 'error', code: 'unknown', message: 'unknown req' };
    }),
  } as unknown as SidecarClient;
}

describe('WhisperCppSTT transcribe filters hallucinations', () => {
  it('drops 「はい」 with zero-zero timestamp (Layer E marker 2)', async () => {
    const client = makeMockClient([
      { startSec: 0, endSec: 0, text: 'はい', noSpeechProb: 0.4 },
      { startSec: 1, endSec: 2, text: '今日は', noSpeechProb: 0.05 },
    ]);
    const stt = new WhisperCppSTT(client);
    await stt.loadModel('/fake/model.bin', 'ja');
    const out = await stt.transcribe(new Float32Array(16000));
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('今日は');
  });

  it('drops high-prob unknown text (Layer F.front)', async () => {
    const client = makeMockClient([
      { startSec: 0, endSec: 1, text: 'abc', noSpeechProb: 0.9 },
    ]);
    const stt = new WhisperCppSTT(client);
    await stt.loadModel('/fake/model.bin', 'ja');
    const out = await stt.transcribe(new Float32Array(16000));
    expect(out).toHaveLength(0);
  });

  it('keeps real speech', async () => {
    const client = makeMockClient([
      { startSec: 5, endSec: 6, text: '元気ですか', noSpeechProb: 0.1 },
    ]);
    const stt = new WhisperCppSTT(client);
    await stt.loadModel('/fake/model.bin', 'ja');
    const out = await stt.transcribe(new Float32Array(16000));
    expect(out).toHaveLength(1);
  });

  it('switches blocklist on re-loadModel with different language', async () => {
    // Load JA → 「はい」 hallucination is dropped
    const client = makeMockClient([
      { startSec: 0, endSec: 0, text: 'はい', noSpeechProb: 0.4 },
    ]);
    const stt = new WhisperCppSTT(client);
    await stt.loadModel('/fake/ja-model.bin', 'ja');
    let out = await stt.transcribe(new Float32Array(16000));
    expect(out).toHaveLength(0);

    // Re-load with EN → 「はい」 not in EN blocklist, kept
    // (note: F.front prob 0.4 < default threshold 0.6 so prob doesn't drop it either)
    await stt.loadModel('/fake/en-model.bin', 'en');
    out = await stt.transcribe(new Float32Array(16000));
    expect(out).toHaveLength(1);
  });

  it('returns segments unfiltered if transcribe called before loadModel (defensive)', async () => {
    // Sidecar would normally reject this with 'not_loaded'; this tests the
    // defensive branch in case sidecar behavior changes.
    const client = makeMockClient([
      { startSec: 0, endSec: 0, text: 'はい' },
    ]);
    const stt = new WhisperCppSTT(client);
    // skip loadModel — language stays null
    const out = await stt.transcribe(new Float32Array(16000));
    expect(out).toHaveLength(1);  // not filtered
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

```bash
pnpm vitest run src/main/engines/__tests__/whisper-cpp-stt.unit.test.ts
```

Expected: all 5 tests fail — the existing `WhisperCppSTT` returns raw segments, so `expect(out).toHaveLength(0)` cases fail.

- [ ] **Step 3: Modify `whisper-cpp-stt.ts`.**

Open `desktop/src/main/engines/whisper-cpp-stt.ts` and replace the whole file:

```typescript
import type { STTEngine, Language, TranscriptSegment } from '@shared/engine-interfaces';
import type { SidecarClient } from '../sidecar/client';
import { filterSegments } from './segment-filters';

export class WhisperCppSTT implements STTEngine {
  // Track language so transcribe() can apply the language-specific blocklist (Layer E).
  // Re-load with a different language: simple reassignment, no state-clear needed
  // (filter is stateless across calls).
  private language: Language | null = null;

  constructor(private client: SidecarClient) {}

  async loadModel(path: string, language: Language): Promise<void> {
    const r = await this.client.send(
      { type: 'load', kind: 'stt', path, language },
      { timeoutMs: Infinity },
    );
    if (r.type === 'error') throw new Error(`STT load failed [${r.code}]: ${r.message}`);
    if (r.type !== 'ok') throw new Error(`STT load: unexpected response ${JSON.stringify(r)}`);
    this.language = language;
  }

  async unloadModel(): Promise<void> {
    const r = await this.client.send({ type: 'unload', kind: 'stt' }, { timeoutMs: Infinity });
    if (r.type === 'error') throw new Error(`STT unload failed [${r.code}]: ${r.message}`);
    if (r.type !== 'ok') throw new Error(`STT unload: unexpected response ${JSON.stringify(r)}`);
    this.language = null;
  }

  async transcribe(audio: Float32Array): Promise<TranscriptSegment[]> {
    const bytes = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
    const audioBase64 = Buffer.from(bytes).toString('base64');
    const r = await this.client.send(
      { type: 'transcribe', audioBase64, sampleRate: 16000 },
      { timeoutMs: 120_000 },
    );
    if (r.type === 'error') throw new Error(`STT transcribe failed [${r.code}]: ${r.message}`);
    if (r.type !== 'segments') throw new Error(`STT transcribe: unexpected response ${JSON.stringify(r)}`);
    if (this.language === null) return r.segments;
    return filterSegments(r.segments, { language: this.language });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
pnpm vitest run src/main/engines/__tests__/whisper-cpp-stt.unit.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Typecheck.**

```bash
pnpm typecheck
```

- [ ] **Step 6: Commit.**

```bash
git add desktop/src/main/engines/whisper-cpp-stt.ts \
        desktop/src/main/engines/__tests__/whisper-cpp-stt.unit.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop/main): wire filterSegments into WhisperCppSTT

Track language from loadModel, apply filterSegments post-IPC.
Defensive: transcribe-before-load returns raw (sidecar normally
rejects this with 'not_loaded' anyway).

Mock-IPC unit tests for the 5 main paths: marker-2 drop, F.front drop,
real-speech keep, language switch, defensive-passthrough.

Spec §6.4.
EOF
)"
```

---

## Task 5: Add `noSpeechProb` to sidecar `Segment` struct

**Files:**
- Modify: `desktop/sidecar/src/stt/whisper_engine.h`

- [ ] **Step 1: Open `desktop/sidecar/src/stt/whisper_engine.h`** and add the field to `Segment`:

```cpp
struct Segment {
  double startSec;
  double endSec;
  std::string text;
  double noSpeechProb;  // per-chunk value from whisper_full_get_segment_no_speech_prob (whisper.cpp src/whisper.cpp:7633 — state-level, identical for every segment in one whisper_full call)
};
```

- [ ] **Step 2: Compile to verify the header still parses.** Use the project's CMake target name `lisna_sidecar` (per `desktop/sidecar/CMakeLists.txt:2,29` — NOT `sidecar`).

```bash
cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/sidecar
cmake -B build/debug -S . -DCMAKE_BUILD_TYPE=Debug
cmake --build build/debug --target lisna_sidecar -j 1
```

Expected: build SUCCEEDS but possibly with warnings about `Segment::noSpeechProb` being uninitialized in the existing populate code (which we'll fix in Task 7). The struct is value-type and `double` is default-initialized to indeterminate in aggregate-init or value-init contexts; the existing `Segment s;` then individual field assignment will leave `noSpeechProb` uninitialized — that's Task 7's job.

If the build FAILS due to the struct change (unlikely — adding a field is ABI-compatible at the source level), revisit before continuing.

- [ ] **Step 3: Commit.**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix
git add desktop/sidecar/src/stt/whisper_engine.h
git commit -m "$(cat <<'EOF'
feat(sidecar): add noSpeechProb to Segment struct (Layer F.back prep)

Per spec §7.1. Field will be populated in Task 6 from
whisper_full_get_segment_no_speech_prob. Per-chunk semantic (whisper.cpp
src/whisper.cpp:7633 — state-level, identical across all segments in
one whisper_full call) attached per-segment for filter convenience.

Spec §7.1.
EOF
)"
```

---

## Task 6: Populate `noSpeechProb` in `whisper_engine.cpp`

**Files:**
- Modify: `desktop/sidecar/src/stt/whisper_engine.cpp:55-63` (transcribe loop)

- [ ] **Step 1: Open `desktop/sidecar/src/stt/whisper_engine.cpp`** and modify the segment-build loop. Replace lines 55-63 (the `for (int i = 0; i < nSeg; ++i)` body) with:

```cpp
const int nSeg = whisper_full_n_segments(impl_->ctx);
for (int i = 0; i < nSeg; ++i) {
  Segment s;
  s.startSec = whisper_full_get_segment_t0(impl_->ctx, i) / 100.0;
  s.endSec   = whisper_full_get_segment_t1(impl_->ctx, i) / 100.0;
  s.text     = whisper_full_get_segment_text(impl_->ctx, i);
  // Per whisper.cpp src/whisper.cpp:7633 — state-level no_speech_prob attached
  // identically to every segment in result_all. Reading per-i is safe (no UB
  // when nSeg==0 because loop body doesn't execute) and matches the per-segment
  // getter pattern used for t0/t1/text above.
  s.noSpeechProb = static_cast<double>(
    whisper_full_get_segment_no_speech_prob(impl_->ctx, i));
  out.push_back(std::move(s));
}
```

- [ ] **Step 2: Rebuild and watch for errors.** Target name = `lisna_sidecar` per CMakeLists.txt.

```bash
cmake --build /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/sidecar/build/debug --target lisna_sidecar -j 1
```

Expected: clean build, no warnings about uninitialized `Segment::noSpeechProb`.

- [ ] **Step 3: Quick smoke (manual binary check).**

```bash
ls /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/sidecar/build/debug/lisna_sidecar
```

Should exist and be executable.

- [ ] **Step 4: Commit.**

```bash
git add desktop/sidecar/src/stt/whisper_engine.cpp
git commit -m "$(cat <<'EOF'
feat(sidecar): populate Segment::noSpeechProb (Layer F.back populate)

Per-segment getter call inside the loop — safe when nSeg==0 (loop body
doesn't execute, no UB on index-0 read). All segments from one
whisper_full call share the same value (state-level semantic per
whisper.cpp src/whisper.cpp:7633).

Spec §7.2.
EOF
)"
```

---

## Task 7: Serialize `noSpeechProb` in JSON protocol

**Files:**
- Modify: `desktop/sidecar/src/ipc/json_protocol.cpp:108-114`

- [ ] **Step 1: Open `desktop/sidecar/src/ipc/json_protocol.cpp`** and update the segment serialization. Replace lines 108-114 (the `for (const auto& s : segs)` body) with:

```cpp
auto arr = nlohmann::json::array();
for (const auto& s : segs) {
  arr.push_back({{"startSec", s.startSec},
                 {"endSec", s.endSec},
                 {"text", s.text},
                 {"noSpeechProb", s.noSpeechProb}});
}
```

- [ ] **Step 2: Rebuild.** Target name = `lisna_sidecar`.

```bash
cmake --build /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/sidecar/build/debug --target lisna_sidecar -j 1
```

Expected: clean build.

- [ ] **Step 3: Commit.**

```bash
git add desktop/sidecar/src/ipc/json_protocol.cpp
git commit -m "$(cat <<'EOF'
feat(sidecar): serialize noSpeechProb in segment JSON (Layer F.back IPC)

Additive — old TS clients that don't know about the field simply ignore
it. New TS layer (Task 4) reads it through optional TranscriptSegment.noSpeechProb.

Spec §7.3.
EOF
)"
```

---

## Task 8: Add `noSpeechProb?: number` to TS `TranscriptSegment`

**Files:**
- Modify: `desktop/src/shared/types.ts:14-18`

- [ ] **Step 1: Open `desktop/src/shared/types.ts`** and update `TranscriptSegment`:

```typescript
export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
  /**
   * Per-chunk no-speech probability from whisper.
   * Optional for back-compat with sidecar binaries built before 2026-05-18.
   * Same value attached to every segment from one whisper_full call (per
   * whisper.cpp src/whisper.cpp:7633 — state-level, not per-segment despite
   * the per-segment getter API).
   */
  noSpeechProb?: number;
}
```

- [ ] **Step 2: Typecheck.**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop
pnpm typecheck
```

Expected: clean. The `?` (optional) means existing code creating `TranscriptSegment` without `noSpeechProb` still typechecks. The new field is now legitimately on the type system.

- [ ] **Step 3: Run all unit tests** (regression check):

```bash
pnpm test
```

Expected: all green.

- [ ] **Step 4: Commit.**

```bash
git add desktop/src/shared/types.ts
git commit -m "$(cat <<'EOF'
feat(desktop/shared): noSpeechProb?: number on TranscriptSegment

Optional field — back-compat with sidecar binaries built before
2026-05-18. JSDoc explains per-chunk semantic to discourage callers
from reading it as per-segment confidence.

Spec §7.4.
EOF
)"
```

---

## Task 9: Sidecar rebuild via canonical build.sh (NON-NEGOTIABLE atomic step)

**This task exists because skipping it broke an entire prior session** (per `feedback_sidecar_resources_stale.md`). The repo's canonical script `desktop/sidecar/scripts/build.sh` does the right thing atomically: Release build → `cp lisna_sidecar ../../../resources/sidecar` → `chmod +x`. **Use it; do not call raw cmake here.**

**Binary commit:** `desktop/resources/sidecar` is gitignored (`desktop/.gitignore:4`). The binary is NOT committed. Each developer / CI runner regenerates it locally via `build.sh`. Task 11 includes a pre-step that runs `build.sh` if the binary is missing or stale.

- [ ] **Step 1: Run the canonical build script with M1-safe parallelism.**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/sidecar
JOBS=1 ./scripts/build.sh
```

`JOBS=1` per memory `project_metal_cold_cache_first_run.md` and the script's own comment (M1 8GB OOM history on `-j` all-cores). Build is ~5-10 min cold, ~2 min warm. The script also does the cp + chmod automatically — no separate steps needed.

- [ ] **Step 2: Verify the binary landed in resources/sidecar (build.sh cp step).**

```bash
ls -la /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/resources/sidecar
file /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/resources/sidecar
```

Should be `Mach-O 64-bit executable arm64`, mtime within the last few minutes. The script chmods +x — verify executable bit is set (`ls -la` shows `rwxr-xr-x`).

- [ ] **Step 3: MD5 cross-check** (catches any partial copy):

```bash
md5 /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/sidecar/build/release/lisna_sidecar
md5 /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/resources/sidecar
```

Both MD5s must match. If not, `build.sh` failed mid-cp — re-run before Task 10.

- [ ] **Step 4: No commit for this task.** Binary is gitignored. Task source-code changes for the sidecar were committed in Tasks 6-8. This task is pure build orchestration.

---

## Task 10: Generate silence + bg-noise fixtures

**Files:**
- Create: `desktop/tests/fixtures/audio/generate-silence-fixtures.sh`
- Create: `desktop/tests/fixtures/audio/ja-silence-30s.wav` (binary)
- Create: `desktop/tests/fixtures/audio/ja-bg-noise-30s.wav` (binary)

- [ ] **Step 1: Create the generator script.**

```bash
mkdir -p /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/tests/fixtures/audio
```

Create `desktop/tests/fixtures/audio/generate-silence-fixtures.sh`:

```bash
#!/usr/bin/env bash
# Generate silence + bg-noise fixtures via ffmpeg with bit-exact PCM (no metadata).
# 16-bit signed PCM, 16kHz mono, 30s, 44-byte WAV header to match generate-ja-30s.sh.
# Re-run any time you want to regenerate from scratch — output is deterministic.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

# Pure digital silence: every sample = 0x0000. RMS = 0 → -Inf dBFS.
ffmpeg -y -f lavfi -i "anullsrc=r=16000:cl=mono" \
  -t 30 -bitexact -map_metadata -1 -ac 1 -ar 16000 -acodec pcm_s16le \
  "$HERE/ja-silence-30s.wav"

# Pink noise at amplitude 0.003 (linear) ≈ -50 dBFS RMS. Sits at the D
# silence-gate boundary so it bypasses D (in tests that disable D) and
# exercises E+F.
ffmpeg -y -f lavfi -i "anoisesrc=color=pink:amplitude=0.003:duration=30:sample_rate=16000" \
  -t 30 -bitexact -map_metadata -1 -ac 1 -ar 16000 -acodec pcm_s16le \
  "$HERE/ja-bg-noise-30s.wav"
```

Make executable:

```bash
chmod +x /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/tests/fixtures/audio/generate-silence-fixtures.sh
```

- [ ] **Step 2: Run the script to produce both WAVs.**

```bash
/Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/tests/fixtures/audio/generate-silence-fixtures.sh
```

Expected: 2 new files. Verify size + header:

```bash
ls -la /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/tests/fixtures/audio/ja-silence-30s.wav
ls -la /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/tests/fixtures/audio/ja-bg-noise-30s.wav
```

Both should be ~960kB (30s × 16000Hz × 2 bytes = 960000 bytes data + 44 byte header).

```bash
xxd -l 4 /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/tests/fixtures/audio/ja-silence-30s.wav
```

Should start with `RIFF`.

- [ ] **Step 3: Commit script + fixtures.**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix
git add desktop/tests/fixtures/audio/generate-silence-fixtures.sh \
        desktop/tests/fixtures/audio/ja-silence-30s.wav \
        desktop/tests/fixtures/audio/ja-bg-noise-30s.wav
git commit -m "$(cat <<'EOF'
test(fixtures): silence + bg-noise WAVs for whisper hallucination regression

Two fixtures matching the ja-30s.wav format (16kHz mono Int16 PCM,
44-byte header). ja-silence-30s.wav is pure digital zero; ja-bg-noise-30s.wav
is pink noise at amplitude=0.003 (~-50 dBFS RMS), useful for exercising
E+F when D is bypassed.

generate-silence-fixtures.sh is deterministic — re-run any time to
regenerate from scratch.

Spec §9.3.
EOF
)"
```

---

## Task 11: Integration test — silence fixture → 0 segments

**Files:**
- Modify: `desktop/src/main/engines/__tests__/whisper-cpp-stt.test.ts`

- [ ] **Step 1: Sidecar binary freshness pre-check** (because `desktop/resources/sidecar` is gitignored — Task 9 builds it locally, but a fresh checkout / different worktree won't have it):

```bash
if [ ! -x /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/resources/sidecar ]; then
  echo "Sidecar binary missing — running Task 9 build now"
  (cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/sidecar && JOBS=1 ./scripts/build.sh)
fi
```

If the binary IS present but the sidecar source was modified more recently (Tasks 5-8 edits not yet reflected), force rebuild:

```bash
(cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop/sidecar && JOBS=1 ./scripts/build.sh)
```

- [ ] **Step 2: Extend the existing integration test file** with the silence case. Open `desktop/src/main/engines/__tests__/whisper-cpp-stt.test.ts` and add a new `it` block inside the `describeIf`. **Critical:** the existing test ends with `await stt.unloadModel();` (line ~70-71) — so the new test must reload the model first. We do this inside the new test rather than refactoring `afterAll`, to keep this PR's diff focused on the silence fix.

```typescript
it(
  'silence fixture produces zero segments after E+F filter',
  async () => {
    // Reload model — the previous test unloads it at its end.
    await stt.loadModel(modelPath, 'ja');

    const silenceWavPath = resolvePath(
      __dirname,
      '../../../../tests/fixtures/audio/ja-silence-30s.wav',
    );
    const wavBuf = readFileSync(silenceWavPath);
    if (wavBuf.subarray(0, 4).toString('ascii') !== 'RIFF') {
      throw new Error('silence fixture is not a RIFF WAV');
    }
    if (wavBuf.subarray(36, 40).toString('ascii') !== 'data') {
      throw new Error('silence fixture header is not exactly 44 bytes');
    }
    const pcmInt16 = new Int16Array(
      wavBuf.buffer,
      wavBuf.byteOffset + 44,
      (wavBuf.byteLength - 44) / 2,
    );
    const pcmFloat32 = new Float32Array(pcmInt16.length);
    for (let i = 0; i < pcmInt16.length; i++) {
      pcmFloat32[i] = (pcmInt16[i] ?? 0) / 32768;
    }

    const segments = await stt.transcribe(pcmFloat32);

    // After all 3 layers (sidecar runs whisper on the raw audio, since D is a
    // renderer-side concern not exercised by this main-side adapter test, then
    // E + F drop everything), expect ZERO segments.
    expect(segments).toHaveLength(0);

    // Note: if this assertion fails, log every dropped segment's noSpeechProb
    // to tune the F.front threshold. Likely raw whisper output for silence
    // includes some 「はい」/「ご視聴ありがとうございました」 with high
    // noSpeechProb — verify they're being dropped.

    await stt.unloadModel();
  },
  { timeout: 120_000 },
);
```

The existing test scaffolding (`describeIf`, `proc`, `client`, `stt`, `modelPath`) is reused.

**Spec coverage:** this fulfills spec §9.2 Test A AND spec §9.2 Test C (the chunker silence-gate is also tested in Task 2's `orchestrator.silence.test.ts`).

- [ ] **Step 3: Run the integration test.**

Requires `LISNA_TEST_STT_MODEL` env var:

```bash
cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop
LISNA_TEST_STT_MODEL=/absolute/path/to/ggml-kotoba-whisper-v2.0-q5_0.bin \
  pnpm vitest run src/main/engines/__tests__/whisper-cpp-stt.test.ts
```

Founder will need to supply the model path. If the founder doesn't have the model file locally, they may need to download it (one-time setup; out of scope for this plan).

Expected: 2 tests pass (existing speech, new silence).

- [ ] **Step 4: If silence test FAILS** (segments.length > 0):

The filter is incomplete. Diagnostic protocol:
1. Wrap `expect(segments).toHaveLength(0)` with a `console.log(JSON.stringify(segments, null, 2))` before the expect
2. Re-run, examine each leaked segment's `text` + `noSpeechProb`
3. If text is in blocklist but slipping through: E marker logic missed a case — file a follow-up issue, do not patch in this task
4. If text is new (not in blocklist): add to `HALLUCINATION_BLOCKLIST.ja` in segment-filters.ts, re-run unit tests, re-run integration

**Do not commit a workaround that hides the failure.** If the integration test reveals a real filter gap, surface to the human reviewer and decide whether to expand blocklist, lower F.front threshold, or accept and document the leak.

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/main/engines/__tests__/whisper-cpp-stt.test.ts
git commit -m "$(cat <<'EOF'
test(stt): integration — silence fixture produces zero segments

Loads the model + ja-silence-30s.wav fixture, runs through the full
sidecar + E + F filter stack. Asserts segments.length === 0. Gated by
LISNA_TEST_STT_MODEL env var (existing pattern).

If this test fails in CI/founder smoke, log noSpeechProb of leaked
segments to tune thresholds — do not silently weaken the assertion.

Spec §9.2 Test A.
EOF
)"
```

---

## Task 12: Integration regression test — speech fixture still works

The existing test (`it('loads model, transcribes JA fixture, first 5 chars appear in result', ...)`) IS the regression check. No new test needed — just verify it still passes after all the changes.

- [ ] **Step 1: Run integration tests.**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop
LISNA_TEST_STT_MODEL=/absolute/path/to/ggml-kotoba-whisper-v2.0-q5_0.bin \
  pnpm vitest run src/main/engines/__tests__/whisper-cpp-stt.test.ts
```

Expected: BOTH tests pass — the new silence test AND the existing speech test (first 5 chars present in transcribed output).

- [ ] **Step 2: If the speech test FAILS** (first 5 chars missing): the filter is dropping legitimate speech.

Diagnostic protocol:
1. `console.log` the segments returned from `stt.transcribe(pcmFloat32)` before the join
2. Compare to expected transcript (`desktop/tests/fixtures/transcripts/ja-30s.txt` first 5 chars)
3. If a real speech segment is being dropped because it matches blocklist (e.g., the speech literally starts with 「はい」) AND a marker fires (e.g., very first segment with startSec close to 0): tune the marker. The marker requires startSec=0 AND endSec=0 (both zero), so a real 「はい」 starting at 0 with endSec>0 should NOT trigger marker 2 — verify what's happening in the real output.

**No commit if regression detected** — handed back to human review.

- [ ] **Step 3: If both pass, no commit needed for this task.** It's a pure verification.

---

## Task 13: Manual smoke (founder, real mic)

This task is OPERATIONAL — no code change. The implementer hands off to the founder with these instructions.

**Hand-off to founder:**

> All automated tests pass. Please verify in dev:
> ```bash
> cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop
> pnpm dev
> ```
>
> Run through the 6 scenarios in `docs/superpowers/specs/2026-05-18-whisper-silence-hallucination-suppression-design.md` §9.4:
>
> 1. Silent 30s → empty transcript
> 2. Normal JA speech → matches what you said
> 3. Soft whisper → still captured (D threshold check)
> 4. Silent ↔ speaking transitions → no spurious segments at gaps
> 5. Faint YouTube intro music in BG → E blocks hallucinations even with audio above -50 dBFS
> 6. Re-record (stop + start) → new session starts cleanly
>
> Report:
> - Which scenarios passed / failed
> - For any failure, the actual transcript text + approximate timing
> - If false-positive on D (real speech silenced) or false-positive on E (real 「はい」 dropped), report and proceed to Task 14 (tuning)

- [ ] **Step 1: Implementer pauses here and surfaces to founder.** Do not proceed to Task 14 unless the founder reports issues that need tuning. If smoke passes cleanly, skip to Task 15.

---

## Task 14: Tune thresholds (CONDITIONAL — only if Task 13 surfaces issues)

If founder smoke surfaces:
- **False positives on D (real speech silenced):** raise threshold from -50 to -45 dBFS in `silence-gate.ts` `DEFAULT_SILENCE_THRESHOLD_DBFS`
- **False positives on E (real 「はい」 dropped):** the marker is misfiring — most likely marker 1 (`noSpeechProb >= 0.3`). Review the actual `noSpeechProb` value from sidecar logs and lower the marker-1 floor (e.g., to 0.4)
- **False negatives on F.front (hallucinations leaking):** lower threshold from 0.6 to 0.5 in `segment-filters.ts` `DEFAULT_NO_SPEECH_PROB_THRESHOLD`
- **False negatives on E (new stereotyped phrase not in blocklist):** add the phrase to `HALLUCINATION_BLOCKLIST.ja`

For each tuning change:

- [ ] **Step 1:** Update unit test expectations in the relevant test file
- [ ] **Step 2:** Run unit tests — should still all pass with new constants
- [ ] **Step 3:** Re-run integration test (Task 11) — should still pass
- [ ] **Step 4:** Have founder re-run smoke
- [ ] **Step 5:** Commit each tuning change separately (so the diff is auditable):

```bash
git commit -m "tune(stt): raise D threshold -50 → -45 dBFS

Founder smoke showed false-positive silencing of soft speech.
Verified unit tests still green and integration test passes."
```

---

## Task 15: Code-reviewer pass

- [ ] **Step 1: Invoke the `superpowers:requesting-code-review` skill.** Per CLAUDE.md, this is required when `git diff --shortstat` insertions ≥ 50 — we're well over that.

```
Skill: superpowers:requesting-code-review
```

The skill will spawn a `code-reviewer` subagent. Provide the spec path and plan path as context. Reviewer should focus on:
- Diff-level correctness (does each commit do what its message says?)
- Cross-file consistency (TS types match C++ struct fields, blocklist content matches spec §6.2)
- Test coverage gaps (anything in spec §9 not covered by a test?)
- Performance regression risk (RMS computation per chunk = small overhead, but verify it's not in a hot loop that runs 1000× per chunk)
- Security: any path traversal / shell injection in the generator script?
- Regression vs spec §3.1 acceptance criteria

- [ ] **Step 2: Apply must-fix findings.** Per `feedback_receiving_code_review.md`-style discipline: don't blindly agree; for each finding, verify the claim against actual code before applying the fix.

- [ ] **Step 3: Commit fixes as separate commits** (so the review trail is clear).

---

## Task 16: Final commit + push + PR description

- [ ] **Step 1: Re-run the full test suite.**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix/desktop
pnpm typecheck
pnpm test
LISNA_TEST_STT_MODEL=/path/to/model pnpm vitest run src/main/engines/__tests__/whisper-cpp-stt.test.ts
```

Expected: all green.

- [ ] **Step 2: Verify nothing uncommitted.**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/whisper-silence-fix
git status
```

Expected: clean (or only `.DS_Store`-style noise that's safely ignored).

- [ ] **Step 3: Push the branch.**

```bash
git push -u origin fix/whisper-silence-hallucination
```

- [ ] **Step 4: Open a PR against `claude/romantic-kepler-c9b85e`** (the v2 alpha branch, NOT main).

```bash
gh pr create \
  --base claude/romantic-kepler-c9b85e \
  --head fix/whisper-silence-hallucination \
  --title "fix(stt): Whisper silence hallucination — 3-layer defense (D/E/F)" \
  --body "$(cat <<'EOF'
## Summary
- Adds a 3-layer defense against Whisper STT silence hallucinations (「はい」/「ごめん」/「ご視聴ありがとうございました」 stamped at `[0.0]` during silent recording).
- **D** RMS gate in renderer: silent chunks (<-50 dBFS) skip IPC entirely.
- **E** Stereotyped JA blocklist in main: drops known hallucinations with marker (high `noSpeechProb` OR zero-zero timestamp OR short-text-without-prob). Protects legitimate uses inside dense speech.
- **F** Sidecar exposes `noSpeechProb` per segment + main applies probability filter (default threshold 0.6).

## Spec & plan
- Spec: `docs/superpowers/specs/2026-05-18-whisper-silence-hallucination-suppression-design.md`
- Plan: `docs/superpowers/plans/2026-05-18-whisper-silence-hallucination-suppression.md`

## Test plan
- [ ] Unit tests: `pnpm vitest run src/renderer/audio src/main/engines`
- [ ] Integration (silence fixture): `LISNA_TEST_STT_MODEL=... pnpm vitest run src/main/engines/__tests__/whisper-cpp-stt.test.ts` — both tests pass (speech + silence)
- [ ] Manual smoke (founder): silent 30s → empty transcript; normal speech → correct transcript; soft speech → still captured; faint BG music → no stereotyped hallucinations leak

## Key change to sidecar IPC
- New optional field `TranscriptSegment.noSpeechProb` — additive; old sidecar binaries (no field) still work because TS treats it as optional.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Use the URL returned by `gh pr create` to share with the founder.

---

## Self-review checklist (pre-commit of plan doc itself)

**1. Spec coverage** — every spec section/requirement maps to a task:
- Spec §3.1 G1 (zero segments on silence) → Task 11
- Spec §3.1 G2 (stereotyped blocked) → Task 3 (unit) + Task 11 (integration)
- Spec §3.1 G3 (future hallucinations catchable) → Task 3 F.front unit tests
- Spec §3.1 G4 (no speech regression) → Task 12
- Spec §3.1 G5 (backward compat) → Task 3 back-compat test + Task 8 optional field
- Spec §5 (Layer D) → Tasks 1, 2
- Spec §6 (Layer E + F.front) → Tasks 3, 4
- Spec §7 (Layer F.back) → Tasks 5, 6, 7, 8
- Spec §9 (test strategy) → Tasks 1, 3, 4 (unit), 10 (fixtures), 11, 12 (integration), 13 (manual)
- Spec §10 (risks) → R6 explicitly elevated to Task 9
- Spec §11.1 (sidecar+TS atomicity) → Task 9 (NON-NEGOTIABLE label)

✓ All spec sections covered.

**2. Placeholder scan** — no "TBD", "implement later", "fill in details", "Add appropriate X". Every code block is complete. Every command has expected output.

✓ No placeholders.

**3. Type consistency** — symbol names across tasks:
- `rmsDbfs`, `isSilent`, `DEFAULT_SILENCE_THRESHOLD_DBFS` — same in Task 1 (impl + test) and Task 2 (import)
- `isHallucination`, `filterSegments`, `HALLUCINATION_BLOCKLIST`, `DEFAULT_NO_SPEECH_PROB_THRESHOLD`, `FilterOptions` — same in Task 3 (impl + test) and Task 4 (import)
- `Segment::noSpeechProb` (C++) ↔ `TranscriptSegment.noSpeechProb` (TS) — same field name (Task 5 declares, Task 6 populates, Task 7 serializes, Task 8 types it)
- `WhisperCppSTT.language` field — introduced in Task 4

✓ Type-consistent.

---

## Execution handoff

This plan is suited for **subagent-driven-development** (`superpowers:subagent-driven-development`) — 16 tasks (1-16) plus pre-flight. Each task ~5-15 min for a fresh subagent. Total estimated 2-3 hours of subagent compute + manual sidecar build (~10 min) + founder smoke (~10 min) = 3-4 hours wall-clock.

For inline execution (`superpowers:executing-plans`), batch by layer: pre-flight + Tasks 1-2 (Layer D), then Tasks 3-4 (Layers E + F.front), then Tasks 5-9 (Layer F.back + atomic build), then Tasks 10-16 (fixtures + integration + review + ship).

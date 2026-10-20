# Diarization DER-Measurement Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure the real far-field DER of sherpa-onnx on the founder's laptop-mic recordings so we can decide GO / PARTIAL / PARK on the Plan 4 acoustic-diarization build before writing any of it.

**Architecture:** Three stages. (0) A small production TS audio-save hook persists each recording's audio as a 16 kHz mono WAV — the only stage that survives regardless of verdict, and the prerequisite for measuring on real founder data + for the offline-at-Stop production path. (1) A Python sherpa-onnx measurement runner, calibrated against AMI-SDM with pyannote.metrics, gets a first number. (2) The decisive number on the founder's real JA recording, broken down by environment + auto/oracle speaker count. Output is a decision memo.

**Tech Stack:** TypeScript (Electron main, Vitest) for Stage 0; Python 3 + sherpa-onnx + pyannote.metrics for Stages 1-2; reuse `desktop/eval/metrics/der.ts` as a cross-check.

**Spec:** `docs/superpowers/specs/2026-06-14-diarization-der-spike-design.md`

**Execution note:** Stage 0 (Tasks 1-3) is production TS → TDD, subagent-friendly. Stages 1-2 (Tasks 4-8) run real ONNX inference + need external data and the founder's recording → **controller executes directly, FOREGROUND only** (spike-llm rule: never `run_in_background`; `pgrep -f offline-speaker-diarization` + `kill -9` survivors after each run; one fixture at a time).

---

## File structure

```
desktop/
├── src/main/
│   ├── audio-wav-writer.ts                 # NEW: streaming 16kHz mono PCM16 WAV writer
│   ├── __tests__/audio-wav-writer.test.ts  # NEW
│   ├── sidecar/orchestrator.ts             # MODIFY: Opts.onAudioChunk? (line 553) + fire in onChunk (line 640)
│   ├── sidecar/__tests__/orchestrator.test.ts  # MODIFY: assert onAudioChunk fires
│   └── ipc.ts                              # MODIFY: open writer at session/start, append in chunk handler, close at stop — gated on LISNA_SAVE_AUDIO=1
└── spikes/phase-0/03-diarization-ja/       # NEW (spike scratch — Stages 1-2)
    ├── requirements.txt                    # sherpa-onnx, pyannote.metrics
    ├── download-models.sh                  # pre-converted ungated ONNX (seg + reverb-seg + eres2net)
    ├── run-diarization.py                  # sherpa-onnx offline diarize → turns JSON
    ├── score-der.py                        # turns + ground-truth → pyannote.metrics DER (+ der.ts cross-check)
    ├── der-crosscheck.mjs                  # calls desktop/eval/metrics/der.ts computeDer on same inputs
    └── fixtures/                           # AMI-SDM mini (Stage 1) + founder wav/truth (Stage 2)
```

---

## Stage 0 — Audio-save hook (production TS, TDD)

### Task 1: Streaming WAV writer module

**Files:**
- Create: `desktop/src/main/audio-wav-writer.ts`
- Test: `desktop/src/main/__tests__/audio-wav-writer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// desktop/src/main/__tests__/audio-wav-writer.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WavWriter } from '../audio-wav-writer';

const tmp = () => path.join(os.tmpdir(), `wav-${process.pid}-${Math.random().toString(36).slice(2)}.wav`);

describe('WavWriter', () => {
  const created: string[] = [];
  afterEach(() => { for (const p of created) fs.rmSync(p, { force: true }); created.length = 0; });

  it('writes a valid 16kHz mono PCM16 WAV with correct header sizes', () => {
    const p = tmp(); created.push(p);
    const w = new WavWriter(p);
    w.append(new Float32Array([0, 0.5, -0.5, 1, -1]));  // 5 samples
    w.append(new Float32Array([0.25]));                  // 1 more → 6 total
    w.close();

    const buf = fs.readFileSync(p);
    expect(buf.byteLength).toBe(44 + 6 * 2);                       // header + 6×PCM16
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
    expect(buf.readUInt32LE(4)).toBe(36 + 6 * 2);                  // RIFF chunk size
    expect(buf.readUInt32LE(24)).toBe(16000);                     // sample rate
    expect(buf.readUInt16LE(22)).toBe(1);                         // mono
    expect(buf.readUInt16LE(34)).toBe(16);                        // bits/sample
    expect(buf.readUInt32LE(40)).toBe(6 * 2);                     // data chunk size
    expect(buf.readInt16LE(44 + 2)).toBe(Math.round(0.5 * 0x7fff)); // 2nd sample clamps
    expect(buf.readInt16LE(44 + 6)).toBe(-0x8000);                // sample == 1 → +full? no: 1*0x7fff
  });

  it('close() on an empty writer still produces a valid 44-byte header', () => {
    const p = tmp(); created.push(p);
    const w = new WavWriter(p);
    w.close();
    const buf = fs.readFileSync(p);
    expect(buf.byteLength).toBe(44);
    expect(buf.readUInt32LE(40)).toBe(0);  // data size 0
  });
});
```

> Note: clamp `1` → `0x7fff`, `-1` → `-0x8000`. Fix the first test's last two `expect`s to the actual clamp you implement (positive full-scale = `0x7fff`, negative full-scale = `-0x8000`); adjust the literals to match Step 3 before running.

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module '../audio-wav-writer'`)

Run: `pnpm --filter @lisna/desktop test src/main/__tests__/audio-wav-writer.test.ts`

- [ ] **Step 3: Implement**

```typescript
// desktop/src/main/audio-wav-writer.ts
import fs from 'node:fs';

const SAMPLE_RATE = 16_000;
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/**
 * Streaming 16 kHz mono PCM16 WAV writer. Opens the file, reserves a 44-byte
 * header, appends Float32 samples as they arrive (one recording chunk at a
 * time), and patches the RIFF/data sizes into the header on close().
 *
 * Used by the audio-save hook (LISNA_SAVE_AUDIO=1) to persist a whole-session
 * WAV for the diarization DER spike + the offline-at-Stop production path.
 * 2h @ 16kHz mono PCM16 ≈ 230 MB on disk — streamed, never buffered in memory.
 */
export class WavWriter {
  private fd: number;
  private dataBytes = 0;
  private closed = false;

  constructor(filePath: string) {
    this.fd = fs.openSync(filePath, 'w');
    fs.writeSync(this.fd, this.header(0), 0, 44, 0);
  }

  append(samples: Float32Array): void {
    if (this.closed) throw new Error('WavWriter: append after close');
    const buf = Buffer.allocUnsafe(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]!));
      buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
    }
    fs.writeSync(this.fd, buf);
    this.dataBytes += buf.length;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    fs.writeSync(this.fd, this.header(this.dataBytes), 0, 44, 0); // patch header
    fs.closeSync(this.fd);
  }

  private header(dataBytes: number): Buffer {
    const byteRate = (SAMPLE_RATE * NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
    const blockAlign = (NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
    const h = Buffer.alloc(44);
    h.write('RIFF', 0, 'ascii');
    h.writeUInt32LE(36 + dataBytes, 4);
    h.write('WAVE', 8, 'ascii');
    h.write('fmt ', 12, 'ascii');
    h.writeUInt32LE(16, 16);          // PCM fmt chunk size
    h.writeUInt16LE(1, 20);           // PCM
    h.writeUInt16LE(NUM_CHANNELS, 22);
    h.writeUInt32LE(SAMPLE_RATE, 24);
    h.writeUInt32LE(byteRate, 28);
    h.writeUInt16LE(blockAlign, 32);
    h.writeUInt16LE(BITS_PER_SAMPLE, 34);
    h.write('data', 36, 'ascii');
    h.writeUInt32LE(dataBytes, 40);
    return h;
  }
}
```

- [ ] **Step 4: Run test, expect PASS** (`pnpm --filter @lisna/desktop test src/main/__tests__/audio-wav-writer.test.ts`)

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/audio-wav-writer.ts desktop/src/main/__tests__/audio-wav-writer.test.ts
git commit -m "feat(diarization-spike): streaming 16kHz mono WAV writer"
```

---

### Task 2: orchestrator `onAudioChunk` side-channel

**Files:**
- Modify: `desktop/src/main/sidecar/orchestrator.ts` (`Opts` at line 553; `onChunk` at line 639-648)
- Test: `desktop/src/main/sidecar/__tests__/orchestrator.test.ts`

- [ ] **Step 1: Add a failing test** (append to the existing describe block)

```typescript
// in desktop/src/main/sidecar/__tests__/orchestrator.test.ts
it('fires onAudioChunk with the raw audio buffer before timestamp remap', async () => {
  const seen: { len: number; offset: number }[] = [];
  const orch = makeOrchestrator({  // use the test's existing factory; add the opt:
    onAudioChunk: (audio: Float32Array, offsetSec: number) =>
      seen.push({ len: audio.length, offset: offsetSec }),
  });
  await orch.start();
  await orch.onChunk(new Float32Array(16000), 130);
  expect(seen).toEqual([{ len: 16000, offset: 130 }]);
});
```

> Match the existing test file's orchestrator-construction pattern (it builds `Opts` with mock `stt`/`llm`). Thread the new optional `onAudioChunk` through that factory.

- [ ] **Step 2: Run, expect FAIL** (`onAudioChunk` not on `Opts`)

Run: `pnpm --filter @lisna/desktop test src/main/sidecar/__tests__/orchestrator.test.ts`

- [ ] **Step 3: Add the opt + fire it**

In `Opts` (after `buildPrompt?`, ~line 564):

```typescript
  /**
   * Optional side-channel fired once per recording chunk with the RAW audio
   * buffer (16kHz mono Float32) and its session offset, BEFORE STT and before
   * the segment-timestamp remap. Wired by the session/* IPC handlers to the
   * WAV writer when LISNA_SAVE_AUDIO=1. Must not throw (fire-and-forget); the
   * caller guarantees non-throwing behavior. No-op when unset.
   */
  onAudioChunk?(audio: Float32Array, sessionOffsetSec: number): void;
```

In `onChunk` (line 640, as the FIRST statement, before `transcribe`):

```typescript
  async onChunk(audio: Float32Array, sessionOffsetSec = 0): Promise<TranscriptSegment[]> {
    this.opts.onAudioChunk?.(audio, sessionOffsetSec);   // raw buffer, pre-remap
    const raw = await this.opts.stt.transcribe(audio);
    // ... unchanged
```

- [ ] **Step 4: Run test, expect PASS** + run the full orchestrator suite to confirm no regression:

`pnpm --filter @lisna/desktop test src/main/sidecar/__tests__/orchestrator.test.ts`

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/sidecar/orchestrator.ts desktop/src/main/sidecar/__tests__/orchestrator.test.ts
git commit -m "feat(diarization-spike): orchestrator onAudioChunk side-channel"
```

---

### Task 3: Wire the WAV writer in `ipc.ts` (gated on `LISNA_SAVE_AUDIO=1`)

**Files:**
- Modify: `desktop/src/main/ipc.ts` (session/start handler; chunk handler ~line 269-276; session/stop handler)

**Context:** `ipc.ts:276` already calls `orch.onChunk(payload.samples, payload.startMs / 1000)`. The orchestrator is created per session in the `session/start` handler. We open a `WavWriter` at start (when gated on), pass its `.append` as `onAudioChunk`, and `.close()` it at stop/finalize.

- [ ] **Step 1: Read the current session/start + session/stop handlers**

Run: `grep -nE "session/start|session/stop|new SessionOrchestrator|sessionStart|sessionStop" desktop/src/main/ipc.ts`

Identify (a) where `new SessionOrchestrator(opts)` is built, (b) the stop/finalize handler that ends the session.

- [ ] **Step 2: Add the writer lifecycle**

At module scope in `ipc.ts`:

```typescript
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { WavWriter } from './audio-wav-writer';

let audioWriter: WavWriter | null = null;
```

In the `session/start` handler, AFTER the orchestrator's `Opts` object is constructed but BEFORE `new SessionOrchestrator(opts)` — add `onAudioChunk` to the opts when gated:

```typescript
audioWriter = null;
if (process.env.LISNA_SAVE_AUDIO === '1') {
  try {
    const dir = path.join(app.getPath('userData'), 'audio-captures');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const w = new WavWriter(path.join(dir, `${stamp}.wav`));
    audioWriter = w;
    opts.onAudioChunk = (audio) => { try { w.append(audio); } catch { /* best-effort */ } };
    log.info('[audio-capture] saving session audio to', path.join(dir, `${stamp}.wav`));
  } catch (err) {
    log.warn('[audio-capture] disabled — could not open writer', err);
    audioWriter = null;
  }
}
```

In the `session/stop` (and any finalize-settled) path, close it:

```typescript
try { audioWriter?.close(); } catch { /* best-effort */ } finally { audioWriter = null; }
```

> The `app`/`log` imports may already exist — don't duplicate. `opts` is whatever local the handler already builds; if the handler inlines the object into `new SessionOrchestrator({...})`, hoist it to a `const opts = {...}` first so the gate can attach `onAudioChunk`.

- [ ] **Step 3: Typecheck + full verify**

```bash
pnpm --filter @lisna/desktop verify
```

Expected: typecheck + lint + tests green (no new test needed — Task 1/2 cover the units; this is wiring verified by typecheck + the existing ipc/session tests).

- [ ] **Step 4: Manual smoke (controller, FOREGROUND)**

```bash
LISNA_SAVE_AUDIO=1 pnpm --filter @lisna/desktop dev
# record ~20s, stop, then:
ls -la "$HOME/Library/Application Support/@lisna/desktop/audio-captures/"
# confirm a non-trivial .wav exists; sanity-play it.
```

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main/ipc.ts
git commit -m "feat(diarization-spike): persist session audio to WAV when LISNA_SAVE_AUDIO=1"
```

---

## Stage 1 — Calibrated sherpa-onnx pipeline + AMI read (controller, FOREGROUND)

### Task 4: Python env + pre-converted ONNX models

**Files:**
- Create: `desktop/spikes/phase-0/03-diarization-ja/requirements.txt`
- Create: `desktop/spikes/phase-0/03-diarization-ja/download-models.sh`

- [ ] **Step 1: requirements.txt**

```
sherpa-onnx
pyannote.metrics
soundfile
numpy
```

- [ ] **Step 2: download-models.sh** — use sherpa-onnx's **ungated pre-converted** releases (avoids the gated HF pull; production license is MIT for pyannote-segmentation-3.0). Pull the canonical URLs from the sherpa-onnx diarization docs at run time:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p models && cd models
# Segmentation: pyannote-segmentation-3.0 ONNX + reverb-tuned variant (reverberant rooms)
# Embedding: 3D-Speaker eres2net (default), + one fallback-ladder candidate.
# NOTE: confirm the exact current asset filenames against
#   https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html
# (the project re-hosts converted ONNX on its GitHub releases; URLs version over time).
echo "Download from the sherpa-onnx speaker-diarization model list:"
echo "  - sherpa-onnx-pyannote-segmentation-3-0 (seg)"
echo "  - sherpa-onnx-reverb-diarization-v1 (reverb seg)"
echo "  - 3dspeaker eres2net embedding (emb)"
echo "  - (fallback) nemo/wespeaker embedding"
```

- [ ] **Step 3: Create venv + install + download (FOREGROUND)**

```bash
cd desktop/spikes/phase-0/03-diarization-ja
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
bash download-models.sh   # then fetch the listed assets into models/
```

- [ ] **Step 4: Commit the scaffolding (NOT the models — they're large/binary)**

Add `models/` and `.venv/` to a local `.gitignore` in the spike dir, then:

```bash
echo -e ".venv/\nmodels/\nfixtures/\n*.wav" > desktop/spikes/phase-0/03-diarization-ja/.gitignore
git add desktop/spikes/phase-0/03-diarization-ja/requirements.txt \
        desktop/spikes/phase-0/03-diarization-ja/download-models.sh \
        desktop/spikes/phase-0/03-diarization-ja/.gitignore
git commit -m "chore(diarization-spike): python env + model download scaffolding"
```

---

### Task 5: Diarization runner + DER scorer (pyannote.metrics + der.ts cross-check)

**Files:**
- Create: `desktop/spikes/phase-0/03-diarization-ja/run-diarization.py`
- Create: `desktop/spikes/phase-0/03-diarization-ja/score-der.py`
- Create: `desktop/spikes/phase-0/03-diarization-ja/der-crosscheck.mjs`

- [ ] **Step 1: run-diarization.py** — sherpa-onnx OFFLINE diarization over a whole WAV; supports `--num-speakers N` (oracle) or auto (`-1`); emits turns JSON `[{start,end,speaker}]`.

```python
#!/usr/bin/env python3
"""Run sherpa-onnx offline speaker diarization on a 16kHz mono WAV.
Emits [{"start": s, "end": s, "speaker": "0"}] to stdout. Mirrors the
sherpa-onnx offline-speaker-diarization.py example; confirm the config
field names against the installed sherpa-onnx version."""
import argparse, json, sys
import soundfile as sf
import sherpa_onnx

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", required=True)
    ap.add_argument("--seg", required=True, help="segmentation ONNX path")
    ap.add_argument("--emb", required=True, help="embedding ONNX path")
    ap.add_argument("--num-speakers", type=int, default=-1, help="-1 = auto")
    ap.add_argument("--cluster-threshold", type=float, default=0.5)
    args = ap.parse_args()

    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=args.seg),
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=args.emb),
        clustering=sherpa_onnx.FastClusteringConfig(
            num_clusters=args.num_speakers, threshold=args.cluster_threshold
        ),
    )
    if not config.validate():
        print("invalid sherpa-onnx config", file=sys.stderr); sys.exit(2)
    sd = sherpa_onnx.OfflineSpeakerDiarization(config)
    audio, sr = sf.read(args.wav, dtype="float32", always_2d=False)
    assert sr == sd.sample_rate, f"wav sr {sr} != model sr {sd.sample_rate}"
    result = sd.process(audio).sort_by_start_time()
    turns = [{"start": float(s.start), "end": float(s.end), "speaker": str(s.speaker)}
             for s in result]
    json.dump(turns, sys.stdout)

if __name__ == "__main__":
    main()
```

> The exact `sherpa_onnx` config class names vary by version. Before trusting any number, diff this against the installed example: `python -c "import sherpa_onnx, inspect; print([n for n in dir(sherpa_onnx) if 'Diar' in n or 'Cluster' in n])"` and the bundled `offline-speaker-diarization.py`. Fix field names to match.

- [ ] **Step 2: score-der.py** — pyannote.metrics DER (collar 0.25), with and without overlap; prints JSON.

```python
#!/usr/bin/env python3
"""DER via pyannote.metrics (source of truth). Inputs: turns JSON (pred) +
ground-truth JSON, both [{start,end,speaker}]. Prints {der, der_no_overlap,
miss, false_alarm, confusion, overlap_pct}."""
import argparse, json
from pyannote.core import Annotation, Segment
from pyannote.metrics.diarization import DiarizationErrorRate

def to_annotation(turns):
    a = Annotation()
    for t in turns:
        a[Segment(t["start"], t["end"])] = str(t["speaker"])
    return a

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pred", required=True); ap.add_argument("--truth", required=True)
    args = ap.parse_args()
    pred = to_annotation(json.load(open(args.pred)))
    truth = to_annotation(json.load(open(args.truth)))
    m = DiarizationErrorRate(collar=0.25, skip_overlap=False)
    comp = m(truth, pred, detailed=True)
    m2 = DiarizationErrorRate(collar=0.25, skip_overlap=True)
    der_no_ov = m2(truth, pred)
    total = comp["total"] or 1.0
    print(json.dumps({
        "der": comp["diarization error rate"],
        "der_no_overlap": der_no_ov,
        "miss": comp["missed detection"] / total,
        "false_alarm": comp["false alarm"] / total,
        "confusion": comp["confusion"] / total,
    }, indent=2))

if __name__ == "__main__":
    main()
```

- [ ] **Step 3: der-crosscheck.mjs** — feed the same pred/truth (mapped to `{start,end,speakerId}`) through the repo's `computeDer` so we report both numbers.

```javascript
// desktop/spikes/phase-0/03-diarization-ja/der-crosscheck.mjs
// Usage: node der-crosscheck.mjs pred.json truth.json
import { computeDer } from '../../../eval/metrics/der.ts';
import fs from 'node:fs';
const ids = new Map(); let next = 0;
const toSeg = (t) => ({ start: t.start, end: t.end,
  speakerId: ids.has(`${t.speaker}`) ? ids.get(`${t.speaker}`) : (ids.set(`${t.speaker}`, next), next++) });
const [, , predP, truthP] = process.argv;
const pred = JSON.parse(fs.readFileSync(predP)).map(toSeg);
ids.clear(); next = 0;
const truth = JSON.parse(fs.readFileSync(truthP)).map(toSeg);
console.log(JSON.stringify({ der_ts: computeDer(truth, pred) }, null, 2));
```

> `der.ts` is TS; run via `pnpm --filter @lisna/desktop exec tsx der-crosscheck.mjs ...` or `npx tsx`. If the import path friction is high, port `computeDer` inline — it's 40 lines. The cross-check exists only to flag if `der.ts`'s no-overlap/greedy number diverges materially from pyannote.metrics (expected: der.ts ≤ pyannote DER by ~the overlap fraction).

- [ ] **Step 4: Commit**

```bash
git add desktop/spikes/phase-0/03-diarization-ja/run-diarization.py \
        desktop/spikes/phase-0/03-diarization-ja/score-der.py \
        desktop/spikes/phase-0/03-diarization-ja/der-crosscheck.mjs
git commit -m "feat(diarization-spike): sherpa-onnx runner + pyannote.metrics DER scorer"
```

---

### Task 6: AMI-SDM calibration read

**Files:** uses Task 5 scripts; writes notes into the eventual memo (Task 9).

- [ ] **Step 1: Get a small AMI-SDM slice + RTTM ground truth**

Fetch 2-3 AMI **SDM** (single distant mic) meeting excerpts with RTTM from `pyannote/AMI-diarization-setup` or `diarizers-community/ami`. Convert RTTM → `[{start,end,speaker}]` truth JSON (a 10-line script). Resample/convert audio to 16 kHz mono WAV.

- [ ] **Step 2: Run the pipeline FOREGROUND, one file at a time**

```bash
cd desktop/spikes/phase-0/03-diarization-ja && source .venv/bin/activate
python run-diarization.py --wav fixtures/ami-1.wav --seg models/<seg>.onnx --emb models/<emb>.onnx --num-speakers -1 > /tmp/ami-1.pred.json
python score-der.py --pred /tmp/ami-1.pred.json --truth fixtures/ami-1.truth.json
# cleanup:
pgrep -f offline-speaker-diarization | xargs -r kill -9 2>/dev/null; pgrep -f run-diarization | xargs -r kill -9 2>/dev/null; true
```

- [ ] **Step 3: Record the calibration delta**

Compare your DER to the published AMI-SDM number (~22.7% pyannote 3.1). Note your stack's penalty (small ONNX + auto-cluster). This makes the founder's later number interpretable. Write the numbers into a running scratch note for Task 9.

- [ ] **Step 4: Commit the truth-conversion helper** (not the AMI audio — license/size)

```bash
git add desktop/spikes/phase-0/03-diarization-ja/rttm-to-truth.py  # if you wrote one
git commit -m "chore(diarization-spike): AMI-SDM calibration helper + read" || true
```

---

## Stage 2 — Real founder-recording DER (controller + founder, FOREGROUND)

### Task 7: Founder recording fixture + independent ground truth

**Files:** `desktop/spikes/phase-0/03-diarization-ja/fixtures/founder-*.{wav,truth.json}` (gitignored — local only, PII)

- [ ] **Step 1: Capture** — with Stage 0 shipped, founder records 1-2 real sessions (`LISNA_SAVE_AUDIO=1`), doubling as the 2-pass hands-on test. One small-room (2-4) and, if available, one classroom (5+). The WAV lands in `audio-captures/`.

- [ ] **Step 2: Author ground truth INDEPENDENTLY of STT** (R11). Open the WAV in Audacity/ELAN; mark speaker turns by ear into a label track; export → `[{start,end,speaker}]`. Do NOT derive boundaries from Whisper segments. Keep it honest; spot-check. Controller assists; founder confirms speaker identities where ambiguous.

- [ ] **Step 3: Copy WAV + truth into `fixtures/`** (gitignored). Record metadata (people count, room, mic) in the Task 9 note.

---

### Task 8: Measure real DER — auto vs oracle, native vs STT-snap, by model, peak RSS

**Files:** uses Task 5 scripts + `/usr/bin/time -l` for RSS.

- [ ] **Step 1: Auto vs oracle speaker count** (isolates count error from confusion, R9). FOREGROUND, one file at a time:

```bash
cd desktop/spikes/phase-0/03-diarization-ja && source .venv/bin/activate
F=fixtures/founder-smallroom
/usr/bin/time -l python run-diarization.py --wav $F.wav --seg models/<seg>.onnx --emb models/<emb>.onnx --num-speakers -1 > /tmp/auto.json 2> /tmp/auto.rss
python score-der.py --pred /tmp/auto.json --truth $F.truth.json
# oracle (set N to the real speaker count from Task 7 metadata):
python run-diarization.py --wav $F.wav --seg models/<seg>.onnx --emb models/<emb>.onnx --num-speakers <N> > /tmp/oracle.json
python score-der.py --pred /tmp/oracle.json --truth $F.truth.json
pgrep -f offline-speaker-diarization | xargs -r kill -9 2>/dev/null; pgrep -f run-diarization | xargs -r kill -9 2>/dev/null; true
```

- [ ] **Step 2: Reverb segmenter + one embedding-ladder swap** — rerun Step 1 with `models/<reverb-seg>.onnx` and with a fallback embedding (TitaNet/WeSpeaker). Record which config is best.

- [ ] **Step 3: Native-turn vs STT-snap DER** (R10) — the native number is Step 1's (DER on diarization turns vs truth). For the STT-snap delta: snap each turn onto the session's Whisper segments (from the matching `sessions/<ts>/transcript.json` dump), re-score, report the extra loss. (A ~30-line snap script; only needed if the native DER is near the GO line.)

- [ ] **Step 4: Peak RSS** (R12) — read max RSS from the `/usr/bin/time -l` output of the offline pass on the real-length file. Note whether it fits the post-STT / pre-LLM budget on 8 GB.

- [ ] **Step 5: Per-environment** — repeat Steps 1-4 for the classroom fixture if captured. Bucket all numbers small-room vs classroom.

- [ ] **Step 6: der.ts cross-check** — run `der-crosscheck.mjs` on one fixture; confirm the repo metric tracks pyannote.metrics (report both + the overlap-%).

---

### Task 9: Decision memo (GO / PARTIAL / PARK)

**Files:** Create `docs/superpowers/decisions/2026-06-14-diarization-der-spike-verdict.md`

- [ ] **Step 1: Write the memo** with: every measured DER (per environment / model / auto-vs-oracle, native + STT-snap, pyannote.metrics + der.ts + overlap-%), AMI calibration delta, peak RSS, methodology + fixtures used, and the recommendation against the spec's §6 table:
  - GO (≤15%) → open Plan 4 acoustic build, scoped to passing environment(s)
  - PARTIAL (small-room 15-25%, classroom fails) → founder call
  - PARK (>25% everywhere) → hold acoustic; open the §7 semantic role-inference spec
- [ ] **Step 2: State the offline-at-Stop production implication** (spec §8): if GO/PARTIAL, Plan 4's per-chunk diarization framing must change to once-at-Stop on the whole-session WAV.
- [ ] **Step 3: Commit + surface to founder**

```bash
git add docs/superpowers/decisions/2026-06-14-diarization-der-spike-verdict.md
git commit -m "docs(diarization-spike): DER verdict + GO/PARTIAL/PARK recommendation"
```

---

## Self-review checklist (controller, before execution)

- Spec §4 Stage 0 → Tasks 1-3 ✓; Stage 1 → Tasks 4-6 ✓; Stage 2 → Tasks 7-8 ✓; deliverable §11 → Task 9 ✓.
- Spec §5 metric (pyannote.metrics + collar + der.ts cross-check + overlap + native/STT-snap) → Tasks 5, 8 ✓.
- Spec §6 thresholds → Task 9 ✓. §8 offline-at-Stop → Task 9 Step 2 ✓. §10 safety (`pgrep -f`, foreground) → Tasks 6, 8 ✓.
- Spec §7 role-inference is explicitly OUT (PARK pivot) — not in this plan ✓.
- Open verification points flagged for the implementer (not placeholders): sherpa_onnx config class names (Task 5 Step 1), exact model asset URLs (Task 4 Step 2), AMI fetch specifics (Task 6 Step 1) — each names the authoritative source to confirm against, because these version over time.

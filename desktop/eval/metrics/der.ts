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

// Greedy 1-1 label assignment: for each truth speaker, pick the pred speaker
// that maximizes overlap.
function bestLabelMap(truth: number[], pred: number[]): Map<number, number> {
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

// Spike 1.1 scorer — reads results/seed-*/{chunk-0,chunk-1,merge}.json and
// scores the merged InterviewNote against the 6 acceptance criteria (README).
// Emits results/scorecard.json + a human-readable summary to stdout.
//
// Field names verified against InterviewNoteSchema (themes[].name,
// qa_pairs[].question/.ts, quotable_lines[].text, key_takeaways[].text).
// Pure file IO — no LLM. Safe to re-run.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RESULTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'results');

interface Theme { name?: string }
interface QaPair { question?: string; ts?: number }
interface TextLeaf { text?: string }
interface NoteShape {
  themes?: Theme[];
  qa_pairs?: QaPair[];
  quotable_lines?: TextLeaf[];
  key_takeaways?: TextLeaf[];
}
interface ChunkFile { ok: boolean; note?: NoteShape; latencyMs?: number; parseErrorReason?: string }
interface MergeFile { ok: boolean; merged?: NoteShape; latencyMs?: number; parseErrorReason?: string }

interface RunScorecard {
  seed: number;
  c1_zodValid: boolean;
  c2_themeCrossChunk: boolean;
  c3_qaNoDup: boolean;
  c4_tsOrdered: boolean;
  c5_noFabrication: boolean;
  c6_latencyOk: boolean;
  passCount: number;
  latencyTotal: number;
  latencyMerge: number;
  notes: string[];
}

const LATENCY_BUDGET_MS = 12000;

function trigramJaccard(a: string, b: string): number {
  const ngrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i <= s.length - 3; i++) set.add(s.slice(i, i + 3));
    return set;
  };
  const A = ngrams(a);
  const B = ngrams(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function scoreRun(seed: number, chunks: ChunkFile[], merge: MergeFile): RunScorecard {
  const sc: RunScorecard = {
    seed,
    c1_zodValid: merge.ok === true,
    c2_themeCrossChunk: false,
    c3_qaNoDup: false,
    c4_tsOrdered: false,
    c5_noFabrication: false,
    c6_latencyOk: (merge.latencyMs ?? Infinity) <= LATENCY_BUDGET_MS,
    passCount: 0,
    latencyTotal: 0,
    latencyMerge: merge.latencyMs ?? 0,
    notes: [],
  };

  const m = merge.merged;
  if (!sc.c1_zodValid || !m) {
    sc.notes.push(`merge failed: ${merge.parseErrorReason ?? 'unknown'}`);
  } else {
    const themesOf = (c?: ChunkFile): string[] => (c?.note?.themes ?? []).map((t) => t.name ?? '');
    const c0Themes = themesOf(chunks[0]);
    const c1Themes = themesOf(chunks[1]);
    const mergeThemes = (m.themes ?? []).map((t) => t.name ?? '');

    // C2: at least one merged theme present in BOTH chunks (deduped, not concatenated).
    sc.c2_themeCrossChunk = mergeThemes.some((name) => {
      const inC0 = c0Themes.some((t) => trigramJaccard(t, name) > 0.5);
      const inC1 = c1Themes.some((t) => trigramJaccard(t, name) > 0.5);
      return inC0 && inC1;
    });
    if (!sc.c2_themeCrossChunk) sc.notes.push('C2 fail: no theme present in both chunks survived dedup');

    // C3: qa_pair dedup — merged distinct count ~ distinct across both chunks.
    const srcQs = [
      ...((chunks[0]?.note?.qa_pairs ?? []).map((q) => q.question ?? '')),
      ...((chunks[1]?.note?.qa_pairs ?? []).map((q) => q.question ?? '')),
    ];
    const distinctSourceQs: string[] = [];
    for (const q of srcQs) {
      if (!distinctSourceQs.some((seen) => trigramJaccard(seen, q) > 0.7)) distinctSourceQs.push(q);
    }
    const mergedQs = (m.qa_pairs ?? []).map((q) => q.question ?? '');
    sc.c3_qaNoDup =
      mergedQs.length >= 0.95 * distinctSourceQs.length &&
      mergedQs.length <= distinctSourceQs.length + 1;
    if (!sc.c3_qaNoDup) sc.notes.push(`C3 fail: merged Q count ${mergedQs.length} vs distinct ${distinctSourceQs.length}`);

    // C4: temporal ordering of merged qa_pairs.
    const tsSeq = (m.qa_pairs ?? []).map((q) => q.ts ?? 0);
    sc.c4_tsOrdered = tsSeq.every((t, i) => i === 0 || t >= tsSeq[i - 1]!);
    if (!sc.c4_tsOrdered) sc.notes.push('C4 fail: merged qa_pairs not temporally ordered');

    // C5: no fabrication — every merged theme/quote/takeaway traces to a chunk.
    const chunkText = [chunks[0], chunks[1]].flatMap((c) => [
      ...((c?.note?.themes ?? []).map((t) => t.name ?? '')),
      ...((c?.note?.quotable_lines ?? []).map((q) => q.text ?? '')),
      ...((c?.note?.key_takeaways ?? []).map((t) => t.text ?? '')),
    ]);
    const mergeText = [
      ...mergeThemes,
      ...((m.quotable_lines ?? []).map((q) => q.text ?? '')),
      ...((m.key_takeaways ?? []).map((t) => t.text ?? '')),
    ];
    const fabrications = mergeText.filter(
      (mt) => mt.length > 0 && !chunkText.some((ct) => trigramJaccard(mt, ct) > 0.4),
    );
    sc.c5_noFabrication = fabrications.length === 0;
    if (!sc.c5_noFabrication) {
      sc.notes.push(`C5 fail: ${fabrications.length} fabricated: ${fabrications.slice(0, 3).join(' | ')}`);
    }
  }

  sc.passCount = [
    sc.c1_zodValid, sc.c2_themeCrossChunk, sc.c3_qaNoDup,
    sc.c4_tsOrdered, sc.c5_noFabrication, sc.c6_latencyOk,
  ].filter(Boolean).length;
  sc.latencyTotal =
    (chunks[0]?.latencyMs ?? 0) + (chunks[1]?.latencyMs ?? 0) + (merge.latencyMs ?? 0);
  return sc;
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

function main(): void {
  if (!existsSync(RESULTS_DIR)) {
    console.error(`No results dir: ${RESULTS_DIR}`);
    process.exit(1);
  }
  const seedDirs = readdirSync(RESULTS_DIR).filter((d) => d.startsWith('seed-'));
  if (seedDirs.length === 0) {
    console.error('No seed-* result dirs found. Run the spike first.');
    process.exit(1);
  }
  const scorecards: RunScorecard[] = [];
  for (const dir of seedDirs) {
    const seed = parseInt(dir.replace('seed-', ''), 10);
    const chunk0 = readJson<ChunkFile>(resolve(RESULTS_DIR, dir, 'chunk-0.json'), { ok: false });
    const chunk1 = readJson<ChunkFile>(resolve(RESULTS_DIR, dir, 'chunk-1.json'), { ok: false });
    const merge = readJson<MergeFile>(resolve(RESULTS_DIR, dir, 'merge.json'), { ok: false });
    scorecards.push(scoreRun(seed, [chunk0, chunk1], merge));
  }

  const sorted = [...scorecards].sort((a, b) => b.passCount - a.passCount);
  const clean = scorecards.filter((s) => s.passCount === 6).length;
  const acceptable = scorecards.filter((s) => s.passCount >= 4).length;
  const verdict =
    scorecards.length > 0 && scorecards.every((s) => s.passCount === 6) ? 'PASS' :
    clean >= 2 ? 'PASS' :
    acceptable >= 2 ? 'MIXED' :
    'FAIL';

  const out = {
    verdict,
    scorecards: sorted,
    summary: {
      runsClean: clean,
      runsAcceptable: acceptable,
      runsFailed: scorecards.filter((s) => s.passCount < 4).length,
      meanTotalLatencyMs: Math.round(scorecards.reduce((s, x) => s + x.latencyTotal, 0) / scorecards.length),
      meanMergeLatencyMs: Math.round(scorecards.reduce((s, x) => s + x.latencyMerge, 0) / scorecards.length),
    },
  };
  writeFileSync(resolve(RESULTS_DIR, 'scorecard.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main();

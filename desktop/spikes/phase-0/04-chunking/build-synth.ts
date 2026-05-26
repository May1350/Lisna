// desktop/spikes/phase-0/04-chunking/build-synth.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

const fixtures = [
  `${REPO_ROOT}/backend/tests/fixtures/transcripts/procedural-physics-em.json`,
  `${REPO_ROOT}/backend/tests/fixtures/transcripts/narrative-ukraine-russia.json`,
  `${REPO_ROOT}/backend/tests/fixtures/transcripts/yt-JGXIB.json`,
];

interface RawSegment { ts: number; text: string }
interface RawFixture { source: string; bucket_seconds: number; transcripts: RawSegment[] }

const allSegs: { ts: number; text: string; speakerId: number }[] = [];
let tsOffset = 0;

for (const path of fixtures) {
  const data = JSON.parse(readFileSync(path, 'utf-8')) as RawFixture;
  for (const s of data.transcripts) {
    allSegs.push({ ts: s.ts + tsOffset, text: s.text, speakerId: 0 });
  }
  tsOffset = allSegs[allSegs.length - 1].ts + 60; // 60s gap between fixtures
}

const out = {
  sessionId: 'synth',
  speakers: [{ id: 0 }],
  transcriptSegments: allSegs,
};

const outPath = `${import.meta.dirname}/fixtures/synth-90min.json`;
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(
  `Wrote synth: ${allSegs.length} segments, ${allSegs[allSegs.length - 1].ts.toFixed(0)}s ` +
  `(${(allSegs[allSegs.length - 1].ts / 60).toFixed(1)}min)`
);

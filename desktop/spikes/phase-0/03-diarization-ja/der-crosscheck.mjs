// Cross-check the repo's computeDer (greedy 1-1 match, 100 ms grid, NO overlap
// scoring) against pyannote.metrics on the same pred/truth turns. The repo
// metric is expected to read <= pyannote DER by roughly the overlap fraction
// (it keeps one speaker per 100 ms slot). A large divergence at overlap≈0 flags
// a real bug in der.ts. Imports the REAL der.ts so this tests the shipped code.
//
// Usage (from repo root or the spike dir, via tsx):
//   desktop/node_modules/.bin/tsx <thisdir>/der-crosscheck.mjs pred.json truth.json
import fs from 'node:fs';
import { computeDer } from '../../../eval/metrics/der.ts';

/** Map speaker-string turns -> der.ts DiarizationSegment[] (per-file id space;
 *  der.ts remaps labels itself, so pred/truth id spaces need not align). */
function toSegs(turns) {
  const ids = new Map();
  let next = 0;
  return turns.map((t) => {
    const key = String(t.speaker);
    if (!ids.has(key)) ids.set(key, next++);
    return { start: Number(t.start), end: Number(t.end), speakerId: ids.get(key) };
  });
}

const [, , predP, truthP] = process.argv;
if (!predP || !truthP) {
  console.error('usage: tsx der-crosscheck.mjs <pred.json> <truth.json>');
  process.exit(2);
}
const pred = toSegs(JSON.parse(fs.readFileSync(predP, 'utf8')));
const truth = toSegs(JSON.parse(fs.readFileSync(truthP, 'utf8')));
console.log(JSON.stringify({ der_ts: Number(computeDer(truth, pred).toFixed(4)) }, null, 2));

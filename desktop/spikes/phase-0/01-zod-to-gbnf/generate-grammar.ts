// Spike 0.1 round-trip step: run the Zod -> GBNF converter against the mini
// Lecture fixture and write the generated grammar to disk. The .gbnf is
// checked into the repo (small, human-reviewable) so reviewers can inspect
// what the converter actually emits, and so downstream verification (llama.cpp
// grammar parse) operates on the same artifact every run.
//
// Usage (from repo root):
//   cd desktop && pnpm exec tsx spikes/phase-0/01-zod-to-gbnf/generate-grammar.ts
//
// Output is written next to this script (cwd-independent) so the generated
// .gbnf always lands at desktop/spikes/phase-0/01-zod-to-gbnf/lecture-mini.gbnf
// regardless of how tsx is invoked.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { zodToGbnf } from './zod-to-gbnf';
import { LectureMiniSchema } from './fixtures/lecture-mini-schema';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(HERE, 'lecture-mini.gbnf');

const gbnf = zodToGbnf(LectureMiniSchema, 'LectureNote');
writeFileSync(OUT_PATH, gbnf);
console.log(`Wrote ${OUT_PATH}: ${gbnf.length} bytes, ${gbnf.split('\n').length} lines`);

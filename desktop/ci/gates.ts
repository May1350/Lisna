import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const range = pkg.devDependencies?.electron ?? '';
const minMajor = Number(range.replace(/[^\d.]/g, '').split('.')[0]);
if (!Number.isFinite(minMajor) || minMajor < 39) {
  console.error(`CI gate failed: Electron ${range} < 39 (CoreAudio Tap 요구). 스펙 §7 참고.`);
  process.exit(1);
}
console.log(`Electron version gate OK (>= ${minMajor})`);

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BaselineFileSchema, type BaselineFile } from './format';

export function saveBaseline(path: string, baseline: BaselineFile): void {
  // Validate before persisting — fail loudly if a runner produced malformed data
  BaselineFileSchema.parse(baseline);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(baseline, null, 2), 'utf8');
}

export function loadBaseline(path: string): BaselineFile | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const json = JSON.parse(raw);
  return BaselineFileSchema.parse(json);
}

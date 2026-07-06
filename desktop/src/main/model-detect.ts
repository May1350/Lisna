import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import type { ModelDescriptor } from '@shared/types';

/**
 * Detection core for the onboarding "smart skip" flow: given a catalog
 * descriptor, find whether a matching file already exists on disk (correct
 * size AND sha256) so onboarding can skip re-downloading it. Pure detection —
 * no IPC, no UI. See `.superpowers/sdd/task-1-brief.md`.
 */

export interface DetectDeps {
  statSize?: (p: string) => number | null; // byte size, or null if missing/unreadable
  sha256File?: (p: string) => Promise<string>; // hex sha256 of file contents
  extraCandidates?: (slot: 'stt' | 'llm') => string[]; // prior/known locations
}

interface ModelLocations {
  stt: string[];
  llm: string[];
}

function defaultStatSize(p: string): number | null {
  try {
    return fs.statSync(p).size;
  } catch {
    return null;
  }
}

/** Streams the file into sha256; a read error resolves to '' (a value that
 *  can never equal a real hex digest) so the caller's comparison just misses
 *  rather than throwing. */
export function sha256File(p: string): Promise<string> {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(p);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(''));
  });
}

/** Reads `<userDataDir>/model-locations.json`. Any missing/malformed file
 *  yields the empty shape — this is a best-effort cache, not a source of
 *  truth. */
export function knownLocations(userDataDir: string): ModelLocations {
  const p = path.join(userDataDir, 'model-locations.json');
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(p, 'utf8'));
    const obj = parsed as { stt?: unknown; llm?: unknown };
    const stt = Array.isArray(obj.stt) ? obj.stt.filter((x): x is string => typeof x === 'string') : [];
    const llm = Array.isArray(obj.llm) ? obj.llm.filter((x): x is string => typeof x === 'string') : [];
    return { stt, llm };
  } catch {
    return { stt: [], llm: [] };
  }
}

/** Dedup-appends `p` to `slot` in `<userDataDir>/model-locations.json`. */
export function recordLocation(userDataDir: string, slot: 'stt' | 'llm', p: string): void {
  const filePath = path.join(userDataDir, 'model-locations.json');
  const current = knownLocations(userDataDir);
  if (!current[slot].includes(p)) {
    current[slot] = [...current[slot], p];
  }
  fs.writeFileSync(filePath, JSON.stringify(current));
}

/** Collects sttPath/llmPath from `models.json` and its
 *  `models.json.freshux-backup` sibling (if present), skipping any
 *  missing/malformed file. */
export function priorModelsJsonPaths(userDataDir: string): ModelLocations {
  const result: ModelLocations = { stt: [], llm: [] };
  const files = ['models.json', 'models.json.freshux-backup'];
  for (const file of files) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(path.join(userDataDir, file), 'utf8'));
      const obj = parsed as { sttPath?: unknown; llmPath?: unknown };
      if (typeof obj.sttPath === 'string') result.stt.push(obj.sttPath);
      if (typeof obj.llmPath === 'string') result.llm.push(obj.llmPath);
    } catch {
      // missing or malformed — skip
    }
  }
  return result;
}

/**
 * Returns the first candidate path whose size AND sha256 match `d`, else
 * null. Candidate order: userData `models/<filename>` first, then
 * `deps.extraCandidates` (if supplied) or the default prior-models-json +
 * known-locations union. Size is checked BEFORE hashing so a mismatch never
 * pays the cost of hashing a large wrong file.
 */
export async function detectExistingModel(
  d: ModelDescriptor,
  userDataDir: string,
  deps: DetectDeps = {},
): Promise<string | null> {
  const statSize = deps.statSize ?? defaultStatSize;
  const hashFile = deps.sha256File ?? sha256File;

  const candidates = [
    path.join(userDataDir, 'models', d.filename),
    ...(deps.extraCandidates?.(d.kind) ?? [
      ...priorModelsJsonPaths(userDataDir)[d.kind],
      ...knownLocations(userDataDir)[d.kind],
    ]),
  ];

  for (const candidate of candidates) {
    if (statSize(candidate) !== d.sizeBytes) continue;
    if ((await hashFile(candidate)) === d.sha256) return candidate;
  }
  return null;
}

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseGlossary, normalizeGlossary } from '@shared/stt/glossary';
import { atomicWriteJson } from './atomic-json';

const FILE = 'glossary.json';

/**
 * Read the user's glossary terms from `<userData>/glossary.json`. Fail-soft to
 * `[]` on missing/corrupt (mirrors `loadGlossaryInitialPrompt`). Also unlinks an
 * orphan `glossary.json.tmp` left by a crash mid-write (mirrors loadModelsJson).
 */
export async function loadGlossary(userDataDir: string): Promise<string[]> {
  await fs.unlink(path.join(userDataDir, `${FILE}.tmp`)).catch(() => {});
  try {
    const raw = await fs.readFile(path.join(userDataDir, FILE), 'utf8');
    return normalizeGlossary(parseGlossary(JSON.parse(raw)));
  } catch {
    return [];
  }
}

/**
 * Persist the glossary atomically. Returns the NORMALIZED list actually written
 * (trim/dedupe/len-cap/count-cap), so the caller/UI reflects exactly what was
 * stored. The same `glossary.json` is read by `loadGlossaryInitialPrompt` on the
 * next transcribe — no extra wiring.
 */
export async function saveGlossary(userDataDir: string, terms: readonly string[]): Promise<string[]> {
  const clean = normalizeGlossary(terms);
  await atomicWriteJson(userDataDir, FILE, clean);
  return clean;
}

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FixtureMetaSchema, FixtureTranscriptSchema } from './_schema';
import type { NoteFamily } from '../judges/judge-types';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export async function validateEvalBaselines(
  registered: Record<NoteFamily, string[]>,
  fixturesRoot = 'eval/fixtures',
): Promise<ValidationResult> {
  const errors: string[] = [];
  for (const family of Object.keys(registered) as NoteFamily[]) {
    for (const fixtureId of registered[family]) {
      const dir = join(fixturesRoot, family, fixtureId);
      if (!existsSync(dir)) {
        errors.push(`[${family}] fixture missing: ${fixtureId} (expected at ${dir})`);
        continue;
      }
      try {
        const meta = FixtureMetaSchema.parse(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')));
        if (meta.fixtureId !== fixtureId) {
          errors.push(`[${family}] meta.fixtureId mismatch: dir=${fixtureId}, meta=${meta.fixtureId}`);
        }
        if (meta.family !== family) {
          errors.push(`[${family}] family mismatch: ${fixtureId} declares family=${meta.family}`);
        }
        FixtureTranscriptSchema.parse(JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8')));
      } catch (e) {
        errors.push(`[${family}] ${fixtureId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

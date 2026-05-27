import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evalBaselines } from '../eval-baselines';

describe('evalBaselines registry', () => {
  it('contains the Lecture v0 baseline slug', () => {
    expect(evalBaselines).toContain('lecture/spike-0.2-v0');
  });

  it('every registered slug has a baseline file on disk', () => {
    for (const slug of evalBaselines) {
      const path = join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'baselines', `${slug}.baseline.json`);
      expect(existsSync(path), `Baseline file missing: ${path}`).toBe(true);
    }
  });

  it('every baseline file is valid JSON with note.family discriminator', () => {
    for (const slug of evalBaselines) {
      const path = join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'baselines', `${slug}.baseline.json`);
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      expect(parsed.note).toBeDefined();
      expect(parsed.note.family).toBeDefined();
    }
  });
});

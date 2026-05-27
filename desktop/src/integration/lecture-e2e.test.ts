/**
 * Hardware-gated Lecture E2E test.
 *
 * Runs the full Lecture pipeline (transcript → chunk → grammar-call →
 * post-decode → merge → final parse) against a REAL LLM. Gated behind
 * `LISNA_LLM_INTEGRATION=1` env so CI never invokes it.
 *
 * STATUS (Plan 3 Task 15): SCAFFOLD ONLY. The production
 * `SidecarClient.generateWithGrammar` method does not exist yet
 * (ipc-protocol.ts SidecarRequest.generate has no `grammar` field;
 * a future plan extends the C++ side + IPC envelope). Until then,
 * this test's body checks for the wiring and skips with a clear
 * reason when it's absent. When the wiring lands, this scaffold
 * becomes a live regression check.
 *
 * Per pitfalls.md (spike-llm):
 *   - Foreground only (never `run_in_background: true`).
 *   - afterAll `pkill -9 llama-completion` for hardware safety.
 *   - Verify `ps -ef | grep -E "llama-completion|vitest.*integration"` returns empty after run.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { finalizeLecture } from '../main/sidecar/orchestrator';
import { LectureNoteSchema } from '../shared/families/lecture/schema';
import { SessionTranscriptSchema } from '../shared/note-schema/transcript';
import { modelProfiles } from '../shared/models/profiles';
import '../shared/families/lecture/core';   // side-effect: register LectureFamilyCore
import type { GrammarCapableSidecar } from '../main/sidecar/grammar-call';

const HARD_GATED = process.env.LISNA_LLM_INTEGRATION === '1';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

afterAll(() => {
  // Hardware safety per pitfalls.md (spike-llm) — kill any residual LLM process
  // even if the test was skipped (no-op on a clean run).
  try {
    execSync('pkill -9 -f llama-completion', { stdio: 'ignore' });
  } catch {
    /* ignore — process may not exist */
  }
});

describe.skipIf(!HARD_GATED)('Lecture E2E (real LLM, LISNA_LLM_INTEGRATION=1)', () => {
  it('full pipeline produces a valid LectureNote from a 30s fixture', async () => {
    // Load + validate the fixture against the v2 SessionTranscript schema.
    const fixturePath = resolve(__dirname, 'fixtures/lecture-30s.transcript.json');
    const rawFixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
    const transcript = SessionTranscriptSchema.parse(rawFixture);

    // Build the real production sidecar adapter HERE. Until the production
    // SidecarClient.generateWithGrammar lands, this test must explicitly
    // check + skip; the day the method appears, swap the body for a
    // `spawnSidecar()` + `makeSidecarGenerator(client)` chain.
    const sidecar: GrammarCapableSidecar = await buildE2ESidecar();
    expect(typeof sidecar.generateWithGrammar).toBe('function');

    const result = await finalizeLecture({
      sessionId: 'e2e-test-lecture-30s',
      transcript,
      sidecar,
      modelProfile: modelProfiles['llama-3.2-3b-q4-km']!,
      promptVariantId: 'lecture-v1',
    });

    // Structural assertions per spec §5.2:
    expect(() => LectureNoteSchema.parse(result.note)).not.toThrow();
    expect(result.note.family).toBe('lecture');
    expect(result.note.sections.length).toBeGreaterThanOrEqual(1);
    for (const section of result.note.sections) {
      expect(section.ts).toBeGreaterThanOrEqual(0);
      expect(section.summary.length).toBeGreaterThan(0);
    }

    // Telemetry sanity:
    expect(result.telemetry.chunkCount).toBeGreaterThanOrEqual(1);
    expect(result.telemetry.totalTokensIn).toBeGreaterThan(0);
  }, 180_000);
});

/**
 * Build the E2E-test sidecar adapter. Today this throws — the production
 * SidecarClient does not yet expose `generateWithGrammar`. When that lands
 * (extends `SidecarRequest.generate` with a `grammar` field on the C++
 * side + adds a `generateWithGrammar` method on the TS client), replace
 * this body with the live spawn + adapter chain.
 *
 * Sketch of the future implementation (DO NOT enable today):
 *
 *   const client = await spawnLiveSidecar();             // not yet implemented
 *   await client.send({ type: 'load', kind: 'llm', path: '...' });
 *   const adapter: GrammarCapableSidecar = {
 *     generateWithGrammar: async ({ prompt, grammar, ... }) => {
 *       const resp = await client.send({ type: 'generate', messages: [...], grammar, ... });
 *       return { text: resp.text, seed: ... };
 *     },
 *   };
 *   return adapter;
 */
async function buildE2ESidecar(): Promise<GrammarCapableSidecar> {
  throw new Error(
    'E2E_NOT_RUNTIME_WIRED: SidecarClient.generateWithGrammar is not yet implemented. ' +
    'Production wiring is deferred to a future plan (extends ipc-protocol SidecarRequest.generate ' +
    'with a `grammar` field on the C++ side + adds a `generateWithGrammar` method on the TS client). ' +
    'When that lands, replace buildE2ESidecar() with the live spawn + adapter chain. ' +
    'See desktop/spikes/phase-0/02-3b-lecture-grammar/run-spike.ts for a working grammar-CLI pattern.',
  );
}

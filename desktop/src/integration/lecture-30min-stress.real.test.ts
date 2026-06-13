/**
 * 30-minute Lecture stress test (REAL-3B leg) — env-gated wall-time fidelity
 * check. Pairs with `lecture-30min-stress.test.ts` (mocked leg, CI default).
 *
 * Spawns the prebuilt sidecar (same pattern as
 * `chunked-note.escape-literal-repro.test.ts`), runs finalizeLecture against
 * the 45-min synth transcript at the production 3000-token budget, asserts:
 *   - chunkCount === EXPECTED_CHUNKS_AT_DEFAULT (matches mocked-leg pin)
 *   - schema valid
 *   - sections.length in [chunkCount, MAX_SECTIONS=24]
 *   - per-chunk wall < 90s typical (catches silent cold-cache 2× regression)
 *   - total wall < 12 min (generous overall ceiling)
 *
 * WHEN to run:
 *   - Founder-gated. Dev app (`pnpm --filter @lisna/desktop dev`) MUST be
 *     quit first — 8GB M3 OOMs with two sidecars per pitfalls.md
 *     (spike-llm). beforeAll runtime guard enforces this.
 *   - Never run_in_background: true (session resume stacks zombies).
 *
 * Per `pitfalls.md (vitest-scope)` — explicit FILE PATH only.
 * Per `pitfalls.md (spike-llm)` — afterAll pkill + SIGTERM→5s→SIGKILL race.
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { finalizeLecture } from '../main/sidecar/orchestrator';
import { makeGrammarSidecar } from '../main/sidecar/grammar-call';
import { SidecarClient } from '../main/sidecar/client';
import { LlamaCppLLM } from '../main/engines/llama-cpp-llm';
import { LectureNoteSchema } from '../shared/families/lecture/schema';
import { modelProfiles } from '../shared/models/profiles';
import '../shared/families/lecture/core';

import {
  EXPECTED_CHUNKS_AT_DEFAULT,
  makeSynthetic30MinTranscript,
} from './lecture-30min-stress.helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
// desktop/src/integration → ../../resources/sidecar
const sidecarBin = resolvePath(__dirname, '../../resources/sidecar');
const llmModel = process.env.LISNA_TEST_LLM_MODEL ?? '';
const REAL_LLM_GATED =
  process.env.LISNA_LLM_INTEGRATION === '1' &&
  existsSync(sidecarBin) &&
  llmModel.length > 0 &&
  existsSync(llmModel);

let _proc: ChildProcess | null = null;
let _sigintHandler: NodeJS.SignalsListener | null = null;

afterAll(() => {
  // pitfalls.md (spike-llm): SIGTERM→5s→SIGKILL race in the inline finally
  // catches the orderly path; this is the fail-safe for a crashed test.
  try {
    execSync('pkill -9 -f llama-completion', { stdio: 'ignore' });
  } catch {
    /* noop */
  }
  if (_sigintHandler) {
    process.off('SIGINT', _sigintHandler);
    _sigintHandler = null;
  }
});

describe.skipIf(!REAL_LLM_GATED)('finalizeLecture 30-min stress (real 3B)', () => {
  beforeAll(() => {
    // Runtime OOM guard: refuse to run if the dev app is already up. Two
    // sidecars = ~6GB resident on 8GB M3 = swap + likely kernel panic per
    // pitfalls.md (spike-llm). Comment-only docs are insufficient.
    let devUp = false;
    try {
      execSync('pgrep -f "@lisna/desktop dev"', { stdio: 'ignore' });
      devUp = true;
    } catch {
      // pgrep returns non-zero (= no match) → we're clear.
    }
    if (devUp) {
      throw new Error(
        'DEV_APP_RUNNING: quit `pnpm --filter @lisna/desktop dev` before running this test. ' +
          'Two sidecars on 8GB OOM (pitfalls.md spike-llm).',
      );
    }
  });

  it(
    'processes 30-min synth via real 3B, all chunks merged, per-chunk < 90s typical',
    async () => {
      const transcript = makeSynthetic30MinTranscript();
      const perChunkMs: number[] = [];
      const t0 = Date.now();

      const proc = spawn(sidecarBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      _proc = proc;
      const client = new SidecarClient(proc);

      // SIGINT handler so Ctrl-C during the long run kills the sidecar.
      _sigintHandler = () => {
        try {
          _proc?.kill('SIGKILL');
        } catch {
          /* noop */
        }
        process.exit(130);
      };
      process.once('SIGINT', _sigintHandler);

      try {
        await client.waitForReady(15_000);
        const llm = new LlamaCppLLM(client);
        await llm.loadModel(llmModel);

        const sidecar = makeGrammarSidecar(client);

        const result = await finalizeLecture({
          sessionId: 'stress-real-3b',
          transcript,
          sidecar,
          modelProfile: modelProfiles['llama-3.2-3b-q4-km']!,
          onTelemetry: (e) => {
            if (e.kind === 'chunk-done') perChunkMs.push(e.totalLatencyMs);
          },
        });

        const totalMs = Date.now() - t0;
        console.log(
          `[lecture-30min-stress] chunks=${result.telemetry.chunkCount} ` +
            `totalMs=${totalMs} perChunkMs=${JSON.stringify(perChunkMs)} ` +
            `sections=${result.note.sections.length}`,
        );

        expect(result.telemetry.chunkCount).toBe(EXPECTED_CHUNKS_AT_DEFAULT);
        expect(() => LectureNoteSchema.parse(result.note)).not.toThrow();
        expect(result.note.sections.length).toBeGreaterThanOrEqual(
          EXPECTED_CHUNKS_AT_DEFAULT,
        );
        // Lecture schema hard ceiling is MAX_SECTIONS=24; consolidation targets
        // a duration-aware soft cap (consolidate-lecture-sections.ts).
        expect(result.note.sections.length).toBeLessThanOrEqual(24);

        // Wall-time bounds. Today's healthy baseline (founder retest
        // 2026-06-09 n=1): ~30s for ~25s of input. 90s/chunk catches a
        // 2-3× cold-cache or single-extra-outer-retry regression.
        for (const ms of perChunkMs) {
          expect(ms).toBeLessThan(90_000);
        }
        expect(totalMs).toBeLessThan(12 * 60_000);
      } finally {
        if (_proc && !_proc.killed) {
          const proc = _proc;
          try {
            proc.kill('SIGTERM');
            await Promise.race([
              new Promise<void>((r) => proc.once('exit', () => r())),
              new Promise<void>((r) => setTimeout(r, 5000)),
            ]);
            if (!proc.killed) proc.kill('SIGKILL');
          } catch {
            /* noop — already dead */
          }
          _proc = null;
        }
      }
    },
    15 * 60_000, // outer vitest kill: 15 min
  );
});

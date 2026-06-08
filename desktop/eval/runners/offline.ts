import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import type { PipelineRunner, PipelineResult } from './pipeline-stub';
import { fixtureToSessionTranscript } from './fixture-to-transcript';
import { SidecarClient } from '../../src/main/sidecar/client';
import { LlamaCppLLM } from '../../src/main/engines/llama-cpp-llm';
import { makeGrammarSidecar } from '../../src/main/sidecar/grammar-call';
import type { GrammarCapableSidecar } from '../../src/main/sidecar/grammar-call';
import { finalizeLecture, finalizeMeeting } from '../../src/main/sidecar/orchestrator';
import { modelProfiles } from '../../src/shared/models/profiles';
import '../../src/shared/families/lecture/core';
import '../../src/shared/families/meeting/core';

/** Wrap a sidecar so per-chunk attempt counts can be recovered without editing
 *  finalize: tally generateWithGrammar calls; the caller snapshots between chunk
 *  progress events. */
function countingProxy(inner: GrammarCapableSidecar): { sidecar: GrammarCapableSidecar; total: () => number } {
  let calls = 0;
  return {
    sidecar: { generateWithGrammar: (req) => { calls++; return inner.generateWithGrammar(req); } },
    total: () => calls,
  };
}

/** Build an offline eval runner for ANY profiled model. `modelId` is DERIVED
 *  from the model file (resolved against the profile registry by basename) so a
 *  1B run can never be silently stamped as 3B — the baseline label always
 *  matches the model actually loaded. Resolving at factory time also fails fast
 *  on an unknown model instead of after spawning the sidecar. */
export function makeOfflineRunner(opts: { runnerId: string; sidecarBin: string; llmModelPath: string }): PipelineRunner {
  const profile = Object.values(modelProfiles).find(
    (p) => p.filename === basename(opts.llmModelPath),
  );
  if (!profile) throw new Error('UNKNOWN_MODEL_PROFILE');

  return {
    id: opts.runnerId,
    modelId: profile.id,
    promptVariantId: 'default',
    async run({ meta, transcript }): Promise<PipelineResult> {
      // Family guard BEFORE spawning anything (cheap, unit-testable).
      if (meta.family !== 'lecture' && meta.family !== 'meeting') {
        throw new Error(`UNSUPPORTED_FAMILY_FOR_OFFLINE_RUNNER:${meta.family}`);
      }

      const proc = spawn(opts.sidecarBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      const client = new SidecarClient(proc);
      const t0 = Date.now();
      try {
        await client.waitForReady(10_000);
        const llm = new LlamaCppLLM(client);
        await llm.loadModel(opts.llmModelPath);
        const proxy = countingProxy(makeGrammarSidecar(client));
        const st = fixtureToSessionTranscript(transcript, meta);

        // Per-chunk attempts: chunk progress fires BEFORE that chunk's call(s),
        // so snapshot the call count at each chunk start; chunk i's attempts =
        // (next chunk's start, or the final count) − chunk i's start.
        const chunkStarts: number[] = [];
        const onProgress = (e: { phase: string }) => {
          if (e.phase === 'chunk') chunkStarts.push(proxy.total());
        };

        let note: unknown;
        try {
          if (meta.family === 'lecture') {
            ({ note } = await finalizeLecture({ sessionId: st.sessionId, transcript: st,
              sidecar: proxy.sidecar, modelProfile: profile, onProgress }));
          } else {
            ({ note } = await finalizeMeeting({ sessionId: st.sessionId, transcript: st,
              sidecar: proxy.sidecar, modelProfile: profile, diarizationStatus: 'disabled', onProgress }));
          }
        } finally {
          await llm.unloadModel().catch(() => {});
        }
        const finalCount = proxy.total();
        const retryAttempts = chunkStarts.map((start, i) => (chunkStarts[i + 1] ?? finalCount) - start);
        return { note, retryAttempts, runMs: Date.now() - t0 };
      } finally {
        proc.kill('SIGKILL');
      }
    },
  };
}

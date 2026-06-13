import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import type { PipelineRunner, PipelineResult } from './pipeline-stub';
import { fixtureToSessionTranscript } from './fixture-to-transcript';
import { SidecarClient } from '../../src/main/sidecar/client';
import { LlamaCppLLM } from '../../src/main/engines/llama-cpp-llm';
import { makeGrammarSidecar } from '../../src/main/sidecar/grammar-call';
import type { GrammarCapableSidecar } from '../../src/main/sidecar/grammar-call';
import { finalizeLecture, finalizeMeeting, finalizeInterview, finalizeBrainstorm } from '../../src/main/sidecar/orchestrator';
import { modelProfiles } from '../../src/shared/models/profiles';
import '../../src/shared/families/lecture/core';
import '../../src/shared/families/meeting/core';
import '../../src/shared/families/interview/core';
import '../../src/shared/families/brainstorm/core';

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
      const proc = spawn(opts.sidecarBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      const client = new SidecarClient(proc);
      const t0 = Date.now();
      try {
        await client.waitForReady(15_000);
        const llm = new LlamaCppLLM(client);
        await llm.loadModel(opts.llmModelPath);

        // ── Anti-wedge sequence (adapted from scripts/note-quality-eval.ts:200-235;
        // the primer here primes on raw transcript text, not the assembled finalize
        // prompt — same big-prefill effect, the runner doesn't pre-build that prompt).
        // Real-LLM eval is FOREGROUND-only and slow (pitfalls.md spike-llm). The flat
        // 10s waitForReady is NOT enough: on an 8GB machine the first cold prefill can
        // exceed the production 60s no-progress timeout. We pay that cost once here
        // with (1) a 16-token plain warmup, then (2) a PLAIN (no-grammar) primer on a
        // big transcript prefill — empirically the only sequence that unwedges the
        // subsequent grammar call (plain-big-prefill → grammar ran at normal speed;
        // cold→grammar and grammar→grammar both wedged 300s+).
        const st = fixtureToSessionTranscript(transcript, meta);
        const warmText = st.transcriptSegments.map((s) => s.text).join('\n').slice(0, 4000);
        for await (const _ of client.sendStream(
          { type: 'generate', messages: [{ role: 'user', content: 'こんにちは' }], seed: 1, temperature: 0.4, maxTokens: 16 },
          { timeoutMs: 180_000 },
        )) { /* drain warmup */ }
        try {
          for await (const _ of client.sendStream(
            { type: 'generate', messages: [{ role: 'user', content: warmText }], seed: 1, temperature: 0.4, maxTokens: 8 },
            { timeoutMs: 600_000 },
          )) { /* drain primer */ }
        } catch { /* primer timeout is non-fatal — continue to the real finalize */ }

        const proxy = countingProxy(makeGrammarSidecar(client));

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
          } else if (meta.family === 'meeting') {
            ({ note } = await finalizeMeeting({ sessionId: st.sessionId, transcript: st,
              sidecar: proxy.sidecar, modelProfile: profile, diarizationStatus: 'disabled', onProgress }));
          } else if (meta.family === 'interview') {
            ({ note } = await finalizeInterview({ sessionId: st.sessionId, transcript: st,
              sidecar: proxy.sidecar, modelProfile: profile, diarizationStatus: 'disabled', onProgress }));
          } else {
            ({ note } = await finalizeBrainstorm({ sessionId: st.sessionId, transcript: st,
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

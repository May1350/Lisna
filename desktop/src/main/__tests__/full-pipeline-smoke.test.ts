/**
 * Full STT → SessionOrchestrator → LLM → Note end-to-end smoke.
 *
 * **OBSOLETE under STT Phase 2 (record-then-transcribe) — kept as a skipped
 * placeholder.** This smoke validated the LIVE pipeline: STT-per-10s-chunk via
 * `orch.onChunk` accumulating segments, then `orch.stop()` returning a plain
 * markdown Note. Both code paths were DELETED in Task C1 — recording now only
 * captures audio (`onChunk` returns `[]`), and the whole WAV is transcribed at
 * finalize through the v2 family pipeline.
 *
 * The replacement headless smoke (WAV → `transcribeFile` → finalize* → family
 * Note) is built by Task C3 once the finalize route transcribes the saved WAV.
 * Until then this file is `describe.skip` so it neither runs nor references the
 * removed `stop()` surface.
 */
import { describe, it, expect } from 'vitest';
import { SessionOrchestrator } from '../sidecar/orchestrator';

describe.skip('Full pipeline smoke (STT → Orchestrator → LLM → Note) — obsolete, rebuilt in Task C3', () => {
  it('placeholder — live stop()/onChunk-segment path removed in STT Phase 2', () => {
    // The orchestrator no longer exposes a live `stop()`; finalize is owned by
    // the v2 family pipeline (session/finalize). Asserts only that the class
    // still constructs so the skipped block stays type-valid.
    const orch = new SessionOrchestrator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stt: {} as any, llm: {} as any,
      sttModelPath: '/stt', llmModelPath: '/llm', language: 'ja',
    });
    expect(orch.language).toBe('ja');
  });
});

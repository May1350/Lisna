import type { STTEngine, TranscribeOpts } from '@shared/engine-interfaces';
import type { SttFn } from './run-stt-eval';

/**
 * Adapt a production `STTEngine` (e.g. `WhisperCppSTT`) into the `SttFn`
 * signature `runSttEval` expects. The engine returns timed segments; the
 * eval scorer needs a single string for CER/WER, so segments are joined
 * in emission order with no separator (whisper.cpp emits Japanese
 * segments without trailing spaces; injecting one would inflate WER).
 *
 * The `SttCondition` argument is intentionally ignored — the engine is
 * stateless w.r.t. condition (the orchestrator chooses which audio it
 * passes per condition; the engine just transcribes whatever bytes it
 * receives).
 */
export function makeRealSttFn(engine: STTEngine, opts?: TranscribeOpts): SttFn {
  return async (audio) => {
    const segments = await engine.transcribe(audio, opts);
    return segments.map((s) => s.text).join('');
  };
}

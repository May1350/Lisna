import type { Language, TranscriptSegment } from './types';
import type { ChatMessage } from './ipc-protocol';

export type { Language, TranscriptSegment, ChatMessage };

/**
 * Per-call STT tuning. `initialPrompt` is a Whisper proper-noun bias string
 * (built from a glossary — see `shared/stt/glossary.ts`). Empty/undefined =
 * no bias (identical to the pre-Phase-1 path).
 */
export interface TranscribeOpts {
  initialPrompt?: string;
}

export interface STTEngine {
  /** GGUF 모델 파일 로드. 호출 후 transcribe 가능 상태로 만든다. */
  loadModel(path: string, language: Language): Promise<void>;
  /** OS-confirmed reclamation 까지 대기 (스펙 §4 — 단순 Promise resolve 가 아닌, madvise + mach_vm 검증까지). */
  unloadModel(): Promise<void>;
  /**
   * 한 번 호출 = 약 10초 청크 1개 (마지막 부분 청크는 더 짧을 수 있음).
   * 청킹은 호출자(오디오 캡쳐 파이프라인) 책임. 엔진은 내부 스트리밍/클록 보유 안 함.
   */
  transcribe(audio: Float32Array, opts?: TranscribeOpts): Promise<TranscriptSegment[]>;
  /** Whole-file transcription of a saved WAV at finalize; `path` is an absolute 16k mono PCM16 WAV. */
  transcribeFile(path: string, opts?: TranscribeOpts): Promise<TranscriptSegment[]>;
}

export interface GenOpts {
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
}

export interface LLMEngine {
  loadModel(path: string): Promise<void>;
  unloadModel(): Promise<void>;
  /**
   * Stream tokens for a chat-style generation request. `messages` is the
   * structured chat history (system / user / assistant turns). The adapter
   * forwards it to the sidecar, which applies the GGUF chat template before
   * tokenization. See `ChatMessage` in `ipc-protocol.ts` for the rationale.
   */
  generate(messages: ChatMessage[], opts: GenOpts): AsyncIterable<string>;
}

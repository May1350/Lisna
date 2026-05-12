import type { Language, TranscriptSegment } from './types';

export type SidecarRequest =
  | { id: string; type: 'load'; kind: 'stt'; path: string; language: Language }
  | { id: string; type: 'load'; kind: 'llm'; path: string }
  | { id: string; type: 'unload'; kind: 'stt' | 'llm' }
  | { id: string; type: 'transcribe'; audioBase64: string; sampleRate: number }
  | { id: string; type: 'generate'; prompt: string; maxTokens?: number; temperature?: number; stop?: string[] };

export type SidecarResponse =
  | { id: string; type: 'ok' }                                       // load/unload 성공
  | { id: string; type: 'segments'; segments: TranscriptSegment[] }  // transcribe 결과
  | { id: string; type: 'token'; token: string }                     // generate 스트리밍 1 token
  | { id: string; type: 'done' }                                     // generate 종료
  | { id: string; type: 'error'; code: string; message: string };

export type SidecarEvent =
  | { type: 'ready'; pid: number; version: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'memory'; rssBytes: number; phase: 'idle' | 'stt' | 'llm' | 'transition' };

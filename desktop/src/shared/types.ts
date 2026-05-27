export type Language = 'ja' | 'en' | 'ko' | 'zh';

export const SUPPORTED_LANGUAGES: readonly Language[] = ['ja', 'en', 'ko', 'zh'] as const;

export interface ModelDescriptor {
  kind: 'stt' | 'llm';
  language?: Language;       // stt 만 사용
  filename: string;          // gguf 파일명
  sizeBytes: number;
  sha256: string;
  source: { url: string };   // hf hub or self-mirror
}

/**
 * Legacy (alpha) transcript segment shape — drives the alpha single-shot
 * `ja-note-v1.ts` path. v2 structured-note pipeline uses
 * `desktop/src/shared/note-schema/transcript.ts::TranscriptSegment`
 * (`{ ts, endTs, text, speakerId, meta? }`).
 *
 * Both shapes coexist during alpha→v2 transition (spec §10.1).
 * Adapter direction: STT emits legacy → orchestrator converts to v2 after
 * diarization assigns `speakerId`. See
 * `desktop/src/shared/note-schema/NAMING.md` for the locked convention.
 */
export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
  /**
   * Per-chunk no-speech probability from whisper.
   * Optional for back-compat with sidecar binaries built before 2026-05-18.
   * Same value attached to every segment from one whisper_full call (per
   * whisper.cpp src/whisper.cpp:7633 — state-level, not per-segment despite
   * the per-segment getter API).
   */
  noSpeechProb?: number;
}

export interface Note {
  language: Language;
  generatedAt: string;       // ISO
  markdown: string;
  transcriptSegments: TranscriptSegment[];
}

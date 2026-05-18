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

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export interface Note {
  language: Language;
  generatedAt: string;       // ISO
  markdown: string;
  transcriptSegments: TranscriptSegment[];
}

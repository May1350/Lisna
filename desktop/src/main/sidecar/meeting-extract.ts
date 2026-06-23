import { z } from 'zod';
import { MeetingExtractSchema, type ExtractedAtoms } from '@shared/families/meeting/extract-schema';
import { callWithGrammar, type LlmGenerator } from './grammar-call';
import { zodToGbnf } from '@shared/note-schema';
import type { SessionTranscript, Speaker, NoteLanguage } from '@shared/note-schema';
import type { SamplingParams } from '@shared/ipc-protocol';

/** Grammar built once at module scope — cold-path safe (no LLM spawn). */
const extractGrammar = zodToGbnf(MeetingExtractSchema, 'MeetingExtract');

/** Empty atoms returned on extraction failure so a bad chunk doesn't abort finalize. */
const EMPTY_ATOMS: ExtractedAtoms = {
  decisions: [],
  action_items: [],
  key_figures: [],
  open_questions: [],
  risks: [],
};

/**
 * Local chunk renderer — intentionally NOT imported from orchestrator.ts
 * (renderTranscriptWithSpeakers is file-local there; importing it would
 * create a circular dependency since the orchestrator imports meeting-extract).
 */
function renderChunk(chunk: SessionTranscript): string {
  return chunk.transcriptSegments
    .map((seg) => `[${seg.ts}] [話者${seg.speakerId}] ${seg.text}`)
    .join('\n');
}

/**
 * Build the per-chunk extraction prompt.
 * System: JA rules for faithful atom extraction.
 * User: rendered transcript text.
 */
export function buildMeetingExtractPrompt(
  chunkText: string,
  language: NoteLanguage,
): { system: string; user: string } {
  // JA rules (current only supported language for extraction).
  // `language` is part of the public API for future locale expansion.
  const isJa = language === 'ja' || language !== 'en';
  const system = isJa
    ? [
        'この区間のみ抽出してください。',
        '数値・日付・固有名詞は文字起こしのとおり正確に記録してください（言い直しは最後の確定値を使用）。',
        '雑談・休憩・相槌は除外してください。',
        '抽出対象: 決定事項 / 宿題（担当者） / 数値・指標 / 質問・懸念 / リスク。',
        'JSONのみを出力してください。説明文は不要です。',
      ].join('\n')
    : [
        'Extract from this segment only.',
        'Record numbers, dates, and proper nouns exactly as spoken (use the last confirmed value for corrections).',
        'Exclude small talk, breaks, and filler.',
        'Categorize: decisions / action items (owner) / key figures / open questions / risks.',
        'Output JSON only.',
      ].join('\n');

  const user = `会議書き起こし:\n${chunkText}`;

  return { system, user };
}

/**
 * Run one grammar-constrained LLM extraction call over a single transcript chunk.
 * Returns flat ExtractedAtoms plus the chunk's timestamp range.
 * On any failure (call or parse) returns ok:false with empty atoms so the
 * assembler can continue with the remaining chunks.
 */
export async function extractMeetingAtoms(opts: {
  chunk: SessionTranscript;
  generator: LlmGenerator;
  language: NoteLanguage;
  chunkIndex: number;
  totalChunks: number;
  speakers: Speaker[];
  sampling?: SamplingParams;
  temperature?: number;
}): Promise<{ atoms: ExtractedAtoms; tsRange: [number, number]; ok: boolean; reason?: string }> {
  const { chunk, generator, language, chunkIndex, sampling, temperature } = opts;

  const segs = chunk.transcriptSegments;
  const tsRange: [number, number] = [segs[0]?.ts ?? 0, segs.at(-1)?.endTs ?? 0];

  const chunkText = renderChunk(chunk);
  const { system, user } = buildMeetingExtractPrompt(chunkText, language);

  const result = await callWithGrammar<unknown>({
    prompt: user,
    system,
    schema: z.unknown(),
    grammar: extractGrammar,
    baseSeed: 6000 + chunkIndex,
    temperature: temperature ?? 0.2,
    maxAttempts: 3,
    maxTokens: 2048,
    generator,
    sampling,
    expectedLanguage: language,
  });

  if (!result.ok) {
    return { ok: false, reason: result.finalReason, atoms: { ...EMPTY_ATOMS }, tsRange };
  }

  try {
    const atoms = MeetingExtractSchema.parse(result.value);
    return { ok: true, atoms, tsRange };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason, atoms: { ...EMPTY_ATOMS }, tsRange };
  }
}

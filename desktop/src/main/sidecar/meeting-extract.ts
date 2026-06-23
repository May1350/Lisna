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
 *
 * Renders `[<ts>] <text>` — the `[話者<id>]` token was DROPPED (2026-06-23): the
 * 3B echoed that front-of-line marker verbatim into decisions[].text. `[ts]`
 * stays as a low-echo-risk within-chunk ordering cue (it's not read back —
 * topic-synth anchors atoms from transcriptSegments[].ts directly — and
 * quality-filters strips any echoed `[\d+]` anyway). Speaker attribution is off
 * while diarization is disabled (owners already undefined); reintroduce it as a
 * natural suffix, not a leading bracket token, when diarization returns.
 */
export function renderChunk(chunk: SessionTranscript): string {
  return chunk.transcriptSegments
    .map((seg) => `[${seg.ts}] ${seg.text}`)
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
  //
  // Positive-framing rewrite (2026-06-23): the prior prompt named negatives
  // ("雑談・相槌は除外") which PRIMES a 3B to EMIT them (p1tune backfire), and gave
  // no positive target for abstraction, so the model echoed transcript lines
  // verbatim as decisions. Every line now states what TO do — paraphrase into a
  // short point (言い換え/まとめ), keep numbers/proper-nouns verbatim, return []
  // when a category is empty (positive antidote to the placeholder
  // hallucination). NO negative examples; NO in-prompt JSON example (the grammar
  // fixes the shape; an example anchors small models). Designed + adversarially
  // critiqued; SHIP gated on a reboot A/B (copyRate↓, coverage not regressed,
  // figure-fidelity intact).
  const isJa = language === 'ja' || language !== 'en';
  const system = isJa
    ? [
        'あなたは会議の書記です。発言を聞いて、要点だけを記録します。',
        '決まったこと・やること（担当者がいれば owner）・数値や日付・未解決の質問・リスクを記録してください。',
        '各項目は、発言の内容を自分の言葉で一文の短い要点にまとめてください。一読で「何が決まったか」「何をするか」が分かる形にします。',
        '数値・日付・金額・固有名詞・製品名は、発言のとおり正確に書いてください（言い直された場合は最後に確定した値を使います）。',
        '実際に挙がった内容だけを記録してください。記録すべき内容が無い分類は、空の配列 [] にします。',
        'JSONのみを出力してください。',
      ].join('\n')
    : [
        'You are the meeting scribe. Record only the key points from what is said.',
        'Record decisions, action items (owner if stated), numbers/dates, open questions, and risks.',
        'For each item, paraphrase the point into one short line in your own words — so a reader sees at a glance what was decided or is to be done.',
        'Write numbers, dates, amounts, and proper nouns exactly as spoken (use the last confirmed value for corrections).',
        'Record only what actually came up; use an empty array [] for any category with nothing real.',
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

import type { SessionTranscript } from '@shared/note-schema/transcript';
import type { NoteFamily, NoteLanguage } from '@shared/note-schema';
import { renderSystemTemplate } from './prompts';
import { SYSTEM as LECTURE_SYSTEM } from '../lecture/prompts/v2';
import { SYSTEM as MEETING_SYSTEM } from '../meeting/prompts/v1';
import { SYSTEM as INTERVIEW_SYSTEM } from '../interview/prompts/v2';
import { SYSTEM as BRAINSTORM_SYSTEM } from '../brainstorm/prompts/v1';
import { PASS2_FIELD_SEMANTICS } from './two-pass-prompts';

/**
 * Single-shot cloud prompt per family (spec section 5 "Prompt reuse").
 * Reuses the JA field-semantics the on-device prompts already encode; the
 * cloud model gets the WHOLE transcript in one call (no chunking, no GBNF).
 * postDecodeOnly fields (from, ideas[].id) and NoteBase system meta are
 * filled/overwritten by the caller (Task 5) — the model is told NOT to emit
 * them.
 */

// Numeric (not a 'cloud-v1' label) because it is stored into NoteBase
// generatedBy.promptVersion, which is z.number() — same convention as the
// on-device family prompts' numeric `version` fields.
export const CLOUD_PROMPT_VERSION = 1;

const FAMILY_SYSTEM: Record<NoteFamily, string> = {
  lecture: LECTURE_SYSTEM,
  meeting: `${MEETING_SYSTEM}\n\n${PASS2_FIELD_SEMANTICS.meeting}`,
  interview: INTERVIEW_SYSTEM,
  brainstorm: BRAINSTORM_SYSTEM,
};

// Verbatim-locked (spec section 5 "Prompt reuse") — do not reword; tests pin
// the key phrases (from / generatedBy / JSON-only / family+title).
const CLOUD_ADDENDUM = `
## 出力形式（クラウド生成・厳守）
- 出力は JSON オブジェクト 1 個のみ。前後に説明文・コードフェンスを付けないでください。
- ノート全体を一度に出力します（チャンク分割はありません）。
- 「from」フィールドと ideas[].id は出力しないでください（システムが後段で付与します）。
- schemaVersion / generatedAt / generatedBy / language / durationSec も出力不要です（システムが設定します）。
- family と title（内容を要約した日本語タイトル）は必ず含めてください。`;

/** mm:ss, or hh:mm:ss once the segment is an hour or more in. */
function formatTs(totalSeconds: number): string {
  const wholeSeconds = Math.floor(totalSeconds);
  const s = wholeSeconds % 60;
  const totalMinutes = Math.floor(wholeSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * One line per segment: `[mm:ss] text`, or `[mm:ss] 話者N: text` once the
 * transcript has more than one distinct speakerId. Unlike the on-device
 * per-chunk renderers (orchestrator.ts renderTranscriptWithSpeakers), there's
 * no separate "speaker map" header — this is a single whole-transcript call,
 * so the raw SpeakerRef is enough context for the model.
 */
function formatTranscript(transcript: SessionTranscript): string {
  const distinctSpeakers = new Set(transcript.transcriptSegments.map((s) => s.speakerId));
  const multiSpeaker = distinctSpeakers.size >= 2;
  return transcript.transcriptSegments
    .map((s) => {
      const prefix = multiSpeaker ? `話者${s.speakerId}: ` : '';
      return `[${formatTs(s.ts)}] ${prefix}${s.text}`;
    })
    .join('\n');
}

export function buildCloudNotePrompt(
  family: NoteFamily,
  transcript: SessionTranscript,
  language: NoteLanguage,
): { system: string; user: string } {
  const familySystem = renderSystemTemplate(FAMILY_SYSTEM[family], language);
  const system = `${familySystem}\n${CLOUD_ADDENDUM}`;
  const user = `以下は録音全体の文字起こしです。この内容から ${family} ノートを JSON で作成してください。\n\n${formatTranscript(transcript)}`;
  return { system, user };
}

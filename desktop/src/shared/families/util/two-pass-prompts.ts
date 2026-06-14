import type { ChunkContext } from './prompts';
import type { NoteFamily, NoteLanguage } from '@shared/note-schema';

const LANG_WORD: Record<NoteLanguage, string> = { ja: '日本語', en: 'English', ko: '한국어' };

/** Per-family one-line emphasis for the free-prose pass — what to foreground.
 *  The grounding/JA/no-JSON rules are shared (see buildPass1Prompts). */
export const PASS1_EMPHASIS: Record<NoteFamily, string> = {
  lecture: 'この回で説明された概念・用語・例を、教わった順に分かりやすくまとめてください。',
  meeting: '誰が何を主張し、どんな論点・決定・宿題が出たかが分かるようにまとめてください。',
  interview: '質問と回答の流れ（誰が何を尋ね、どう答えたか）が分かるようにまとめてください。',
  brainstorm: '出されたアイデアと、その背景・賛否・発展が分かるようにまとめてください。',
};

/** Pass-1: free JA prose (NO grammar). The grounding step. */
export function buildPass1Prompts(
  family: NoteFamily,
  ctx: ChunkContext,
  language: NoteLanguage,
): { system: string; user: string } {
  const L = LANG_WORD[language];
  const system = `あなたは会話・講義の記録者です。文字起こしの一部を読み、${L}の散文で内容を要約します。

# 最重要ルール (違反した出力は破棄され、やり直しになります)
- 必ず${L}で書くこと。英語の文や見出しを書いてはいけません（人名・社名・専門用語の原語表記のみ可）。
- 文字起こしに実際に出てきた内容だけを書くこと。推測・新情報・一般論を加えてはいけません（捏造禁止）。
- JSON・記号・マークダウン・箇条書き記号は使わず、ふつうの文章で書くこと。

# この回で重視すること
- ${PASS1_EMPHASIS[family]}`;
  const user = `パート ${ctx.chunkIndex + 1}/${ctx.totalChunks}

文字起こし:
${ctx.transcript}

上の文字起こしの内容を${L}の散文で要約してください。`;
  return { system, user };
}

/** Pass-2: structure the pass-1 prose into the family JSON (grammar enforces shape). */
export function buildPass2Prompts(language: NoteLanguage): { system: string; userPrefix: string } {
  const L = LANG_WORD[language];
  const system = `あなたは${L}の要約を、指定されたJSON構造に変換するアシスタントです。

# 最重要ルール
- 入力の${L}の要約に書かれている内容だけを使うこと。新しい情報や英語への翻訳を加えてはいけません。
- 出力の文字列値は必ず${L}にすること。
- title は内容を表す簡潔な1行にすること。要約全体を title に入れてはいけません。
- 質疑・議論・アイデアなどの配列は、項目ごとに1要素に分割すること（1要素に複数を詰め込まない）。
- 文字起こしに無い数値・時刻を作らないこと（ts は不明なら 0）。
- 指定されたJSONスキーマに厳密に従うこと。`;
  const userPrefix = `以下の${L}の要約を、指定スキーマのJSONに構造化してください。`;
  return { system, userPrefix };
}

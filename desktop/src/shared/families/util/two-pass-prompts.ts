import type { ChunkContext } from './prompts';
import type { NoteFamily, NoteLanguage } from '@shared/note-schema';

const LANG_WORD: Record<NoteLanguage, string> = { ja: '日本語', en: 'English', ko: '한국어' };

/** Per-family one-line emphasis for the free-prose pass — what to foreground.
 *  The grounding/JA/no-JSON rules are shared (see buildPass1Prompts). */
export const PASS1_EMPHASIS: Record<NoteFamily, string> = {
  lecture: 'この回で説明された概念・用語・例を、教わった順に分かりやすくまとめてください。',
  meeting:
    'この会議の主要な議題（全体で5〜7個程度）ごとに、決まったこと・担当者と期限のあるタスク・重要な数値や固有名詞を、' +
    '文字起こしのとおり正確にまとめてください。休憩・雑談・本題でない話（天気・設備の不調・飲食店の話など）は除外すること。',
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
- 数値・日付・固有名詞（社名・製品名・人名）は推測せず、文字起こしにあるとおり正確に書き写すこと。言い直し（例:「4,200…いや4,400」）があれば、最後に確定した値を採用すること。
- 話題ごとに段落を分け、同じ話題は1つにまとめること（細分化しすぎない）。
- JSON・記号・マークダウン・箇条書き記号は使わず、ふつうの文章で書くこと。

# この回で重視すること
- ${PASS1_EMPHASIS[family]}`;
  const user = `パート ${ctx.chunkIndex + 1}/${ctx.totalChunks}

文字起こし:
${ctx.transcript}

上の文字起こしの内容を${L}の散文で要約してください。`;
  return { system, user };
}

/** Per-family field semantics for the structuring pass — maps the prose to the
 *  RIGHT schema fields (without this, the model dumps everything into decisions
 *  as topic labels). Generic when a family has no entry. */
const PASS2_FIELD_SEMANTICS: Partial<Record<NoteFamily, string>> = {
  meeting:
    `# 重要な区別（数は少なくてよい。質を優先）
- topic_arc は主要議題のみ（5〜7個）。雑談・小さな論点を議題にしないこと。
- decisions の text には「決定内容そのもの」を書くこと。良い例:「プロプランを2,980円から3,480円に値上げする」／悪い例:「料金改定」（これは議題名なので topic_arc へ）。決まっていない話・提案は入れない。
- 担当者つきの具体的タスクは decisions ではなく next_steps に入れ、owner（担当者）を付けること。
- executive_summary は主要議題すべてに触れる2〜4文にすること。
- 固有名詞（社名・製品名・人名）は要約のとおり残すこと。`,
};

/** Pass-2: structure the pass-1 prose into the family JSON (grammar enforces shape).
 *  Pass `family` to inject that family's field semantics. */
export function buildPass2Prompts(
  language: NoteLanguage,
  family?: NoteFamily,
): { system: string; userPrefix: string } {
  const L = LANG_WORD[language];
  const semantics = family && PASS2_FIELD_SEMANTICS[family] ? `\n\n${PASS2_FIELD_SEMANTICS[family]}` : '';
  const system = `あなたは${L}の要約を、指定されたJSON構造に変換するアシスタントです。

# 最重要ルール
- 入力の${L}の要約に書かれている内容だけを使うこと。新しい情報や英語への翻訳を加えてはいけません。
- 出力の文字列値は必ず${L}にすること。
- title は内容を表す簡潔な1行にすること。要約全体を title に入れてはいけません。
- 1つの要素に複数の異なる項目を詰め込まないこと。ただし同じ議題・同じ決定は1つの要素にまとめること（不要に分割しない）。
- 文字起こしに無い数値・時刻を作らないこと（ts は不明なら 0）。
- 該当する内容が無いフィールドは空配列または省略にすること（埋めるための作り話をしない）。
- 指定されたJSONスキーマに厳密に従うこと。${semantics}`;
  const userPrefix = `以下の${L}の要約を、指定スキーマのJSONに構造化してください。`;
  return { system, userPrefix };
}

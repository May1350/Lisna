import type { PromptVariant, ChunkContext, MergeContext } from '../../util/prompts';
import { interviewPromptsV1 } from './v1';

/**
 * v2 — fabrication-incident fix (2026-06-12, dump 2026-06-11T16-14-00-372Z).
 *
 * On a real 11.5-min JA finance interview the 3B ignored the transcript and
 * emitted a memorized ENGLISH boilerplate template (graded F by two
 * reviewers; reproduced deterministically offline at seed 7000 — jaRatio 0,
 * grounding 0, round invented ts). Three v1 defects implicated:
 *
 *   1. `家族 = interview` — "note family" mistranslated as kinship 家族,
 *      twice, right at the generation boundary.
 *   2. No explicit output-language rule. The EN-authored lecture/meeting
 *      prompts carry "All user-visible text MUST be Japanese"; the JA-native
 *      interview prompt assumed it implicitly — the 3B didn't.
 *   3. The user template ended with an ENGLISH instruction sentence
 *      ("Produce the InterviewNote JSON for this chunk only.") — the last
 *      prose before generation primes English continuation.
 *
 * v2 keeps v1's structure (roles / extraction / anti-parroting / budget) and
 * applies surgical fixes: a 最重要ルール block up top (Japanese-only strings,
 * transcript-grounding, real-ts-only), `family = "interview"` spelled as a
 * field value not 家族, an all-Japanese tail instruction, and an explicit
 * ban on round placeholder timestamps. Merge template carried from v1
 * unchanged (merge path not implicated).
 */
const SYSTEM = `あなたは日本語インタビューの構造化要約システムです。
入力: 文字起こしテキスト (時間 + 話者IDタグ付き)
出力: InterviewNote JSON のみ (前置き・説明禁止)

# 最重要ルール (違反した出力は破棄され、やり直しになります)
- すべての文字列値 (title / purpose / subject_summary / question / answer / themes / quotable_lines / key_takeaways / conclusions / next_steps) は必ず日本語で書くこと。英語の文章を出力してはいけません。
- すべての内容は下の transcript に実際に出現する発言だけから導くこと。transcript を読まずに一般的・汎用的な内容を書くことは捏造であり禁止。
- ts / appears_at_ts には transcript の [分:秒] タグから読み取った実際の秒数を使うこと。0, 10, 20, 30 のような切りの良い数値を機械的に並べることは禁止。

# 役割 (interviewer / interviewee role assignment)
- participants[].role に interviewer (質問者) と interviewee (回答者) を記録してください。
- 質問者は通常 1 人。回答者は 1 人 (1:1) または複数 (panel)。
- 各 qa_pairs の asked_by / answered_by には Speaker map に存在する話者ID (整数) だけを入れてください。Speaker map にないIDを発明しないでください。
- 話者が複数いる場合、asked_by === answered_by は許容されません (同じ話者が自分に質問することはありません)。
- Speaker map に話者が1人しかいない場合は、すべての話者ID (asked_by / answered_by / speakerRef) に 0 を入れてください。

# 抽出ルール
- purpose: このインタビューの目的・主題を transcript の語彙を使って1文で記述してください。
- qa_pairs: 質問→回答ペア。question / answer は transcript の発言をほぼそのまま使う (要約してもよいが、transcript にない話題を作らない)。max 80 ペア。
- themes: 回答に通底する考え方や姿勢を拾う。表面的な話題ではなく潜在的なテーマ。max 12 テーマ (各 themes[].appears_at_ts ≤ 20)。
- quotable_lines: transcript から実際の印象的な発言を引用する。平凡な発言を入れない。max 20。
- key_takeaways: インタビューを通じて得られた洞察。max 15。
- subject_summary: 被取材者の概要 (transcript で語られた事実のみ)。

# 重要 (anti-parroting)
- 出力 JSON 内のすべてのテキストは入力 transcript から派生したものでなければなりません。
- transcript に出現しない理論・数字・名前を生成 (捏造) しないでください。
- 同じ意味の質問を複数 qa_pairs に分けて記録しないでください (1つに統合)。

# Budget
- qa_pairs ≤ 80 / themes ≤ 12 / quotable_lines ≤ 20 / key_takeaways ≤ 15
- conclusions ≤ 15 / next_steps ≤ 30 (PurposeDrivenNote 共通)
`;

export const interviewPromptsV2: PromptVariant = {
  version: 2,
  variantId: 'interview-v2',
  systemTemplate: SYSTEM,
  chunkUserTemplate: ({ chunkIndex, totalChunks, transcript }: ChunkContext) =>
    `Chunk ${chunkIndex + 1} of ${totalChunks}\n\nTranscript:\n${transcript}\n\n上の transcript だけを根拠に、この chunk の InterviewNote JSON を作成してください。family フィールドは "interview"。すべての文字列値は日本語で書くこと。JSON のみを出力。`,
  mergeUserTemplate: (ctx: MergeContext) => interviewPromptsV1.mergeUserTemplate!(ctx),
  recommendedTemp: 0.4,
  notes:
    'v2: fabrication-incident fix — 最重要ルール block (JA-only strings / transcript-grounding / real-ts ban on round placeholders), 家族→family-field wording, all-JA tail instruction. Structure otherwise inherited from v1; merge template delegated to v1 (not implicated).',
};

import type { PromptVariant, ChunkContext, MergeContext } from '../../util/prompts';

const SYSTEM = `あなたは日本語インタビューの構造化要約システムです。
入力: 文字起こしテキスト (時間 + 話者IDタグ付き)
出力: InterviewNote JSON のみ (前置き・説明禁止)

# 役割 (interviewer / interviewee role assignment)
- participants[].role に interviewer (質問者) と interviewee (回答者) を記録してください。
- 質問者は通常 1 人。回答者は 1 人 (1:1) または複数 (panel)。
- 各 qa_pairs の asked_by / answered_by には Speaker map に存在する話者ID (整数) だけを入れてください。Speaker map にないIDを発明しないでください。
- 話者が複数いる場合、asked_by === answered_by は許容されません (同じ話者が自分に質問することはありません)。
- Speaker map に話者が1人しかいない場合は、すべての話者ID (asked_by / answered_by / speakerRef) に 0 を入れてください。

# 抽出ルール
- purpose: このインタビューの目的・主題を1文で記述してください。
- qa_pairs: 質問→回答ペア。テキストは transcript から逐語的に派生させる。creative writing 禁止。max 80 ペア。
- themes: 回答に通底する考え方や姿勢を拾う。表面的な話題ではなく潜在的なテーマ。max 12 テーマ (各 themes[].appears_at_ts ≤ 20)。
- quotable_lines: 印象的・代表的な発言のみ。平凡な発言を入れない。max 20。
- key_takeaways: インタビューを通じて得られた洞察。max 15。
- subject_summary: 被取材者の概要。

# 重要 (anti-parroting)
- 出力 JSON 内のすべてのテキストは入力 transcript から派生したものでなければなりません。
- transcript に出現しない理論・数字・名前を生成 (捏造) しないでください。
- 同じ意味の質問を複数 qa_pairs に分けて記録しないでください (1つに統合)。

# Budget
- qa_pairs ≤ 80 / themes ≤ 12 / quotable_lines ≤ 20 / key_takeaways ≤ 15
- conclusions ≤ 15 / next_steps ≤ 30 (PurposeDrivenNote 共通)
`;

export const interviewPromptsV1: PromptVariant = {
  version: 1,
  variantId: 'interview-v1',
  systemTemplate: SYSTEM,
  chunkUserTemplate: ({ chunkIndex, totalChunks, transcript }: ChunkContext) =>
    `Chunk ${chunkIndex + 1} of ${totalChunks}\n\nTranscript:\n${transcript}\n\nProduce the InterviewNote JSON for this chunk only. 家族 = interview。JSON のみを出力。`,
  mergeUserTemplate: ({ partials }: MergeContext) =>
    `${partials.length} partial InterviewNote JSONs to merge:\n${JSON.stringify(partials, null, 2)}\n\n上記 partial JSONs を1つの InterviewNote に統合してください。家族 = interview。\n- themes: 意味的に同義のテーマは1エントリに統合し、appears_at_ts を結合。\n- qa_pairs: ts 昇順に並べ、順序を保持。\n- quotable_lines / key_takeaways / conclusions / next_steps: 重複を除外。\n入力 partial に存在しないテーマ・引用・Q&A を生成しないでください。JSON のみを出力。`,
  recommendedTemp: 0.4,
  notes: 'v1: anti-parroting + JA output + interviewer/interviewee role assignment + .max(N) budget hints. Aligned with Plan 7 Interview judge axes (qaParity / themeExtraction / quotableSelection). mergeUserTemplate present — Interview uses merge-llm for themes (spec section 5.2b).',
};

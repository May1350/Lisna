import type { PromptVariant, ChunkContext } from '../../util/prompts';
import { LECTURE_SLOTS } from '../slots';

/**
 * v2 — JA-native prompt (EN-flip fix, 2026-06-13).
 *
 * On a real JA accounting lecture the 3B emitted English output (jaRatio 0.05)
 * because lecture-v1 is ENGLISH-authored with a weak JA directive that contained
 * a prose loophole: "unless the lecture itself uses English or romanized loanwords"
 * licensed full-English output on topic-drift.  Three v1 defects implicated:
 *
 *   1. English-authored system prompt — model primed English continuation from
 *      the generation boundary.
 *   2. The JA directive was an English sentence inside an English prompt — weak
 *      in-context signal.
 *   3. The user template tail ended with an ENGLISH instruction sentence
 *      ("Produce the LectureNote JSON for this chunk only.") — last prose before
 *      generation primes English continuation.
 *
 * v2 mirrors the proven interview-v2 fix: JA-native system prompt written in
 * Japanese throughout, 最重要ルール block at the top (Japanese-only strings /
 * transcript-grounding / loanwords+terms+formulas stay, but PROSE must be JA),
 * and a JA user-tail.  All v1 content rules (sections, slots, anti-parroting,
 * provenance, empty-chunk) are preserved — translated to JA.  Merge template
 * absent: lecture uses deterministic merge (same as v1, spec §5.2b).
 */

const SLOT_HINTS = LECTURE_SLOTS.map(
  (s) => `- **${s.type}**: ${s.promptHint}`,
).join('\n');

const SYSTEM = `あなたは日本語講義の構造化ノート生成システムです。
入力: 文字起こしテキスト (タイムスタンプ付き)
出力: LectureNote JSON のみ (前置き・説明・マークダウン禁止)

# 最重要ルール (違反した出力は破棄され、やり直しになります)
- すべての文字列値 (title / course / lecturer / 各 section の heading / summary / takeaway / key_terms / examples / points 等) は必ず日本語で書くこと。**英語の文章を出力してはいけません。** ただし専門用語・ローマ字借用語・数式 (LaTeX 記法可) は原語のまま保持してよい。
- すべての内容は下の transcript に実際に出現する発言だけから導くこと。transcript にない理論・数値・名前を生成 (捏造) することは禁止。

# セクション構造
- 各 section は heading (≤120字)・ts (秒数, 整数)・summary (1〜3文)・key_terms / examples / points 配列 (空可) を持つ。
- JSON のみを出力すること。markdown・前置き・説明を含めないこと。

# スロット (オプション — セクションごとに各タイプ最大1つ。内容が genuinely 複数ある場合のみ複数可)
${SLOT_HINTS}

# 重要 (anti-parroting)
- formula の expression フィールドには講師が実際に述べた/書いた式のみを記録すること。"E=mc^2"・"F=ma"・"P=NP" のようなプレースホルダは、その講義がまさにその式について語っている場合のみ使用可。transcript 内に式が見当たらない場合は formula スロットを省略すること。
- 同じルールが procedure_steps・argument_chain・timeline にも適用される。捏造しないこと。transcript にあるものだけを使うこと。

# 出典 (provenance)
- スキーマは key_term・example・point・スロットの各要素に \`from: "transcript" | "inferred"\` を要求する。
- transcript で直接述べられたものには \`"from": "transcript"\` を出力すること。
- pipeline が後から "inferred" を付与する。自分でマークする必要はないが、不確実な場合は \`"transcript"\` を優先すること。

# 空 chunk の扱い
- chunk に意味のある内容がない (沈黙・フィラーのみ) 場合は、sections が空の最小限の note を出力すること。捏造しないこと。`;

export const lecturePromptsV2: PromptVariant = {
  version: 2,
  variantId: 'lecture-v2',
  systemTemplate: SYSTEM,
  chunkUserTemplate: ({ chunkIndex, totalChunks, transcript }: ChunkContext) =>
    `Chunk ${chunkIndex + 1} of ${totalChunks}\n\nTranscript:\n${transcript}\n\n上の transcript だけを根拠に、この chunk の LectureNote JSON を作成してください。すべての散文 (heading・summary・説明) は日本語で書くこと (専門用語・数式は原語可)。JSON のみを出力。`,
  // No mergeUserTemplate — Lecture uses deterministic merge (spec §5.2b).
  recommendedTemp: 0.4,
  notes:
    'v2: JA-native prompt — 最重要ルール block (JA-only prose / transcript-grounding; loanwords+terms+formulas in original language allowed), all-JA tail instruction. Eliminates the EN-authored loophole in v1 that licensed full-English output. All content rules (slots, anti-parroting, provenance, empty-chunk) preserved, translated to JA.',
};

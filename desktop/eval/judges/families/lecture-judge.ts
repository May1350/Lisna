// desktop/eval/judges/families/lecture-judge.ts
export const LECTURE_JUDGE_PROMPT = `あなたは Lecture-family note の厳しい採点者です。
入力: transcript (時系列のbucket列), note (採点対象のLectureNote JSON), ground_truth (補助 — expectedFormulas など).
出力は JSON のみ。説明文・前置きは禁止。

# 共通6軸 (0-10)
- coverage: transcript の主要概念のうち何 % が note に反映されているか。漏れ = issues に anchor付きで列挙。
- accuracy: claims/definitions/timestamps が transcript と一致するか。誤定義・幻覚は大幅減点。
- hierarchy: section 分けが論理的か。重複・孤立 bullet・誤グルーピングは減点。
- conciseness: bullet/summary が要約されているか。冗長・繰返しは減点。短すぎて意味不明も減点。
- importance: \`points[*].important: true\` の使い分け。乱発と欠落の両方減点。
- provenance: \`key_terms[*].from: 'transcript'\` の比率と妥当性。inferred を必要箇所のみで使っているか。

# Lecture-specific 2軸 (0-10)
- sectionCoherence: section 内の bullet/key_terms/examples/points が同じテーマで束ねられているか。違うトピックが混ざっている = 減点。
- contentFidelity: extras (formula/procedure_steps/argument_chain/timeline) の中身が transcript の内容に grounded か。
  - 例: 物理講義 transcript なのに formula に "E = mc^2" が出現、transcript には "静電ポテンシャル" "電位" しか出てこない → これは prompt exemplar parroting で大幅減点 (3点以下)。
  - ground_truth.expectedFormulas に挙がっている formula は parroting ではない。
  - extras 全体が空でも transcript に formula らしき式・段階的手順がなければ pass。

# 採点指針
- 5 = 平均的な note。
- issues は 「coverage が低い」ではなく 「[03:20] X の定義が transcript にあるが note に欠落」のように anchor付き具体的に。
- wins も 「[12:00] 静電ポテンシャル section が良くまとまっている」のように。
- overall は coverage 0.25 + accuracy 0.30 + hierarchy 0.15 + conciseness 0.10 + importance 0.05 + sectionCoherence 0.05 + contentFidelity 0.10 の加重平均。provenance は overall に含めない。

出力:
{
  "coverage": <0-10>, "accuracy": <0-10>, "hierarchy": <0-10>, "conciseness": <0-10>,
  "importance": <0-10>, "provenance": <0-10>,
  "sectionCoherence": <0-10>, "contentFidelity": <0-10>,
  "overall": <0-10>,
  "issues": ["...", "..."], "wins": ["...", "..."]
}`;

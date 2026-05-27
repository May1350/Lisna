// desktop/eval/judges/families/brainstorm-judge.ts
export const BRAINSTORM_JUDGE_PROMPT = `あなたは Brainstorm-family note の厳しい採点者です。
入力: transcript, note (BrainstormNote JSON), ground_truth (themes/ideaCount/participantCount).
出力は JSON のみ。

# 共通6軸 (0-10)
- Lecture/Meeting と同じ定義。

# Brainstorm-specific 3軸 (0-10)
- clusterCoherence: 各 idea_cluster.theme と所属 ideas が意味的に一致するか。theme と無関係の idea が混ざっている = 減点。
- ideaDiversity: 重複アイデア (言い回しは違うが意味同じ) の比率。重複が多いほど減点。0% で 10 点。
- argumentChainDepth: ideas 間の引用関係 (built_on / contradicts / refines) を引き出せているか。flat な list だけ = 減点 (3-4点)。深い chain は加点 (8+)。

# 採点指針
- 5 = 平均的。
- 1 idea_cluster しかなく ground_truth.themes が複数ある = clusterCoherence 大幅減点。
- ground_truth.ideaCount の 50%-150% range 外 = ideaDiversity の前段で issues に anchor付き列挙。
- overall = coverage 0.20 + accuracy 0.25 + hierarchy 0.10 + conciseness 0.10 + clusterCoherence 0.15 + ideaDiversity 0.10 + argumentChainDepth 0.10 の加重平均。importance/provenance は除外。

出力:
{
  "coverage": <0-10>, "accuracy": <0-10>, "hierarchy": <0-10>, "conciseness": <0-10>,
  "importance": <0-10>, "provenance": <0-10>,
  "clusterCoherence": <0-10>, "ideaDiversity": <0-10>, "argumentChainDepth": <0-10>,
  "overall": <0-10>,
  "issues": ["...", "..."], "wins": ["...", "..."]
}`;

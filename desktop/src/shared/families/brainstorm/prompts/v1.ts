import type { PromptVariant, ChunkContext, MergeContext } from '../../util/prompts';

const SYSTEM = `あなたは日本語のブレインストーミング・セッションの構造化要約システムです。
入力: 文字起こしテキスト (時間 + 話者IDタグ付き)
出力: BrainstormNote JSON のみ (前置き・説明禁止)

# 抽出ルール
- purpose: このブレインストーミングの目的・問いを1文で記述してください。
- idea_clusters: 関連するアイデア群をテーマで括る。各 cluster の theme は cluster の ideas を実際に括れるラベルでなければなりません (clusterCoherence)。
- ideas[]: 個別の発想。contributed_by に発話者の話者IDを記録。creative writing 禁止 — transcript から派生したテキストのみ。
- ideas[].id は出力に含めないでください — 後段で UUID を割り当てます (post-decode hydration)。
- parking_lot: 重要だが本セッション範囲外として棚上げされた論点。
- conclusions: 議論を通じて見えた一般的な気づき (decisions ではなく divergent から見えた洞察)。
- next_steps: 具体的な行動。owner を話者ID (整数) で記録。

# 議論の流れ (argument chain identification)
- A が提案 → B が反応 (賛成・反論・補強) → C がさらに展開、という argument chain がある場合、同じ idea_cluster の ideas[] に時間順 (ts 昇順) で並べてください。
- 反論や保留は parking_lot または conclusions に明示してください。

# 多様性 (idea diversity)
- 「ノート生成を5秒以内に」「ノート生成を高速に」「ノート生成を瞬時にする」は言い換え (paraphrase) — 1つの idea として統合してください。
- 同じテーマ内でも angle (時間軸・コスト軸・UX軸) が違えば別 idea として保持してください。

# 重要 (anti-parroting)
- 出力 JSON 内のテキストは入力 transcript から派生したものでなければなりません。
- transcript に出現しないアイデア・反論・人名を生成 (捏造) しないでください。
- idea_clusters[].theme は cluster の ideas を本当に括れるラベルでなければなりません — "良いアイデア" のような無意味な theme は禁止。

# Budget
- idea_clusters ≤ 15
- cluster あたり ideas ≤ 30 (≥ 1 必須 — 空 cluster は禁止)
- parking_lot ≤ 20
- conclusions ≤ 15 / next_steps ≤ 30 (PurposeDrivenNote 共通)
`;

export const brainstormPromptsV1: PromptVariant = {
  version: 1,
  variantId: 'brainstorm-v1',
  systemTemplate: SYSTEM,
  chunkUserTemplate: ({ chunkIndex, totalChunks, transcript }: ChunkContext) =>
    `Chunk ${chunkIndex + 1} of ${totalChunks}\n\nTranscript:\n${transcript}\n\nProduce the BrainstormNote JSON for this chunk only. 家族 = brainstorm。JSON のみを出力。`,
  mergeUserTemplate: ({ partials }: MergeContext) =>
    `${partials.length} partial BrainstormNote JSONs to merge:\n${JSON.stringify(partials, null, 2)}\n\n上記 partial JSONs を1つの BrainstormNote に統合してください。家族 = brainstorm。\n- idea_clusters: 意味的に同義のテーマは1クラスタに統合。各クラスタの ideas は ts 昇順に並べる。\n- parking_lot / conclusions / next_steps: 重複を除外。\n- atmosphere: 全 partial を踏まえて1つ選択。\n- ideas[].id は出力に含めないでください (post-decode hydration が割り当てます)。\n入力 partial に存在しないアイデアを生成しないでください。JSON のみを出力。`,
  recommendedTemp: 0.5,
  notes: 'v1: anti-parroting + JA output + argument-chain identification + idea diversity + clusterCoherence + .max(N) budget hints. Aligned with Plan 7 Brainstorm judge axes (clusterCoherence / ideaDiversity / argumentChainDepth). mergeUserTemplate present — Brainstorm uses merge-llm for idea_clusters (spec section 5.2b).',
};

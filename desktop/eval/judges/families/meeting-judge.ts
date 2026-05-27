// desktop/eval/judges/families/meeting-judge.ts
export const MEETING_JUDGE_PROMPT = `あなたは Meeting-family note の厳しい採点者です。
入力: transcript, note (MeetingNote JSON), ground_truth (decisions/actionItems/participantCount).
出力は JSON のみ。

# 共通6軸 (0-10) — coverage/accuracy/hierarchy/conciseness/importance/provenance
- Lecture と同じ定義。decisions/action_items を含め全 claim が transcript と一致するかが accuracy。

# Meeting-specific 3軸 (0-10)
- decisionCapture: ground_truth.decisions のうち mustAppear:true が何 % note.decisions に出現するか。文字列完全一致でなく substring/意味一致でOK。漏れは大幅減点。
- actionItemClarity: 各 next_step が who/what/when を含むか。who 不明・when 未指定は減点。
- participantAttribution: speakers_involved の id が transcript 上の発言と整合するか。誤attribution は大幅減点。

# 採点指針
- 5 = 平均的な note。
- issues は anchor (例: 「[01:30] 田中の発言が誤って佐藤に attribute されている」) 付き具体的。
- wins も具体的に。
- overall = coverage 0.20 + accuracy 0.25 + hierarchy 0.10 + conciseness 0.10 + importance 0.05 + decisionCapture 0.15 + actionItemClarity 0.10 + participantAttribution 0.05 の加重平均。provenance は除外。

出力:
{
  "coverage": <0-10>, "accuracy": <0-10>, "hierarchy": <0-10>, "conciseness": <0-10>,
  "importance": <0-10>, "provenance": <0-10>,
  "decisionCapture": <0-10>, "actionItemClarity": <0-10>, "participantAttribution": <0-10>,
  "overall": <0-10>,
  "issues": ["...", "..."], "wins": ["...", "..."]
}`;

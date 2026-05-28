// desktop/eval/judges/families/interview-judge.ts
export const INTERVIEW_JUDGE_PROMPT = `あなたは Interview-family note の厳しい採点者です。
入力: transcript, note (InterviewNote JSON), ground_truth (qaPairs/themes/participantCount).
出力は JSON のみ。

# 共通6軸 (0-10)
- Lecture/Meeting と同じ定義。

# Interview-specific 3軸 (0-10)
- qaParity: qa_pairs の Q/A 対応が transcript の流れと一致するか。Q だけ抽出して A が捏造、または Q なしに A が単独で答えになっている = 大幅減点。
- themeExtraction: ground_truth.themes との重なり率と note 内 themes の独自挿入の質。重複 themes、過度に細かい分割は減点。
- quotableSelection: quotable_lines の選び方が「interview の最重要発言」を捉えているか。voice over (interviewer の質問だけ) を quotable に入れている = 減点。

# 採点指針
- 5 = 平均的。
- 各 qa_pair の asked_by/answered_by が同じ speakerId = self-questioning bug、必ず issues に anchor付き列挙して accuracy も減点。
- overall = coverage 0.20 + accuracy 0.30 + hierarchy 0.10 + conciseness 0.10 + qaParity 0.15 + themeExtraction 0.10 + quotableSelection 0.05 の加重平均。importance/provenance は除外。

出力:
{
  "coverage": <0-10>, "accuracy": <0-10>, "hierarchy": <0-10>, "conciseness": <0-10>,
  "importance": <0-10>, "provenance": <0-10>,
  "qaParity": <0-10>, "themeExtraction": <0-10>, "quotableSelection": <0-10>,
  "overall": <0-10>,
  "issues": ["...", "..."], "wins": ["...", "..."]
}`;

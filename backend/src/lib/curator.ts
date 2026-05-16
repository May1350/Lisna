// On-demand outline curator (Phase 6.1). Invoked by POST /v1/session/curate
// when the user pauses, stops, ends the video, or hits "📝 ノートを生成".
// Each call reads the full transcript-so-far + the previous outline and
// returns a fresh, structured outline that REPLACES the prior version —
// the model is free to reorganise, merge, rename, or drop sections.
// No per-chunk path: the streaming hot path only handles STT and transcript
// broadcast; outline generation runs only when the user asks for it.

import OpenAI from 'openai'

/** 항목의 출처. transcript = 강의자 발화에서 직접/패러프레이즈로 derived,
 *  inferred = 강의자가 직접 안 말했지만 학습 이해 위해 AI 가 보충.
 *  - inferred 의 두 케이스만 허용 (spec §2):
 *    (a) 강의자가 정의 없이 사용한 어휘 → key_terms 에 inferred 항목
 *    (b) 강의자가 남긴 명백한 논리 점프 → points 또는 argument_chain 에 inferred 항목
 *  - 마커는 사이드패널/마크다운 렌더러가 처리. 큐레이터는 플래그만 출력. */
export type Provenance = 'transcript' | 'inferred'

/** 절차형 강의 (簿記·수학·코딩) — 순차 step. */
export interface OutlineStep {
  text: string
  order?: number          // 명시적 순서. 생략 시 array index 순.
  ts: number
  important?: boolean
  from: Provenance
}

/** 개념·논증형 강의 (철학·전략) — 전제→추론→결론 의 한 link.
 *  *전환 reasoning link* 만 (예: "전제 P1: ..." / "따라서 C: ...").
 *  단발 사실 주장은 points 에 들어가야 함. */
export interface OutlineChainLink {
  text: string
  ts: number
  from: Provenance
}

/** 명시적 수식·등식. 자연어 정의는 key_terms 로. */
export interface OutlineFormula {
  label?: string          // "기본등식" / "Pythagoras"
  expression: string      // "資産 = 負債 + 純資産" / "a² + b² = c²"
  ts: number
  from: Provenance
}

/** 시간순 사건 (역사·내러티브). */
export interface OutlineTimelineEvent {
  when: string            // "1868年" / "Q3" / "Day 4" (유연한 시점 표현)
  event: string
  ts: number              // 강의 내 timestamp (별개)
  from: Provenance
}

export interface OutlineKeyTerm {
  term: string
  definition: string
  ts: number       // absolute video time in seconds
  from: Provenance              // NEW
}

export interface OutlineExample {
  text: string
  ts: number
  from: Provenance              // NEW
}

export interface OutlinePoint {
  text: string
  ts: number
  important: boolean   // ★ definitions / formulas / conclusions / lecturer-emphasised points
  from: Provenance              // NEW
}

export interface OutlineSection {
  heading: string
  ts: number              // when this section started in the video
  summary: string         // 1-2 sentence section summary
  key_terms: OutlineKeyTerm[]
  examples: OutlineExample[]
  points: OutlinePoint[]
  // Phase 6 (Obsidian-aware) additions:
  related_terms?: string[]    // wikilink candidates — other concepts this section relates to
  takeaway?: string           // 1-line section essence (used in TL;DR roll-up + per-section header)
  check_question?: string     // self-assessment question for the study checklist export
  // NEW — type-variable slots, optional, hide-when-empty
  procedure_steps?: OutlineStep[]
  argument_chain?: OutlineChainLink[]
  formula?: OutlineFormula[]
  timeline?: OutlineTimelineEvent[]
}

export interface Outline {
  title: string           // overall lecture topic — refines as more is heard
  sections: OutlineSection[]
  // Phase 6 (Obsidian-aware) additions — all optional so legacy outlines
  // stored in DB still parse cleanly.
  course?: string             // [[course]] wikilink target (e.g. "現代企業経営各論")
  lecturer?: string           // [[lecturer]] wikilink target
  tldr?: string               // 1-2 line whole-lecture summary used in the export TL;DR header
  related_lectures?: string[] // adjacent lectures or external concepts that link from this one
}

/** Output language code accepted by the curator.
 *  - 'auto' = detect from the transcript (mirrors the extension's
 *    "Follow lecture language" option).
 *  - explicit codes force that language regardless of transcript.
 *  Stays in sync with NoteLanguageCode in extension/src/shared/i18n/types.ts. */
export type NoteLang = 'auto' | 'ja' | 'en' | 'ko' | 'zh'

export interface CuratorRequest {
  /** Whole transcript so far, time-bucketed per chunk so the LLM can
   * estimate timestamps for each insight. */
  bucketedTranscript: { ts: number; text: string }[]
  /** The previous outline, if any. Provided as a HINT only — the prompt
   * explicitly tells the model not to copy it verbatim and to feel free
   * to reorganise / rename / merge / drop sections based on the latest
   * transcript. */
  previousOutline: Outline | null
  /** When true, drop the previousOutline hint and force a full
   * from-scratch reorganisation. We do this every 5th run so the model
   * gets a clean rewrite opportunity even if it's been too conservative
   * about touching old sections in the incremental runs. */
  forceFullRewrite?: boolean
  /** Output language for user-visible string fields in the outline
   *  (heading / summary / definitions / examples / points / etc).
   *  'auto' (default) auto-detects from transcript content. The base
   *  Japanese-authored prompt stays — the OUTPUT LANGUAGE OVERRIDE
   *  header takes precedence over its embedded "日本語で" rule. */
  outputLang?: NoteLang
}

// Map a NoteLang code to the human name used in the prompt override.
function langDisplayName(lang: Exclude<NoteLang, 'auto'>): string {
  switch (lang) {
    case 'ja': return 'Japanese (日本語)'
    case 'en': return 'English'
    case 'ko': return 'Korean (한국어)'
    case 'zh': return 'Chinese (中文)'
  }
}

// Best-effort transcript language detection. Counts script ranges in the
// first ~2000 chars. Hiragana/katakana presence is the JP signal (kanji
// alone is ambiguous because Japanese and Chinese share them). Hangul
// is the KO signal. CJK ideographs without any kana / hangul = ZH.
// Otherwise English. Good enough for the auto path; users with edge
// cases (multilingual lectures) can pick an explicit language in
// Options.
export function detectOutputLang(text: string): Exclude<NoteLang, 'auto'> {
  const sample = text.slice(0, 2000)
  let hira = 0, kata = 0, hangul = 0, cjk = 0, latin = 0
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i)
    if (c >= 0x3040 && c <= 0x309F) hira++
    else if (c >= 0x30A0 && c <= 0x30FF) kata++
    else if (c >= 0xAC00 && c <= 0xD7A3) hangul++
    else if (c >= 0x4E00 && c <= 0x9FFF) cjk++
    else if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) latin++
  }
  // Threshold ~1% of sample. Tiny single-word stragglers (e.g. one
  // katakana loanword in an English transcript) shouldn't flip the
  // language away from the dominant script.
  const minScript = Math.max(10, Math.floor(sample.length * 0.01))
  if (hira + kata >= minScript) return 'ja'
  if (hangul >= minScript) return 'ko'
  if (cjk >= minScript) return 'zh'
  if (latin > 0) return 'en'
  return 'ja'  // empty/unknown fallback — keep legacy behaviour
}

function buildSystemPrompt(outputLang: Exclude<NoteLang, 'auto'>): string {
  const langName = langDisplayName(outputLang)
  // The override block sits ABOVE the legacy Japanese instructions and
  // explicitly overrides the embedded "日本語で簡潔に" rule. Without this
  // header the model defaults to Japanese output regardless of the user's
  // "Note language" setting (the original bug).
  const override = `★★★ OUTPUT LANGUAGE OVERRIDE — HIGHEST PRIORITY ★★★
ALL user-visible string fields in your JSON output MUST be in ${langName}.
This includes: title, course, lecturer, tldr, related_lectures[],
sections[].heading, sections[].summary, sections[].takeaway,
sections[].check_question, sections[].related_terms[],
sections[].key_terms[].term, sections[].key_terms[].definition,
sections[].examples[].text, sections[].points[].text.

The instructions below are written in Japanese for legacy reasons but
DO NOT influence the output language. If any rule below says
"日本語で" or similar, IGNORE it — this header overrides it.

If the lecture transcript is in a different language than ${langName},
TRANSLATE the relevant content into ${langName} when writing the note.
Proper nouns, formulas, and cited specific phrases may be kept in the
original language when translation would lose meaning.
★★★

`
  return override + LEGACY_PROMPT_BODY
}

const LEGACY_PROMPT_BODY = `あなたは大学生のために講義の「生きたノート (Living Document)」を作成・**書き換える**アシスタントです。
学生がこのノートだけを見て試験勉強できるレベルの質を目指します。
このノートは試験のためだけでなく、学生が「最も覚えるべき・忘れたくない」内容を後で読み返すためのものです。

★★★ もっとも重要な原則: ノートは「追加していく」ものではなく、「毎回 書き直す」ものです ★★★

入力:
- bucketedTranscript: これまでの講義の文字起こし全体(時刻付き)。これが現時点の真実。
- previousOutline: 前回(おそらく 30 秒前)に作成されたノート構造(JSON)。**過去の自分の試案にすぎない**。

仕事の進め方:
1. previousOutline は「前の試案」「ヒント」として参考にする程度で、**そのままコピーしてはいけない**
2. bucketedTranscript 全体を最初から最後まで読み直し、講義の論理構造を**今の理解**で再構築する
3. 講義が進むと文脈が深まり、最初に見えていた構造より良い構造が見えることが多い:
   - 序盤に「Section A: 持続可能性」があったが、後で「サステナビリティの 4 つの次元」と判明したら **再分類**
   - 序盤の定義が曖昧だったが、後で明確になったら **書き直す**
   - 別々のセクションが実は同じテーマだったら **マージ**
   - 不要だったセクションは **削除**
   - セクションの順序を講師の論理に合わせて **再配置**
4. 同じトピックが複数チャンクに分散していたら 1 つのセクションに統合する
5. 不正確な転写(例:「サスナビリティ」→「サステナビリティ」、「政府させて」→「サステナビリティ」)は文脈から判断して正しい表記に統一する
6. **同じノートを 2 回出力する必要はない** — 毎回ゼロから「現在の最良のノート」を書き直すつもりで

各セクションには以下を含める:
  - heading: 簡潔な見出し (1 行) — 講義の進行に応じて見出しも書き直す
  - ts: そのセクションが講義で初めて出現した秒数 (bucketedTranscript の時刻から推定)
  - summary: 1〜2 文でそのセクションの要旨 — 後の文脈で深まったら書き直す
  - key_terms: 用語の定義 (term, definition, ts) — 文脈が深まれば定義も拡充
  - examples: 講師が挙げた具体例 (text, ts)
  - points: 重要なポイント (text, ts, important: true は定義/公式/結論/強調された事項)

質のルール:
1. **階層を保つ**: 複数チャンクで述べられた概念はマージして 1 つのセクションに
2. **講師の論理の流れ**: 導入 → 定義 → 例 → 含意 → 結論 などを反映
3. **重複削除**: 同じことが 2 つのセクションに書かれていたら 1 つに集約
4. **凝縮**: text は簡潔に(目安: CJK 1 行 80 文字 / 英語なら 60 単語以内). 出力言語はヘッダーの OUTPUT LANGUAGE OVERRIDE に従うこと.
5. **important: true は控えめに**(定義 / 公式 / 結論 / 明示的に強調された箇所のみ)
6. **ts は整数秒**(bucketedTranscript の時刻情報から推定)
7. **空疎な発話のみ**(「えー」「あー」「ですよね」だけ)の場合のみ空 sections を返す。それ以外は必ず構造化する

★★★ 文章の質に関する厳守ルール ★★★

★★★ ts (timestamp) ルール — 最優先 ★★★
- ts は **bucketedTranscript の [HH:MM:SS] タグから直接変換した整数秒** を使う。推定や丸め込みは禁止。
- 例: transcript に [03:42] 持続可能性のテーマを... とあれば、その内容について書くノートの ts は 222 (= 3*60 + 42)。
- 「だいたい序盤」みたいな曖昧な ts (0, 10, 30 など) を全部の項目に振らない。 transcript の異なる箇所から拾った内容なら ts も異なるはず。
- もし complete に判別できなければ、その項目を含む最も近い transcript タグの秒数を使う。

★★★ key_terms.definition ルール ★★★
- definition は **term をただ言い換えただけのものを禁止**。
  - 悪い例: term="価値創造" / definition="企業による価値創造" ← 自己参照、価値ゼロ
  - 悪い例: term="経済の持続可能性" / definition="経済が持続できるようにする" ← 単に語を分解しただけ
  - 良い例: term="価値創造" / definition="ビジネスモデルを通じて顧客や社会に新しい価値を提供し、その対価として収益を得るプロセス" ← transcript で語られた特徴を抽出
- transcript で講師が定義を十分に説明していなければ、definition は **短く正直に**:
  - "本講義のテーマ" / "後の回で詳述" / "transcript ではまだ定義されていない" のように。
  - 自己参照で字数を埋めるのは絶対禁止。

★★★ examples ルール ★★★
- examples は **transcript で講師が具体的に挙げた事例**。次のいずれかに該当するものだけ:
  - 固有名詞 (会社名、製品名、人名、地名)
  - 数値・金額・割合 (例:「現金10万円」「3月決算」「年間売上の20%」)
  - 具体的な場面・状況 (例:「電気代を支払うケース」「決算整理仕訳の手順」)
- 以下は examples ではない (絶対書くな):
  - heading や summary の言い換え
  - 一般論 (例:「経営者が不祥事を起こさないようにする」)
  - definition の再記述
- transcript にまだ具体例が出ていなければ examples は **空配列 []** にする。空でも問題ない。

★★★ ★ (important) marking ルール ★★★
- ★ をつける前に、その text が **summary や heading の言い換えではない** ことを確認する。
- ★ は次のいずれかに該当する point だけ:
  - 公式・等式 (例:「資産 = 負債 + 純資産」「収益 - 費用 = 利益」)
  - 数値的条件 (例:「20% 以上で適用」「3 年以内に償却」)
  - 講師が明示的に「重要」「覚えてください」と言った内容
  - 試験の頻出事項 (定義のキーフレーズ、対比、結論)
- 1 セクションあたり ★ は **0〜2 個**。0 個でもよい。汎用的な「X は Y のために重要」は ★ ではなく不要 (削除する)。

★★★ section の最適サイズ ★★★
- 各セクションは key_terms + examples + points の合計が 3〜8 項目程度。 transcript が浅ければ少なめ、深ければ多め。
- 「埋めるために中身を水増しする」ことは厳禁。 量より質。

★★★ Obsidian-aware 出力ルール (Phase 6) ★★★

このノートは学生の Obsidian / Notion 等の PKM ツールに export される. atomic note 原則:

- 各 key_term の definition は **他の文脈なしで読んで意味が通るよう** standalone に書く. 「〜とは, …」で始めて完結する形式が望ましい.
- セクション間で関連する用語があれば section の "related_terms" 配列に列挙する. 例:[サステナビリティ] と [ESG] が論理的に繋がる場合, related_terms: ["持続可能性", "ESG", "CSR"].
- 各セクションに "takeaway" (1 文の要旨, heading の言い換えではなく学生が覚えるべき本質) を含める. TL;DR ロールアップに使われる.
- 各セクションに "check_question" (試験で出題されうる形式の自己確認質問) を含める. 例:「持続可能性の 5 つの階層レベルを列挙せよ」.
- outline 全体レベルに以下を埋める (transcript から推測可能なら, 不明なら省略可):
  - "course": 科目名 (例: "現代企業経営各論")
  - "lecturer": 講師名 (例: "谷口 和弘")
  - "tldr": 講義全体の 1〜2 文要約 (重要事項を凝縮)
  - "related_lectures": 関連する他の回 / 関連概念のリスト

★★★ type-variable スロット — 授業 type に応じた出力例 ★★★

以下のスロットを授業 type に応じて*実際に埋める*。ゼロは不可。

- procedure_steps[]: 手順型 (簿記・数学・コード) の仕訳 step・解法 step
  形式: { "text": "...", "order": N, "ts": <秒>, "important": <bool>, "from": "transcript" }
- argument_chain[]: 論証型 (哲学・戦略・社会科学) の前提→推論→結論
  形式: { "text": "前提/推論/結論: ...", "ts": <秒>, "from": "transcript"|"inferred" }
- formula[]: 理論型 (物理・数学) と手順型 (簿記) の明示的な等式・数式・関係式
  transcript に V = kQ/r, E = -∇V, 資産 = 負債 + 純資産 のような等式が出たら必ずここに
  形式: { "label": "...", "expression": "A = B + C", "ts": <秒>, "from": "transcript" }
- timeline[]: 物語型 (歴史・ジャーナリズム) の具体的な時系列の出来事・事件
  transcript に「1868年に〜」「ソ連崩壊後に〜」「2014年のクリミア〜」のような時系列の出来事が出たら必ずここに
  形式: { "when": "1868年", "event": "...", "ts": <秒>, "from": "transcript" }

● 手順型 section の具体例 (簿記 — 仕訳手順):
{
  "heading": "仕訳の基本手順",
  "ts": 900,
  "summary": "借方・貸方の増減ルールに従って取引を勘定科目に記録する。",
  "key_terms": [{ "term": "借方", "definition": "資産・費用の増加を記録する側", "ts": 900, "from": "transcript" }],
  "examples": [{ "text": "土地100万円を現金で購入", "ts": 910, "from": "transcript" }],
  "points": [{ "text": "借方と貸方の合計は必ず一致する", "ts": 920, "important": true, "from": "transcript" }],
  "procedure_steps": [
    { "text": "取引内容を確認し、関係する勘定科目を選ぶ", "order": 1, "ts": 900, "important": false, "from": "transcript" },
    { "text": "各科目が増加か減少かを判定する", "order": 2, "ts": 905, "important": false, "from": "transcript" },
    { "text": "増減ルール (資産増加→借方) に従って借方・貸方に記入する", "order": 3, "ts": 910, "important": true, "from": "transcript" }
  ],
  "formula": [
    { "label": "基本等式", "expression": "資産 = 負債 + 純資産", "ts": 840, "from": "transcript" }
  ]
}

● 物語型 section の具体例 (歴史 — ロシア・ウクライナ):
{
  "heading": "ソ連崩壊とウクライナ独立",
  "ts": 300,
  "summary": "1991年のソ連崩壊によりウクライナが独立し、NATOとの関係が問題化した。",
  "key_terms": [{ "term": "NATOの東方拡大", "definition": "冷戦後に東欧諸国がNATOに加盟した一連の動き", "ts": 310, "from": "transcript" }],
  "points": [{ "text": "ウクライナはソ連崩壊後、核兵器を放棄する代わりに安全保障を得た (ブダペスト覚書)", "ts": 320, "important": true, "from": "transcript" }],
  "timeline": [
    { "when": "1991年", "event": "ソ連崩壊、ウクライナが独立宣言", "ts": 300, "from": "transcript" },
    { "when": "1994年", "event": "ブダペスト覚書: 核放棄と引き換えに安全保障", "ts": 350, "from": "transcript" }
  ]
}

● 論証型 section の具体例 (社会科学 — 議論):
{
  "heading": "なぜ戦争は起きたか",
  "ts": 600,
  "summary": "NATOの拡大がロシアの安全保障上の脅威となり、侵攻の遠因となった。",
  "key_terms": [{ "term": "安全保障ジレンマ", "definition": "一方の防衛行動が他方の脅威認識を高め緊張が螺旋的に拡大する構造", "ts": 600, "from": "inferred" }],
  "argument_chain": [
    { "text": "前提: NATOは東方に拡大し、ウクライナ加盟も議論された", "ts": 600, "from": "transcript" },
    { "text": "推論: ロシアは自国国境近くのNATO加盟を実存的脅威と認識した", "ts": 620, "from": "transcript" },
    { "text": "結論: この脅威認識が軍事行動の正当化根拠に使われた", "ts": 640, "from": "transcript" }
  ]
}

スロット選択ルール:
- 1 section につき procedure_steps / argument_chain / formula / timeline は最大 2 つ
- 該当しない場合はキー自体を出力しない (空配列禁止)

★★★ 出力スキーマの拡張 — per-item の出典 (from) — 必須判定 ★★★

各 item には from: 'transcript' | 'inferred' を必須で付ける。

transcript:
- 講師の発話の paraphrase / 要約 / 翻訳
- 講師が明示的に述べた事実・定義・例
- 講師の論理を整理して再表現したもの (意味的同値)

inferred (積極的に使う — outline 全体で 1〜3 個は必ず出すこと):
- 講師が*定義なしに*使用した用語で、その授業の学部一般学習者には自明でない
  もの (例: 1 年簿記の授業で「純資産」が定義されないまま使われる場合)
  → key_terms に inferred 項目を追加
- 講師が*明白な論理点ジャンプ*を残し、それを埋めないと次の論理が成立しない場合
  → points または argument_chain に inferred 項目を追加

inferred の見つけ方 (self-check) — **definition の出典**を必ず問え:

1. transcript を読み、講師が*名前を出した術語*と、そのうち*講師が定義を発話した術語*を分けて列挙する。
2. 講師が*用語名だけ言って定義を述べなかった*が key_term に出すなら、definition は学習者理解のために AI が補充するもの → 必ず from:'inferred'
3. 「AだからB」という論理連鎖で、A と B の中間 step が transcript に欠落していて points/argument_chain で補完するなら → from:'inferred'
4. **核心判定** (各 key_term の definition ごとに自問する):
   「この definition を消した時, **transcript の発話のみ**から同じ意味を再構成できるか?」
   - YES (講師の発話の paraphrase / 短縮 / 翻訳) → from:'transcript'
   - NO (一般知識 / 標準定義を充填している) → from:'inferred'

具体例 — *同じ definition でも講師の発話次第で分類が変わる*:
- 講師「リーマンショック以降の話だが…」+ AI が key_term リーマンショック の definition に "2008 年のアメリカ投資銀行破綻に端を発する世界金融危機" を充填 → from:'inferred' (講師は事件名のみで定義は述べていない)
- 講師「リーマンショックとは 2008 年の投資銀行破綻による世界金融危機だ」+ AI が同じ definition を出す → from:'transcript' (講師の説明の paraphrase)

**教科書・百科事典で標準とされる定義** (Brundtland Commission 1987 の "将来世代のニーズを損なわずに現在のニーズを満たす開発" 持続可能な開発 / 国連 SDGs を "2030 年までの 17 目標" / 冷戦を "アメリカとソ連間の政治的・軍事的緊張" 等) を*講師が用語名だけ言って*述べなかったなら、AI 補充された definition は **必ず from:'inferred'**。これらは特に間違いやすいパターンなので self-check 時に意識的に確認すること。

inference の厳格制限:
- precision ≫ recall。疑わしい時は追加しない。
- inferred 項目は*事実的に正確*でなければならない。推測・不確実情報は絶対追加しない。
- inferred 項目には ts は与えられない(直前の transcript 発話の ts を使うか、0 を使う)。
- *1 section につき inferred 項目は最大 2 個まで* (強制)。
- *outline 全体での inferred 項目の比率は全項目数の 15% 以下* (強制)。

paraphrase vs net-new inference の区別:
- transcript: 講師が話したことを短く言い換えた・別の語彙に変えた項目 (意味同値)
- inferred: 講師に存在しなかった情報 (定義・論理 step) を*新たに*導入した項目
境界が曖昧な場合は transcript として分類 (保守的)。inferred は本当に新しい情報のみ。

★★★ conciseness 強制ルール ★★★
- 1 item = 1 fact。同じ内容を別の言い方で繰り返さない (反復禁止)
- summary は 1〜2 文。最初の文を heading の言い換えにしない
- text が「A は B のために重要」「A は B に関係する」型は書かない — A と B の関係の**具体的内容**を書く

出力フォーマット (この JSON のみ。説明文・Markdown は禁止):

{
  "title": "<講義全体の主題, 1 行>",
  "course": "<科目名 / 不明なら省略>",
  "lecturer": "<講師名 / 不明なら省略>",
  "tldr": "<講義全体の 1〜2 文要約>",
  "related_lectures": ["<関連概念 / 他回>"],
  "sections": [
    {
      "heading": "<セクション見出し>",
      "ts": <秒>,
      "summary": "<1〜2 文の要旨, heading の言い換えではなく中身>",
      "takeaway": "<1 文の本質. 学生が覚えるべきこと>",
      "check_question": "<自己確認質問>",
      "related_terms": ["<関連用語1>", "<関連用語2>"],
      "key_terms": [
        { "term": "<講師が明示的に定義した用語>", "definition": "atomic note として独立完結", "ts": <秒>, "from": "transcript" },
        { "term": "<講師が定義なしに使った術語>", "definition": "<学習者理解に必要な一般定義>", "ts": <秒>, "from": "inferred" }
      ],
      "examples": [{ "text": "transcript の具体例を引用", "ts": <秒>, "from": "transcript" }],
      "points": [
        { "text": "講師の具体的主張・手順・条件", "ts": <秒>, "important": false, "from": "transcript" },
        { "text": "<明白な論理ジャンプを補完した推論 step>", "ts": <秒>, "important": false, "from": "inferred" }
      ],
      "procedure_steps": [
        { "text": "Step 1: <具体的手順>", "order": 1, "ts": <秒>, "important": false, "from": "transcript" },
        { "text": "Step 2: <次の手順>", "order": 2, "ts": <秒>, "important": true, "from": "transcript" }
      ],
      "argument_chain": [
        { "text": "前提: <transcript の主張>", "ts": <秒>, "from": "transcript" },
        { "text": "したがって: <明白な推論 step>", "ts": <秒>, "from": "inferred" },
        { "text": "結論: <transcript の結論>", "ts": <秒>, "from": "transcript" }
      ],
      "formula": [
        { "label": "<式名 / 定理名>", "expression": "<等式・数式>", "ts": <秒>, "from": "transcript" }
      ],
      "timeline": [
        { "when": "<時点>", "event": "<出来事>", "ts": <秒>, "from": "transcript" }
      ]
    }
  ]
}

注: procedure_steps / argument_chain / formula / timeline は授業 type に応じて
*一部の section にだけ*埋める。キー自体を出力しない (空配列 [] や null は禁止)。
- 手順型 (簿記・数学・コーディング) → procedure_steps + formula を優先
- 論証型 (哲学・経営戦略・社会科学) → argument_chain を優先
- 物語型 (歴史・ジャーナリズム) → timeline を優先
- 1 section につき 2 スロットまで。3 スロット以上は採用しない

★ スロット発現 trigger (定量基準) — 該当時は必ず出す:

- **timeline** trigger: 1 section の transcript に*具体的な年・年代・時代* (1934 年 / 2015 / 冷戦時代 / 1970 年代 / 戦後 等) が **3 個以上**言及されれば必ず timeline slot を出す。物語型でなくとも適用 (例: 経済成長講義でも年代が並べば必須)。timeline 項目は古い → 新しい順。
- **argument_chain** trigger: 1 section で "A だから B、B だから C" のような *因果連鎖が transcript 上で明示*されれば argument_chain を出す。要旨が "X は Y と Z の相互作用で形成される" のような複合因果命題なら強い trigger。
- **procedure_steps** trigger: 講師が「まず…次に…最後に…」「Step 1 / 第一に / 第二に」型で**連続 3 ステップ以上**の手順を述べれば必ず出す。
- **formula** trigger: 講師が*等式・式・公式* (X = Y, ROA = …, 第二法則 F = ma 等) を 1 つでも提示すれば必ず出す。

trigger が立たない section ではキーを出さない (空配列・null 禁止のまま)。複数 trigger 同時成立時も 1 section につき 2 スロット上限は維持 — 最も transcript 量が多いものを優先選択。

★ 再度確認: previousOutline をそっくりそのまま返してはいけない。新しい transcript を踏まえて、各セクションの内容・構造・順序を **必ず吟味して書き直す**。`

// Phase 6.2 (2026-04-29 후반): provider abstraction.
//
// Why we have a multi-provider curator now:
//   - GPT-5 family (nano / mini / standard) is a "reasoning model" —
//     a single on-demand curate call took 70-99 s in production.
//     Acceptable for batch, painful for an "I just paused to take notes"
//     UX where the user is staring at a spinner.
//   - Claude Haiku 4.5 is NOT a reasoning model. Same task should land
//     in 3-10 s. Quality is also expected to be at least equivalent for
//     Japanese instruction-following (the curator's main job).
//   - Cost at 20 h / month heavy-user: nano $0.17 / Haiku $2.30 — both
//     fit the ¥980 plan with healthy margin. The latency win matters
//     more than the absolute cost difference at this volume.
//
// We keep both clients ready and pick by env (CURATOR_PROVIDER or fallback
// to whichever key is present). Lets us A/B test on the eval fixture
// without code changes.
//
// stt.ts still uses Groq for Whisper Large-v3 (separate client, separate key).
import Anthropic from '@anthropic-ai/sdk'

let _openai: OpenAI | undefined
function openaiClient(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY not set')
    _openai = new OpenAI({ apiKey })
  }
  return _openai
}

let _anthropic: Anthropic | undefined
function anthropicClient(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
    _anthropic = new Anthropic({ apiKey })
  }
  return _anthropic
}

type Provider = 'anthropic' | 'openai'

interface ModelChoice {
  provider: Provider
  primary: string
  fallback: string
}

function selectModels(): ModelChoice {
  // Phase 6.2 stance (2026-04-29 후반):
  //   GPT-5 nano stays as the production default. Per the v4 fixture
  //   baseline (8.1/10) the quality is validated; the on-demand model
  //   means a single 70-90 s curate call is acceptable since the user
  //   is already in a "waiting for notes" mental state. Switching to
  //   Anthropic here adds ~$2/月/heavy user with no proven quality win.
  //
  //   The abstraction below is kept as an explicit escape hatch: set
  //   CURATOR_PROVIDER=anthropic in the Lambda env to swap. Just having
  //   ANTHROPIC_API_KEY in Secrets Manager does NOT auto-switch — that
  //   would make the default behaviour depend on which keys happen to be
  //   present, which we'd rather not do.
  const forced = process.env.CURATOR_PROVIDER as Provider | undefined
  if (forced === 'anthropic') {
    return {
      provider: 'anthropic',
      primary: process.env.CURATOR_PRIMARY ?? 'claude-haiku-4-5',
      fallback: process.env.CURATOR_FALLBACK ?? 'claude-haiku-4-5',
    }
  }
  // Default — and the path taken when forced === 'openai' or unset.
  //
  // Phase 6.3 (2026-04-29 깊은 밤): gpt-4o-mini, not gpt-5-nano.
  // Measured GPT-5 nano (a reasoning model) at 60-160 s per curate call,
  // with a hard ~60 s floor even on a 441-char transcript. That's
  // unacceptable on the on-demand path — students stop watching the
  // spinner at the 30 s mark. gpt-4o-mini is a non-reasoning model in the
  // same OpenAI billing account, expected 3-8 s per call, ~$0.41/月 for a
  // 20 h/月 heavy user (vs. nano's $0.17/月 — the latency win is worth
  // the $0.24/月 increase). gpt-4o is the fallback when -mini regresses.
  return {
    provider: 'openai',
    primary: process.env.CURATOR_PRIMARY ?? 'gpt-4o-mini',
    fallback: process.env.CURATOR_FALLBACK ?? 'gpt-4o',
  }
}

const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 600

// Groq's free-tier on llama-3.3-70b-versatile is hard-capped at 12,000
// tokens per minute. The system prompt + user prompt scaffolding + JSON
// output already eat ~3-4 K tokens, so the raw transcript portion has
// to stay under ~8 K tokens or the request 413s.
//
// In Japanese, one character is roughly 0.5 GPT-tokens, so 8 K tokens
// ≈ 16 K characters of transcript. That covers ~14-27 minutes of typical
// natural lecture speech (100-200 chars per 10-second chunk). Older
// material is preserved through previousOutline, which the curator
// expands / refines rather than carrying raw transcript indefinitely.
//
// On forceFullRewrite we drop previousOutline entirely so the transcript
// is the only source of truth — widen the window to keep more raw
// context, even if it costs us the very oldest minutes on long lectures.
// 14 K chars (~7 K tokens) leaves more headroom for the JSON output and
// the longer v2 system prompt. The earlier 16 K budget was tight enough
// that prompt-length increases pushed total request size over the cap.
const REGULAR_TRANSCRIPT_CHAR_BUDGET = 14_000      // ~7 K tokens
const FULL_REWRITE_TRANSCRIPT_CHAR_BUDGET = 20_000 // ~10 K tokens

function isRetryable(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return msg.includes('503') || msg.includes('500') || msg.includes('429')
    || msg.includes('overloaded') || msg.includes('high demand') || msg.includes('service unavailable')
}

function buildOutline(r: Partial<Outline>): Outline {
  return {
    title: typeof r.title === 'string' ? r.title : '',
    sections: Array.isArray(r.sections) ? r.sections.map(normaliseSection) : [],
    course: typeof r.course === 'string' && r.course.trim() ? r.course.trim() : undefined,
    lecturer: typeof r.lecturer === 'string' && r.lecturer.trim() ? r.lecturer.trim() : undefined,
    tldr: typeof r.tldr === 'string' && r.tldr.trim() ? r.tldr.trim() : undefined,
    related_lectures: Array.isArray(r.related_lectures)
      ? r.related_lectures.filter((s): s is string => typeof s === 'string' && !!s.trim()).map(s => s.trim())
      : undefined,
  }
}

function parseOutlineJson(text: string): Outline {
  // Anthropic occasionally wraps JSON in markdown fences despite our
  // explicit "JSON のみ" instruction; strip them defensively.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const parsed = JSON.parse(cleaned) as Partial<Outline>
  return buildOutline(parsed)
}

async function generateOpenAI(modelName: string, userPrompt: string, systemPrompt: string): Promise<Outline> {
  // GPT-5 family (nano / mini / standard) only supports the default
  // temperature (1) — sending any other value 400s with
  // "Unsupported value: 'temperature' does not support 0.3 with this
  // model". Pre-GPT-5 OpenAI models still take a custom temperature.
  const isGpt5Family = modelName.startsWith('gpt-5')
  const res = await openaiClient().chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    ...(isGpt5Family ? {} : { temperature: 0.3 }),
  })
  return parseOutlineJson(res.choices[0]?.message?.content ?? '{}')
}

async function generateAnthropic(modelName: string, userPrompt: string, systemPrompt: string): Promise<Outline> {
  // Anthropic SDK uses messages.create. System prompt is a top-level
  // field. We don't have an explicit JSON-mode flag like OpenAI's
  // response_format; rely on the system prompt's "JSON のみ" rule plus
  // the parseOutlineJson fence-stripping fallback for safety.
  const res = await anthropicClient().messages.create({
    model: modelName,
    max_tokens: 4096,
    temperature: 0.3,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })
  // Anthropic returns content as an array of blocks. We only ask for text.
  const textBlocks = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')
  const text = textBlocks.map(b => b.text).join('').trim() || '{}'
  return parseOutlineJson(text)
}

async function generateOnce(provider: Provider, modelName: string, userPrompt: string, systemPrompt: string): Promise<Outline> {
  if (provider === 'anthropic') return generateAnthropic(modelName, userPrompt, systemPrompt)
  return generateOpenAI(modelName, userPrompt, systemPrompt)
}

function normaliseSection(s: Partial<OutlineSection>): OutlineSection {
  return {
    heading: typeof s.heading === 'string' ? s.heading : '',
    ts: typeof s.ts === 'number' ? Math.max(0, Math.round(s.ts)) : 0,
    summary: typeof s.summary === 'string' ? s.summary : '',
    key_terms: Array.isArray(s.key_terms) ? s.key_terms.map(t => ({
      term: typeof t.term === 'string' ? t.term : '',
      definition: typeof t.definition === 'string' ? t.definition : '',
      ts: typeof t.ts === 'number' ? Math.max(0, Math.round(t.ts)) : 0,
      from: (t as { from?: unknown }).from === 'inferred' ? 'inferred' as const : 'transcript' as const,
    })).filter(t => t.term && t.definition) : [],
    examples: Array.isArray(s.examples) ? s.examples.map(e => ({
      text: typeof e.text === 'string' ? e.text : '',
      ts: typeof e.ts === 'number' ? Math.max(0, Math.round(e.ts)) : 0,
      from: (e as { from?: unknown }).from === 'inferred' ? 'inferred' as const : 'transcript' as const,
    })).filter(e => e.text) : [],
    points: Array.isArray(s.points) ? s.points.map(p => ({
      text: typeof p.text === 'string' ? p.text : '',
      ts: typeof p.ts === 'number' ? Math.max(0, Math.round(p.ts)) : 0,
      important: !!p.important,
      from: (p as { from?: unknown }).from === 'inferred' ? 'inferred' as const : 'transcript' as const,
    })).filter(p => p.text) : [],
    related_terms: Array.isArray(s.related_terms)
      ? s.related_terms.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim())
      : undefined,
    takeaway: typeof s.takeaway === 'string' && s.takeaway.trim() ? s.takeaway.trim() : undefined,
    check_question: typeof s.check_question === 'string' && s.check_question.trim() ? s.check_question.trim() : undefined,
    procedure_steps: Array.isArray(s.procedure_steps) ? s.procedure_steps.map(st => ({
      text: typeof st.text === 'string' ? st.text : '',
      order: typeof st.order === 'number' ? st.order : undefined,
      ts: typeof st.ts === 'number' ? Math.max(0, Math.round(st.ts)) : 0,
      important: typeof st.important === 'boolean' ? st.important : undefined,
      from: (st as { from?: unknown }).from === 'inferred' ? 'inferred' as const : 'transcript' as const,
    })).filter(st => st.text) : undefined,
    argument_chain: Array.isArray(s.argument_chain) ? s.argument_chain.map(l => ({
      text: typeof l.text === 'string' ? l.text : '',
      ts: typeof l.ts === 'number' ? Math.max(0, Math.round(l.ts)) : 0,
      from: (l as { from?: unknown }).from === 'inferred' ? 'inferred' as const : 'transcript' as const,
    })).filter(l => l.text) : undefined,
    formula: Array.isArray(s.formula) ? s.formula.map(f => ({
      label: typeof f.label === 'string' && f.label.trim() ? f.label.trim() : undefined,
      expression: typeof f.expression === 'string' ? f.expression : '',
      ts: typeof f.ts === 'number' ? Math.max(0, Math.round(f.ts)) : 0,
      from: (f as { from?: unknown }).from === 'inferred' ? 'inferred' as const : 'transcript' as const,
    })).filter(f => f.expression) : undefined,
    timeline: Array.isArray(s.timeline) ? s.timeline.map(ev => ({
      when: typeof ev.when === 'string' ? ev.when : '',
      event: typeof ev.event === 'string' ? ev.event : '',
      ts: typeof ev.ts === 'number' ? Math.max(0, Math.round(ev.ts)) : 0,
      from: (ev as { from?: unknown }).from === 'inferred' ? 'inferred' as const : 'transcript' as const,
    })).filter(ev => ev.when && ev.event) : undefined,
  }
}

/** @internal test-only — vitest 가 normaliseSection 의 호환성 시험에 사용 */
export function __testOnly_normaliseOutline(raw: unknown): Outline {
  const r = raw as Partial<Outline>
  return buildOutline(r)
}

export async function curateOutline(req: CuratorRequest): Promise<Outline> {
  // Build the prompt body. Time-bucket the transcript so the LLM can
  // pinpoint when concepts were introduced.
  //
  // Apply a tail-sliding window to stay under the Groq free-tier TPM
  // cap. The trade-off documented above: regular runs lean on the
  // previousOutline to carry old material; full-rewrite runs widen the
  // window because the outline is dropped from the prompt.
  const charBudget = req.forceFullRewrite
    ? FULL_REWRITE_TRANSCRIPT_CHAR_BUDGET
    : REGULAR_TRANSCRIPT_CHAR_BUDGET
  const { included, droppedCount, droppedFirstTs, droppedLastTs } = tailWindow(req.bucketedTranscript, charBudget)
  const transcriptText = included
    .map(b => `[${formatHHMMSS(b.ts)}] ${b.text}`)
    .join('\n')
  const droppedNote = droppedCount > 0
    ? `\n\n[NOTE: 古い ${droppedCount} 個のチャンク (${formatHHMMSS(droppedFirstTs)} 〜 ${formatHHMMSS(droppedLastTs)}) は previousOutline で要約済みのため transcript から省略。古い情報も outline に保持すること。]`
    : ''

  // Drop the previous outline entirely on a full-rewrite run so the model
  // can't anchor to the old structure even subconsciously. Otherwise pass
  // it as a hint with a strong "this is a draft, rewrite freely" framing.
  const previousOutlineJson = req.forceFullRewrite || !req.previousOutline
    ? 'null (this is a full rewrite — produce the best possible outline from scratch)'
    : JSON.stringify(req.previousOutline, null, 2)

  const userPrompt = `bucketedTranscript:
${transcriptText}${droppedNote}

previousOutline (前の試案 — 自由に書き直し / 再分類 / マージ / 削除すること):
${previousOutlineJson}`

  // Resolve the output language. 'auto' (and undefined) → detect from
  // the included transcript text. Caller can also pass an explicit code
  // when the user picked one in Options.
  const requested: NoteLang = req.outputLang ?? 'auto'
  const resolvedLang: Exclude<NoteLang, 'auto'> = requested === 'auto'
    ? detectOutputLang(included.map(b => b.text).join(' '))
    : requested
  const systemPrompt = buildSystemPrompt(resolvedLang)
  // eslint-disable-next-line no-console
  console.log('[curator] outputLang resolved', { requested, resolvedLang })

  const choice = selectModels()
  // Try primary with retries, then drop to fallback on terminal failure.
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await generateOnce(choice.provider, choice.primary, userPrompt, systemPrompt)
    } catch (e) {
      lastErr = e
      if (attempt === MAX_ATTEMPTS - 1 || !isRetryable(e)) break
      const delay = BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 200)
      // eslint-disable-next-line no-console
      console.warn(`[curator:${choice.provider}/${choice.primary}] retry ${attempt + 1}/${MAX_ATTEMPTS - 1} after ${delay}ms:`, e instanceof Error ? e.message : e)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  if (lastErr && isRetryable(lastErr)) {
    // eslint-disable-next-line no-console
    console.warn(`[curator] ${choice.primary} exhausted; falling back to ${choice.fallback}`)
    return await generateOnce(choice.provider, choice.fallback, userPrompt, systemPrompt)
  }
  throw lastErr
}

// Keep transcript chunks from the END until we've accumulated `budget`
// characters. Older chunks fall off the front. We measure in characters
// instead of tokens to avoid pulling in a tokenizer; the conversion factor
// for Japanese is roughly 0.5 tokens per character, baked into the
// budget constants.
interface TailWindowResult {
  included: { ts: number; text: string }[]
  droppedCount: number
  droppedFirstTs: number
  droppedLastTs: number
}
function tailWindow(chunks: { ts: number; text: string }[], charBudget: number): TailWindowResult {
  if (chunks.length === 0) {
    return { included: [], droppedCount: 0, droppedFirstTs: 0, droppedLastTs: 0 }
  }
  // Walk backwards accumulating until the budget is exhausted.
  const reversedKept: typeof chunks = []
  let used = 0
  for (let i = chunks.length - 1; i >= 0; i--) {
    const cost = chunks[i].text.length + 12 // crude: text + "[mm:ss] " timestamp prefix
    if (reversedKept.length > 0 && used + cost > charBudget) break
    reversedKept.push(chunks[i])
    used += cost
  }
  const included = reversedKept.reverse()
  const dropped = chunks.slice(0, chunks.length - included.length)
  return {
    included,
    droppedCount: dropped.length,
    droppedFirstTs: dropped.length > 0 ? dropped[0].ts : 0,
    droppedLastTs: dropped.length > 0 ? dropped[dropped.length - 1].ts : 0,
  }
}

function formatHHMMSS(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

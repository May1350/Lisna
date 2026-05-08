// On-demand outline curator. Invoked by /v1/session/curate when the user
// pauses the lecture, the video ends, or they hit the manual "ノートを
// 生成" button. Reads the FULL transcript-so-far + the current outline
// and re-generates a structured, hierarchical study outline.
//
// History: Phase 4 ran this as a "rolling" curator firing every ~30 s
// during playback (~120 calls/h on a 1-h lecture). Phase 6.1 (2026-04-29)
// pivoted to on-demand because (a) the user almost never wants the
// outline mid-playback — they want it when they STOP to review, and
// (b) on-demand cuts curator calls from ~120/h to 1-3/h, slashing LLM
// cost by ~95%, while improving quality because the model sees the
// complete transcript instead of a 16 K-char tail window.
//
// Output is the full curated tree (sections → key_terms / examples /
// points / takeaway / check_question / related_terms), REPLACING the
// previous tree wholesale. The previousOutline param lets the model
// stay consistent with prior structure when the user re-curates after
// adding more transcript.

import OpenAI from 'openai'

export interface OutlineKeyTerm {
  term: string
  definition: string
  ts: number       // absolute video time in seconds
}

export interface OutlineExample {
  text: string
  ts: number
}

export interface OutlinePoint {
  text: string
  ts: number
  important: boolean   // ★ definitions / formulas / conclusions / lecturer-emphasised points
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

export type CuratorLanguage = 'auto' | 'ja' | 'en' | 'ko' | 'zh'

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
  /** Output language for the generated outline (Phase i18n).
   *   - 'auto'  → match the transcript's source language (LLM detects)
   *   - 'ja' / 'en' / 'ko' / 'zh' → force the output to that language
   *
   * Key terms / proper nouns / numbers stay in their original form;
   * only the prose (definitions, summaries, points, etc.) is translated.
   * Defaults to 'auto' when the request omits it. */
  targetLanguage?: CuratorLanguage
}

const SYSTEM_PROMPT = `あなたは大学生のために講義の「生きたノート (Living Document)」を作成・**書き換える**アシスタントです。
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
4. **凝縮**: text は日本語で簡潔に(1 行 80 文字以内)
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
      "key_terms": [{ "term": "...", "definition": "atomic note として独立完結", "ts": <秒> }],
      "examples": [{ "text": "transcript の具体例を引用", "ts": <秒> }],
      "points": [{ "text": "講師の具体的主張・手順・条件", "ts": <秒>, "important": <bool> }]
    }
  ]
}

★ 再度確認: previousOutline をそっくりそのまま返してはいけない。新しい transcript を踏まえて、各セクションの内容・構造・順序を **必ず吟味して書き直す**。`

// Per-language output instruction. Appended to the base SYSTEM_PROMPT
// so the model knows what language to write the prose in. Key terms,
// proper nouns, numbers, formulas stay in source form (a Japanese
// lecture's "持続可能性" stays as 持続可能性 even in a Korean output —
// for both vocabulary preservation AND so Obsidian wikilinks stay
// consistent across notes; explained below).
function languageInstruction(target: CuratorLanguage | undefined): string {
  switch (target) {
    case 'auto':
    case undefined:
    case null as unknown as undefined:
      return ''
    case 'ja':
      return `\n\n★★★ 出力言語: 日本語 ★★★\nすべての prose (heading / summary / takeaway / definition / point.text / example.text / check_question) を日本語で書く。`
    case 'en':
      return `\n\n★★★ OUTPUT LANGUAGE: ENGLISH ★★★\n
Write ALL prose fields (heading / summary / takeaway / definition / point.text / example.text / check_question / tldr / related_lectures / related_terms) in clear, concise English suitable for university students.

Critical preservation rules:
1. Key terms (key_terms[i].term) — KEEP IN THE ORIGINAL LANGUAGE OF THE LECTURE. If the lecture is Japanese and the term is "持続可能性", keep "持続可能性" as the term. The English translation goes inline in the definition: \`definition: "Sustainability — the capacity to maintain ... 持続可能性"\`. This preserves Obsidian wikilink consistency across a student's notes.
2. Proper nouns / company names / cited works — keep verbatim.
3. Quoted phrases from the transcript — keep in the original language inside quotation marks, then explain in English.
4. Numbers, dates, formulas — preserve exactly as spoken.

The course / lecturer fields should also stay in the original language so they match across notes and wikilink correctly.`
    case 'ko':
      return `\n\n★★★ 출력 언어: 한국어 ★★★\n
모든 prose 필드 (heading / summary / takeaway / definition / point.text / example.text / check_question / tldr / related_lectures / related_terms) 를 한국어로 작성한다. 자연스러운 한국어 학술/강의 노트 톤. 존댓말은 사용하지 말고 명사형/평서문 위주의 학습노트 스타일.

★ 보존 규칙 (중요):
1. **key_term.term 은 강의의 원어 그대로 유지.** 강의가 일본어이고 용어가 「持続可能性」이면 term 도 「持続可能性」그대로. 한국어 번역은 definition 안에 inline 으로 병기: \`definition: "지속가능성 — 환경/사회/경제의 균형을 유지하며..."\`. Obsidian wikilink 일관성과 원어 어휘 학습을 위한 의도적 결정.
2. 고유명사 / 기업명 / 인용 — 그대로 유지.
3. transcript 인용구는 원어 그대로 따옴표로, 옆에 한국어 설명.
4. 숫자, 날짜, 공식 — 강의 그대로.

course / lecturer 필드는 원어 유지 (강의 wikilink 일관성).`
    case 'zh':
      return `\n\n★★★ 输出语言: 简体中文 ★★★\n
所有 prose 字段 (heading / summary / takeaway / definition / point.text / example.text / check_question / tldr / related_lectures / related_terms) 用简体中文撰写。学术笔记风格,简洁清晰。避免繁体字。

★ 保留规则 (重要):
1. **key_term.term 保留讲座的原始语言。** 如果讲座是日语,术语 "持続可能性" 保持原样;中文翻译写在 definition 里: \`definition: "可持续性 — 在环境、社会、经济三方面保持平衡..."\`。这是为了保持 Obsidian wikilink 在多个笔记之间的一致性,也方便学生学习原始术语。
2. 专有名词 / 公司名 / 引用 — 原样保留。
3. transcript 引用语保留原语言加引号,旁边附中文解释。
4. 数字、日期、公式 — 严格按讲座原文。

course / lecturer 字段保留原语言 (wikilink 一致性)。`
  }
}

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

// Curator-emitted course / lecturer placeholders that should be treated
// as "not extracted" rather than as real entity names. The prompt says
// "不明なら省略" but LLMs frequently emit a placeholder anyway. Without
// this scrub these placeholders end up as wikilink targets in Obsidian
// (`[[不明]]`) and pollute the graph with a fake hub aggregating every
// lecture where extraction failed.
const PLACEHOLDER_VALUES = new Set([
  '不明', 'unknown', 'n/a', 'na', '-', '—', 'なし', '未定', 'unspecified',
])
function scrubPlaceholder(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined
  const trimmed = s.trim()
  if (!trimmed) return undefined
  if (PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) return undefined
  return trimmed
}

function parseOutlineJson(text: string): Outline {
  // Anthropic occasionally wraps JSON in markdown fences despite our
  // explicit "JSON のみ" instruction; strip them defensively.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const parsed = JSON.parse(cleaned) as Partial<Outline>
  return {
    title: typeof parsed.title === 'string' ? parsed.title : '',
    sections: Array.isArray(parsed.sections) ? parsed.sections.map(normaliseSection) : [],
    course: scrubPlaceholder(parsed.course),
    lecturer: scrubPlaceholder(parsed.lecturer),
    tldr: typeof parsed.tldr === 'string' && parsed.tldr.trim() ? parsed.tldr.trim() : undefined,
    related_lectures: Array.isArray(parsed.related_lectures)
      ? parsed.related_lectures.filter((s): s is string => typeof s === 'string' && !!s.trim()).map(s => s.trim())
      : undefined,
  }
}

async function generateOpenAI(modelName: string, systemPrompt: string, userPrompt: string): Promise<Outline> {
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

async function generateAnthropic(modelName: string, systemPrompt: string, userPrompt: string): Promise<Outline> {
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

async function generateOnce(provider: Provider, modelName: string, systemPrompt: string, userPrompt: string): Promise<Outline> {
  if (provider === 'anthropic') return generateAnthropic(modelName, systemPrompt, userPrompt)
  return generateOpenAI(modelName, systemPrompt, userPrompt)
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
    })).filter(t => t.term && t.definition) : [],
    examples: Array.isArray(s.examples) ? s.examples.map(e => ({
      text: typeof e.text === 'string' ? e.text : '',
      ts: typeof e.ts === 'number' ? Math.max(0, Math.round(e.ts)) : 0,
    })).filter(e => e.text) : [],
    points: Array.isArray(s.points) ? s.points.map(p => ({
      text: typeof p.text === 'string' ? p.text : '',
      ts: typeof p.ts === 'number' ? Math.max(0, Math.round(p.ts)) : 0,
      important: !!p.important,
    })).filter(p => p.text) : [],
    related_terms: Array.isArray(s.related_terms)
      ? s.related_terms.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim())
      : undefined,
    takeaway: typeof s.takeaway === 'string' && s.takeaway.trim() ? s.takeaway.trim() : undefined,
    check_question: typeof s.check_question === 'string' && s.check_question.trim() ? s.check_question.trim() : undefined,
  }
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

  // Compose the per-call system prompt: base prompt (in Japanese, the
  // canonical authoring language) + a target-language postscript when
  // the user has chosen a non-auto note language. The postscript
  // explicitly preserves key_term.term in the lecture's source language
  // for Obsidian wikilink consistency across notes.
  const fullSystemPrompt = SYSTEM_PROMPT + languageInstruction(req.targetLanguage)

  const choice = selectModels()
  // Try primary with retries, then drop to fallback on terminal failure.
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await generateOnce(choice.provider, choice.primary, fullSystemPrompt, userPrompt)
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
    return await generateOnce(choice.provider, choice.fallback, fullSystemPrompt, userPrompt)
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

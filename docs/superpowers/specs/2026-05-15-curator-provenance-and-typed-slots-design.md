# Curator: Provenance Marking + Type-Variable Slot Schema

> **작성일**: 2026-05-15
> **상태**: design 단계 (브레인스토밍 완료 / spec 검토 대기 → implementation plan 작성 예정)
> **참조**:
> - `2026-04-26-online-learning-summary-extension-design.md` §11 (Obsidian-aware pivot, Phase 6 schema)
> - `backend/src/lib/curator.ts` (현재 Outline 스키마 + 프롬프트)
> - `backend/scripts/eval-curator.ts` + `backend/scripts/lib/judge.ts` (회귀 측정 하네스)
> - `backend/src/lib/markdown-obsidian.ts` (export 컨벤션)
> - `extension/src/side-panel/components/OutlineView.tsx` (사이드패널 렌더러)
> - 베이스라인: `backend/tests/fixtures/baselines/2026-05-15-current.json` (overall 8.2 / accuracy 9.0 / conciseness 7.0)
> - mockups: `.claude/mockups/note-marker-locked.html` (확정 마커 스타일)

---

## 0. Executive Summary

현재 curator 가 만드는 노트는 학생 입장에서 "용어의 개념 정리 위주" 라는 인상을 줌. 원인은 Phase 6 Obsidian-aware pivot 때 schema 가 **atomic note (key_terms 중심)** 로 최적화되었기 때문이며, 강의자의 논리 흐름·절차·논증·시간순 같은 *non-glossary* 차원이 표현되는 슬롯이 schema 에 없음. eval 베이스라인이 v4-gpt5nano / v5-gpt4omini / 현재 모두 8.1~8.2 plateau 인 것도 같은 원인 (프롬프트 수정으로 안 깨지는 천장).

이 spec 은 두 가지 직교 변경을 묶어 다룬다:

1. **Provenance marking** — 강의자 derived 인지 AI inferred 인지 항목 단위로 명시. AI 보충은 **점선 + ink-500 + ※** 으로 시각 분리하되 "AI" 단어는 쓰지 않음. 인라인 배치 (별도 블록 아님).
2. **Type-variable slot schema** — section 안에 옵셔널 슬롯 (`procedure_steps`, `argument_chain`, `formula`, `timeline`) 을 추가. 강의 type 별로 자연스러운 슬롯만 채워지고 나머지는 비어 hide. **명시적 type discriminator 없음** — 슬롯의 채워짐/비어있음으로 emerge.

두 변경 모두 backwards-compatible (모든 새 필드 optional, legacy outline JSON 그대로 파싱됨).

### 비-목표 (out of scope, 이 spec 안에선 안 함)

- 강의 type 분류기 (`section.type: 'procedural' | …`) — 명시 discriminator 까지 가면 union schema + backwards compat 깨짐. 옵셔널 슬롯 emergence 로 충분
- 사용자 자연어 override (Path 1) — 별도 UX 작업. 추가 기능. spec 진입 후 review 단계에서 필요해지면 v2
- AI inferred content 의 사용자 수동 편집 / 승인 UX — 학습자가 inferred 를 transcript 로 promote 하거나 삭제하는 기능. v2 후보
- Rolling-mode 새 베이스라인 캡처 — single-shot 베이스라인이 prompt regression 측정에 충분. rolling 은 production-fidelity 가 필요한 단계 (anchoring 이슈 의심 시) 에서

---

## 1. Motivation

### 1.1 Founder qualitative signal (1차 근거)

founder 가 직접 본인 노트를 살짝 사용한 결과: "정리가 단어의 개념정리 위주라고 느꼈었어." 이건 eval 점수보다 우선하는 신호다.

### 1.2 구조적 원인 분석

현재 OutlineSection 의 슬롯 구성:
- `key_terms[]` — 글로서리 (Obsidian wikilink 친화)
- `points[]` — 보조 bullet
- `examples[]` — 예
- `summary` / `takeaway` — 섹션 추상
- `check_question?` — 학습 체크
- `related_terms?` — wikilink 후보

이 구성은 **개념 그래프** 표현엔 최적이지만, 다음 차원을 *전혀* 표현 못함:
- 절차 (簿記 仕訳·수학 풀이·코딩 step)
- 논증 chain (전제 → 추론 → 결론)
- 공식 / 등식 (자산=부채+純자산)
- 시간순 사건 (역사·내러티브)

큐레이터 프롬프트 line 181-182 가 "講師の論理の流れ: 導入 → 定義 → 例 → 含意 → 結論 などを反映" 라고 지시하지만 *그걸 담을 슬롯이 없음* → LLM 이 어쩔 수 없이 모든 정보를 key_terms / points 에 압축 → 글로서리 처럼 보임.

### 1.3 Eval plateau 와의 일치

| 베이스라인 | overall | conciseness | importance |
|---|---|---|---|
| v4-gpt5nano | 8.1 | 7 | 8 |
| v5-gpt4omini | 8.1 | 7 | 8 |
| 2026-05-15-current | 8.2 | 7 | 8 |

3 버전에 걸쳐 점수 거의 변화 없음 = "프롬프트 미세조정으로는 더 못 올라감" 의 정량 신호. 천장의 원인이 구조에 있을 가능성이 큼.

### 1.4 신뢰 원칙 (founder 직접 입력)

브레인스토밍에서 확립된 3원칙:
1. **Coverage** — 강의의 주요 포인트 놓치지 않기
2. **Accuracy** — 허위 정보 작성 금지 (엄격)
3. **Provenance** — 강의에 없는 정보를 AI 가 보충했을 때 학생이 *한 눈에* 알 수 있어야 함

원칙 2 + 3 결합 해석: **AI 는 elaborate 할 수 있되 transparent.** 거짓을 transcript 인 척 쓰면 안 됨 (2). 학습에 필요한 보충은 가능하지만 마킹 필수 (3).

---

## 2. Inference 범위 정책 — B-보수

AI 가 추가 (inferred) 할 수 있는 항목의 범위는 다음 두 케이스로 한정.

| 케이스 | 트리거 | 출력 형태 |
|---|---|---|
| **Missing definition** | 강의자가 어떤 어휘를 *정의 없이* 사용했고, 그 어휘가 **해당 강의의 학부 수준 일반 학습자에게 자명하지 않을 때** (예: 1학년 簿記 수업의 "純資産" — 강의가 정의 안 했고 일반 1학년이 모르는 어휘) | `key_terms[]` 에 새 항목 (from: 'inferred') |
| **Logic bridge** | 강의자가 "그래서 … 가 되어" 류의 명백한 논리 점프를 남겼고, 그 점프를 채우지 않으면 다음 논리로 이어지지 않을 때 | `points[]` 또는 `argument_chain[]` 에 새 항목 (from: 'inferred') |

룰:
- **Precision ≫ Recall** — 의심 갈 때는 추가하지 말 것
- AI 가 추가한 항목은 **사실적으로 정확** 해야 함 — 추측·가능성·잘 모르는 영역은 절대 추가 금지
- AI 가 추가한 항목엔 `ts` (강의 내 timestamp) 없음 — UI / markdown 모두 `—` 또는 omit
- 한 섹션당 inferred 항목 **최대 2개 (강제)** — 큐레이터 프롬프트에서 명시. 강의자 본문이 압도되면 마커 fatigue → 시각 신호 무효화
- **노트 전체 inferred 항목 비율 ≤ 15%** (전 항목 수 기준) — 큐레이터 프롬프트에 명시. 전 섹션이 inferred 로 도배되면 visual noise floor → "한 눈에 구별" 원칙 무효

---

## 3. 스키마 변경

### 3.1 Per-item provenance flag

기존 per-item type 에 `from` 필드 추가:

```ts
type Provenance = 'transcript' | 'inferred'

interface OutlineKeyTerm {
  term: string
  definition: string
  ts: number              // 'inferred' 항목은 0 또는 직전 transcript ts
  from: Provenance        // NEW. default 'transcript' for backward compat
}

interface OutlinePoint {
  text: string
  ts: number
  important: boolean
  from: Provenance        // NEW
}

interface OutlineExample {
  text: string
  ts: number
  from: Provenance        // NEW
}
```

레거시 JSON 에 `from` 없으면 파싱 시 `'transcript'` 로 디폴트. 기존 노트는 마커가 절대 안 보임 (전부 transcript).

**구현 주의 — `normaliseSection` 명시 수정 필요** (`backend/src/lib/curator.ts:442+`): 현재 normaliseSection 은 key_terms / examples / points 의 `from` 필드를 *세팅하지 않음*. 새 코드에서 각 item 매핑부에 `from: typeof X.from === 'string' && X.from === 'inferred' ? 'inferred' : 'transcript'` 가드를 명시적으로 추가해야 backward-compat 가 보장됨. 렌더러도 `item.from === 'inferred'` 가드를 쓰고 `undefined` 를 'transcript' 처럼 취급.

### 3.2 새 옵셔널 슬롯 — type-variable

`OutlineSection` 에 다음 슬롯 추가. 모두 optional. 강의 type 에 따라 채워지는 슬롯이 emerge.

```ts
interface OutlineStep {
  text: string
  order?: number          // 명시적 순서 (없으면 array index)
  ts: number
  important?: boolean     // 핵심 step (terra dot 강조)
  from: Provenance
}

interface OutlineChainLink {
  text: string            // "전제 P1: …" / "따라서 C: …" 같은 한 줄
  ts: number
  from: Provenance
}

interface OutlineFormula {
  label?: string          // "기본등식" / "Pythagoras" 등
  expression: string      // "資産 = 負債 + 純資産" / "a² + b² = c²"
  ts: number
  from: Provenance
}

interface OutlineTimelineEvent {
  when: string            // "1868年" / "Q3" / "Day 4" — 유연한 시점 표현
  event: string
  ts: number              // 강의 내 timestamp (별개)
  from: Provenance
}

interface OutlineSection {
  // ... 기존 필드 그대로 ...
  procedure_steps?: OutlineStep[]
  argument_chain?: OutlineChainLink[]
  formula?: OutlineFormula[]
  timeline?: OutlineTimelineEvent[]
}
```

### 3.3 강의 type 별 expected slot pattern (가이드, 강제 아님)

큐레이터가 emerge 결정을 잘 하도록 프롬프트에 명시할 패턴 (실제 schema 강제 아님):

| 강의 type | 주로 채워지는 슬롯 | 비어있어도 OK |
|---|---|---|
| **Conceptual** (철학·전략·이론) | key_terms · argument_chain · points | procedure_steps · timeline |
| **Procedural** (簿記·수학·코딩) | procedure_steps · formula · key_terms(보조) | argument_chain · timeline |
| **Narrative** (역사·문학) | timeline · key_terms(인물·사건) · points | procedure_steps · formula |
| **Empirical** (생물·화학·물리) | argument_chain (claim-evidence) · formula · key_terms | procedure_steps · timeline |

이 매핑은 *프롬프트 안에 표 형태로 넣음*. 큐레이터가 강의 transcript 를 보고 "이 강의는 어느 type 인가" 를 implicit 으로 판단하고 거기에 맞는 슬롯에 무게.

---

## 4. Curator 프롬프트 변경

`backend/src/lib/curator.ts` 의 SYSTEM_PROMPT 에 세 룰 추가. 기존 룰과 충돌하면 새 룰 우선.

**언어 주의**: curator SYSTEM_PROMPT 는 일본어 (LEGACY_PROMPT_BODY 라인 148+). 아래 4.1-4.3 의 룰은 implementation 시 일본어로 번역해서 삽입. 룰의 의미만 spec 에 한국어로 기록.

### 4.1 Slot emergence 룰

```
강의 type 에 맞는 슬롯만 사용. 모든 슬롯을 무리하게 채우지 말 것.
- procedural 강의 (절차 가르침): procedure_steps + formula 채움, argument_chain / timeline omit
- conceptual 강의 (개념·논증): argument_chain 채움, procedure_steps omit
- narrative 강의 (시간순 사건): timeline 채움
- empirical 강의 (실험·증거): argument_chain + formula
구분이 모호하면 가장 가까운 type 의 슬롯만 채우고 나머지 omit. 빈 슬롯 (예: [] 또는 null) 보다 *omit* 이 명확하므로 키 자체를 안 넣음.

상한 (강제):
- 한 섹션당 새 슬롯 4가지 (procedure_steps / argument_chain / formula / timeline) 중 **최대 2개만 채움**. 3개 이상 채우면 type 분류가 불명확하다는 신호 — 가장 핵심 2개 선택.
- argument_chain 은 *논증 흐름의 transitional reasoning link* (전제→추론→결론) 만. 단발 사실 주장은 points 에 들어가야 함.
- procedure_steps 는 *순차 절차* 만. 단발 절차 한 줄은 points 로.
- formula 는 명시적인 등식·수식. 자연어 정의 (예: "資産は所有する価値のあるもの") 는 key_terms 에.
- 한 항목이 여러 슬롯에 적합해 보이면 다음 precedence 적용: formula > procedure_steps > argument_chain > timeline > points > key_terms. 즉 procedure 안에서 자연스럽게 나온 등식은 formula 에만, points 중복 금지.
```

### 4.2 Inference 룰 (B-보수)

```
transcript 에 명시되지 않은 항목은 다음 두 케이스만 추가:
(a) 강의자가 정의 없이 사용한 어휘로, 그 정의를 모르면 강의 이해가 막힐 때
(b) 강의자가 명백한 논리 점프를 남겨, 그 점프를 채우지 않으면 다음 논리로 이어지지 않을 때

다음 항목엔 from: 'inferred' 를 명시:
- (a) 의 추가 정의는 key_terms 에 from: 'inferred'
- (b) 의 채움은 points 또는 argument_chain 에 from: 'inferred'

다른 모든 항목 (transcript 발화의 paraphrase / 요약 포함) 은 from: 'transcript'.

규칙:
- precision 우선: 의심 갈 때는 추가하지 말 것
- 사실 정확: 추측·불확실 정보는 절대 추가 금지
- 섹션당 inferred 항목 최대 2개 권장
- inferred 항목의 ts 는 0 또는 직전 transcript 발화의 ts 값
```

### 4.3 Paraphrase vs net-new inference 구분

```
- transcript: 강의자 발화를 더 짧게 다듬거나 다른 표현으로 바꾼 항목 (의미 동치)
- inferred: 강의에 없던 정보 (정의·논리 step) 를 net-새로 도입한 항목
경계 모호 시 transcript 로 분류 (보수적). inferred 는 진짜 새로운 정보만.
```

### 4.4 프롬프트 길이 / latency / 출력 토큰 risk

추가 룰 3개 + 슬롯 type 가이드 표 = 프롬프트 ~30% 증가 추정. 출력은 새 슬롯 array + 모든 item 의 `from` 필드로 ~30-50% 증가 추정. latency 영향:

- 현재 single-shot 64.5s @ gpt-4o-mini
- 출력 inflation + reasoning 부담 → 추정 70-90s (불확실)
- on-demand 경로라 사용자가 "기다림" mental state 이고 Function URL 로 30s API GW 타임아웃 우회 (`VITE_CURATE_URL`) → 이론적 상한은 Lambda 자체의 15분이므로 안전

**Implementation gate (concern 3 대응)**: 큐레이터 프롬프트 첫 draft 완성 직후, 본격 iteration 전에 **single-shot dry run 1회** 실행해서 실측. 결과 → 다음 조치:

| 실측 latency | 조치 |
|---|---|
| ≤ 80s | 그대로 진행 |
| 80-100s | 프롬프트 압축 1회 시도 (슬롯 type 가이드 표를 외부 reference 로 빼서 prompt 길이 ↓), 재측정 |
| > 100s | 슬롯 수 축소 검토 (4 → 2-3) 또는 모델 변경 (claude-haiku-4-5) 평가 |

출력 토큰 cap: gpt-4o-mini OpenAI default 는 16K 정도 (현재 명시적 `max_tokens` 안 걸려있음, anthropic 분기에만 4096 있음). 새 스키마로도 16K 안에 충분히 fit 예상이지만 dry run 에서 확인.

---

## 5. 렌더러 변경 (OutlineView.tsx)

### 5.1 Locked marker style — `.inferred` 클래스

`backend/.claude/mockups/note-marker-locked.html` 의 디자인 그대로:

```css
.inferred.kt-item {
  border: 1px dashed var(--terra-soft);    /* paper-200 background 유지 */
}
.inferred.kt-item .kt-term::before {
  content: '※ ';
  color: var(--terra-700);
  font-size: 12.5px;
}
.inferred.kt-item .kt-term { color: var(--ink-700); }
.inferred.kt-item .kt-def  { color: var(--ink-500); }

.inferred.point .bullet-mark {        /* bullet-imp 자리에 ※ 글리프 */
  color: var(--terra-700);
}
.inferred.point .text-imp { color: var(--ink-500); }
.inferred.point .lisna-hl {
  background: linear-gradient(180deg, transparent 60%, var(--paper-300) 60%);
  border-bottom: 1px dashed var(--terra-soft);
}
```

세 신호 redundancy (테두리 + 색 + 글리프) 로 한 신호 놓쳐도 다른 게 잡음.

### 5.2 새 슬롯 컴포넌트

각각 작은 sub-component:

- `<StepList steps={section.procedure_steps} />` — ordered list, terra dot 으로 important step 강조 (현재 points 패턴 재사용)
- `<ChainList links={section.argument_chain} />` — points 와 비슷한 list 지만 prefix "→" 또는 번호로 흐름 표현
- `<FormulaList formulas={section.formula} />` — paper-200 카드 + `<code>` 모노스페이스 expression
- `<TimelineList events={section.timeline} />` — `when` 을 좌측 컬럼, `event` 를 우측 컬럼으로 2-col

각 컴포넌트는 `.inferred` 클래스를 item 단위로 받아 같은 마커 스타일 적용.

### 5.3 Hide-when-empty

이미 OutlineView 가 examples / check_question 에서 쓰는 패턴:
```tsx
{!compact && section.procedure_steps && section.procedure_steps.length > 0 && (
  <StepList steps={section.procedure_steps} onJump={onJump} />
)}
```

새 슬롯 모두 동일하게.

### 5.4 Compact mode

기존 compact mode 룰: important 만 보이고 부수 슬롯은 숨김. 새 슬롯들의 compact 룰:

| 슬롯 | compact 시 |
|---|---|
| procedure_steps | important step 만 표시 (points 와 동일 규칙) |
| argument_chain | 전체 유지 (논증은 chain 이 끊기면 의미 상실) |
| formula | 전체 유지 (시험 직전 cram 뷰에서도 공식은 필수) |
| timeline | 전체 유지 (시간 순서는 sub-set 으로 끊기면 부적합) |

### 5.5 Inferred 표시는 compact 에서도 유지

inferred 항목은 compact 든 full 이든 항상 마커 보임. 학생이 어떤 뷰에서 보든 출처 구분이 명확해야 함.

### 5.6 Compact mode + 마커 상호작용 (명시)

compact 에서 important-only 슬롯이 inferred 위주로 채워진 섹션은 점선 박스만 보일 가능성 — 가능하지만 의도된 동작. 즉 "이 섹션의 시험 직전 essence 가 대부분 AI 보충" 이라는 신호 자체가 학습자에게 가치 있는 정보 (강의자가 명확히 안 다룬 영역임을 알림). 추가 처리 없음.

---

## 6. Markdown export 변경 (markdown-obsidian.ts)

### 6.1 Inferred item 표현 — Obsidian callout

코드베이스는 이미 `> [!info]` / `> [!summary]` / `> [!定義]` callout 컨벤션 사용 중. inferred 도 같은 패턴으로 자연스럽게 확장:

```markdown
> [!note] ※ 純資産
> 自己資本とも呼ばれ、企業の正味の財産価値。資産から負債を差し引いた残額。

> [!note] ※ 簿記の基本等式
> 資産 = 負債 + 純資産。三者は常に均衡する会計恒等式。
```

callout type `[!note]` 은 Obsidian native (default 회색·중립 색조). 비-Obsidian 마크다운 뷰어에선 `> ※ 純資産\n> 自己資本…` 인용블록으로 graceful fallback.

### 6.2 HeadingSet 확장

언어별 callout 헤더 추가:

```ts
interface HeadingSet {
  // ... 기존 필드 ...
  inferred_callout: string  // NEW
}
// ja: '補足', en: 'Note', ko: '보충', zh: '补充'
```

### 6.3 새 슬롯 마크다운 출력

각 새 슬롯의 마크다운 출력:
- `procedure_steps`: 번호 매긴 ordered list (`1. … 2. …`)
- `argument_chain`: `→` prefix 가 붙은 줄들
- `formula`: 코드 블록 (` ```math `) — Obsidian MathJax 호환
- `timeline`: 표 (`| when | event |`)

각 슬롯의 inferred item 은 callout 으로 감싸거나 inline 마커 (※) 추가. 일관성 위해 callout 우선.

### 6.4 Frontmatter 영향

YAML frontmatter 에 `ai_inferred_count: <number>` 추가 검토 — 학생이 Dataview 쿼리로 "AI 보충 많은 노트" 필터링 가능. **이 spec 안에선 안 함**, v2 후보.

---

## 7. Eval 변경 (judge.ts)

### 7.1 새 축 — overall 가중치 *유지*, provenance 는 별도 gate

기존 5 축 + 새 axis 1개 추가:

```ts
interface JudgeAxisScores {
  coverage: number          // 기존
  accuracy: number          // 기존 (inferred 항목도 사실 정확해야 함을 평가에 포함)
  hierarchy: number         // 기존
  conciseness: number       // 기존
  importance: number        // 기존
  provenance: number        // NEW — 0-10. inferred 항목이 정말 필요한 케이스에만 추가됐고, 사실적으로 옳으며, 마킹이 올바른가
}
```

**`overall` 가중치 변경 안 함** (concern 4 대응). 현재 judge.ts:67 의 가중치 (coverage 0.25 / accuracy 0.30 / hierarchy 0.20 / conciseness 0.15 / importance 0.10) 그대로 유지. provenance 는 overall 에 *포함되지 않음* — 별도 gate 축으로 사용.

이유: weight 재분배는 legacy 베이스라인 (`v4-gpt5nano`, `v5-gpt4omini`, `2026-05-15-current`) 의 overall 점수를 비교 불가능하게 만듦. "8.2 → 8.5+" 성공 기준이 새 가중치 하에선 의미가 없어짐. provenance 를 별도 측정함으로써 legacy overall 비교성 보존.

새 성공 기준: **overall (기존 5축 합산) ≥ 8.5 AND provenance ≥ 7.5**.

### 7.2 Judge 프롬프트 보강

```
provenance (0-10) 평가:
- inferred 항목이 transcript 의 명백한 gap (정의 없이 사용된 어휘 / 논리 점프) 에 응답한 케이스인가? 그 외 추가는 감점.
- inferred 항목의 사실 정확성. 추측·불확실 정보가 추가됐으면 큰 감점.
- 섹션당 inferred 가 2개 초과면 잔잔한 감점.
- 모든 inferred 항목이 from: 'inferred' 플래그 보유. 누락 시 감점.
- (slot fit) 강의 type 과 채워진 슬롯이 일관됨. procedural 강의에 procedure_steps 가 비어있고 argument_chain 만 채워지면 감점.
```

### 7.3 Fixture 다양화 — 프롬프트 iteration 의 prerequisite

현재 fixture = `yt-JGXIB.json` (簿記 = mixed conceptual/procedural). **추가 fixture 필요 타입:**
- procedural-pure (수학 풀이·코딩 튜토리얼)
- narrative (역사 강의)

메모리: **eval-set 소유자 = founder (option A, 2026-05-12 결정)**.

**fixture 가 본격 prompt iteration 의 prerequisite 임 (blocker 2 대응)**. 이유: 단일 fixture 위에서 프롬프트 미세조정 = 그 fixture 한정 overfitting. §3.3 의 "강의 type emerge" 라는 핵심 가설은 *복수 type fixture* 에서만 검증 가능. 簿記 하나로 procedure_steps 가 채워졌다 = procedure_steps 가 *어떤 강의에서나* 잘 채워진다 의 증거 아님.

implementation plan 안에서 다음과 같이 게이팅:
1. 첫 prompt draft (B-보수 + 슬롯 emergence) 작성 + 1 fixture 측정 = **landing 가능** (베이스라인 회귀 없음 확인용)
2. 그 뒤 본격 prompt iteration (점수 올리는 작업) 은 **fixture 2-3개 추가 후에만**
3. fixture 추가 = founder 액션 (1 procedural + 1 narrative). 1주일 내 procure 목표. 안 채워지면 v2 로 defer.

### 7.4 새 베이스라인

implementation 직전: `2026-05-15-current` (현재 schema 의 single-shot 점수) 보존. 이게 reference.

implementation 직후: `2026-05-XX-post-typed-slots` 캡처. delta 측정. 회귀 (overall 하락) 면 prompt iteration.

---

## 8. 마이그레이션 / 호환성

### 8.1 Backward compat 매트릭스

| 시점 | 노트 | 새 코드 동작 |
|---|---|---|
| 기존 outline (DB / 디스크 마크다운) | 새 슬롯 없음, `from` 없음 | 새 슬롯 → undefined → renderer hide. `from` → 디폴트 'transcript' → 마커 안 보임. legacy 노트 = 시각상 변화 없음 |
| 새 outline (이 spec 후) | 새 슬롯 있을 수도 있음, `from` 명시 | 정상 동작 |
| 새 노트의 markdown export | 새 슬롯 출력 + inferred callout | 정상 |
| 기존 노트의 markdown export (재-export) | 새 슬롯 없음, 모든 항목 transcript 취급 | 기존 export 와 동일 (변화 없음) |

### 8.2 DB 스키마 — 30분 spike (plan 작성 전)

Outline JSON 은 `notes` 테이블에 `outline_json: jsonb` 컬럼 한 곳에 저장됨 *가정*. 새 필드 추가는 jsonb 라 마이그레이션 불요.

**Plan 작성 *전* 30분짜리 spike 로 확정**: `backend/src/lib/db.ts` + 관련 마이그레이션 파일 확인. 만약 컬럼 단위 분해 / 정규화된 형태 라면 ALTER 필요 → migration script + downtime 검토. 결과를 plan 의 가정으로 못 박음.

### 8.3 익스텐션 버전 범프

새 마커 스타일 + 새 슬롯 렌더링 = 사용자 가시 변경 → CWS 재배포 필요. 버전 0.1.49 → 0.1.50 (artifact-version-bump 룰).

---

## 9. Spec 안에서 결정할 sub-decisions

다음 항목은 spec implementation 시점에 확정 (코드 보고 결정 가능):

| 항목 | 후보 | 결정 시점 |
|---|---|---|
| 4 개 새 슬롯 (procedure_steps / argument_chain / formula / timeline) — 더 추가? | `counter_example` (반례) · `definition_inline` (인용 정의) 등 | 일단 4 개로 시작. 첫 eval 회차 이후 부족하면 추가 |
| Markdown export 의 inferred 표현 | (B) 이탤릭 + ※ 텍스트 / (C) Obsidian callout `> [!note]` | C 권장 — 코드베이스 패턴 일치. B fallback 은 Obsidian 외 viewer 에서 자동 |
| ※ multilingual | JA/KO/ZH = ※, EN = ※ 또는 `*` 또는 `[ed.]` | ※ 통일 — 만국 통용 + 단일 컴포넌트 단순함 |
| 새 eval 축 — `provenance` 단일 vs `inference_quality` + `slot_fit` 분리 | 단일 / 분리 | 단일 (provenance) 로 시작. 5축→6축이면 가중치 재분배 명확. 추가 분해 필요 시 v2 |

---

## 10. Implementation 우선순위 (blocker 1 대응 — 의존성 순서 정정)

기존 spec 초안의 "eval 먼저 → 스키마 → 프롬프트" 는 의존성 모순 (eval 의 새 provenance 축은 스키마의 `from` 필드를 전제로 함). 정정:

| 순서 | 영역 | 의존성 / 이유 |
|---|---|---|
| **0** | DB 스키마 spike (§8.2) | plan 작성의 입력 — jsonb 면 우회, 컬럼이면 migration 필요 |
| **1** | 스키마 type 정의 + `normaliseSection` 가드 (curator.ts) | 모든 후속 단계의 type 의존. `from` 디폴트 'transcript' 명시 |
| **2** | Curator 프롬프트 변경 (§4) | 스키마 type 준비 후 새 슬롯 출력 가능 |
| **3** | **Latency dry run** (§4.4 gate) — 첫 single-shot 실측 | iteration 들어가기 전 budget 확인 |
| **4** | 베이스라인 재캡처 (`2026-05-XX-post-prompt`, 기존 5축 judge) | 회귀 측정 ground truth |
| **5** | Judge 변경 — provenance 축 추가 (judge.ts) | 스키마 + 첫 베이스라인 후. 가중치 *변경 없음* (§7.1) |
| **6** | **(founder) fixture 다양화 — 1 procedural + 1 narrative** | 본격 prompt iteration 의 prerequisite (§7.3). 채우지 못하면 iteration 보류 |
| **7** | 본격 prompt iteration (provenance + 슬롯 emergence 점수 끌어올림) | 6 완료 후 |
| **8** | 렌더러 (OutlineView + `.inferred` + 새 컴포넌트) | 사용자 가시 변경 |
| **9** | Markdown export (callout + 새 슬롯 직렬화) | 외부 출력 일관성 |
| **10** | 익스텐션 버전 범프 (0.1.50) + CWS 재제출 | 8 안정화 후 |

각 단계는 별도 commit / 가능하면 별도 PR. 6번이 *프롬프트 iteration 게이트* 라는 점이 핵심 — 단일 fixture 위에서 점수 올리려 하면 그 fixture 한정 overfit 위험.

---

## 11. Open questions / risks

implementation plan 작성 직전 마지막 확인:

1. **DB 스키마 spike** (§8.2) — plan 작성 전 30분 spike 결과로 jsonb 여부 확정. 컬럼 분해이면 plan 에 migration step 추가.
2. **fixture procurement timing** — founder 가 1주일 안에 procedural + narrative fixture 1개씩 procure 가능한가? 안 되면 §10 step 7 (본격 iteration) 은 그만큼 defer.
3. **Latency dry run 결과** (§4.4 gate) — 첫 측정 후 결정. 100s 초과 시 슬롯 수 축소 / 모델 변경 검토.
4. **AI inferred 항목의 ts** 가 0 이면 OutlineView 의 TsButton 이 어떻게 렌더할지 — 이미 mockup 에 `ts-chip.none` 처리 있음. OutlineView 코드 (TsButton 컴포넌트) 의 `ts === 0` 분기 확인 필요.
5. **Slot emergence 가 mechanical fill 로 회귀하는 경우** (concern 1) — 첫 fixture 셋 위에서 모든 슬롯이 mechanically 채워지면 §4.1 강화 또는 schema validator 단에서 reject. monitoring 메트릭: 섹션당 평균 채워진 슬롯-패밀리 수가 2 초과면 alert.

---

## 12. Success criteria

(§7.1 weight unchanged 정책에 맞춰 overall 비교 가능성 보존)

- [ ] **eval overall ≥ 8.5** (기존 5축 가중치 그대로, plateau 돌파 정량 지표)
- [ ] **provenance ≥ 7.5** (별도 gate 축)
- [ ] **fixture 2-3개 (다양 type) 위에서 위 조건 충족** — 단일 fixture 위 점수만으로는 불충분 (overfit 방지)
- [ ] 각 fixture 의 슬롯 emergence 가 type-적합: procedural fixture → procedure_steps 채워짐 / narrative fixture → timeline 채워짐 등
- [ ] 평균 채워진 슬롯-패밀리 수 ≤ 2 / 섹션 (mechanical fill 회귀 방지)
- [ ] inferred 항목 전체 비율 ≤ 15%
- [ ] founder qualitative 재테스트: "용어 정리 위주" 인상 사라짐
- [ ] backward compat: 기존 노트 시각상 변화 0
- [ ] Markdown export 시 inferred 항목이 Obsidian callout 으로 정상 출력
- [ ] CWS 0.1.50 승인

---

## 13. 참고: 결정 history (이 spec 으로 흘러온 경로)

1. CWS 0.1.49 승인 (2026-05-15) 후 note quality 작업 시작
2. 베이스라인 캡처 (overall 8.2) — 3 버전 plateau 확인
3. founder qualitative input: "단어 정리 위주"
4. 구조적 원인 분석: schema 가 conceptual-편향
5. 두 경로 (Path 1 자연어 override / Path 2 보편 framework) 검토 → Path 3 (faithful surfacing) 추가
6. 3원칙 입력 (coverage / accuracy / provenance)
7. 인라인 (i) + AI 단어 거부 → 점선 + ink-500 + ※ 마커 확정 (mockup 검증)
8. 스키마 변경 폭 (a)-(d) 검토 → (c) 옵셔널 type-가변 슬롯 채택
9. 전체 구조 재검토 → 이 spec 작성
10. **2026-05-15 비판적 reviewer agent 가 spec 강도 시험 → 3 blocker / 4 concern / 4 nice-to-have 발견 → 모두 spec 본문에 통합** (§3.1 normaliseSection 명시 / §4.1 슬롯 cap + precedence / §4.4 latency dry-run gate / §7.1 weight 미변경 정책 / §7.3 fixture iteration 게이트 / §8.2 DB spike / §10 의존성 순서 정정 / §12 새 success criteria)

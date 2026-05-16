# Curator Provenance + Type-Variable Slots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 큐레이터가 항목별 출처 (`from: 'transcript' | 'inferred'`) 를 명시하고, 강의 type 에 따라 procedure_steps / argument_chain / formula / timeline 슬롯이 emerge 하도록 schema·prompt·renderer·export·eval 을 일괄 업데이트. 사이드패널에서 inferred 항목은 점선 + 회색 + ※ 마커로 자동 분리됨.

**Architecture:** 
- 백엔드 (`backend/src/lib/curator.ts`): 타입 정의 확장 + normaliseSection 가드 + JA SYSTEM_PROMPT 에 slot emergence + inference 룰 추가. 출력 모델 = OpenAI gpt-4o-mini 유지
- 사이드패널 (`extension/src/side-panel/components/OutlineView.tsx`): `.inferred` 클래스 + 4 종 새 슬롯용 sub-component, hide-when-empty 패턴 확장
- Markdown export (`backend/src/lib/markdown-obsidian.ts`): inferred 항목을 Obsidian callout `> [!note]` 로 직렬화 + 새 슬롯별 출력 형식
- Eval (`backend/scripts/lib/judge.ts`): 6번째 axis `provenance` 추가, **overall 가중치는 변경 없음** (legacy 베이스라인 호환)
- DB schema 변경 없음 — `sessions.outline` 은 이미 JSONB

**Tech Stack:** TypeScript (backend Lambda + extension Vite/React), OpenAI gpt-4o-mini (curator), Groq llama-3.3-70b (judge), pnpm workspace, vitest

**Spec:** `docs/superpowers/specs/2026-05-15-curator-provenance-and-typed-slots-design.md`

---

## File Structure

| 파일 | 책임 | 작업 종류 |
|---|---|---|
| `backend/src/lib/curator.ts` | 타입 정의 + normaliseSection 가드 + JA 프롬프트 | Modify |
| `backend/scripts/lib/judge.ts` | provenance axis + JA 평가 룰 | Modify |
| `backend/scripts/eval-curator.ts` | 새 axis 출력에 포함 | Modify |
| `backend/src/lib/markdown-obsidian.ts` | 새 슬롯 직렬화 + inferred callout | Modify |
| `backend/tests/markdown-obsidian.test.ts` | 새 출력 검증 | Modify |
| `backend/tests/curator-normalise.test.ts` | normaliseSection 가드 단위 테스트 | **Create** |
| `extension/src/side-panel/components/OutlineView.tsx` | `.inferred` 가드 + 새 슬롯 렌더링 wire-in | Modify |
| `extension/src/side-panel/components/StepList.tsx` | procedure_steps 렌더링 | **Create** |
| `extension/src/side-panel/components/ChainList.tsx` | argument_chain 렌더링 | **Create** |
| `extension/src/side-panel/components/FormulaList.tsx` | formula 렌더링 | **Create** |
| `extension/src/side-panel/components/TimelineList.tsx` | timeline 렌더링 | **Create** |
| `extension/src/side-panel/index.css` | `.inferred` 스타일 + 새 슬롯 스타일 | Modify |
| `extension/src/shared/i18n/locales/*.ts` (4 locales) | `inferred_callout` 등 라벨 추가 | Modify |
| `extension/manifest.config.ts` | 버전 0.1.49 → 0.1.50 | Modify |
| `backend/tests/fixtures/transcripts/*.json` | procedural + narrative fixture | **Create** (founder action) |

---

## Phase A — Schema 확장 + 호환성 가드 (Task 1-4)

이 phase 완료 후: 모든 후속 단계의 타입 의존성 해소. 베이스라인 회귀 없음 (프롬프트 변경 전 / 새 슬롯 출력 전).

### Task 1: Provenance 타입 + per-item `from` 필드

**Files:**
- Modify: `backend/src/lib/curator.ts:14-43` (기존 인터페이스 블록)

- [ ] **Step 1: 인터페이스 위에 Provenance 타입 alias 추가**

`backend/src/lib/curator.ts` 의 `OutlineKeyTerm` 인터페이스 *바로 위* (line ~13) 에 추가:

```ts
/** 항목의 출처. transcript = 강의자 발화에서 직접/패러프레이즈로 derived,
 *  inferred = 강의자가 직접 안 말했지만 학습 이해 위해 AI 가 보충.
 *  - inferred 의 두 케이스만 허용 (spec §2):
 *    (a) 강의자가 정의 없이 사용한 어휘 → key_terms 에 inferred 항목
 *    (b) 강의자가 남긴 명백한 논리 점프 → points 또는 argument_chain 에 inferred 항목
 *  - 마커는 사이드패널/마크다운 렌더러가 처리. 큐레이터는 플래그만 출력. */
export type Provenance = 'transcript' | 'inferred'
```

- [ ] **Step 2: 기존 인터페이스 3개에 `from` 필드 추가**

`OutlineKeyTerm`, `OutlineExample`, `OutlinePoint` 각각 마지막 필드 뒤에 추가:

```ts
export interface OutlineKeyTerm {
  term: string
  definition: string
  ts: number
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
  important: boolean
  from: Provenance              // NEW
}
```

- [ ] **Step 3: 타입 컴파일 확인**

```bash
pnpm --filter backend exec tsc --noEmit
```
Expected: PASS (이 시점에 타입 에러 다수 — 다음 task 에서 fix)

curator.ts 안에서 OutlineKeyTerm/Example/Point 를 *생성* 하는 위치가 normaliseSection 한 곳이라 거기서 from 누락으로 컴파일 에러 발생함. 의도된 상태.

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/curator.ts
git commit -m "feat(curator): add Provenance type + per-item from field on OutlineKeyTerm/Example/Point"
```

---

### Task 2: 새 옵셔널 슬롯 4종 타입 정의

**Files:**
- Modify: `backend/src/lib/curator.ts:14-43` (인터페이스 블록 + OutlineSection)

- [ ] **Step 1: 4종 새 인터페이스 추가 (Provenance 타입 정의 바로 아래)**

```ts
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
```

- [ ] **Step 2: OutlineSection 에 옵셔널 슬롯 4개 추가**

`OutlineSection` 인터페이스 (line ~37+) 의 `check_question?` 다음에 추가:

```ts
export interface OutlineSection {
  heading: string
  ts: number
  summary: string
  key_terms: OutlineKeyTerm[]
  examples: OutlineExample[]
  points: OutlinePoint[]
  related_terms?: string[]
  takeaway?: string
  check_question?: string
  // NEW — type-variable slots, optional, hide-when-empty
  procedure_steps?: OutlineStep[]
  argument_chain?: OutlineChainLink[]
  formula?: OutlineFormula[]
  timeline?: OutlineTimelineEvent[]
}
```

- [ ] **Step 3: 타입 컴파일 확인**

```bash
pnpm --filter backend exec tsc --noEmit
```
Expected: Task 1 과 같은 에러 (normaliseSection 미수정). 다음 task 가 해소.

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/curator.ts
git commit -m "feat(curator): add OutlineStep/ChainLink/Formula/TimelineEvent + OutlineSection optional slots"
```

---

### Task 3: normaliseSection 에 `from` 디폴트 + 새 슬롯 정규화

**Files:**
- Modify: `backend/src/lib/curator.ts:442-468` (normaliseSection 함수)

- [ ] **Step 1: 기존 key_terms / examples / points 매핑에 `from` 가드 추가**

`normaliseSection` 안 (line ~447) 의 key_terms 매핑부:

```ts
key_terms: Array.isArray(s.key_terms) ? s.key_terms.map(t => ({
  term: typeof t.term === 'string' ? t.term : '',
  definition: typeof t.definition === 'string' ? t.definition : '',
  ts: typeof t.ts === 'number' ? Math.max(0, Math.round(t.ts)) : 0,
  from: (t as { from?: unknown }).from === 'inferred' ? 'inferred' as const : 'transcript' as const,
})).filter(t => t.term && t.definition) : [],
```

같은 패턴을 examples / points 매핑에도 적용:

```ts
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
```

- [ ] **Step 2: 새 슬롯 4종 정규화 추가 (check_question 매핑 직후)**

`normaliseSection` 반환 객체의 `check_question` 라인 다음에:

```ts
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
```

빈 배열 (`[]`) 이 아니라 `undefined` 를 반환 — 옵셔널 필드는 *omit* 으로 표현 (spec §4.1).

- [ ] **Step 3: 타입 컴파일 + 기존 테스트 확인**

```bash
pnpm --filter backend exec tsc --noEmit
pnpm --filter backend test
```
Expected: typecheck PASS, 기존 테스트 모두 PASS (legacy outline JSON 은 from 없어도 'transcript' default 됨).

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/curator.ts
git commit -m "feat(curator): normaliseSection adds from default + new slot guards"
```

---

### Task 4: normaliseSection backward-compat 단위 테스트

**Files:**
- Create: `backend/tests/curator-normalise.test.ts`

- [ ] **Step 1: 테스트 파일 생성**

```ts
// backend/tests/curator-normalise.test.ts
import { describe, it, expect } from 'vitest'
import { __testOnly_normaliseOutline } from '../src/lib/curator.js'
// ^^ 이 export 가 없다면 Step 2 에서 추가 필요

describe('curator outline normalisation — from field defaults', () => {
  it('legacy key_term without from defaults to transcript', () => {
    const raw = {
      title: 'X',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [{ term: 't', definition: 'd', ts: 5 }],
        examples: [], points: [],
      }],
    }
    const out = __testOnly_normaliseOutline(raw)
    expect(out.sections[0].key_terms[0].from).toBe('transcript')
  })

  it('explicit from: inferred is preserved', () => {
    const raw = {
      title: 'X',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [{ term: 't', definition: 'd', ts: 5, from: 'inferred' }],
        examples: [], points: [],
      }],
    }
    const out = __testOnly_normaliseOutline(raw)
    expect(out.sections[0].key_terms[0].from).toBe('inferred')
  })

  it('garbage from value (number, null) defaults to transcript', () => {
    const raw = {
      title: 'X',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [{ term: 't', definition: 'd', ts: 5, from: 42 }],
        examples: [{ text: 'e', ts: 5, from: null }],
        points: [{ text: 'p', ts: 5, important: false, from: 'bogus' }],
      }],
    }
    const out = __testOnly_normaliseOutline(raw)
    expect(out.sections[0].key_terms[0].from).toBe('transcript')
    expect(out.sections[0].examples[0].from).toBe('transcript')
    expect(out.sections[0].points[0].from).toBe('transcript')
  })

  it('procedure_steps omitted when input has no procedure_steps key', () => {
    const raw = {
      title: 'X',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
      }],
    }
    const out = __testOnly_normaliseOutline(raw)
    expect(out.sections[0].procedure_steps).toBeUndefined()
  })

  it('procedure_steps with from preserved across array', () => {
    const raw = {
      title: 'X',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
        procedure_steps: [
          { text: 'step1', ts: 0 },
          { text: 'step2', ts: 1, from: 'inferred' },
        ],
      }],
    }
    const out = __testOnly_normaliseOutline(raw)
    expect(out.sections[0].procedure_steps).toHaveLength(2)
    expect(out.sections[0].procedure_steps![0].from).toBe('transcript')
    expect(out.sections[0].procedure_steps![1].from).toBe('inferred')
  })

  it('formula filters out empty expression items', () => {
    const raw = {
      title: 'X',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
        formula: [
          { expression: 'a=b', ts: 0 },
          { expression: '', ts: 1 },           // dropped
          { label: 'L', expression: 'x=y', ts: 2 },
        ],
      }],
    }
    const out = __testOnly_normaliseOutline(raw)
    expect(out.sections[0].formula).toHaveLength(2)
    expect(out.sections[0].formula![1].label).toBe('L')
  })
})
```

- [ ] **Step 2: curator.ts 에 test-only export 추가**

`backend/src/lib/curator.ts` 끝에 (또는 normaliseOutline 함수 *정의* 직후) 추가. 만약 `normaliseOutline` 라는 이름의 wrapper 가 없다면 normaliseSection 만으로는 부족 (Outline 의 sections 배열을 dispatch 하는 wrapper 가 필요). curator.ts 의 `curateOutline` 함수 내부 정규화 로직을 확인하고 wrapper 가 없으면 추가:

```ts
// curator.ts 의 마지막 내부 함수 근처에 추가
/** @internal test-only — vitest 가 normaliseSection 의 호환성 시험에 사용 */
export function __testOnly_normaliseOutline(raw: unknown): Outline {
  const r = raw as Partial<Outline> & { sections?: Partial<OutlineSection>[] }
  return {
    title: typeof r.title === 'string' ? r.title : '',
    sections: Array.isArray(r.sections) ? r.sections.map(normaliseSection) : [],
    course: typeof r.course === 'string' && r.course.trim() ? r.course.trim() : undefined,
    lecturer: typeof r.lecturer === 'string' && r.lecturer.trim() ? r.lecturer.trim() : undefined,
    tldr: typeof r.tldr === 'string' && r.tldr.trim() ? r.tldr.trim() : undefined,
    related_lectures: Array.isArray(r.related_lectures)
      ? r.related_lectures.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim())
      : undefined,
  }
}
```

만약 curator.ts 안에 이미 비슷한 함수가 있으면 그걸 노출하는 식으로 (이름은 같게).

- [ ] **Step 3: 테스트 실행**

```bash
pnpm --filter backend test curator-normalise
```
Expected: 6/6 PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/curator-normalise.test.ts backend/src/lib/curator.ts
git commit -m "test(curator): normaliseSection backward-compat + from defaults + new slot guards"
```

---

## Phase B — Curator 프롬프트 변경 + Latency dry run (Task 5-7)

이 phase 완료 후: 큐레이터가 새 슬롯 출력 + provenance 마킹 시작. 베이스라인 재캡처 가능.

### Task 5: SYSTEM_PROMPT 에 slot emergence 룰 추가 (JA 번역)

**Files:**
- Modify: `backend/src/lib/curator.ts:148+` (LEGACY_PROMPT_BODY)

- [ ] **Step 1: LEGACY_PROMPT_BODY 의 적절한 위치에 새 룰 블록 삽입**

기존 `LEGACY_PROMPT_BODY` 의 "出力スキーマ" 또는 슬롯 설명 부근 뒤에 (line 위치는 코드 검사 후 결정):

```
出力スキーマの拡張: type-variable な追加スロット
================================================
section に optional な以下のスロットを追加可能。授業の type に応じて自然に
emerge する形で*一部だけ*埋める:

- procedure_steps[]: 順次手順 (簿記の仕訳, 数学の解法, コーディング step)
  各 item は { text, order?, ts, important?, from }
- argument_chain[]: 論証の transitional reasoning link (前提 → 推論 → 結論)
  各 item は { text, ts, from }
- formula[]: 明示的な数式・等式
  各 item は { label?, expression, ts, from }
- timeline[]: 時間順事件 (歴史・物語)
  各 item は { when, event, ts, from }

授業 type ごとの推奨スロット使用パターン (強制ではない):
| 授業 type             | 主に埋まる slot                              |
|----------------------|--------------------------------------------|
| 概念・論証 (哲学・戦略) | key_terms, argument_chain, points          |
| 手順 (簿記・数学・コード)| procedure_steps, formula, key_terms (補助)  |
| 物語 (歴史・文学)      | timeline, key_terms (人物・事件), points    |
| 経験・実証 (生物・化学) | argument_chain (主張-証拠), formula, key_terms |

強制ルール:
- 1 section につき procedure_steps / argument_chain / formula / timeline の
  最大 *2 つ* だけを使う。3 つ以上は授業 type の不明確さの signal — 重要な 2 つを選ぶ
- 該当しない slot は省略 (omit) — 空配列 [] や null では*なく*キー自体を出力しない
- argument_chain は *推論の transitional link* のみ。単発の事実主張は points へ
- procedure_steps は *順次手順* のみ。1 行の手順は points へ
- formula は明示的な等式・数式。自然語の定義は key_terms へ
- 1 つの内容が複数 slot に該当する場合の precedence:
  formula > procedure_steps > argument_chain > timeline > points > key_terms
  例: 手順の中で自然に出てきた等式は formula のみに入れ、points で重複させない
```

- [ ] **Step 2: 일본어 자연스러움 + 일관성 review**

기존 prompt 와의 톤 일관성 확인 (정중체 です/ます 또는 직설체 だ/である — 기존 LEGACY_PROMPT_BODY 따라). 룰의 의미가 spec §4.1 와 동치인지 한 번 더 비교.

- [ ] **Step 3: typecheck**

```bash
pnpm --filter backend exec tsc --noEmit
```
Expected: PASS (코멘트/문자열만 변경).

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/curator.ts
git commit -m "feat(curator): JA prompt — slot emergence rules for procedure_steps/argument_chain/formula/timeline"
```

---

### Task 6: SYSTEM_PROMPT 에 inference 룰 추가 (B-보수)

**Files:**
- Modify: `backend/src/lib/curator.ts` (LEGACY_PROMPT_BODY 안)

- [ ] **Step 1: inference rule 블록을 slot emergence 블록 *바로 다음* 에 삽입**

```
出力スキーマの拡張: per-item の出典 (from)
==========================================
各 item には from: 'transcript' | 'inferred' を必須で付ける。

transcript:
- 講師の発話の paraphrase / 要約 / 翻訳
- 講師が明示的に述べた事実・定義・例
- 講師の論理を整理して再表現したもの (意味的同値)

inferred:
- 講師が*定義なしに*使用した用語で、その授業の学部一般学習者には自明でない
  もの (例: 1 年簿記の授業で「純資産」が定義されないまま使われる場合)
  → key_terms に inferred 項目を追加
- 講師が*明白な論理点ジャンプ*を残し、それを埋めないと次の論理が成立しない場合
  → points または argument_chain に inferred 項目を追加

inference の厳格制限:
- precision ≫ recall。疑わしい時は追加しない。
- inferred 項目は*事実的に正確*でなければならない。推測・不確実情報は絶対追加しない。
- inferred 項目には ts は与えられない(直前の transcript 発話の ts を使うか、0 を使う)。
- *1 section につき inferred 項目は最大 2 個まで*。
- *outline 全体での inferred 項目の比率は全項目数の 15% 以下*。

paraphrase vs net-new inference の区別:
- transcript: 講師が話したことを短く言い換えた・別の語彙に変えた項目 (意味同値)
- inferred: 講師に存在しなかった情報 (定義・論理 step) を*新たに*導入した項目
境界が曖昧な場合は transcript として分類 (保守的)。inferred は本当に新しい情報のみ。
```

- [ ] **Step 2: 일본어 검토 + 의미 동치 확인**

spec §4.2-4.3 와 비교.

- [ ] **Step 3: typecheck**

```bash
pnpm --filter backend exec tsc --noEmit
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/curator.ts
git commit -m "feat(curator): JA prompt — B-conservative inference policy + per-item from rule"
```

---

### Task 7: Latency dry run + 결과에 따른 분기

**Files:** (실측 작업, 코드 변경 없음 — 결과에 따라 후속 task 분기)

- [ ] **Step 1: 베이스라인 fixture (yt-JGXIB) 위에서 single-shot 1회 실행**

```bash
cd backend
pnpm tsx --env-file=.env.local scripts/eval-curator.ts --fixture yt-JGXIB
```
Expected: 정상 완료. **`curator: 1 runs in <X>s` 로그 캡처**.

- [ ] **Step 2: 출력 검사 — 새 슬롯이 실제로 emerge 했는지**

scorecard 출력 후 baseline 파일 (없으면 출력만) 또는 stdout 의 outline 을 보고:
- 簿記 강의 → procedure_steps 채워졌나? formula 채워졌나?
- 어떤 inferred 항목이 추가됐나?
- argument_chain / timeline 이 *omit* 됐나 (簿記 와 안 맞으므로)?

- [ ] **Step 3: latency 임계치 분기 결정**

spec §4.4 의 임계치:
- ≤ 80s: 그대로 진행 → Task 8
- 80-100s: 프롬프트 압축 1회 시도 후 재측정 → 압축 task 추가, 그 다음 Task 8
- \> 100s: 슬롯 수 축소 또는 모델 변경 평가 → 사용자에게 보고 후 결정

분기 결과를 plan 안에 mark — 80s 이하면 그대로 Task 8 로.

- [ ] **Step 4: 결과 메모 (Commit 없음 — 실측 작업)**

`docs/superpowers/plans/2026-05-15-curator-provenance-and-typed-slots.md` 의 이 Task 안에 결과 한 줄 기록 (필요시 spec 의 §4.4 도 업데이트). 실제 코드 변경은 없으므로 git commit 불요.

**실측 결과 (2026-05-16, feat/curator-provenance-typed-slots, post-Task-6):**
- Curator latency: **75.4s** (yt-JGXIB, gpt-4o-mini, single-shot, 6 sections, title="簿記入門")
- 임계치 ≤80s 만족 → 그대로 Task 8 (Phase C) 진입. prompt 압축 불요, 모델 변경 불요.
- Eval 5축 scorecard: overall 8.2 / coverage 8.0 / accuracy 9.0 / hierarchy 8.0 / conciseness 7.0 / importance 8.0 (이전 plateau 8.1-8.2 와 회귀 없음 — 새 prompt 가 quality drop 안 일으킴)
- 새 슬롯 emergence + inferred 항목 검사는 Task 8 의 baseline JSON dump 결과로 retrospective 확인 (eval-curator 가 outline JSON 을 stdout 에 출력 안 함).

---

## Phase C — 베이스라인 재캡처 + Judge 변경 (Task 8-11)

### Task 8: 새 schema + 새 prompt 위에서 5축 베이스라인 재캡처

**Files:**
- Create: `backend/tests/fixtures/baselines/2026-05-XX-post-prompt.json` (날짜 = 실제 캡처일)

- [ ] **Step 1: baseline 저장 실행**

```bash
cd backend
DATE=$(date +%Y-%m-%d)
pnpm tsx --env-file=.env.local scripts/eval-curator.ts --baseline "${DATE}-post-prompt"
```
Expected: scorecard 출력 + `2026-05-XX-post-prompt.json` 파일 생성.

- [ ] **Step 2: legacy 베이스라인 (`2026-05-15-current.json`) 과 비교**

```bash
jq '.results[0].judge | {overall, coverage, accuracy, hierarchy, conciseness, importance}' \
  backend/tests/fixtures/baselines/2026-05-15-current.json \
  backend/tests/fixtures/baselines/${DATE}-post-prompt.json
```

기대: 회귀 없음 (overall 8.0 미만으로 떨어지지 않음). 새 슬롯이 emerge 한 결과로 overall 가 *오를 수도 있고*, 그렇지 않을 수도 있음 — 회귀만 없으면 OK.

- [ ] **Step 3: 회귀 시 즉각 분기**

만약 overall < 8.0 이면:
- 출력 JSON 의 sections 구조 점검 (슬롯 mechanical fill / 슬롯 누락 / inferred 과다 등)
- 프롬프트 미세조정 → 재측정
- 3회 시도 후에도 회귀면 사용자에게 보고

회귀 없으면 다음 task 진행.

- [ ] **Step 4: Commit (baseline JSON 만)**

```bash
git add backend/tests/fixtures/baselines/${DATE}-post-prompt.json
git commit -m "test(eval): post-prompt baseline (schema + slot emergence + provenance, 5-axis judge)"
```

---

### Task 9: judge.ts 에 provenance 6번째 축 추가

**Files:**
- Modify: `backend/scripts/lib/judge.ts:27-39` (JudgeAxisScores + JudgeResult)

- [ ] **Step 1: JudgeAxisScores 인터페이스 확장**

```ts
export interface JudgeAxisScores {
  coverage: number
  accuracy: number
  hierarchy: number
  conciseness: number
  importance: number
  provenance: number      // NEW — 0-10
}
```

- [ ] **Step 2: 새 axis 가 overall 계산에 *섞이지 않도록* 명시**

기존 SYSTEM_PROMPT (line 53+) 의 overall 가중치 라인:
```
- overall は 5 軸を以下の重み付けで合算: coverage 0.25, accuracy 0.30, hierarchy 0.20, conciseness 0.15, importance 0.10
```
**변경 없음** — provenance 는 별도 axis 로만 출력. overall 은 *기존 5축* 으로 계산.

이 의도를 SYSTEM_PROMPT 에 명시 (Step 3 에서 처리).

- [ ] **Step 3: typecheck**

```bash
pnpm --filter backend exec tsc --noEmit
```
Expected: PASS (구조 변경만, 다른 사용처 없음).

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/lib/judge.ts
git commit -m "feat(judge): add provenance axis to JudgeAxisScores (separate from overall)"
```

---

### Task 10: judge SYSTEM_PROMPT 에 provenance 평가 룰 추가

**Files:**
- Modify: `backend/scripts/lib/judge.ts:53-80` (SYSTEM_PROMPT)

- [ ] **Step 1: SYSTEM_PROMPT 에 provenance 평가 룰 + 출력 JSON 스키마 갱신**

기존 SYSTEM_PROMPT 의 5축 채점 기준 *바로 뒤* 에 추가:

```
- provenance (出典管理): from: 'inferred' 項目が以下を満たすか。0-10。
  - 必要なケースのみ追加: 講師が定義なしに使った用語 / 明白な論理ジャンプ — それ以外の追加は減点
  - 事実的に正確: 推測・不確実情報は大幅減点
  - 1 section につき inferred が 2 個を超えれば軽い減点
  - 全項目に対する inferred 比率が 15% を超えれば軽い減点
  - 全ての inferred 項目に from: 'inferred' flag が付いている (欠落で減点)
  - slot fit: 授業 type と埋まった slot が整合 — procedural 授業で procedure_steps が
    空で argument_chain だけ埋まれば減点
```

또한 SYSTEM_PROMPT 끝 (출력 JSON 스키마 부분) 의 JSON 예시에 `"provenance": <0-10>` 추가.

기존 overall 가중치 라인 *바로 뒤* 에 한 줄 추가 :

```
- provenance は overall に含まれない (別軸として保存)。
```

- [ ] **Step 2: SYSTEM_PROMPT 의 출력 JSON 예시 갱신**

```
出力は以下の JSON のみ:

{
  "coverage": <0-10>,
  "accuracy": <0-10>,
  "hierarchy": <0-10>,
  "conciseness": <0-10>,
  "importance": <0-10>,
  "provenance": <0-10>,
  "overall": <0-10>,
  "issues": ["...", "..."],
  "wins": ["...", "..."]
}
```

- [ ] **Step 3: eval-curator.ts 의 scorecard 출력에 provenance 행 추가**

`backend/scripts/eval-curator.ts:166-180` (formatScorecard 함수) 의 axis 행 추가:
```ts
lines.push(`    importance   ${j.importance.toFixed(1)}${delta(j.importance, cmp?.importance)}`)
lines.push(`    provenance   ${j.provenance.toFixed(1)}${delta(j.provenance, cmp?.provenance)}`)
```
mean 계산 + 출력에도 provenance 추가:
```ts
lines.push(`    provenance   ${mean('provenance').toFixed(2)}`)
```
(`mean` 함수의 typed key 에도 `'provenance'` 추가.)

- [ ] **Step 4: typecheck + 실행 한번**

```bash
pnpm --filter backend exec tsc --noEmit
cd backend && pnpm tsx --env-file=.env.local scripts/eval-curator.ts --fixture yt-JGXIB
```
Expected: typecheck PASS, scorecard 가 provenance 행 포함해 6 axis 출력.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/lib/judge.ts backend/scripts/eval-curator.ts
git commit -m "feat(judge): JA prompt — provenance evaluation rules + scorecard output extension"
```

---

### Task 11: judge response 파싱 robustness 테스트

**Files:**
- Create: `backend/tests/judge-parse.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```ts
// backend/tests/judge-parse.test.ts
import { describe, it, expect } from 'vitest'
// judge.ts 가 export 하는 파싱 함수 사용 — 없다면 추가
import { __testOnly_parseJudgeResponse } from '../scripts/lib/judge.js'

describe('judge response parsing — provenance axis', () => {
  it('parses 6-axis response correctly', () => {
    const raw = JSON.stringify({
      coverage: 8, accuracy: 9, hierarchy: 8,
      conciseness: 7, importance: 8, provenance: 7.5,
      overall: 8.1,
      issues: ['x'], wins: ['y'],
    })
    const r = __testOnly_parseJudgeResponse(raw)
    expect(r.provenance).toBe(7.5)
    expect(r.overall).toBe(8.1)
  })

  it('legacy 5-axis response defaults provenance to 0 (or NaN — see policy)', () => {
    // 만약 judge.ts 가 legacy 응답을 어떻게 다룰지 정책 결정 필요.
    // 권장: provenance 없으면 0 (적용 안 됐다는 신호) 또는 NaN.
    // 이 테스트는 정책에 맞춰 작성.
    const raw = JSON.stringify({
      coverage: 8, accuracy: 9, hierarchy: 8,
      conciseness: 7, importance: 8,
      overall: 8.1,
      issues: [], wins: [],
    })
    const r = __testOnly_parseJudgeResponse(raw)
    // 가정: 누락 시 0
    expect(r.provenance).toBe(0)
  })
})
```

- [ ] **Step 2: judge.ts 에 test-only export 추가 (없다면)**

`backend/scripts/lib/judge.ts` 의 응답 파싱부를 함수로 추출하고 `__testOnly_parseJudgeResponse` 라는 이름으로 export. legacy 5축 응답에 provenance 누락 시 0 으로 default.

- [ ] **Step 3: 테스트 실행**

```bash
pnpm --filter backend test judge-parse
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/judge-parse.test.ts backend/scripts/lib/judge.ts
git commit -m "test(judge): parse + default-on-missing for provenance axis"
```

---

## Phase D — Founder fixture procurement (Task 12, parallel)

### Task 12: procedural-pure + narrative fixture 추가 (FOUNDER 액션)

**Files:**
- Create: `backend/tests/fixtures/transcripts/<procedural-slug>.json`
- Create: `backend/tests/fixtures/transcripts/<narrative-slug>.json`

이건 **founder 작업**. AI 가 fixture transcript 를 만들면 fixture-overfit 의 의미가 사라짐 (judge 도 같은 LLM 패밀리 → 생성된 transcript 와 채점이 상관).

- [ ] **Step 1: procedural-pure 강의 transcript 1개 procure**

소스: YouTube 수학 풀이 영상 / 프로그래밍 튜토리얼 영상 / 기타 절차 강의. `backend/scripts/fixture-from-youtube.ts` 또는 `backend/scripts/dump-transcript-fixture.ts` 사용.

```bash
cd backend
pnpm tsx scripts/fixture-from-youtube.ts <YouTube URL>
```
출력 형식 = `{ source: <url>, transcripts: [{ts, text}...] }` JSON.

- [ ] **Step 2: narrative 강의 transcript 1개 procure**

소스: 역사 강의 / 문학 강의 / 다큐멘터리 식 강의. 같은 방식.

- [ ] **Step 3: 각 fixture 위에서 eval 한 번 돌려 확인**

```bash
cd backend
pnpm tsx --env-file=.env.local scripts/eval-curator.ts --fixture <procedural-slug>
pnpm tsx --env-file=.env.local scripts/eval-curator.ts --fixture <narrative-slug>
```
Expected: 각 fixture 가 정상 채점되고 의도된 슬롯 emerge:
- procedural fixture → procedure_steps 채워짐
- narrative fixture → timeline 채워짐

만약 의도와 다르면 → 프롬프트 회귀 신호 → 사용자에게 보고 / Task 7 재검토.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/fixtures/transcripts/
git commit -m "test(eval): add procedural + narrative fixtures for slot emergence validation"
```

---

## Phase E — 본격 prompt iteration (Task 13)

### Task 13: 3 fixture 위에서 overall ≥ 8.5 + provenance ≥ 7.5 달성까지 반복

> **CLOSED 2026-05-16 — iter-2 가 final baseline. founder qualitative gate 로 종결.**
>
> 결정 이유:
> - **Judge degeneracy**: iter-0/1/2 baselines 가 3 개의 서로 다른 fixture (narrative-ukraine-russia / procedural-physics-em / yt-JGXIB) 에서 모두 동일한 overall 8.1, provenance 6.0, accuracy 9.0 을 산출. iter-1 의 narrative 만 7.2/5.0/7.0 으로 한 번 변별. Groq llama-3.3-70b judge 가 mode-collapse 하여 실제 변별 신호가 빈약 → quantitative target (overall ≥ 8.5 / provenance ≥ 7.5) 의 측정 도구 신뢰도 자체가 낮음.
> - **Qualitative 관찰은 충분**: iter-4 prompt (`b657a71`) curator-only 관찰: 簿記 procedure_steps 0~3 stochastic, physics argument_chain 2 항목, narrative 모든 신규 슬롯 0 (argument-type 강의로서 자연). 신규 typed slot 이 의도된 강의 type 에 발현 확인됨. 잔존 stochasticity (簿記 procedure_steps 0 케이스) 는 prompt fine-tune 만으로 해결되지 않는 깊은 변수 — judge 점수 0.2 차이로 분리 불가.
> - **Cost vs value**: 24h 대기 후 strict comparison 가능하지만 비교 대상 (iter-0) 이 degenerate. OpenAI/Anthropic judge swap 은 mode-collapse 가 LLM judge 일반 현상이라 같은 결과 확률 ≥ 50%. paid tier 업그레이드는 final eval 하나 위해 과함.
> - **Effective quality gate**: ext 0.1.50 출시 후 founder 가 실강의 노트를 받아 보는 사용 시그널 > quantitative eval 점수.
>
> **Final baseline of record**: iter-2 (`backend/tests/fixtures/baselines/2026-05-16-iter-2.json`, savedAt 02:41 UTC) — overall 8.1 / provenance 6.0 (3 fixture uniform, target 미달이지만 judge degeneracy 로 측정 한계).
>
> **Follow-up (별건)**: 다음 prompt iteration 사이클에선 judge 자체를 교체하거나 (cross-vendor: OpenAI/Anthropic), pairwise comparison (Bradley-Terry) 기반 평가로 전환 검토. 현 eval 인프라는 mode-collapse 에 무력.
>
> ※ Step 1-5 의 원안은 reference 로 남김 (Groq judge 가 정상 변별할 때 적용 가능).

**Files:** (반복 작업, prompt 미세조정)

- [ ] **Step 1: 모든 fixture eval 한 번 (3-baseline 캡처)**

```bash
cd backend
DATE=$(date +%Y-%m-%d)
pnpm tsx --env-file=.env.local scripts/eval-curator.ts --baseline "${DATE}-iter-0"
```

- [ ] **Step 2: 점수 분석 — 어느 축이 천장인가**

3 fixture 평균:
- overall ≥ 8.5 ? provenance ≥ 7.5 ?
- 미달인 axis 의 issues[] 항목들이 어떤 패턴?

- [ ] **Step 3: 약점 axis 별 프롬프트 수정 1회**

예시:
- conciseness 낮음 → "1 bullet = 1 fact, 反復禁止" 강화
- provenance 낮음 → inference 룰 보강 / 슬롯 cap 강조
- slot fit 낮음 → emergence 표 명료화

수정 후:
```bash
pnpm tsx --env-file=.env.local scripts/eval-curator.ts --against "${DATE}-iter-0"
```

- [ ] **Step 4: 반복 (최대 5 round)**

각 round 마다 baseline 저장 (`iter-1`, `iter-2`, ...). 목표 도달 시 정지. 5 round 안에 못 도달하면 사용자에게 보고 — 슬롯 디자인 문제 또는 모델 한계.

- [ ] **Step 5: 도달 시 final baseline commit**

```bash
git add backend/tests/fixtures/baselines/${DATE}-iter-*.json
git add backend/src/lib/curator.ts  # 최종 프롬프트
git commit -m "feat(curator): prompt iteration final (overall X / provenance Y across N fixtures)"
```

---

## Phase F — 렌더러 (사이드패널) (Task 14-20)

### Task 14: index.css 에 `.inferred` 스타일 추가

**Files:**
- Modify: `extension/src/side-panel/index.css`

- [ ] **Step 1: 기존 스타일 토큰 활용해 `.inferred` 룰 추가**

CSS 끝에 추가 (또는 컴포넌트별 스타일 영역에):

```css
/* === Inferred (AI-supplemented) markers — spec §5.1 + mockup === */
/* 점선 테두리 + ink-500 텍스트 + ※ 글리프, 세 신호 redundancy. */

.kt-item.inferred {
  border-style: dashed;
  border-color: var(--terra-soft, #FED7AA);
}
.kt-item.inferred .kt-term::before {
  content: '※ ';
  color: var(--terra-700, #9A330A);
  font-weight: 500;
  font-size: 12.5px;
  margin-right: 1px;
}
.kt-item.inferred .kt-term {
  color: var(--ink-700, #3D3733);
}
.kt-item.inferred .kt-def {
  color: var(--ink-500, #6E6660);
}

.point.inferred .bullet-mark {
  color: var(--terra-700, #9A330A);
  font-size: 12px;
  flex-shrink: 0;
  align-self: center;
  line-height: 1;
  font-weight: 500;
  width: 10px;
  text-align: center;
}
.point.inferred .text-imp {
  color: var(--ink-500, #6E6660);
  font-weight: 400;
}
.point.inferred .lisna-hl {
  background: linear-gradient(180deg, transparent 60%, var(--paper-300, #F4F2EC) 60%) !important;
  border-bottom: 1px dashed var(--terra-soft, #FED7AA);
}
```

Tailwind 가 인라인 클래스로 처리하는 부분이라 별도 CSS 로 빼는 게 가장 안전 (Tailwind utility 충돌 회피).

- [ ] **Step 2: typecheck + build**

```bash
pnpm --filter extension exec tsc --noEmit
```
Expected: PASS (CSS only).

- [ ] **Step 3: Commit**

```bash
git add extension/src/side-panel/index.css
git commit -m "feat(extension): .inferred CSS class (dashed + ink-500 + ※ for key_term/point)"
```

---

### Task 15: OutlineView 의 key_term/point/example 에 `.inferred` 분기 추가

**Files:**
- Modify: `extension/src/side-panel/components/OutlineView.tsx:756+` (key_term ul 부분) 및 point ul / example ul

- [ ] **Step 1: key_term `<li>` 에 inferred 클래스 + ts-chip none 분기**

기존 (line ~756):
```tsx
<li key={`${kt.term}-${i}`}
    className="bg-paper-200 border border-paper-edge rounded-md-design px-2 py-1.5 text-xs">
```
변경:
```tsx
<li key={`${kt.term}-${i}`}
    className={`bg-paper-200 border border-paper-edge rounded-md-design px-2 py-1.5 text-xs kt-item ${kt.from === 'inferred' ? 'inferred' : ''}`}>
```

내부 `<div className="flex items-baseline justify-between gap-2">` 의 term `<span>` 에 `kt-term` 클래스 추가:
```tsx
<span className="kt-term font-semibold text-ink-900">{kt.term}</span>
```

definition 에 `kt-def` 클래스 추가:
```tsx
<div className="kt-def text-ink-700 mt-0.5 leading-relaxed">
  {kt.definition}
</div>
```

ts-chip 의 ts === 0 일 때 (즉 inferred 의 ts 누락 케이스) 처리 — TsButton 컴포넌트 (line 865+) 에 ts === 0 분기 추가:
```tsx
function TsButton({ ts, onJump }: { ts: number; onJump?: (ts: number) => void }) {
  // inferred 항목 (ts === 0) 표시: 회색 dash
  if (ts === 0) {
    return <span className="text-[10px] text-ink-300 font-mono tabular-nums shrink-0">—</span>
  }
  // ... 기존 분기
}
```

- [ ] **Step 2: point `<li>` 도 동일 처리**

기존 point rendering 의 className 에 `point ${p.from === 'inferred' ? 'inferred' : ''}` 추가. bullet 부분도 inferred 일 때 `bullet-mark` 클래스로 ※ 글리프 렌더:

```tsx
<li className={`point text-xs leading-relaxed flex gap-2 items-baseline ${p.from === 'inferred' ? 'inferred' : ''}`}>
  {p.from === 'inferred' ? (
    <span className="bullet-mark" aria-hidden>※</span>
  ) : (
    <span aria-hidden className={p.important ? 'shrink-0 self-center' : 'text-ink-200 shrink-0'} style={...}>
      {!p.important && '•'}
    </span>
  )}
  {/* ... 기존 text-imp / text-reg + TsButton */}
</li>
```

(주의: 기존 important style 객체는 그대로 유지. 새 분기는 inferred 일 때만.)

- [ ] **Step 3: example `<li>` 도 동일하지만 simpler (important 개념 없음)**

example 의 className 에 inferred 추가. example 은 보통 `→` 화살표 prefix 라 bullet 변경 없음.

- [ ] **Step 4: typecheck**

```bash
pnpm --filter extension exec tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: 익스텐션 dev 서버 한 번 띄워서 시각 검증**

(이 단계는 사용자에게 노출 — `.claude/launch.json` 의 extension 런처 사용. 또는 수동:)
```bash
pnpm --filter extension dev
```
LMS 또는 YouTube 강의를 캡처 후 사이드패널에서 inferred 항목이 점선 + 회색 + ※ 로 표시되는지 확인. 만약 라이브 데이터에 inferred 항목이 없으면 dev-gallery 에 mock outline 추가:

`extension/src/dev-gallery/` 어딘가에 mock Outline 으로 inferred 항목 1개씩 포함시켜 렌더 테스트.

- [ ] **Step 6: Commit**

```bash
git add extension/src/side-panel/components/OutlineView.tsx
git commit -m "feat(extension): OutlineView — apply .inferred to key_term/point/example by from flag"
```

---

### Task 16: StepList 컴포넌트 생성 (procedure_steps)

**Files:**
- Create: `extension/src/side-panel/components/StepList.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
// extension/src/side-panel/components/StepList.tsx
import type { OutlineStep } from '../../shared/curator-types'   // 또는 적절한 import 경로
import { TsButton } from './TsButton'                            // OutlineView 에서 export 필요할 수도

interface StepListProps {
  steps: OutlineStep[]
  onJump?: (ts: number) => void
  compact?: boolean
}

export function StepList({ steps, onJump, compact = false }: StepListProps) {
  // compact: important step 만 (points 와 동일 룰)
  const visible = compact ? steps.filter(s => s.important) : steps
  if (visible.length === 0) return null
  
  return (
    <ol className="space-y-1 list-decimal pl-4">
      {visible.map((s, i) => (
        <li key={`${s.text.slice(0, 24)}-${i}`}
            className={`text-xs leading-relaxed flex gap-2 items-baseline ${s.from === 'inferred' ? 'step inferred' : 'step'}`}>
          {s.from === 'inferred' ? (
            <span className="bullet-mark" aria-hidden>※</span>
          ) : null}
          <span className={s.important ? 'text-ink-900 font-medium flex-1' : 'text-ink-700 flex-1'}>
            {s.text}
          </span>
          <TsButton ts={s.ts} onJump={onJump} />
        </li>
      ))}
    </ol>
  )
}
```

`.step.inferred` 의 CSS 는 Task 14 의 `.inferred` 룰 패턴 그대로 — 필요시 Task 14 의 CSS 에 추가.

- [ ] **Step 2: TsButton 을 OutlineView 에서 export 하거나 새 위치로 이동**

`extension/src/side-panel/components/OutlineView.tsx:865+` 의 TsButton 함수를 별도 파일 `TsButton.tsx` 로 분리해 export. OutlineView 는 import 로 사용.

- [ ] **Step 3: typecheck**

```bash
pnpm --filter extension exec tsc --noEmit
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add extension/src/side-panel/components/StepList.tsx extension/src/side-panel/components/TsButton.tsx extension/src/side-panel/components/OutlineView.tsx
git commit -m "feat(extension): StepList component for procedure_steps + extract TsButton"
```

---

### Task 17: ChainList 컴포넌트 생성 (argument_chain)

**Files:**
- Create: `extension/src/side-panel/components/ChainList.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
// extension/src/side-panel/components/ChainList.tsx
import type { OutlineChainLink } from '../../shared/curator-types'
import { TsButton } from './TsButton'

interface ChainListProps {
  links: OutlineChainLink[]
  onJump?: (ts: number) => void
}

export function ChainList({ links, onJump }: ChainListProps) {
  if (links.length === 0) return null
  return (
    <ul className="space-y-1">
      {links.map((l, i) => (
        <li key={`${l.text.slice(0, 24)}-${i}`}
            className={`text-xs leading-relaxed flex gap-2 items-baseline ${l.from === 'inferred' ? 'chain-link inferred' : 'chain-link'}`}>
          <span className="text-ink-300 shrink-0" aria-hidden>
            {l.from === 'inferred' ? '※' : '→'}
          </span>
          <span className="text-ink-700 flex-1">{l.text}</span>
          <TsButton ts={l.ts} onJump={onJump} />
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter extension exec tsc --noEmit
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add extension/src/side-panel/components/ChainList.tsx
git commit -m "feat(extension): ChainList component for argument_chain"
```

---

### Task 18: FormulaList 컴포넌트 생성

**Files:**
- Create: `extension/src/side-panel/components/FormulaList.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
// extension/src/side-panel/components/FormulaList.tsx
import type { OutlineFormula } from '../../shared/curator-types'
import { TsButton } from './TsButton'

interface FormulaListProps {
  formulas: OutlineFormula[]
  onJump?: (ts: number) => void
}

export function FormulaList({ formulas, onJump }: FormulaListProps) {
  if (formulas.length === 0) return null
  return (
    <ul className="space-y-1.5">
      {formulas.map((f, i) => (
        <li key={`${f.expression.slice(0, 24)}-${i}`}
            className={`bg-paper-200 border border-paper-edge rounded-md-design px-2 py-1.5 text-xs ${f.from === 'inferred' ? 'formula-item inferred' : 'formula-item'}`}>
          {f.label && (
            <div className="text-[10px] font-mono uppercase tracking-eyebrow text-ink-500 font-semibold mb-0.5">
              {f.from === 'inferred' ? '※ ' : ''}{f.label}
            </div>
          )}
          <code className="font-mono text-ink-900 leading-relaxed">{f.expression}</code>
          {!f.label && f.from === 'inferred' && (
            <span className="ml-2 text-terra-700 font-mono">※</span>
          )}
          <div className="flex justify-end mt-0.5">
            <TsButton ts={f.ts} onJump={onJump} />
          </div>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter extension exec tsc --noEmit
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add extension/src/side-panel/components/FormulaList.tsx
git commit -m "feat(extension): FormulaList component for formula slot"
```

---

### Task 19: TimelineList 컴포넌트 생성

**Files:**
- Create: `extension/src/side-panel/components/TimelineList.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
// extension/src/side-panel/components/TimelineList.tsx
import type { OutlineTimelineEvent } from '../../shared/curator-types'
import { TsButton } from './TsButton'

interface TimelineListProps {
  events: OutlineTimelineEvent[]
  onJump?: (ts: number) => void
}

export function TimelineList({ events, onJump }: TimelineListProps) {
  if (events.length === 0) return null
  return (
    <ul className="space-y-1">
      {events.map((ev, i) => (
        <li key={`${ev.when}-${i}`}
            className={`text-xs leading-relaxed grid grid-cols-[auto_1fr_auto] gap-2 items-baseline ${ev.from === 'inferred' ? 'timeline-item inferred' : 'timeline-item'}`}>
          <span className="text-ink-500 font-mono tabular-nums shrink-0">
            {ev.from === 'inferred' ? '※ ' : ''}{ev.when}
          </span>
          <span className="text-ink-700">{ev.event}</span>
          <TsButton ts={ev.ts} onJump={onJump} />
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter extension exec tsc --noEmit
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add extension/src/side-panel/components/TimelineList.tsx
git commit -m "feat(extension): TimelineList component for timeline slot"
```

---

### Task 20: OutlineView 에 새 슬롯 컴포넌트 wire-in

**Files:**
- Modify: `extension/src/side-panel/components/OutlineView.tsx`

- [ ] **Step 1: 새 컴포넌트 import**

```tsx
import { StepList } from './StepList'
import { ChainList } from './ChainList'
import { FormulaList } from './FormulaList'
import { TimelineList } from './TimelineList'
```

- [ ] **Step 2: section rendering 에 새 슬롯 hide-when-empty 패턴 추가**

기존 OutlineView 의 section JSX 안 (key_terms ul 다음, points ul 다음, examples 다음, related_terms 다음 어딘가 — 디자인 결정):

```tsx
{/* procedure_steps — 절차형 강의 */}
{section.procedure_steps && section.procedure_steps.length > 0 && (
  <div className="space-y-1">
    <div className="text-[10px] font-mono uppercase tracking-eyebrow text-ink-500 font-medium">
      {T.outline.procedure_steps_label}
    </div>
    <StepList steps={section.procedure_steps} onJump={onJump} compact={compact} />
  </div>
)}

{/* formula — 수식·등식 */}
{!compact && section.formula && section.formula.length > 0 && (
  <div className="space-y-1">
    <div className="text-[10px] font-mono uppercase tracking-eyebrow text-ink-500 font-medium">
      {T.outline.formula_label}
    </div>
    <FormulaList formulas={section.formula} onJump={onJump} />
  </div>
)}

{/* argument_chain — 논증 흐름 */}
{section.argument_chain && section.argument_chain.length > 0 && (
  <div className="space-y-1">
    <div className="text-[10px] font-mono uppercase tracking-eyebrow text-ink-500 font-medium">
      {T.outline.argument_chain_label}
    </div>
    <ChainList links={section.argument_chain} onJump={onJump} />
  </div>
)}

{/* timeline — 시간순 */}
{section.timeline && section.timeline.length > 0 && (
  <div className="space-y-1">
    <div className="text-[10px] font-mono uppercase tracking-eyebrow text-ink-500 font-medium">
      {T.outline.timeline_label}
    </div>
    <TimelineList events={section.timeline} onJump={onJump} />
  </div>
)}
```

각 슬롯이 *omit* 됐을 때 — `section.procedure_steps && section.procedure_steps.length > 0` 가드가 둘 다 처리 (undefined 와 [] 둘 다 false).

- [ ] **Step 3: i18n 라벨 4개 추가**

`extension/src/shared/i18n/locales/*.ts` 각 locale 의 `outline` 객체에 추가:
```ts
// ja
procedure_steps_label: '手順',
formula_label: '公式',
argument_chain_label: '論証',
timeline_label: '時系列',

// en
procedure_steps_label: 'Steps',
formula_label: 'Formula',
argument_chain_label: 'Argument',
timeline_label: 'Timeline',

// ko
procedure_steps_label: '절차',
formula_label: '공식',
argument_chain_label: '논증',
timeline_label: '시간 순',

// zh
procedure_steps_label: '步骤',
formula_label: '公式',
argument_chain_label: '论证',
timeline_label: '时间线',
```

- [ ] **Step 4: typecheck + build**

```bash
pnpm --filter extension exec tsc --noEmit
pnpm --filter extension build
```
Expected: PASS.

- [ ] **Step 5: dev 서버 시각 검증**

extension dev 서버 (Task 14 와 동일 방식) 띄워서 새 슬롯이 채워진 강의 노트에서 4개 슬롯 모두 정상 렌더 + inferred 마커 정상 적용 확인.

- [ ] **Step 6: Commit**

```bash
git add extension/src/side-panel/components/OutlineView.tsx extension/src/shared/i18n/locales/
git commit -m "feat(extension): OutlineView wire-in for procedure_steps/argument_chain/formula/timeline"
```

---

## Phase G — Markdown export (Task 21-23)

### Task 21: HeadingSet 에 inferred_callout + 새 슬롯 라벨 4종 추가

**Files:**
- Modify: `backend/src/lib/markdown-obsidian.ts:37-93` (HeadingSet + HEADINGS 객체)

- [ ] **Step 1: HeadingSet 인터페이스 확장**

```ts
interface HeadingSet {
  // ... 기존 필드 ...
  inferred_callout: string   // NEW — 補足/Note/보충/补充
  steps_label: string        // NEW
  formula_label: string      // NEW
  argument_label: string     // NEW
  timeline_label: string     // NEW
}
```

- [ ] **Step 2: 4개 locale 에 새 라벨 채우기**

```ts
// ja
inferred_callout: '補足', steps_label: '手順', formula_label: '公式',
argument_label: '論証', timeline_label: '時系列',

// en
inferred_callout: 'Note', steps_label: 'Steps', formula_label: 'Formula',
argument_label: 'Argument', timeline_label: 'Timeline',

// ko
inferred_callout: '보충', steps_label: '절차', formula_label: '공식',
argument_label: '논증', timeline_label: '시간 순',

// zh
inferred_callout: '补充', steps_label: '步骤', formula_label: '公式',
argument_label: '论证', timeline_label: '时间线',
```

- [ ] **Step 3: typecheck**

```bash
pnpm --filter backend exec tsc --noEmit
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/markdown-obsidian.ts
git commit -m "feat(markdown): HeadingSet — inferred_callout + 4 new slot labels (4 locales)"
```

---

### Task 22: inferred 항목을 Obsidian callout 으로 직렬화

**Files:**
- Modify: `backend/src/lib/markdown-obsidian.ts` (sectionBlock 또는 그 안의 key_terms 매핑부)

- [ ] **Step 1: key_terms / examples / points 직렬화 시 inferred 분기 추가**

기존 sectionBlock 함수의 key_term 매핑 (sectionBlock 안의 `for (const kt of s.key_terms)` 또는 비슷한 위치):

```ts
for (const kt of s.key_terms) {
  if (kt.from === 'inferred') {
    out.push(`> [!note] ${h.inferred_callout} — ※ ${kt.term}`)
    out.push(`> ${kt.definition}`)
    out.push('')
  } else {
    // 기존 wikilink + 정의 출력
    out.push(`- [[${sanitiseWikilink(kt.term)}]]: ${kt.definition} ▶ ${fmtTs(kt.ts)}`)
  }
}
```

(정확한 출력 형태는 기존 markdown-obsidian.ts 의 패턴을 따라 — 위는 예시. 실제 구현 시 기존 출력과 일관성 유지.)

points 도 동일 패턴:
```ts
for (const p of s.points) {
  if (p.from === 'inferred') {
    out.push(`> [!note] ${h.inferred_callout}`)
    out.push(`> ※ ${p.text}`)
    out.push('')
  } else {
    // 기존 important / regular bullet 출력
  }
}
```

examples 도 동일.

- [ ] **Step 2: 기존 markdown-obsidian.test.ts 확장**

`backend/tests/markdown-obsidian.test.ts` 에 inferred 항목 출력 검증 케이스 추가:

```ts
it('inferred key_term is rendered as note callout', () => {
  const outline: Outline = {
    title: 'X',
    sections: [{
      heading: 'A', ts: 0, summary: '',
      key_terms: [{ term: '純資産', definition: 'def', ts: 0, from: 'inferred' }],
      examples: [], points: [],
    }],
  }
  const md = outlineToObsidianMarkdown(outline, { /* ctx */ note_language: 'ja' /* ... */ })
  expect(md).toContain('> [!note] 補足 — ※ 純資産')
  expect(md).toContain('> def')
})
```

- [ ] **Step 3: 테스트 실행**

```bash
pnpm --filter backend test markdown-obsidian
```
Expected: 새 테스트 + 기존 테스트 모두 PASS. 기존 fixture 가 from 없는 항목들이면 모두 'transcript' default 처리 → 기존 출력 유지.

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/markdown-obsidian.ts backend/tests/markdown-obsidian.test.ts
git commit -m "feat(markdown): inferred items rendered as Obsidian > [!note] callouts"
```

---

### Task 23: 새 슬롯 4종을 마크다운으로 직렬화

**Files:**
- Modify: `backend/src/lib/markdown-obsidian.ts` (sectionBlock)

- [ ] **Step 1: sectionBlock 의 적절한 위치에 새 슬롯 출력 추가**

기존 sectionBlock 의 examples / related_terms 등 출력 뒤에:

```ts
// procedure_steps
if (s.procedure_steps && s.procedure_steps.length > 0) {
  out.push(`#### ${h.steps_label}`)
  out.push('')
  s.procedure_steps.forEach((st, i) => {
    const order = st.order ?? i + 1
    if (st.from === 'inferred') {
      out.push(`> [!note] ${h.inferred_callout}`)
      out.push(`> ${order}. ※ ${st.text}`)
      out.push('')
    } else {
      out.push(`${order}. ${st.text} ▶ ${fmtTs(st.ts)}`)
    }
  })
  out.push('')
}

// formula
if (s.formula && s.formula.length > 0) {
  out.push(`#### ${h.formula_label}`)
  out.push('')
  for (const f of s.formula) {
    if (f.from === 'inferred') {
      out.push(`> [!note] ${h.inferred_callout} — ※ ${f.label ?? ''}`)
      out.push(`> \`\`\`math`)
      out.push(`> ${f.expression}`)
      out.push(`> \`\`\``)
      out.push('')
    } else {
      if (f.label) out.push(`**${f.label}**`)
      out.push('```math')
      out.push(f.expression)
      out.push('```')
      out.push('')
    }
  }
}

// argument_chain
if (s.argument_chain && s.argument_chain.length > 0) {
  out.push(`#### ${h.argument_label}`)
  out.push('')
  for (const l of s.argument_chain) {
    if (l.from === 'inferred') {
      out.push(`> [!note] ${h.inferred_callout}`)
      out.push(`> → ※ ${l.text}`)
      out.push('')
    } else {
      out.push(`- → ${l.text} ▶ ${fmtTs(l.ts)}`)
    }
  }
  out.push('')
}

// timeline
if (s.timeline && s.timeline.length > 0) {
  out.push(`#### ${h.timeline_label}`)
  out.push('')
  out.push(`| ${h.timeline_label} | ${h.points_label} |`)
  out.push('|---|---|')
  for (const ev of s.timeline) {
    const marker = ev.from === 'inferred' ? '※ ' : ''
    out.push(`| ${marker}${ev.when} | ${ev.event} |`)
  }
  out.push('')
}
```

- [ ] **Step 2: 테스트 케이스 추가**

`backend/tests/markdown-obsidian.test.ts` 에 새 슬롯 4종 각각 1개씩 + inferred variant 1개씩 케이스 작성. 총 8개 테스트.

- [ ] **Step 3: 실행**

```bash
pnpm --filter backend test markdown-obsidian
```
Expected: 전체 PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/markdown-obsidian.ts backend/tests/markdown-obsidian.test.ts
git commit -m "feat(markdown): serialize procedure_steps/argument_chain/formula/timeline + inferred variants"
```

---

## Phase H — Ship (Task 24-26)

### Task 24: 익스텐션 버전 범프 0.1.49 → 0.1.50

**Files:**
- Modify: `extension/manifest.config.ts` (또는 `extension/package.json`)

- [ ] **Step 1: 버전 필드 찾기**

```bash
grep -rn "0.1.49\|version" extension/manifest.config.ts extension/package.json | head -5
```

- [ ] **Step 2: 버전 업데이트**

manifest.config.ts 의 version 필드를 `'0.1.50'` 으로. package.json 도 동일.

- [ ] **Step 3: Commit**

```bash
git add extension/manifest.config.ts extension/package.json
git commit -m "chore(extension): bump 0.1.49 → 0.1.50 for curator provenance + typed slots feature"
```

---

### Task 25: 전체 typecheck + lint + test + build

**Files:** (검증 작업)

- [ ] **Step 1: backend typecheck + test**

```bash
pnpm --filter backend exec tsc --noEmit
pnpm --filter backend test
```
Expected: 모두 PASS.

- [ ] **Step 2: extension typecheck + test + build**

```bash
pnpm --filter extension exec tsc --noEmit
pnpm --filter extension test
pnpm --filter extension build
```
Expected: 모두 PASS.

- [ ] **Step 3: 베이스라인 회귀 최종 확인**

```bash
cd backend
pnpm tsx --env-file=.env.local scripts/eval-curator.ts --against 2026-05-15-current
```
Expected: overall ≥ 8.5 AND provenance ≥ 7.5 across all fixtures.

미달이면 Phase E (Task 13) 로 돌아가 추가 iteration.

- [ ] **Step 4: 결과 OK 이면 정리 commit (있을 경우)**

만약 위 검증 중 fix 가 필요했다면 그 commit. 모든 게 깨끗하면 step skip.

---

### Task 26: CWS_BUILD ZIP 생성 + 사용자에게 업로드 인계

**Files:** (artifact 생성)

- [ ] **Step 1: 프로덕션 ZIP 빌드**

```bash
cd extension
CWS_BUILD=1 pnpm build
```
Expected: `extension/dist/` 디렉터리에 manifest.json 의 key 필드 포함된 프로덕션 빌드.

- [ ] **Step 2: ZIP 패키징**

```bash
cd extension/dist
zip -r ../../lisna-extension-0.1.50.zip .
```
또는 기존 packaging 스크립트 사용 (있는지 확인).

- [ ] **Step 3: ZIP 위치 + 업로드 안내 메시지**

`/Users/guntak/Lisna/lisna-extension-0.1.50.zip` 가 준비됨. 사용자에게:
- Chrome Web Store Developer Dashboard 에서 Lisna 항목 → 새 패키지 업로드
- 검토 메모: "curator now distinguishes transcript-derived vs AI-supplemented content with visual markers; new optional slots (procedure / argument / formula / timeline) emerge based on lecture type"
- 검토 대기

- [ ] **Step 4: 메모리 업데이트 (post-merge memory file)**

`/Users/guntak/.claude/projects/-Users-guntak-Lisna/memory/MEMORY.md` 에 한 줄 추가:
- `[CWS 0.1.50 submission YYYY-MM-DD](cws_submission_2026-05-XX.md) — curator provenance marking + 4 new optional slots`

상세 노트도 같은 디렉터리에 작성.

- [ ] **Step 5: 모든 변경 push 검토**

```bash
git log --oneline origin/docs/concept-prd..HEAD
```
Expected: 이 plan 의 모든 commit 들 (Phase A-H). push 여부는 사용자 확인.

---

## Self-Review (writing-plans 스킬 룰)

**Spec coverage check:** spec 의 각 섹션이 plan task 로 mapping 되어 있는가?

| Spec 섹션 | Plan task |
|---|---|
| §2 inference 범위 (B-보수) | Task 6 (프롬프트 룰), Task 13 (iteration) |
| §3.1 per-item provenance | Task 1, 3, 4 |
| §3.2 새 슬롯 4종 | Task 2, 3, 4 |
| §3.3 강의 type 별 추천 slot | Task 5 (프롬프트 표) |
| §4.1 slot emergence rule | Task 5 |
| §4.2-4.3 inference + paraphrase rules | Task 6 |
| §4.4 latency gate | Task 7 |
| §5.1 locked marker style | Task 14 |
| §5.2 새 슬롯 컴포넌트 | Task 16-19 |
| §5.3 hide-when-empty | Task 20 |
| §5.4-5.6 compact mode | Task 16 (StepList compact prop), Task 20 |
| §6.1 inferred callout | Task 21-22 |
| §6.2 HeadingSet 확장 | Task 21 |
| §6.3 새 슬롯 직렬화 | Task 23 |
| §7.1 새 axis (overall 가중치 유지) | Task 9-10 |
| §7.2 judge 프롬프트 보강 | Task 10 |
| §7.3 fixture 다양화 prereq | Task 12, 13 |
| §7.4 새 베이스라인 | Task 8 |
| §8.1 backward-compat | Task 3, 4 |
| §8.2 DB spike | **plan 작성 전 inline 으로 해소 (sessions.outline = JSONB 확인)** |
| §8.3 버전 범프 | Task 24 |
| §10 implementation order | Task 1-26 의 전체 순서 |
| §12 success criteria | Task 25 (검증) |

전 항목 cover 됨.

**Placeholder scan:**
- "TBD", "TODO", "implement later" — 없음
- "Add appropriate error handling" 류 — 없음
- "Similar to Task N" — 없음 (각 task 코드 명시)
- "Write tests for the above" — 없음 (각 테스트 코드 명시)

**Type consistency:**
- `Provenance` 타입 — Task 1, 2, 3, 4, 9 등에서 일관 사용
- 새 슬롯 인터페이스 이름 — `OutlineStep`, `OutlineChainLink`, `OutlineFormula`, `OutlineTimelineEvent` 으로 통일
- 컴포넌트 이름 — `StepList`, `ChainList`, `FormulaList`, `TimelineList` 통일
- 슬롯 필드 이름 — `procedure_steps`, `argument_chain`, `formula`, `timeline` 통일

**Open assumption: `extension/src/shared/curator-types`**
사이드패널 컴포넌트들이 import 할 타입 위치를 가정. 실제로는 `shared` workspace (memory: shared types in workspace) 의 타입 또는 backend curator types 를 직접 import. 첫 task 실행 시 어느 쪽이 표준인지 확인 후 import 경로 통일. (이 부분은 *type consistency 검증을 가로지르는* 항목이라 plan 의 Task 16-20 에서 해결.)

---

## 실행 인계

**Plan complete and saved to `docs/superpowers/plans/2026-05-15-curator-provenance-and-typed-slots.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 각 task 마다 fresh subagent dispatch + task 사이 review, 빠른 iteration. complex spec 이라 추천.

**2. Inline Execution** — 이 세션 내에서 executing-plans 스킬로 batch 실행 + checkpoint review.

**Which approach?**

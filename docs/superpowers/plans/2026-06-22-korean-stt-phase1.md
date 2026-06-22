# Korean STT — Phase 1 (transcription-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users record and transcribe Korean (`ko`) speech end to end, with the output restricted to the existing raw-transcript view — no structured notes for `ko` (deferred to Phase 2 behind an eval gate).

**Architecture:** The pipeline is already language-parametric; `ko` is blocked only at the `session/start` entry gate and is not policy-restricted from notes. Introduce one shared `languageCapabilities(lang)` policy, unblock `ko` for transcription at the gate, add a server-side guard that refuses `ko` *note* finalize, and restrict the post-Stop picker to transcript-only for `ko`.

**Tech Stack:** Electron + TypeScript, React renderer, Vitest, whisper.cpp sidecar (multilingual `large-v3-turbo`).

**Spec:** `docs/superpowers/specs/2026-06-22-korean-stt-phase1-design.md` (reviewer-confirmed).

## Global Constraints

- **Base branch:** `feat/v2-ko-stt`, stacked on `feat/stt-finalize-transcription` (PR #134). Do NOT rebase onto `main` (main lacks the transcript-output mode).
- **No real-LLM / no zombies:** NEVER run `pnpm test`/`pnpm verify`/`pnpm dev` or any `spikes/**` / `scripts/note-loop-run.ts` command. Run ONLY scoped vitest on explicit file paths (`pnpm --filter @lisna/desktop exec vitest run <file>`). The desktop vitest config already excludes `spikes/**`. After any test run, `pgrep -fl "llama-completion|desktop/resources/sidecar"` and `pkill -9` survivors.
- **Verify before commit:** `pnpm --filter @lisna/desktop typecheck` (exit 0) + `pnpm --filter @lisna/desktop exec eslint <changed files>` (exit 0) + the task's scoped tests, before each commit.
- **STT engine needs NO change:** `whisper-cpp-stt.ts loadModel(path, language: Language)` already forwards `ko` to the sidecar, and the sidecar passes `--language` verbatim (`whisper_engine.cpp`). Once the gate admits `ko`, transcription works. Do not edit STT engine or sidecar.
- **Types:** `Language = 'ja'|'en'|'ko'|'zh'` (`src/shared/types.ts`); `NoteLanguage = 'ja'|'en'|'ko'` (`src/shared/note-schema/base.ts`).
- **Conventional commits:** `feat(ko-stt): …` / `test(ko-stt): …`, subject ≤ 72 chars.

---

## File structure

| File | Responsibility |
|---|---|
| `src/shared/language-capabilities.ts` (create) | Single policy: `languageCapabilities(lang) → {transcript, notes}`. Phase-2 flip = one line. |
| `src/shared/__tests__/language-capabilities.test.ts` (create) | Unit tests for the policy. |
| `src/main/ipc.ts` (modify ~768-771, ~576) | Gate uses `languageCapabilities(...).transcript`; fix stale comment. |
| `src/main/sidecar/ipc/session-finalize.ts` (modify `routeFamily` ~192) | Reject note finalize when `!languageCapabilities(lang).notes`. |
| `src/renderer/i18n/error-message-map.ts` (modify) | Add `NOTES_NOT_SUPPORTED_FOR_LANGUAGE` code + JA copy. |
| `src/renderer/routes/Recording.tsx` (modify ~49, ~246) | `ko`-aware localStorage init + add `한국어` radio. |
| `src/renderer/components/FamilyPickerStep.tsx` (modify) | `language` prop; when `!notes`, render transcript-only + hint, default `transcript`. |
| `src/renderer/App.tsx` (modify ~308) | Pass session `language` to `FamilyPickerStep`. |

---

### Task 1: `languageCapabilities` policy seam

**Files:**
- Create: `src/shared/language-capabilities.ts`
- Test: `src/shared/__tests__/language-capabilities.test.ts`

**Interfaces:**
- Produces: `interface LanguageCapabilities { transcript: boolean; notes: boolean }` and `function languageCapabilities(lang: string): LanguageCapabilities`. Unknown/garbage → `{transcript:false, notes:false}`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/shared/__tests__/language-capabilities.test.ts
import { describe, it, expect } from 'vitest';
import { languageCapabilities } from '../language-capabilities';

describe('languageCapabilities', () => {
  it('ja/en support both transcript and notes', () => {
    expect(languageCapabilities('ja')).toEqual({ transcript: true, notes: true });
    expect(languageCapabilities('en')).toEqual({ transcript: true, notes: true });
  });
  it('ko is transcript-only in Phase 1 (notes deferred)', () => {
    expect(languageCapabilities('ko')).toEqual({ transcript: true, notes: false });
  });
  it('zh and unknown codes are fully unsupported', () => {
    expect(languageCapabilities('zh')).toEqual({ transcript: false, notes: false });
    expect(languageCapabilities('xx')).toEqual({ transcript: false, notes: false });
    expect(languageCapabilities('')).toEqual({ transcript: false, notes: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lisna/desktop exec vitest run src/shared/__tests__/language-capabilities.test.ts`
Expected: FAIL — cannot find module `../language-capabilities`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/shared/language-capabilities.ts
import type { Language } from './types';

/** What a language is allowed to produce. Phase 1: ko = transcription only;
 *  flipping ko.notes to true is the entire Phase-2 enablement once 3B Korean
 *  note quality is eval-proven. */
export interface LanguageCapabilities {
  transcript: boolean;
  notes: boolean;
}

const CAPABILITIES: Record<Language, LanguageCapabilities> = {
  ja: { transcript: true, notes: true },
  en: { transcript: true, notes: true },
  ko: { transcript: true, notes: false }, // Phase 1: transcription-only
  zh: { transcript: false, notes: false }, // valid type, unsupported
};

const NONE: LanguageCapabilities = { transcript: false, notes: false };

/** IPC payloads are un-typed JSON, so accept `string` and fall back to NONE
 *  for any unknown code (keeps the entry gate rejecting garbage). */
export function languageCapabilities(lang: string): LanguageCapabilities {
  return CAPABILITIES[lang as Language] ?? NONE;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lisna/desktop exec vitest run src/shared/__tests__/language-capabilities.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/language-capabilities.ts src/shared/__tests__/language-capabilities.test.ts
git commit -m "feat(ko-stt): languageCapabilities policy seam"
```

---

### Task 2: Unblock `ko` at the `session/start` entry gate

**Files:**
- Modify: `src/main/ipc.ts:768-771` (the gate) and `:576` (stale comment)
- Test: `src/main/__tests__/ipc.test.ts`

**Interfaces:**
- Consumes: `languageCapabilities` (Task 1).

**Current code (`ipc.ts:768-771`):**
```typescript
    // Minimal EN support (2026-06-10): ja + en accepted. ko/zh stay gated —
    // prompts are adapted via renderSystemTemplate but un-eval'd, and the
    // bundled STT models cover ja (kotoba) / multilingual (large-v3-turbo).
    if (language !== 'ja' && language !== 'en') throw new Error('UNSUPPORTED_LANGUAGE');
```

- [ ] **Step 1: Write the failing test**

Add to `src/main/__tests__/ipc.test.ts`, following the existing `ipcHandlers['session/start']!({}, { language: 'ja' })` harness pattern (see the `double session/start` test for the surrounding setup/mocks to copy):

```typescript
it('session/start accepts ko (transcription) and still rejects zh/unknown', async () => {
  // (reuse the same beforeEach harness as the other session/start tests)
  await expect(ipcHandlers['session/start']!({}, { language: 'ko' })).resolves.toBeUndefined();
  // reset session between calls exactly as the 'session/discard clears' test does:
  await ipcHandlers['session/discard']!({}, undefined);
  await expect(ipcHandlers['session/start']!({}, { language: 'zh' })).rejects.toThrow('UNSUPPORTED_LANGUAGE');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/__tests__/ipc.test.ts -t 'accepts ko'`
Expected: FAIL — `ko` currently throws `UNSUPPORTED_LANGUAGE`.

- [ ] **Step 3: Write minimal implementation**

```typescript
    // ja + en: full notes. ko: transcription-only (notes deferred to Phase 2,
    // see languageCapabilities). zh + unknown codes stay rejected.
    if (!languageCapabilities(language).transcript) throw new Error('UNSUPPORTED_LANGUAGE');
```

Add the import at the top of `ipc.ts`:
```typescript
import { languageCapabilities } from '@shared/language-capabilities';
```

Fix the now-stale comment at `ipc.ts:576`:
```typescript
        // orch.language is one of ja/en/ko — all valid NoteLanguage values.
        // (ko reaches here only on a note finalize, which Task 3 rejects.)
        language: orch.language as NoteLanguage,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/__tests__/ipc.test.ts`
Expected: PASS (new test + all existing).

- [ ] **Step 5: typecheck + commit**

```bash
pnpm --filter @lisna/desktop typecheck
git add src/main/ipc.ts src/main/__tests__/ipc.test.ts
git commit -m "feat(ko-stt): admit ko at session/start gate (transcription)"
```

---

### Task 3: Server-side guard — refuse `ko` note finalize

**Files:**
- Modify: `src/main/sidecar/ipc/session-finalize.ts` (`routeFamily`, ~187-223)
- Test: `src/main/sidecar/ipc/__tests__/session-finalize.test.ts`

**Interfaces:**
- Consumes: `languageCapabilities` (Task 1). `routeFamily` already has `session.language`.

Rationale: the live `session/finalize` family path has NO language gate today (`routeFamily` passes `session.language` straight into the family finalizers). Unblocking the gate (Task 2) would otherwise let a `ko` session generate an un-eval'd Korean note. This guard is the server-side backstop behind the picker UX (Task 6). The from-dump path is already covered by `dump-finalize-context.ts:44` — leave it.

- [ ] **Step 1: Write the failing test**

Add to `src/main/sidecar/ipc/__tests__/session-finalize.test.ts`, mirroring the existing `register(getCurrentSession)` helper + the case-(g) UNKNOWN_FAMILY pattern. Build a SessionContext fixture identical to the existing ones but with `language: 'ko'`:

```typescript
it('rejects a ko note finalize with NOTES_NOT_SUPPORTED_FOR_LANGUAGE', async () => {
  const koSession = { ...baseSessionFixture, language: 'ko' as const };
  const handler = register(() => koSession); // same helper the other tests use
  await expect(
    handler({}, { family: 'lecture' }),
  ).rejects.toThrow('NOTES_NOT_SUPPORTED_FOR_LANGUAGE');
});
```
(Use the same SessionContext shape the file's other tests construct — copy one and set `language: 'ko'`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/ipc/__tests__/session-finalize.test.ts -t 'ko note finalize'`
Expected: FAIL — no guard, so it proceeds into family routing.

- [ ] **Step 3: Write minimal implementation**

At the top of `routeFamily` (right after the opening brace, before `adaptToV2Transcript`):
```typescript
  // Phase-1 backstop: ko (and any non-notes language) must not generate a
  // structured note. The picker UX (renderer) already restricts ko to
  // transcript; this is the server-side guard for direct-IPC / future callers.
  if (!languageCapabilities(session.language).notes) {
    throw new Error('NOTES_NOT_SUPPORTED_FOR_LANGUAGE');
  }
```
Add the import:
```typescript
import { languageCapabilities } from '@shared/language-capabilities';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lisna/desktop exec vitest run src/main/sidecar/ipc/__tests__/session-finalize.test.ts`
Expected: PASS (new test + all existing; ja/en finalize unaffected).

- [ ] **Step 5: typecheck + commit**

```bash
pnpm --filter @lisna/desktop typecheck
git add src/main/sidecar/ipc/session-finalize.ts src/main/sidecar/ipc/__tests__/session-finalize.test.ts
git commit -m "feat(ko-stt): refuse ko note finalize (server-side backstop)"
```

---

### Task 4: Error copy for the new code

**Files:**
- Modify: `src/renderer/i18n/error-message-map.ts`
- Test: `src/renderer/i18n/__tests__/error-message-map.test.ts`

**Interfaces:**
- Produces: `NOTES_NOT_SUPPORTED_FOR_LANGUAGE` in `ALL_ERROR_CODES` + a JA message.

- [ ] **Step 1: Write the failing test**

Follow the existing test's pattern (it asserts every code in `ALL_ERROR_CODES` has a message). Add:
```typescript
it('NOTES_NOT_SUPPORTED_FOR_LANGUAGE has JA copy', () => {
  expect(ERROR_MESSAGES['NOTES_NOT_SUPPORTED_FOR_LANGUAGE']).toBeTruthy();
});
```
(Use the actual exported map name in the file — open it; it is the `Record` keyed by code. If the existing test already iterates `ALL_ERROR_CODES`, simply adding the code in Step 3 makes that test fail first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lisna/desktop exec vitest run src/renderer/i18n/__tests__/error-message-map.test.ts`
Expected: FAIL — code/message missing.

- [ ] **Step 3: Write minimal implementation**

Add `'NOTES_NOT_SUPPORTED_FOR_LANGUAGE'` to the `ALL_ERROR_CODES` array, and a JA message in the message map matching the file's style (retry-or-explain tone), e.g.:
```typescript
  NOTES_NOT_SUPPORTED_FOR_LANGUAGE:
    'この言語ではノート生成にまだ対応していません。文字起こしをご利用ください。',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lisna/desktop exec vitest run src/renderer/i18n/__tests__/error-message-map.test.ts`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/renderer/i18n/error-message-map.ts src/renderer/i18n/__tests__/error-message-map.test.ts
git commit -m "feat(ko-stt): JA copy for NOTES_NOT_SUPPORTED_FOR_LANGUAGE"
```

---

### Task 5: Korean language radio + `ko`-aware persistence

**Files:**
- Modify: `src/renderer/routes/Recording.tsx:49` (init) and `:246` (after the English radio)
- Test: `src/renderer/routes/__tests__/Recording.test.tsx` (create if absent; otherwise add a case)

**Current init (`Recording.tsx:49`):**
```typescript
    () => (localStorage.getItem('lisna.language') === 'en' ? 'en' : 'ja'),
```
This coerces ANY non-`'en'` value (including a persisted `'ko'`) back to `'ja'` on reload — must be fixed or `ko` silently reverts.

- [ ] **Step 1: Write the failing test**

```typescript
// Recording renders a ko radio and a persisted 'ko' survives init.
import { renderToStaticMarkup } from 'react-dom/server';
// ...mirror the existing Recording test harness (mock window.lisna, localStorage)...
it('offers a Korean (ko) language radio', () => {
  const html = renderToStaticMarkup(<Recording /* required props */ />);
  expect(html).toContain('value="ko"');
  expect(html).toContain('한국어');
});
```
(If `Recording.test.tsx` does not exist, model the harness on `FamilyPickerStep.test.tsx` — `renderToStaticMarkup` of the component. Recording may need props/context; stub the minimum, or test the init function by extracting it — see Step 3 note.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lisna/desktop exec vitest run src/renderer/routes/__tests__/Recording.test.tsx`
Expected: FAIL — no `ko` radio.

- [ ] **Step 3: Write minimal implementation**

Fix init (line 49):
```typescript
    () => {
      const v = localStorage.getItem('lisna.language');
      return v === 'en' || v === 'ko' ? v : 'ja';
    },
```
Add the radio after the English `<label>` (after line 246):
```tsx
        <label>
          <input
            type="radio"
            name="language"
            value="ko"
            checked={language === 'ko'}
            onChange={() => { setLanguage('ko'); localStorage.setItem('lisna.language', 'ko'); }}
          />
          한국어
        </label>
```
(`language`'s `useState<Language>` already permits `'ko'` — `Language` includes it. If the local state type is narrowed to `'ja'|'en'`, widen it to `Language` from `@shared/types`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lisna/desktop exec vitest run src/renderer/routes/__tests__/Recording.test.tsx`
Expected: PASS.

- [ ] **Step 5: typecheck + commit**

```bash
pnpm --filter @lisna/desktop typecheck
git add src/renderer/routes/Recording.tsx src/renderer/routes/__tests__/Recording.test.tsx
git commit -m "feat(ko-stt): Korean language radio + ko-aware persistence"
```

---

### Task 6: `FamilyPickerStep` — transcript-only for `ko`

**Files:**
- Modify: `src/renderer/components/FamilyPickerStep.tsx`
- Test: `src/renderer/components/__tests__/FamilyPickerStep.test.tsx`

**Interfaces:**
- Consumes: `languageCapabilities` (Task 1).
- Produces: new optional prop `language?: string` on `FamilyPickerStep`. When `languageCapabilities(language).notes === false`, only the transcript choice renders and is pre-selected.

- [ ] **Step 1: Write the failing tests**

```typescript
it('with language=ko, shows only the transcript option (no note families)', () => {
  const html = renderToStaticMarkup(
    <FamilyPickerStep language="ko" onPick={() => {}} onDiscard={() => {}} />,
  );
  expect(html).toContain('data-testid="family-radio-transcript"');
  expect(html).not.toContain('data-testid="family-radio-lecture"');
  expect(html).not.toContain('data-testid="family-radio-meeting"');
  expect(html).toContain('coming soon'); // ko-notes hint
});

it('with language=ja, shows all 4 families + transcript (unchanged)', () => {
  const html = renderToStaticMarkup(
    <FamilyPickerStep language="ja" onPick={() => {}} onDiscard={() => {}} />,
  );
  expect(html).toContain('data-testid="family-radio-lecture"');
  expect(html).toContain('data-testid="family-radio-transcript"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lisna/desktop exec vitest run src/renderer/components/__tests__/FamilyPickerStep.test.tsx -t 'language=ko'`
Expected: FAIL — `language` prop ignored; all families render.

- [ ] **Step 3: Write minimal implementation**

In `FamilyPickerStep.tsx`:
- Add import: `import { languageCapabilities } from '@shared/language-capabilities';`
- Extend `Props`: `language?: string;`
- Destructure with default: `function FamilyPickerStep({ onPick, onDiscard, showTranscript = true, language = 'ja' }: Props)`
- Compute: `const notesAllowed = languageCapabilities(language).notes;`
- Initial selection: `const [selected, setSelected] = useState<PickChoice>(notesAllowed ? 'lecture' : 'transcript');`
- When `!notesAllowed`: render ONLY the transcript option + a hint, and skip the `FAMILIES` list. Concretely, gate the families `<ul>`:
```tsx
      {notesAllowed && (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {FAMILIES.map((f) => (
            <li key={f.id} style={{ marginBottom: 12 }}>{renderOption(f)}</li>
          ))}
        </ul>
      )}
      {!notesAllowed && (
        <p style={{ color: '#888', fontSize: 13 }}>
          この言語では文字起こしのみ対応しています（ノート生成は近日対応 / coming soon）。
        </p>
      )}
```
- Force `showTranscript` on when `!notesAllowed` so the transcript option always renders: in the transcript block condition, use `{(showTranscript || !notesAllowed) && ( … )}`. (When `!notesAllowed`, also drop the 「またはノートにせず」 caption — it implies a note alternative that doesn't exist; render the transcript option without that caption.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lisna/desktop exec vitest run src/renderer/components/__tests__/FamilyPickerStep.test.tsx`
Expected: PASS (new + existing; ja path unchanged).

- [ ] **Step 5: typecheck + lint + commit**

```bash
pnpm --filter @lisna/desktop typecheck
pnpm --filter @lisna/desktop exec eslint src/renderer/components/FamilyPickerStep.tsx
git add src/renderer/components/FamilyPickerStep.tsx src/renderer/components/__tests__/FamilyPickerStep.test.tsx
git commit -m "feat(ko-stt): FamilyPickerStep transcript-only for ko"
```

---

### Task 7: Wire session language into `FamilyPickerStep`

**Files:**
- Modify: `src/renderer/App.tsx:308` (the `familyPicking` render)

**Interfaces:**
- Consumes: `FamilyPickerStep`'s `language` prop (Task 6).

The recorded session's language is the value the user picked in `Recording.tsx`, persisted at `localStorage('lisna.language')` and unchanged during `familyPicking`. Read it the same coercion-correct way as Task 5.

- [ ] **Step 1: Write the failing test**

App-level render of the `familyPicking` state is heavier to harness. If `App.test.tsx` already exercises view states, add a case asserting the picker receives `language`. Otherwise, this task's behavior is covered by Task 6's component tests + a manual check; record that explicitly here and rely on typecheck. Add (if an App harness exists):
```typescript
it('passes the persisted ko language to FamilyPickerStep', () => {
  localStorage.setItem('lisna.language', 'ko');
  // drive App into familyPicking per the existing harness, then assert the
  // rendered picker shows transcript-only (no lecture radio).
});
```

- [ ] **Step 2: Run test to verify it fails (if a harness exists)**

Run: `pnpm --filter @lisna/desktop exec vitest run src/renderer/__tests__/App.test.tsx`
Expected: FAIL (picker shows families because language not passed) — or N/A if no App harness; then verify via typecheck only.

- [ ] **Step 3: Write minimal implementation**

At `App.tsx:308`, pass the language:
```tsx
        <FamilyPickerStep
          language={(() => {
            const v = localStorage.getItem('lisna.language');
            return v === 'en' || v === 'ko' ? v : 'ja';
          })()}
          onDiscard={() => { /* unchanged */ }}
          onPick={(choice) => { /* unchanged */ }}
        />
```
(Note: the `onPick` `choice === 'transcript'` branch already exists and runs `runTranscribe` — no change needed; for `ko` the picker can only emit `'transcript'`.)

- [ ] **Step 4: Verify**

Run: `pnpm --filter @lisna/desktop typecheck` (exit 0) and the App test if present.
Expected: PASS / exit 0.

- [ ] **Step 5: lint + commit**

```bash
pnpm --filter @lisna/desktop exec eslint src/renderer/App.tsx
git add src/renderer/App.tsx src/renderer/__tests__/App.test.tsx
git commit -m "feat(ko-stt): pass session language to FamilyPickerStep"
```

---

### Task 8: Full scoped verification + zombie sweep

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + lint the package**

```bash
pnpm --filter @lisna/desktop typecheck
pnpm --filter @lisna/desktop exec eslint src
```
Expected: both exit 0.

- [ ] **Step 2: Scoped test sweep (no real LLM)**

```bash
pnpm --filter @lisna/desktop exec vitest run \
  src/shared/__tests__/language-capabilities.test.ts \
  src/main/__tests__/ipc.test.ts \
  src/main/sidecar/ipc/__tests__/session-finalize.test.ts \
  src/renderer/i18n/__tests__/error-message-map.test.ts \
  src/renderer/components/__tests__/FamilyPickerStep.test.tsx \
  src/renderer/routes/__tests__/Recording.test.tsx
```
Expected: all PASS.

- [ ] **Step 3: Zombie sweep**

```bash
pgrep -fl "llama-completion|llama-cli|whisper-cli|desktop/resources/sidecar|vitest" || echo "NO_ZOMBIES"
```
Expected: NO_ZOMBIES (pkill -9 any survivor).

---

## Manual acceptance (post-implementation — founder-gated)

Claude cannot record audio. After the code lands, acceptance is:

1. Build/run the app (light rebuild path); select 한국어; record a short Korean clip (mic and/or system audio); Stop → the picker offers ONLY 文字起こし; run it → `TranscriptView` shows the Korean transcript.
2. Founder commits a corrected reference transcript as a CER fixture under `desktop/eval/fixtures/` (`ko` slot). Agree the bar then (default: proper-noun errors == 0 / a CER margin, mirroring the JA STT gate).
3. Confirm a `ko` session can NOT produce a structured note (picker has no families; direct `session/finalize` with a family throws `NOTES_NOT_SUPPORTED_FOR_LANGUAGE`).

## Phase 2 (separate spec, founder-gated)

Build a Korean note eval fixture + run the offline-3b loop (`scripts/note-loop-run.ts`, FOREGROUND/zombie-kill) to measure the existing `ko` Korean-prompt-override note quality. If it clears the bar: flip `languageCapabilities('ko').notes = true` (Task 1) — the gate, finalize guard, and picker all follow automatically.

## Self-review

- **Spec coverage:** entry gate (Task 2), transcript output already exists on #134, finalize guard (Task 3), picker transcript-only (Tasks 6-7), language picker + persistence (Task 5), error i18n (Task 4), `languageCapabilities` seam (Task 1), segment-filters `ko` already present (no task), STT unchanged (Global Constraints). Acceptance + Phase 2 documented. All spec sections mapped.
- **Placeholders:** none — Tasks 5/7 flag that a renderer harness may need to be created and give the fallback (model on `FamilyPickerStep.test.tsx`); this is a real instruction, not a TODO.
- **Type consistency:** `languageCapabilities(lang: string)` used identically in Tasks 2/3/6; `NOTES_NOT_SUPPORTED_FOR_LANGUAGE` defined in Task 3 (thrown) + Task 4 (copy); `Language` import path `@shared/types` consistent.

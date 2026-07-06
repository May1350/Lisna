# Auto-register glossary from transcript edits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-register the proper nouns from a transcript edit to the glossary (no confirm tap), with a persistent reversible "added" banner, so the next recording's STT biases toward the corrected spellings.

**Architecture:** A new pure-ish renderer helper `autoRegisterGlossaryFromEdit` (injected glossary IPC deps → testable) runs the existing `suggestGlossaryTerms` extractor and appends its output to the glossary. The existing confirm banner `GlossarySuggestions` flips to an "added + undo" banner (`GlossaryAdded`). Both transcript edit-save sites call the helper then render the banner. Extractor, glossary store, IPC, and STT path are UNCHANGED.

**Tech Stack:** Electron React renderer, TypeScript, Vitest (`renderToStaticMarkup`, no DOM env), existing `@shared/stt/glossary` + `window.lisna.getGlossary/setGlossary` IPC.

## Global Constraints

- Version bump: `desktop/package.json` `0.1.38` → `0.1.39` (last task).
- `suggestGlossaryTerms` / `extractProperNounRuns` / `normalizeGlossary` / `buildInitialPrompt` (`desktop/src/shared/stt/glossary.ts`) and the glossary store + `glossary/get`/`glossary/set` IPC are UNCHANGED. Glossary stays STT-only (`initial_prompt`), never fed to the note LLM.
- Auto-add is BEST-EFFORT: the transcript edit is already saved; a glossary write failure must NOT throw and must NOT show a banner claiming a term was added (only show terms confirmed present in `setGlossary`'s returned list).
- Renderer logic lives in plain modules with INJECTED deps (this package's vitest has NO DOM env); component tests use `renderToStaticMarkup`.
- JA-only user copy, polite desu/masu.
- Run tests FOREGROUND only, scoped (never background).

---

### Task 1: `autoRegisterGlossaryFromEdit` helper

**Files:**
- Create: `desktop/src/renderer/lib/glossary-auto.ts`
- Test: `desktop/src/renderer/lib/__tests__/glossary-auto.test.ts`

**Interfaces:**
- Consumes: `suggestGlossaryTerms` from `@shared/stt/glossary`.
- Produces:
  ```ts
  export interface GlossaryEditDeps {
    getGlossary: () => Promise<string[]>;
    setGlossary: (terms: string[]) => Promise<string[]>;  // returns the normalized saved list
  }
  export function autoRegisterGlossaryFromEdit(
    pairs: readonly { before: string; after: string }[],
    deps: GlossaryEditDeps,
  ): Promise<string[]>;  // terms actually added (⊆ what setGlossary persisted); [] on none/failure
  ```

- [ ] **Step 1: Write failing tests** (`glossary-auto.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';
import { autoRegisterGlossaryFromEdit } from '../glossary-auto';

const pair = (before: string, after: string) => ({ before, after });

it('appends a new proper noun and returns it', async () => {
  const set = vi.fn(async (terms: string[]) => terms);
  const added = await autoRegisterGlossaryFromEdit(
    [pair('アグリック', 'アグリテック')],
    { getGlossary: async () => [], setGlossary: set },
  );
  expect(added).toEqual(['アグリテック']);
  expect(set).toHaveBeenCalledWith(['アグリテック']);
});

it('no new proper noun → does NOT call setGlossary, returns []', async () => {
  const set = vi.fn(async (t: string[]) => t);
  const added = await autoRegisterGlossaryFromEdit(
    [pair('マイク', 'マイクのテストです')],  // no NEW katakana/Latin run
    { getGlossary: async () => [], setGlossary: set },
  );
  expect(added).toEqual([]);
  expect(set).not.toHaveBeenCalled();
});

it('already-glossed term is not re-added', async () => {
  const set = vi.fn(async (t: string[]) => t);
  const added = await autoRegisterGlossaryFromEdit(
    [pair('アグリック', 'アグリテック')],
    { getGlossary: async () => ['アグリテック'], setGlossary: set },
  );
  expect(added).toEqual([]);
  expect(set).not.toHaveBeenCalled();
});

it('returns only terms actually persisted (cap drops overflow)', async () => {
  const set = vi.fn(async () => ['iOS']);  // setGlossary echoes only iOS (cap)
  const added = await autoRegisterGlossaryFromEdit(
    [pair('アイオーエス アンドロイド', 'iOS Android')],
    { getGlossary: async () => [], setGlossary: set },
  );
  expect(added).toEqual(['iOS']);  // 'Android' extracted but not in saved list
});

it('setGlossary throws → returns [], no throw escapes', async () => {
  const added = await autoRegisterGlossaryFromEdit(
    [pair('アグリック', 'アグリテック')],
    { getGlossary: async () => [], setGlossary: async () => { throw new Error('disk'); } },
  );
  expect(added).toEqual([]);
});
```

- [ ] **Step 2: Run — verify fail.** `cd desktop && npx vitest run src/renderer/lib/__tests__/glossary-auto.test.ts` → FAIL (module/function undefined).

- [ ] **Step 3: Implement `glossary-auto.ts`:**
```ts
import { suggestGlossaryTerms } from '@shared/stt/glossary';

export interface GlossaryEditDeps {
  getGlossary: () => Promise<string[]>;
  setGlossary: (terms: string[]) => Promise<string[]>;
}

/**
 * Extract new proper nouns from transcript edit before→after pairs and
 * auto-append them to the glossary (no confirm). Returns the terms actually
 * persisted — best-effort: the edit is already saved, so a glossary write
 * failure resolves to [] rather than throwing.
 */
export async function autoRegisterGlossaryFromEdit(
  pairs: readonly { before: string; after: string }[],
  deps: GlossaryEditDeps,
): Promise<string[]> {
  try {
    const existing = await deps.getGlossary();
    const terms = suggestGlossaryTerms(pairs, existing);
    if (terms.length === 0) return [];
    const saved = await deps.setGlossary([...existing, ...terms]);
    return terms.filter((t) => saved.includes(t));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run — verify pass.** `cd desktop && npx vitest run src/renderer/lib/__tests__/glossary-auto.test.ts && npx tsc -p tsconfig.json --noEmit` → 5 pass, tsc clean.

- [ ] **Step 5: Commit** — `git add -A desktop/src/renderer/lib/glossary-auto.ts desktop/src/renderer/lib/__tests__/glossary-auto.test.ts && git commit -m "feat(desktop): autoRegisterGlossaryFromEdit — append edit proper-nouns"`

---

### Task 2: `GlossaryAdded` banner (flip `GlossarySuggestions`)

**Files:**
- Create: `desktop/src/renderer/components/GlossaryAdded.tsx`
- Delete: `desktop/src/renderer/components/GlossarySuggestions.tsx` (+ any test) — replaced
- Test: `desktop/src/renderer/components/__tests__/GlossaryAdded.test.tsx`

**Interfaces:**
- Produces: `GlossaryAdded({ added, onClose }: { added: string[]; onClose: () => void })` — shows the already-added terms with per-term ✕ remove + remove-all; removes via `window.lisna.getGlossary/setGlossary`.

- [ ] **Step 1: Write failing test** (`renderToStaticMarkup`):

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { GlossaryAdded } from '../GlossaryAdded';
it('renders added terms + heading + remove-all', () => {
  const html = renderToStaticMarkup(<GlossaryAdded added={['アグリテック', 'iOS']} onClose={() => {}} />);
  expect(html).toContain('追加しました');
  expect(html).toContain('アグリテック');
  expect(html).toContain('glossary-added');       // data-testid
  expect(html).toContain('すべて取り消す');
});
it('empty added → renders nothing', () => {
  expect(renderToStaticMarkup(<GlossaryAdded added={[]} onClose={() => {}} />)).toBe('');
});
```

- [ ] **Step 2: Run — verify fail.** `cd desktop && npx vitest run src/renderer/components/__tests__/GlossaryAdded.test.tsx` → FAIL.

- [ ] **Step 3: Implement `GlossaryAdded.tsx`** (mirror the old `GlossarySuggestions` styling — same `.lz-tag`, `--lz-*` tokens, in-flow persistent banner — but semantics flipped to "added + undo"):
```tsx
import { useState } from 'react';

interface Props {
  /** Terms just auto-added to the glossary (autoRegisterGlossaryFromEdit result). */
  added: string[];
  onClose: () => void;
}

/**
 * Persistent "added to glossary" banner. Transcript-edit proper nouns are
 * auto-registered (no confirm); this shows what was added and lets the user
 * undo a wrong one (a bad term would bias future STT). JA-locked work surface.
 */
export function GlossaryAdded({ added, onClose }: Props) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  if (added.length === 0) return null;
  const active = added.filter((t) => !removed.has(t));

  async function remove(terms: string[]) {
    setBusy(true);
    try {
      const existing = await window.lisna.getGlossary();
      const drop = new Set(terms);
      await window.lisna.setGlossary(existing.filter((t) => !drop.has(t)));
      setRemoved((prev) => new Set([...prev, ...terms]));
    } catch {
      // best-effort: glossary already holds the term; leave it, user can use 用語集.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="glossary-added"
      role="region"
      aria-label="用語集に追加した語"
      style={{ marginTop: 16, padding: '12px 14px', border: '1px solid var(--lz-border)', borderRadius: 'var(--lz-radius)', background: 'var(--lz-surface)' }}
    >
      <p style={{ margin: '0 0 2px', fontSize: 13.5, fontWeight: 600 }}>用語集に追加しました</p>
      <p className="lz-hint" style={{ margin: '0 0 10px' }}>次回以降の文字起こしがこの表記に寄ります。不要なら取り消せます。</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {added.map((c) => (
          <span key={c} className="lz-tag" style={{ opacity: removed.has(c) ? 0.5 : 1, textDecoration: removed.has(c) ? 'line-through' : 'none' }}>
            {c}
            {!removed.has(c) && (
              <button className="lz-tag-x" onClick={() => void remove([c])} disabled={busy} aria-label={`${c} を取り消す`}>✕</button>
            )}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        {active.length > 1 && (
          <button onClick={() => void remove(active)} disabled={busy}>すべて取り消す</button>
        )}
        <button className="lz-primary" onClick={onClose} disabled={busy}>閉じる</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — verify pass.** `cd desktop && npx vitest run src/renderer/components/__tests__/GlossaryAdded.test.tsx && npx tsc -p tsconfig.json --noEmit` → pass + clean. (tsc will flag the now-orphaned `GlossarySuggestions` import sites — those are fixed in Task 3; if tsc fails ONLY on those two imports, that is expected here and resolved next task. To keep this task self-green, delete `GlossarySuggestions.tsx` + its test in THIS task and leave the imports for Task 3 — but then tsc fails on the dangling imports. Therefore: do Task 2 + Task 3's import swap together is tempting, but keep them separate by having Task 2 NOT delete `GlossarySuggestions.tsx` yet — create `GlossaryAdded` alongside; Task 3 swaps imports + deletes the old component. Adjust: in Task 2, do NOT delete `GlossarySuggestions.tsx`; only add `GlossaryAdded`. tsc stays clean.)

- [ ] **Step 5: Commit** — `git add -A desktop/src/renderer/components/GlossaryAdded.tsx desktop/src/renderer/components/__tests__/GlossaryAdded.test.tsx && git commit -m "feat(desktop): GlossaryAdded — auto-added banner with per-term undo"`

---

### Task 3: Wire both edit-save sites + remove old banner

**Files:**
- Modify: `desktop/src/renderer/routes/TranscriptView.tsx` (save handler ~42-64 + banner render ~97)
- Modify: `desktop/src/renderer/routes/History.tsx` (save handler ~52-73 + banner render ~126)
- Delete: `desktop/src/renderer/components/GlossarySuggestions.tsx` (+ its test if present)

**Interfaces:**
- Consumes: `autoRegisterGlossaryFromEdit` (Task 1), `GlossaryAdded` (Task 2).

- [ ] **Step 1:** In BOTH `TranscriptView.tsx` and `History.tsx`: replace the post-`saveTranscript` block that computed `suggestGlossaryTerms(...)` + `setSuggestions(...)` and rendered `<GlossarySuggestions candidates=... />`. New shape (re-read the live files for the exact `pairs` construction — keep the same `before/after` diff of changed segments):
  - state: `const [addedTerms, setAddedTerms] = useState<string[]>([]);` (replacing `suggestions`).
  - in `save()`, after `saveTranscript` succeeds:
    ```ts
    try {
      const pairs = local
        .map((s, i) => ({ before: segments[i]?.text ?? '', after: s.text }))
        .filter((p) => p.before !== p.after);
      const added = await autoRegisterGlossaryFromEdit(pairs, {
        getGlossary: window.lisna.getGlossary,
        setGlossary: window.lisna.setGlossary,
      });
      setAddedTerms(added);
    } catch { /* best-effort — helper already swallows, this guards the pairs build */ }
    ```
  - render: `{addedTerms.length > 0 && <GlossaryAdded added={addedTerms} onClose={() => setAddedTerms([])} />}` (same in-flow position the old banner used).
  - Update imports: drop `suggestGlossaryTerms` + `GlossarySuggestions`; add `autoRegisterGlossaryFromEdit` (from `../lib/glossary-auto`) + `GlossaryAdded`.
- [ ] **Step 2:** Delete `desktop/src/renderer/components/GlossarySuggestions.tsx` and its test file if one exists (`grep -rn "GlossarySuggestions" desktop/src` must return nothing after the import swap).
- [ ] **Step 3: Run** — `cd desktop && npx tsc -p tsconfig.json --noEmit && npx eslint src/renderer/routes/TranscriptView.tsx src/renderer/routes/History.tsx && npx vitest run src/` → tsc clean (no dangling `GlossarySuggestions`/`suggestGlossaryTerms`-unused refs), eslint clean, all tests pass (any old GlossarySuggestions test deleted). `pgrep -fl "llama-completion|vitest" || echo clean`.
- [ ] **Step 4: Commit** — `git commit -am "feat(desktop): auto-register glossary on transcript edit (both sites)"`

---

### Task 4: Version bump 0.1.39 + full verify

**Files:** Modify `desktop/package.json` version `0.1.38` → `0.1.39`.

- [ ] **Step 1:** Bump version.
- [ ] **Step 2:** `cd desktop && pnpm --filter @lisna/desktop typecheck && pnpm --filter @lisna/desktop lint && pnpm --filter @lisna/desktop test` (FOREGROUND) → all green; `pgrep -fl "llama-completion|vitest" || echo clean` → 0 orphans.
- [ ] **Step 3: Commit** — `git commit -am "chore(desktop): 0.1.39 — auto-register glossary from transcript edits"`

---

## Post-plan (operational, NOT plan tasks)
Rebuild `/Applications/Lisna.app` (skip build:sidecar) → founder edits a transcript proper noun → "用語集に追加しました" banner → next recording biases. Then push (pre-push gate) → optionally tag/release 0.1.39.

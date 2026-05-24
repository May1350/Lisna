---
name: i18n-check
description: Verify EN/JA/KO i18n consistency on the Lisna web marketing site (`web/`). Use after any UI text edit, before opening a PR that touches `web/src/**`, when reviewing a Dependabot or feature PR for accidental hardcoded strings, or when a user reports "language switching not working." Runs `web/scripts/check-i18n.mjs` and surfaces violations grouped by category. Also kicks off in pre-commit + CI for `web/**` changes.
---

# i18n consistency check (Lisna web)

This skill enforces the 3-language invariant on the marketing site:

> Every user-visible string is either translated in all three locales
> (`en` / `ja` / `ko`) or explicitly marked as a brand/tech token that
> never translates.

## When to invoke

ALWAYS run before reporting these tasks complete:
- Edits to anything under `web/src/app/[locale]/**` or `web/src/components/**`
- Edits to `web/src/messages/{en,ja,ko}.json`
- New marketing page / component / copy block
- Adding a new locale (re-run + add the locale to `routing.ts`, then re-run)
- Reviewing a PR that touches `web/**` and mentions UI / copy / translation

Also run as a sanity sweep when a user reports "the page doesn't change
language when I click EN/JA/KO."

## What it checks

1. **Key parity** (HARD FAIL) — every key in `en.json` exists in `ja.json` + `ko.json` and vice versa. Stray keys also fail.
2. **Value parity** (warn) — same value in `en` and `ja`/`ko` for a key, unless that key is allowlisted in `IDENTICAL_VALUES_OK` (`web/src/i18n/brand-vocabulary.ts`). Catches the common bug of "I copied en into ja.json and never localized."
3. **Hardcoded CJK in JSX** (warn) — any visible hiragana / katakana / kanji / hangul in a `.tsx` file under `web/src/app/` or `web/src/components/`, except: files allowlisted in `HARDCODED_OK_FILES`; lines that are `locale:` lookup keys; lines referencing `LOCALE_LABELS` / `LOCALE_SHORT` / `META_TITLE` / `META_DESC`; legal-page `<article lang="ja">` blocks (paired with an EN block in the same file).

Hardcoded English detection is intentionally NOT included — too many false
positives without AST parsing. Value parity (#2) catches the common
copy-paste-without-translation bug for English-source strings.

## How to run

From the repo root:

```bash
# Fast, warnings allowed
pnpm --filter lisna-web check:i18n

# Strict — treat warnings as failures (CI mode)
pnpm --filter lisna-web check:i18n:strict
```

Or directly:

```bash
node web/scripts/check-i18n.mjs [--strict]
```

## What to do with output

### Hard fails (always block)

- `messages/<locale>.json missing key: X.Y.Z` — add the key to that locale's
  file. Use the EN version as the source of truth; translate appropriately
  for JA / KO. Do NOT just copy the EN string.
- `messages/<locale>.json has stray key not in en: X.Y.Z` — either remove
  the stray key, or add it to `en.json` if it's intentionally a new key.
- `allowlist drift: ...` — the two allowlists (in `brand-vocabulary.ts` and
  `check-i18n.mjs`) are out of sync. Update whichever side is missing the
  entry. Both must match exactly.

### Warnings

- `value identical to en for "X"` — usually means a real translation gap.
  Translate the value. If it's intentional (brand / tech / punctuation),
  add the key path to `IDENTICAL_VALUES_OK` in BOTH `brand-vocabulary.ts`
  AND `check-i18n.mjs`. Always include a comment explaining WHY.
- `hardcoded CJK in <file>:<line>` — extract the string into the
  appropriate namespace in `messages/{en,ja,ko}.json` and reference via
  `useTranslations` / `getTranslations`. If the file is intentionally
  JA-only (Stripe callback, tokusho), add it to `HARDCODED_OK_FILES`.

## Adding new locales

The script keys off `LOCALES = ['en', 'ja', 'ko']` (hardcoded). When adding
a new locale:
1. Update `web/src/i18n/routing.ts` `locales` array.
2. Create `web/src/messages/<new>.json` (start by copying `en.json` then
   translating — `check-i18n` will catch any value left identical).
3. Update `LOCALE_LABELS` + `LOCALE_SHORT` in `brand-vocabulary.ts`.
4. Update `LOCALES` constant in this script (`check-i18n.mjs`).
5. Re-run `pnpm --filter lisna-web check:i18n:strict`.

## Brand vocabulary

Anything that should NEVER translate (product names, library names,
licenses, competitor names, currency symbols) lives in
`web/src/i18n/brand-vocabulary.ts` as named exports under `BRAND`. Import
from there in JSX rather than hardcoding the string. See that file's
header comment for the contract.

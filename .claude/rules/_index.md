# Rules index

Root `CLAUDE.md` carries the always-loaded top 20 rules. This directory
holds detailed rules Claude opens on-demand. When a session enters a
category (writing tests, touching the curator, etc.), open the matching
file.

| File | Contains | Open when |
|---|---|---|
| `architecture.md` | Module map, layering rules, abstraction guidance | Touching > 1 package or designing a new module |
| `domain.md` | Lisna-specific business / runtime invariants | Working on STT pipeline, curator, quota, slides, sessions |
| `pitfalls.md` | Battle scars — bugs we've already paid for | Before adding retries, timeouts, cross-frame messaging, audio sync |
| `testing.md` | Test conventions, fixture layout, eval baselines | Writing or modifying tests / eval scripts |
| `workflow.md` | PR / commit / branch / deploy / migration conventions | Opening a PR, writing a migration, deploying |
| `archived/` | Rules sunset by `/rules-sunset` (kept for git blame) | Rarely — only for historical lookup |

## Rule format

Each rule line follows this format so `/rules-sunset` and `/rules-compress` can parse them:

```
- [YYYY-MM-DD] (subcategory) <one-line rule>. Reason: <why>.
  last-cited: YYYY-MM-DD
```

- **`[YYYY-MM-DD]`** = date added.
- **`(subcategory)`** = optional finer tag (e.g. `(zod)`, `(pool)`).
- **Reason** = one clause explaining the failure mode this rule prevents. If you can't write a reason, the rule is probably noise.
- **`last-cited`** = updated by `/audit` when the rule is referenced in a PR description or applied during a session. 90 days untouched → archive candidate.

## Adding a rule

Always use `/learn "<insight>"`. The command:
1. Classifies the insight into a category.
2. Checks for duplicates / conflicts with existing rules.
3. Proposes a diff against the right file.
4. Never edits without showing the diff first.

Don't edit these files by hand — the audit tooling depends on the format.

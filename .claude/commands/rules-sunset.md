---
description: Move rules untouched > 90 days to archived/
argument-hint: "[optional --dry-run]"
---

# /rules-sunset

Archives rules whose `last-cited` date is older than 90 days from today.
Run monthly or when `/audit` reports stale rules.

## Steps

1. **Compute cutoff**: today − 90 days.

2. **Scan `.claude/rules/*.md`** (skip `archived/` and `_index.md`). For each rule line matching the format `[YYYY-MM-DD] ... last-cited: YYYY-MM-DD`:
   - If `last-cited` < cutoff → candidate for sunset.

3. **Build report**:
   ```
   Sunset candidates (last-cited < YYYY-MM-DD):

   architecture.md:
     - [2025-08-...] (subcat) ... — last-cited 2025-09-12 (256 days)
   pitfalls.md:
     - [2025-07-...] ... — last-cited 2025-08-04 (294 days)
   ```

4. **If `$ARGUMENTS` contains `--dry-run`**: print report and stop.

5. **Otherwise, for each candidate**: ask user `archive | keep (cite today) | delete entirely`.
   - **archive**: cut from source file, append to `archived/<source-file>.md` with `sunset: YYYY-MM-DD` line added.
   - **keep**: update `last-cited` on the rule in-place to today.
   - **delete**: cut entirely (use for rules that are no longer true, not just unused).

6. **Sanity report after**:
   ```
   Sunset run — YYYY-MM-DD
   Archived: N
   Kept (re-cited): N
   Deleted: N
   Files modified: <list>
   ```

## Archive format

In `.claude/rules/archived/<source>.md`:

```markdown
# Archived from <source>.md

- [2025-08-15] (cors) <original rule> — last-cited 2025-09-12. sunset: 2026-05-23. reason: superseded by post-Web-Store CORS lockdown becoming SOP.
```

The `reason:` field is required. If the user can't articulate why it's no longer needed, the rule probably should be KEPT (with `last-cited` refreshed), not archived.

Argument: $ARGUMENTS

---
description: Route a new insight to the right rules file (with diff preview)
argument-hint: "<insight in quotes>"
---

# /learn

You were just told (or just discovered) something worth remembering. Your
job is to file it in the right place WITHOUT bloating `CLAUDE.md`.

## Steps

1. **Classify** the insight into ONE of these buckets:
   - `architecture` → module layering, abstraction, bundling, cross-package
   - `domain` → Lisna-specific runtime invariant (audio, curator, quota, slides, sessions, auth)
   - `pitfalls` → a bug we paid for; a footgun future code might step on
   - `testing` → fixture, baseline, coverage convention
   - `workflow` → branch/commit/PR/migration/deploy convention
   - `top20` → ONLY if it's universally relevant (touches > 60% of sessions). Otherwise NO.

2. **Search for duplicates / conflicts** in the target file. Read the file first. If a rule already covers this, propose an UPDATE (refine wording, add a sub-case) instead of an APPEND. If two existing rules now disagree, flag it.

3. **Format** as:
   ```
   - [YYYY-MM-DD] (subcategory) <one-line rule>. Reason: <why>.
     last-cited: YYYY-MM-DD
   ```
   Date = today. `subcategory` is optional, lowercase, parenthesized. The rule MUST fit on one line in source (wrap visually only). Reason MUST exist — if you can't write it, the insight isn't actionable yet; ask the user for the failure mode.

4. **Show the diff** (use Edit tool with old_string = preceding line for placement, new_string = preceding line + new rule). DO NOT auto-commit. Print the diff and ask: "Add this rule? (y/n)".

5. **If `top20`** is suggested, ALSO check root `CLAUDE.md` line count after insertion. If > 150 lines, refuse and instead route to the appropriate detailed file + propose a `/rules-compress` pass on root.

6. **Update `last-cited`** on any existing rule you referenced while making this decision.

## Anti-patterns to refuse

- Insight that's just a restatement of code ("the function does X")
- One-off observation with no failure mode ("we used gpt-4o-mini today")
- Insight that contradicts an existing rule without explaining what changed
- Insight that's actually a TODO / backlog item (route to `/refactor-next` or `docs/REFACTOR_BACKLOG.md` instead)

## Output format

```
Classified as: <bucket>
Target file: .claude/rules/<file>.md
Duplicate check: <none | refining rule on line N | conflict with rule on line M>
Proposed diff:
<diff>
Add? (y/n)
```

Argument: $ARGUMENTS

---
name: Rule proposal
about: Propose adding / changing / archiving a Claude rule
title: "rule: "
labels: claude-rule
assignees: ''
---

## Type

- [ ] New rule
- [ ] Update existing rule (link line below)
- [ ] Archive (justify why no longer needed)

## Target file

- [ ] root `CLAUDE.md` (only if universally relevant — > 60% of sessions)
- [ ] `.claude/rules/architecture.md`
- [ ] `.claude/rules/domain.md`
- [ ] `.claude/rules/pitfalls.md`
- [ ] `.claude/rules/testing.md`
- [ ] `.claude/rules/workflow.md`

## Proposed rule

```
- [YYYY-MM-DD] (subcategory) <one-line rule>. Reason: <why>.
  last-cited: YYYY-MM-DD
```

## Reason (the "why")

What failure mode does this prevent? Concrete example or bug reference. If you can't write this, the rule isn't ready.

## Duplicate / conflict check

- Searched existing rules for: `<keyword>`
- Found: [none | rule at X.md line N → relationship is …]

## Acceptance

- [ ] Diff against target file in PR
- [ ] No new collision after review
- [ ] If `top20` → CLAUDE.md still ≤ 150 lines after merge

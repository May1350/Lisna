## Summary

One paragraph. What changes, why.

## Closes

- Backlog item: `docs/REFACTOR_BACKLOG.md` → <title>
- Issue: #<num>
- _OR_: ad-hoc fix (justify briefly)

## Test plan

- [ ] Concrete steps to verify
- [ ] ...

## Pitfall / invariant check

Walk through `.claude/rules/pitfalls.md` and `domain.md`. Any rules touched?

- [ ] None applicable
- [ ] Applied rule(s): <list — and how this PR honors them>

## New rules to propose?

If this PR uncovered a new invariant or pitfall, list `/learn` candidates:

- [ ] None
- [ ] Will run `/learn` after merge: <one-line each>

## Self-review

- [ ] CLAUDE.md ≤ 150 lines (if touched)
- [ ] Migration NNN monotonic (if touched)
- [ ] Tests added for new backend route / curator branch / withAuth change / cross-frame msg change
- [ ] HANDOFF.md updated if user-visible behavior changed
- [ ] No `.claude/settings.local.json` committed

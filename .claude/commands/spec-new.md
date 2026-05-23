---
description: Scaffold a new spec stub under docs/superpowers/specs/
argument-hint: "<name-in-kebab-case> [optional one-line goal]"
---

# /spec-new

Creates a spec file before starting non-trivial work. Use this whenever
the change involves > 1 file or > 1 day of effort. The spec is a
thinking aid, not a contract — adjust as you learn.

## Steps

1. **Parse args**: `$ARGUMENTS` first token = slug (kebab-case). Rest = optional goal sentence.

2. **Compute path**: `docs/superpowers/specs/YYYY-MM-DD-<slug>.md` using today's date.

3. **If file exists** at that path → ask user: overwrite, append timestamp suffix, or abort.

4. **Write** the template below.

5. **Print path** and suggest opening it.

## Template

```markdown
# <Title — derived from slug, title-cased>

**Date**: YYYY-MM-DD
**Status**: draft | in-progress | shipped | abandoned
**Goal**: <one-sentence from $ARGUMENTS or `TODO: write goal`>
**Owner**: <user — usually you>

## Why now

Why this, why not later? Link to backlog item / issue / PRD section / user feedback.

## Success criteria

- [ ] Concrete, testable. Not "improve X" — "X latency p50 ≤ 200ms" or "endpoint returns 400 for malformed input".
- [ ] ...

## Non-goals

What's explicitly out of scope. Prevents scope creep.

## Risks / pitfalls

Walk through `.claude/rules/pitfalls.md` and `domain.md`. Which apply?
- Pitfall: <ref> — mitigation: <plan>
- Invariant: <ref> — preserve by: <plan>

## Plan

1. Step. File(s) touched. Verification.
2. ...

## Open questions

Things to resolve BEFORE coding (ask user, research, prototype).

## Out of session

After shipping:
- [ ] Update HANDOFF.md §2
- [ ] Close backlog item if applicable
- [ ] /learn any new pitfalls discovered
- [ ] Decision record if a non-obvious choice was made
```

Argument: $ARGUMENTS

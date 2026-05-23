---
description: Wrap up current session — extract learnings, update HANDOFF, write next-session prompt
---

# /handoff

End-of-session ritual. Run when:
- User says "let's wrap up" / "good for today"
- Context is ≥ ~70% used (you should proactively offer this)
- About to switch to a clearly different task

## Steps (do these IN ORDER — don't skip)

### 1. Extract learnings (5 min)

Scan THIS session's tool history for:
- New invariants discovered ("I learned that X must…")
- Bugs hit + workarounds ("turns out Y was returning…")
- Decisions made with stated reasoning ("we chose A over B because…")
- Conventions agreed upon ("from now on we'll…")

For each, propose `/learn` candidates. Present as a numbered list. Ask the user to confirm which to file. DO NOT auto-file.

### 2. Update `docs/HANDOFF.md`

Edit the relevant sections:
- §2 "What just landed" — add today's notable changes (one bullet line, no narrative)
- §5 "What's broken / monitor" — add new items observed; update state of existing items
- §8 "Where to start the next session" — IF priorities shifted, re-order or add

Update the `**Last updated**` date at the top.

Show the diff. Ask: "Update HANDOFF.md? (y/n)".

### 3. Record decisions (if any)

For each non-trivial decision made today, create `docs/superpowers/decisions/YYYY-MM-DD-<slug>.md`:

```markdown
# <Decision title>

**Date**: YYYY-MM-DD
**Status**: accepted | superseded by <link>
**Context**: 2-3 sentences on what we were facing.
**Decision**: 1 sentence on what we chose.
**Alternatives considered**: bullet list, one line each, why-rejected.
**Consequences**: 2-3 bullets on what this enables / costs.
```

Show paths to be created. Ask: "Create decision records? (y/n)".

### 4. Backlog deltas

If today produced new refactor items, propose appends to `docs/REFACTOR_BACKLOG.md` (format: see file). If items were COMPLETED, propose marking them ✅ DONE.

### 5. Next-session prompt

Write ONE pasteable prompt for the next session that:
- States the current goal in one sentence
- Names the files/areas to start with
- Notes any open question to resolve first
- Is ≤ 6 lines

Print it in a fenced block.

### 6. Sanity counts

Print:
- CLAUDE.md line count (must be ≤ 150)
- New rules added today (count)
- Rules `last-cited` updated (count)
- HANDOFF.md sections touched

## Output template

```
=== Session handoff ===

Learnings to file (proposed /learn entries):
  1. [domain] ...
  2. [pitfalls] ...
Decisions to record:
  - YYYY-MM-DD-<slug>: ...
HANDOFF.md updates:
  §2: + ...
  §5: ~ ...
Backlog deltas:
  + ...
  ✅ ...

Next-session prompt:
```
<paste-ready prompt>
```

Counts:
  CLAUDE.md: NN lines (cap 150)
  Rules added: N
  Rules cited: N
  HANDOFF sections: §X, §Y

Proceed with all of the above? (y / select / n)
```

If user picks "select", iterate by section asking y/n for each block.

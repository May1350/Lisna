---
description: Pick the top item from REFACTOR_BACKLOG.md and start working on it
argument-hint: "[optional item number or slug]"
---

# /refactor-next

Pulls the next priority item from `docs/REFACTOR_BACKLOG.md` and starts a
focused work session on it.

## Steps

1. **Read `docs/REFACTOR_BACKLOG.md`**.

2. **Pick the item**:
   - If `$ARGUMENTS` is provided (a number or slug), find that item. If not found, report and stop.
   - Otherwise, take the first item in the "Now" section (highest priority). If "Now" is empty, take the first from "Next". If both empty, report and stop.

3. **Confirm with user**:
   ```
   Next refactor: <title>
   Why: <reason from backlog>
   Touches: <files / areas>
   Estimated effort: <S | M | L>
   Open spec? (y/n)
   ```

4. **Create a working spec** at `docs/superpowers/specs/YYYY-MM-DD-<slug>.md` using the template:
   ```markdown
   # <title>

   **Backlog item**: <link or copy of item>
   **Why now**: <reason>
   **Touches**: <files>
   **Success criteria**:
   - [ ] ...
   - [ ] ...
   **Non-goals**: <list>
   **Risks**: <list — especially pitfalls.md entries that apply>
   **Plan**:
   1. ...
   2. ...
   ```

5. **Create branch**: `refactor/<slug>` off `main`. Confirm first.

6. **Read relevant rule files**:
   - Always: `.claude/rules/_index.md`
   - If touching backend: `.claude/rules/architecture.md` + `domain.md`
   - If touching network / cross-frame / DB: `.claude/rules/pitfalls.md`
   - If touching tests: `.claude/rules/testing.md`

7. **Start work**. Report a 3-step plan, then begin.

## After completion

- Mark the backlog item as ✅ DONE (date) in `docs/REFACTOR_BACKLOG.md`.
- If new pitfalls or invariants were discovered → propose `/learn` candidates.
- Run `/handoff` if context permits.

Argument: $ARGUMENTS

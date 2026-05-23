---
description: Reconcile docs/REFACTOR_BACKLOG.md with GitHub Issues (label:refactor)
---

# /backlog-sync

Two-way sync between the markdown backlog and GitHub Issues. Source of
truth is the markdown file (humans edit it most often), but Issues are
where assignment + PR linkage live.

## Steps

1. **Read `docs/REFACTOR_BACKLOG.md`**.

2. **List GitHub Issues** with label `refactor` (use github MCP `list_issues`, state=open).

3. **Build cross-reference table**. Match by:
   - Explicit `#<issue-num>` annotation in backlog item
   - Issue title prefix matching backlog slug

4. **Classify each item**:
   - `in-both`: present in both, status agrees → skip
   - `md-only`: in backlog but no issue → propose creating issue
   - `issue-only`: issue exists but not in backlog → propose appending to backlog
   - `status-conflict`: e.g. backlog says ✅ DONE but issue still open → propose closing the issue
   - `desc-drift`: descriptions differ significantly → flag for human review

5. **Show summary**:
   ```
   Backlog ↔ Issues sync — YYYY-MM-DD
   Total backlog items: N
   Total open issues (label:refactor): N
   in-both: N
   md-only: N → create issues?
   issue-only: N → append to backlog?
   status-conflict: N → resolve?
   desc-drift: N → review manually
   ```

6. **For each non-trivial action**, ask user y/n. Batch creation OK if user picks "y to all".

7. **When creating issues**: use the `refactor-task` template body, link back to the backlog item with markdown anchor.

8. **When appending to backlog**: place under "Next" section by default, with `#<issue-num>` annotation.

9. **Update `docs/REFACTOR_BACKLOG.md`** with `**Last synced**: YYYY-MM-DD` at the top.

## Don't do

- Don't auto-close issues without user confirmation (PRs may still be in flight).
- Don't delete backlog items even if their issue is closed — mark ✅ DONE with date instead. The history is useful.
- Don't open issues for items marked `parking-lot` in the backlog.

## Format reference

A backlog item in `REFACTOR_BACKLOG.md` looks like:

```
- [P1] **<title>** — <one-line reason>. Touches: <files>. Effort: S/M/L. #<issue-num>
```

An issue body looks like:

```markdown
Linked to backlog: [<title>](https://github.com/may1350/lisna/blob/main/docs/REFACTOR_BACKLOG.md#<anchor>)

<copy of backlog item body>
```

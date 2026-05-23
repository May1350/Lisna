---
description: Find similar / overlapping rules across .claude/rules/ and propose merges
---

# /rules-compress

Run quarterly OR whenever `/audit` reports a rules file > 300 lines OR
`CLAUDE.md` is creeping over 150.

## Steps

1. **Read all `.claude/rules/*.md`** (skip `archived/`).

2. **Cluster rules** by:
   - Same subcategory tag → likely candidates
   - Shared key terms (regex on rule body)
   - Same target file/area mentioned

3. **For each cluster of 3+ rules**:
   - Quote the rules.
   - Propose ONE consolidated rule that captures the general principle.
   - Mark the originals for archive (move to `archived/` with `superseded-by: <new-rule-date>`).

4. **For pairs (2 rules) that overlap**:
   - Check if one is a special case of the other → suggest folding the special case as a parenthetical in the general rule.
   - Otherwise leave alone — pairs aren't enough signal.

5. **Show a single diff** containing all proposed merges + archive moves. DO NOT auto-apply. Ask user to approve each cluster individually:
   ```
   Cluster 1/N: <subcategory>
   Originals:
     - <rule A>
     - <rule B>
     - <rule C>
   Proposed merge:
     - <new rule>
   Apply? (y/n/skip)
   ```

6. **Update `last-cited`** on the merged rule to today.

## Anti-patterns to avoid

- Merging rules from DIFFERENT files — keep file categorization intact
- Losing the "Reason:" specificity — if the merged rule loses why-detail, don't merge
- Compressing rules with conflicting subcategory tags (suggests they shouldn't merge)

## Output

```
Compression report — YYYY-MM-DD
Files scanned: <N>
Clusters found: <N>
Proposals: <N> merges, <N> archives
Lines saved (if all accepted): ~<N>

[interactive per-cluster prompts...]
```

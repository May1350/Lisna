---
description: Weekly repo health check — file size, type drift, migration numbering, stale rules
---

# /audit

Run weekly (also via GHA on cron). Produces a report; does not auto-fix.

## Checks

### 1. CLAUDE.md size cap

- Read `CLAUDE.md` line count. If > 150 → flag with suggestion to run `/rules-compress` or migrate items to detailed files.
- For each `.claude/rules/*.md`, line count. Soft cap 300/file; > 500 → suggest splitting.

### 2. Stale rules

For every rule line matching `[YYYY-MM-DD]` format across `.claude/rules/**`:
- Parse `last-cited:` date.
- If older than 90 days from today → list as sunset candidate.
- Report grouped by file. Don't archive automatically — output `/rules-sunset` command suggestion.

### 3. Migration numbering

```
ls backend/src/migrations/*.sql | sort
```

- Verify monotonic, no gaps.
- Cross-check against `schema_migrations` if a DB is reachable (skip in CI without secrets).

### 4. Type drift

Check that the Outline shape is in sync:
- Read `backend/src/lib/curator.ts` (extract `Outline` interface).
- Read `extension/src/side-panel/api-client.ts` (extract `Outline` interface).
- Diff field names + types. Any mismatch → flag with line numbers.

### 5. Lambda bundle externals

Check `backend/infra/lib/*.ts` for any handler config that does NOT have `externalModules: ['@aws-sdk/*']`. List violations.

### 6. CORS lockdown status

Read latest `cdk deploy` context (if available) or check `infra/lib/api-stack.ts` defaults. If `allowedCorsOrigins` includes `*` and the repo has a Web Store ID configured, flag it.

### 7. Dead code drift

Look for:
- `// TODO: remove` comments older than 60 days (git blame)
- Files matching `*-old.*`, `*-legacy.*`, `*.bak`
- Exports never imported (run `pnpm tsc --noEmit` with project refs — skip if slow)

### 8. HANDOFF.md freshness

Parse `**Last updated**:` date. If > 21 days old AND there are commits since → flag "HANDOFF stale".

### 9. Backlog ↔ Issues sync

- Read `docs/REFACTOR_BACKLOG.md` items.
- Match against open GitHub issues with label `refactor` (via gh / MCP).
- Report orphans (backlog item without issue, or vice versa).
- Suggest `/backlog-sync` if drift > 3 items.

## Output

Markdown report. Print to stdout. If running via GHA, also write to `.claude/cache/audit-YYYY-MM-DD.md` (gitignored) and open an Issue if any check fails with severity ≥ warn.

```
# Audit — YYYY-MM-DD

## Severity: ok | warn | fail
- CLAUDE.md size: <N>/150 lines [ok]
- Rules files: <list> [warn: pitfalls.md 312 lines]
- Stale rules: <N> candidates [list]
- Migration order: [ok]
- Type drift: [fail: Outline.sections mismatch — backend has `tags?:`, ext has `tags:`]
...

## Recommended actions
1. ...
2. ...
```

Do NOT make changes. This is read-only.

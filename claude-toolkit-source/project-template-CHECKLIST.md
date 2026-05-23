# Project template checklist

Quick reference: when forking Lisna's `.claude/` system into a new repo,
this is what's portable vs project-specific. Use alongside `BOOTSTRAP.md`.

## Portable (copy verbatim — generic content)

✅ `.claude/commands/learn.md`
✅ `.claude/commands/handoff.md`
✅ `.claude/commands/refactor-next.md`
✅ `.claude/commands/spec-new.md`
✅ `.claude/commands/rules-compress.md`
✅ `.claude/commands/rules-sunset.md`
✅ `.claude/rules/_index.md`
✅ `.claude/rules/archived/.gitkeep`
✅ `.github/ISSUE_TEMPLATE/rule-proposal.md`
✅ `.github/ISSUE_TEMPLATE/pitfall-discovery.md`

## Portable with light edits

🔧 `.claude/commands/audit.md` — migration path, Outline drift check refs
🔧 `.claude/commands/backlog-sync.md` — `may1350/lisna` repo path
🔧 `.claude/settings.json` — permission allowlist tuned to project
🔧 `.claude/hooks/session-start.sh` — "Lisna" project name in echo
🔧 `.claude/hooks/pre-commit-check.sh` — migration dir path
🔧 `.github/ISSUE_TEMPLATE/refactor-task.md` — backlog link
🔧 `.github/PULL_REQUEST_TEMPLATE.md` — drop Lisna-specific checklist
🔧 `.github/workflows/claude-audit.yml` — migration path, cron tz
🔧 `.github/workflows/backlog-sync.yml` — repo-aware
🔧 `docs/REFACTOR_BACKLOG.md` — structure portable; content project-specific

## Project-specific (write fresh, KEEP structure)

📝 `CLAUDE.md` — keep rules 1-10 (workflow), rules 18-20 (meta), section structure. Replace 11-17 (Lisna invariants) with new project's. Replace "Project-specific shorthand" with new project's shorthand.
📝 `.claude/rules/architecture.md` — keep "Layering" + "Abstractions" sections (generic). Rewrite "Cross-package boundaries" and "What goes where".
📝 `.claude/rules/workflow.md` — most rules portable; rewrite "Deploy" + "Migrations" sections to match new stack.

## Project-specific (start empty)

🆕 `.claude/rules/domain.md` — empty stub. Real invariants accrue via `/learn`.
🆕 `.claude/rules/pitfalls.md` — empty stub.
🆕 `.claude/rules/testing.md` — partial — keep "When skipping is fine" / "When NOT to skip" generic frame, rewrite layout + rules.

## Not portable (don't copy)

❌ `docs/HANDOFF.md` — completely fresh per project
❌ `docs/PRD.md` — completely fresh per project
❌ `docs/DEPLOYMENT.md`, `docs/DESIGN.md`, etc. — project-specific

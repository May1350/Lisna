---
description: Bootstrap a new repo with the Claude Code rule system
argument-hint: "[optional stack: typescript-monorepo | nextjs | python | electron | generic]"
---

# /new-project

Bootstraps a fresh repo with the same rule system used in Lisna. Run from the new repo's root.

## Pre-flight

1. Check current dir is a git repo: `git rev-parse --is-inside-work-tree`. If not, ask whether to `git init` here.
2. Check it's a CLEAN repo (no existing `CLAUDE.md`, no `.claude/`). If existing files found, ask: "Existing setup detected — overwrite, merge, or abort?"
3. Confirm `$ARGUMENTS` stack hint (or ask).

## Steps

### 1. Create skeleton

```bash
mkdir -p .claude/{commands,rules/archived,hooks}
mkdir -p docs/superpowers/{plans,specs,decisions}
mkdir -p .github/{ISSUE_TEMPLATE,workflows}
```

### 2. Locate kit source

Try in order:
- Local clone: `~/claude-toolkit/` if it exists
- Local clone: `~/dev/lisna/claude-toolkit-source/` if it exists
- Otherwise prompt user for path to a Lisna clone (or the future standalone template repo)

### 3. Copy the verbatim files (from BOOTSTRAP.md "Step 3" list)

8 slash commands, 1 _index.md, 2 hooks (chmod +x), 3 issue templates, PR template, 2 GHA workflows, settings.json.

### 4. Generate stubs (from BOOTSTRAP.md "Step 4" list)

For CLAUDE.md, prompt user for:
- Project name (replaces "Lisna")
- One-line concept
- Stack one-liner (e.g., "Next.js 14 + Postgres" or "Electron + Rust core")
- Top 3 unique invariants this project will likely have (can be guesses; will be refined)

Generate root CLAUDE.md with workflow + meta rules (rules 1-10 + 18-20 from Lisna), placeholder for project-specific section, and the index.

For rules/*.md: write empty stubs with just the header + "How to add" instructions. Real content accrues via `/learn`.

For HANDOFF.md: write a minimal seed with §1 "Project at a glance" filled from user input, other sections as `_TBD_` placeholders.

For REFACTOR_BACKLOG.md: copy the structure, prefill `## Now` with one starter item: "Run `/audit` after first week of use to verify system is healthy."

### 5. Update `.gitignore`

Append:
```
.claude/settings.local.json
.claude/cache/
```

### 6. Apply stack preset (if `$ARGUMENTS` provided)

- `typescript-monorepo`: add rule for pnpm workspaces, tsconfig.refs, lint rules
- `nextjs`: add rule for app/ router, server components, env var loading
- `python`: add rule for uv/poetry, pyproject.toml structure, ruff
- `electron`: add rule for ipc + main/renderer split
- `generic`: skip

### 7. First commit

```bash
git add .
git status  # show user
```

Propose commit message: `chore: bootstrap Claude Code rule system`

Don't auto-commit. Show + confirm.

### 8. Print next steps

```
Bootstrap complete.

Next:
1. Edit CLAUDE.md "Repo layout" + "Top 20 rules" sections — current values are placeholders
2. Write docs/PRD.md (the product yardstick)
3. Start a real task. When you discover a project-specific invariant, run /learn "..."
4. After ~1 week of use, run /audit to verify health
```

Argument: $ARGUMENTS

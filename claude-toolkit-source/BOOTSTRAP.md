# Bootstrap a new project with the Lisna Claude system

Step-by-step for cloning this setup into a fresh repo. Takes ~15 minutes.

## Step 0 — Decide scope

Is the new project:
- (a) **Solo / first session** → start with `MINIMUM` set below
- (b) **Team / multi-session expected** → use `FULL` set
- (c) **Just adding rules to existing repo** → only Step 3 + 4

## Step 1 — Personal `~/.claude/` (one time per machine)

Skip if you already have this.

```bash
# From this directory
mkdir -p ~/.claude/commands
cp personal/CLAUDE.md ~/.claude/CLAUDE.md
cp personal/commands/new-project.md ~/.claude/commands/new-project.md
# settings.json is optional — see file for what it sets
```

Now `/new-project` is available in any Claude Code session.

## Step 2 — Project skeleton

In the new repo's root:

```bash
mkdir -p .claude/commands .claude/rules/archived .claude/hooks
mkdir -p docs/superpowers/{plans,specs,decisions}
mkdir -p .github/ISSUE_TEMPLATE .github/workflows
```

## Step 3 — Copy these files VERBATIM (generic, no project-specific content)

From this repo's root:

| Source | Destination | Notes |
|---|---|---|
| `.claude/commands/learn.md` | `<new>/.claude/commands/learn.md` | |
| `.claude/commands/handoff.md` | `<new>/.claude/commands/handoff.md` | |
| `.claude/commands/audit.md` | `<new>/.claude/commands/audit.md` | Edit migration path + Outline check refs if not applicable |
| `.claude/commands/refactor-next.md` | `<new>/.claude/commands/refactor-next.md` | |
| `.claude/commands/spec-new.md` | `<new>/.claude/commands/spec-new.md` | |
| `.claude/commands/rules-compress.md` | `<new>/.claude/commands/rules-compress.md` | |
| `.claude/commands/rules-sunset.md` | `<new>/.claude/commands/rules-sunset.md` | |
| `.claude/commands/backlog-sync.md` | `<new>/.claude/commands/backlog-sync.md` | Edit `may1350/lisna` repo path |
| `.claude/rules/_index.md` | `<new>/.claude/rules/_index.md` | |
| `.claude/hooks/session-start.sh` | `<new>/.claude/hooks/session-start.sh` | Replace "Lisna" in echo line |
| `.claude/hooks/pre-commit-check.sh` | `<new>/.claude/hooks/pre-commit-check.sh` | Adjust migration dir path |
| `.github/ISSUE_TEMPLATE/refactor-task.md` | `<new>/.github/ISSUE_TEMPLATE/refactor-task.md` | Replace `may1350/lisna` link |
| `.github/ISSUE_TEMPLATE/pitfall-discovery.md` | `<new>/.github/ISSUE_TEMPLATE/pitfall-discovery.md` | |
| `.github/ISSUE_TEMPLATE/rule-proposal.md` | `<new>/.github/ISSUE_TEMPLATE/rule-proposal.md` | |
| `.github/PULL_REQUEST_TEMPLATE.md` | `<new>/.github/PULL_REQUEST_TEMPLATE.md` | Drop Lisna-specific checklist items |
| `.github/workflows/claude-audit.yml` | `<new>/.github/workflows/claude-audit.yml` | Adjust cron + migration path if used |
| `.github/workflows/backlog-sync.yml` | `<new>/.github/workflows/backlog-sync.yml` | |
| `.claude/settings.json` | `<new>/.claude/settings.json` | Prune permission allowlist to what the new project needs |

Make hooks executable: `chmod +x <new>/.claude/hooks/*.sh`

## Step 4 — Stub these files (start blank, fill as you go)

| File | Source pattern (this repo) | Action |
|---|---|---|
| `<new>/CLAUDE.md` | `CLAUDE.md` | Copy structure (sections), KEEP rules 1-10 + 18-20 (workflow + meta), DELETE rules 11-17 (Lisna-specific invariants), DELETE "Project-specific shorthand" section, edit "Repo layout" |
| `<new>/.claude/rules/architecture.md` | `.claude/rules/architecture.md` | Keep "Layering" + "Abstractions" generic rules, delete "Cross-package boundaries" Lisna-specific, edit "What goes where" |
| `<new>/.claude/rules/domain.md` | `.claude/rules/domain.md` | Empty — start with just the header. New project's invariants get added via `/learn` |
| `<new>/.claude/rules/pitfalls.md` | `.claude/rules/pitfalls.md` | Empty — start with header + "How to add a pitfall" instructions. Real pitfalls accrue. |
| `<new>/.claude/rules/testing.md` | `.claude/rules/testing.md` | Keep "When skipping a test is fine" + "When NOT to skip" generic frame, edit "Layout" + rules to match the new stack |
| `<new>/.claude/rules/workflow.md` | `.claude/rules/workflow.md` | Mostly portable — edit deploy section to match new stack |
| `<new>/.claude/rules/archived/.gitkeep` | same | Copy verbatim |
| `<new>/docs/REFACTOR_BACKLOG.md` | `docs/REFACTOR_BACKLOG.md` | Copy structure (Now/Next/Parking lot/Archive), delete Lisna items |
| `<new>/docs/HANDOFF.md` | — | NEW. Use the structure from this repo's `docs/HANDOFF.md` as a guide but write fresh. |
| `<new>/docs/PRD.md` | — | NEW per-project. Locked product yardstick. |

## Step 5 — Update `.gitignore`

Add these lines so shared config commits but local session state doesn't:

```
.claude/settings.local.json
.claude/cache/
```

DO NOT ignore the whole `.claude/` directory — that defeats the system.

## Step 6 — First-session verification

In the new repo, start a Claude Code session and check:

1. SessionStart hook prints the briefing (branch / handoff date / backlog top 3)
2. `/learn "test: this is a sanity check. Reason: verify routing."` proposes a diff against `.claude/rules/` and DOESN'T auto-commit
3. `/audit` runs and reports ok (CLAUDE.md ≤ 150 lines, no stale rules, etc.)
4. PR template renders when you draft a new PR

If any of these fail, the wiring is off — see "Troubleshooting" below.

## Step 7 — First real usage

Wait until you actually hit a bug or discover an invariant. Then:

1. `/learn "<the insight>"` — let the routing decide where it goes
2. Don't edit `.claude/rules/*` by hand — always go through `/learn`
3. End of session → `/handoff`

## Step 8 — When to extract to a separate template repo

Once you've used the system across ≥ 3 projects, extract `claude-toolkit-source/`
plus the generic files into a standalone GitHub repo. Then this `claude-toolkit-source/`
directory can be deleted from project repos in favor of `git clone` + the kit's
own bootstrap script.

## Troubleshooting

- **`/learn` doesn't appear as a slash command**: check `.claude/commands/learn.md` has the YAML frontmatter (`---\ndescription: ...\n---`) and the file is committed.
- **Hooks don't run**: check `.claude/settings.json` has the SessionStart hook entry AND the script path is correct AND `chmod +x` was applied.
- **CLAUDE.md not loading**: file must be in repo root, named exactly `CLAUDE.md`. Workspace-level `<package>/CLAUDE.md` is also loaded when working in that package.
- **`/learn` keeps wanting to write to root CLAUDE.md**: it's mis-classifying. Add to the prompt: "this is a pitfall, not a top-20."

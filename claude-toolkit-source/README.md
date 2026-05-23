# claude-toolkit-source

The "second-instance kit" for spinning up the Claude Code rule system in
a NEW project. The live, battle-tested version lives at the repo root
(`.claude/`, `CLAUDE.md`, `docs/REFACTOR_BACKLOG.md`, etc.). This
directory exists only to make adopting the same setup in a fresh repo
fast.

## Files here

- `BOOTSTRAP.md` — step-by-step: how to copy this system to a new repo, what to prune, what to seed.
- `personal/` — the `~/.claude/` (user-level) layer. Lives in your home dir, not in any project repo.
  - `CLAUDE.md` — personal collaboration style (terse, verify, etc.)
  - `commands/new-project.md` — `/new-project` slash command that bootstraps a fresh repo from this kit
  - `settings.json` — global Claude Code settings (optional hooks)
- `project-template-CHECKLIST.md` — what files to copy + which to clear vs keep when forking the live `.claude/` into a new project.

## Why thin?

The live `.claude/` in this repo gets used daily; every fix lands there
first. Maintaining a parallel "template" copy would just diverge.
Instead, the kit treats the live setup as the source of truth and
provides the **prune/seed instructions** to make a clean adoption.

When the system is mature enough (after ~10 sessions of real use, say),
the next step is to extract this into a separate `claude-project-template`
GitHub repo. Until then, source-of-truth = live `.claude/` here.

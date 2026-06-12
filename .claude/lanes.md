# Lanes — session + subagent isolation map

This file declares directory ownership for each Lisna Claude worktree.
The `.claude/hooks/pre-commit-check.sh` (section 7) reads the parseable
block at the bottom and prints a SOFT warning when staged files fall
outside the current worktree's owned set AND outside the shared seams.

## Operating model — SINGLE CONTROLLER SESSION (adopted 2026-06-08)

Lisna v2 work runs through **one controller session** on the **main
worktree** (`/Users/guntak/Lisna`). This replaces the earlier
parallel-human-session model (e.g. the "Lisna-AI" + "Lisna-note" split),
which repeatedly drifted the main worktree onto another branch and caused
branch-confusion incidents.

The rules:

1. **One session holds merge control** — the controller, on `main`. All
   PR review + `main` merges happen here only. No second human-driven
   session merges in parallel.
2. **Well-defined execution work → delegate to subagents** in isolated
   worktrees; the controller reviews + merges. Subagents stay inside
   their assigned worktree (see `feedback_subagent_worktree_boundary` /
   `.claude/rules/workflow.md (dispatch)` — never `git checkout`/`pull`/
   `reset` a shared branch).
3. **Exploration / design → the controller drives directly.** Subagents
   can't do interactive back-and-forth, so brainstorming, spec authoring,
   and design decisions stay in the controller session.

Consequence for ownership: under a single controller, lane boundaries
exist mainly to scope **subagent worktrees**. The controller on `main`
works across the whole v2 surface directly (everything except the frozen
`extension/`), so its parseable row owns a broad set; subagent worktrees
get a narrow scoped row added by the controller when it dispatches them.

## The contract

- Each Claude session works in a designated worktree, owning a set of
  directories.
- Edits to other lanes' directories should either:
  - (a) be moved to the correct lane's worktree, OR
  - (b) tag the commit subject `[cross-lane: <from> → <to>]` and update
    this file's shared-seams section if a new persistent seam appears.
- "Shared seams" (package.json, lockfile, CLAUDE.md, rules-via-/learn,
  etc.) have no owner — any session may edit them without a tag.
- The hook is a SOFT warning, never a block. `--no-verify` is NOT the
  remedy; either re-home the change or add the tag.

## Lane definitions

Under the single-controller model, the first entry below is the live
controller; the rest are **templates** — the scoped ownership a subagent
worktree should get when the controller dispatches that kind of work.

### Controller (main) — LIVE
The controller session on the main worktree. Drives exploration/design
directly and owns the whole v2 surface except the frozen `extension/`.
When it delegates execution to a subagent worktree, it narrows that
worktree to one of the templates below.

- **Worktree:** `.` (main repo)
- **Branch:** `main` (feature branches off `main` for each change)
- **Owns:** `desktop/` · `docs/` · `backend/` · `infra/` · `shared/` · `.claude/`

### AI infra (subagent template)
v2 note-creation backbone — schemas, registries, sidecar wrapper,
orchestrator, C++ sidecar binary, integration tests.

- **Worktree:** `.claude/worktrees/<slug>` (create on dispatch)
- **Branch:** `feat/v2-*` or `fix/v2-*`
- **Owns:**
  - `desktop/src/main/`
  - `desktop/src/shared/`
  - `desktop/sidecar/`
  - `desktop/__tests__/`
  - `desktop/spikes/` (Phase 0+ AI experiments)

### Spec/Docs
Plans, specs, decision memos, command/skill/hook definitions, HANDOFF,
backlog. Long-form thinking, not code.

- **Worktree:** `.claude/worktrees/spec-docs` (create on demand)
- **Branch:** integration branch or thin `docs/v2-*` topic branch
- **Owns:**
  - `docs/`
  - `.claude/commands/`
  - `.claude/skills/`
  - `.claude/hooks/`
  - `.claude/launch.json`
  - `.claude/worktrees/` (git manages directly; lane just tracks)

### App design
Desktop renderer UI — Recording.tsx, NoteView, picker UI, family-specific
renderer components.

- **Worktree:** `.claude/worktrees/app-design` (create AFTER Plan 3
  contract-freeze — typically Plan 3 Tasks 1-3)
- **Branch:** `design/v2-lecture-ui` (or per-feature)
- **Owns:**
  - `desktop/src/renderer/`
  - `desktop/src/preload/`

### Eval (Plan 7)
v2 eval harness — fixtures, judges, contract tests, scorecards, runners.

- **Worktree:** `.claude/worktrees/eval` (create on demand)
- **Branch:** `feat/v2-eval-harness`
- **Owns:**
  - `desktop/eval/`
  - `desktop/scripts/eval-*.ts`

### Web
lisna.jp marketing site (Next.js, EN/JA/KO).

- **Worktree:** `.claude/worktrees/web-<slug>` (on demand)
- **Branch:** `feat/web-*`
- **Owns:**
  - `web/`

### Backend
AWS Lambda + CDK + shared workspace package (HTTP wire types).

- **Worktree:** `.claude/worktrees/backend-<slug>` (on demand) or main
- **Branch:** `feat/be-*`
- **Owns:**
  - `backend/`
  - `infra/`
  - `shared/` (root workspace package — snake_case HTTP wire shapes)

### Extension (FROZEN)
Chrome MV3 extension. **NO NEW WORK** per CLAUDE.md scope-freeze
(2026-05-24). Dependabot security patches still merge but no
human/agent-initiated edits.

- **Owns:** `extension/`

## Shared seams (no owner — any lane may edit without a cross-lane tag)

- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- `.github/workflows/` (CI changes often span multiple lanes)
- `CLAUDE.md` (top-20 rules)
- `docs/PRD.md` (locked product yardstick)
- `.claude/rules/` (any lane's `/learn` may append)
- `.claude/lanes.md` (this file — any lane may add/update its worktree row)
- `.gitignore`, `.gitattributes`
- Root-level `tsconfig*.json`, `*.config.{ts,js,mjs}`
- `README.md`

## Cross-lane tagging convention

When a commit legitimately edits files outside the current lane's owned
set AND outside the shared seams, add a `Cross-lane:` trailer to the
commit body (git-trailer convention, parallels `Co-Authored-By:`). The
SUBJECT stays in the standard `type(scope): summary` form — the
`commit-msg-check.sh` hook requires it.

```
<type>(<scope>): <summary>

<body explaining the change>

Cross-lane: <current-lane> → <target-lane>
```

Example — AI infra session adds a renderer-process helper:
```
feat(renderer): NoteView stub

Inline-placeholder until App design session picks up Plan 3 UI.

Cross-lane: ai-infra → app-design
```

Searchable via `git log --grep='^Cross-lane:'`. If the cross-lane edit
becomes a recurring pattern (e.g., a new shared seam is forming),
promote the path into the shared-seams section above instead of tagging
every commit.

## Worktree state (2026-06-08)

The single-session consolidation pruned all in-flight feature worktrees
(their PRs squash-merged to `main`). Only two remain:

| Path | Branch | Status |
|---|---|---|
| `.` | `main` | Controller (live). |
| `.claude/worktrees/spec-docs` | `docs/v2-spec-docs` | Long-lived spec/decision branch (no PR; far ahead of `main`). KEEP. |

Subagent worktrees are created on dispatch and removed after their PR
merges (`git worktree remove`). Before creating one, verify the work
isn't already done + pushed (`git branch -a | grep <slug>` +
`git ls-remote origin '<glob>'`) — see `.claude/rules/workflow.md
(dispatch)`. Several stale **remote** branches still exist from earlier
work (e.g. `fix/auth-picker-diagnostics`, `worktree-*`); they have no
local worktree and can be cleaned up separately.

---

## Machine-parseable section (pre-commit hook reads everything below)

Format per line — fields separated by `|`:
```
<worktree-relative-to-repo-root>|<space-sep-owned-dirs>|<lane-name>
```

`seams:` line is a single space-separated list.

<!-- BEGIN PARSEABLE -->
.|desktop/ docs/ backend/ infra/ shared/ .claude/|controller
.claude/worktrees/spec-docs|docs/ .claude/commands/ .claude/skills/ .claude/hooks/ .claude/launch.json .claude/worktrees/|spec-docs
.claude/worktrees/ci-playwright-fix|extension/package.json|ci-fix
.claude/worktrees/sanitizer-latex-fix|desktop/src/main/ desktop/eval/|sanitizer-latex-fix
.claude/worktrees/history-viewer|desktop/ docs/|history-viewer
.claude/worktrees/note-quality-eval|desktop/eval/ desktop/scripts/|note-quality-eval
.claude/worktrees/per-chunk-2pass|desktop/ docs/|per-chunk-2pass
.claude/worktrees/2pass-sampler|desktop/ docs/|2pass-sampler
.claude/worktrees/sampler-alignment|desktop/src/shared/ desktop/sidecar/ desktop/__tests__/ desktop/eval/ desktop/scripts/|sampler-alignment
seams: package.json pnpm-lock.yaml pnpm-workspace.yaml .github/workflows/ CLAUDE.md docs/PRD.md .claude/rules/ .claude/lanes.md .gitignore .gitattributes README.md tsconfig
<!-- END PARSEABLE -->

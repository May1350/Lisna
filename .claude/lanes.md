# Lanes — multi-session isolation map

This file declares directory ownership for each Lisna Claude session lane.
The `.claude/hooks/pre-commit-check.sh` (section 7) reads the parseable
block at the bottom and prints a SOFT warning when staged files fall
outside the current worktree's owned set AND outside the shared seams.

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

### AI infra
v2 note-creation backbone — schemas, registries, sidecar wrapper,
orchestrator, C++ sidecar binary, integration tests.

- **Worktree:** `.` (main repo)
- **Branch:** `spec/v2-note-creation-design` (current v2 integration)
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

## Stale worktrees (founder cleanup decision pending)

Two worktrees from earlier work, both predate this lane scheme:

| Path | Branch | Status |
|---|---|---|
| `.claude/worktrees/auth-picker-diagnostics` | `fix/auth-picker-diagnostics` | Extension fix; extension FROZEN |
| `.claude/worktrees/flamboyant-williams-6fe1f8` | `chore/sidecar-build-j1` | Old sidecar build chore |

Founder to confirm safe-to-prune. If yes:
```
git worktree remove --force .claude/worktrees/auth-picker-diagnostics
git worktree remove --force .claude/worktrees/flamboyant-williams-6fe1f8
git branch -d fix/auth-picker-diagnostics chore/sidecar-build-j1
```

---

## Machine-parseable section (pre-commit hook reads everything below)

Format per line — fields separated by `|`:
```
<worktree-relative-to-repo-root>|<space-sep-owned-dirs>|<lane-name>
```

`seams:` line is a single space-separated list.

<!-- BEGIN PARSEABLE -->
.|desktop/src/main/ desktop/src/shared/ desktop/sidecar/ desktop/__tests__/ desktop/spikes/|ai-infra
.claude/worktrees/meeting|desktop/src/main/ desktop/src/shared/ desktop/src/integration/|ai-infra
.claude/worktrees/spec-docs|docs/ .claude/commands/ .claude/skills/ .claude/hooks/ .claude/launch.json .claude/worktrees/|spec-docs
.claude/worktrees/app-design|desktop/src/renderer/ desktop/src/preload/|app-design
.claude/worktrees/eval|desktop/eval/ desktop/scripts/eval-|eval
.claude/worktrees/feat-cpp-grammar-gen|desktop/sidecar/ desktop/src/main/ desktop/src/shared/ desktop/eval/ docs/superpowers/|ai-infra
.claude/worktrees/fix-pipeline-unblock|desktop/sidecar/ desktop/src/main/ desktop/src/shared/ desktop/eval/ docs/superpowers/|ai-infra
seams: package.json pnpm-lock.yaml pnpm-workspace.yaml .github/workflows/ CLAUDE.md docs/PRD.md .claude/rules/ .claude/lanes.md .gitignore .gitattributes README.md tsconfig
<!-- END PARSEABLE -->

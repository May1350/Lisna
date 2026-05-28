# Workflow rules

PR / commit / branch / migration / deploy conventions.

## Branches

- [2026-05-12] (branch) Feature branches off `main`, named `fix/<slug>`, `feat/<slug>`, `chore/<slug>`, `refactor/<slug>`. Reason: PR list scannability. last-cited: 2026-05-12
- [2026-05-12] (branch) Never push directly to `main`. All merges via PR. Reason: review trail. last-cited: 2026-05-12
- [2026-05-12] (branch) Long-lived worktree branches (e.g. `worktree-web-redesign`) require periodic `Merge main into ...` to avoid drift. Reason: late-stage merge pain. last-cited: 2026-05-12

## Commits

- [2026-05-12] (commit) Subject format: `type(scope): summary`. Types: `fix`, `feat`, `chore`, `refactor`, `docs`. Scope optional. ≤ 72 chars. Reason: matches existing `git log` style. last-cited: 2026-05-12
- [2026-05-12] (commit) Reference tracking IDs (`F-O-11`, etc.) in subject when applicable. Reason: traceability to issue/launch checklist. last-cited: 2026-05-12
- [2026-05-12] (commit) One concern per commit. If a refactor enables a bug fix, two commits. Reason: bisectability. last-cited: 2026-05-12

## PRs

- [2026-05-12] (pr) PR body uses `.github/PULL_REQUEST_TEMPLATE.md`: Summary, Test plan, Related backlog/issue. Reason: review consistency. last-cited: 2026-05-12
- [2026-05-12] (pr) PR closes a backlog item OR an issue OR is explicitly marked "ad-hoc fix" in description. No silent drive-by PRs. Reason: backlog hygiene. last-cited: 2026-05-12
- [2026-05-12] (pr) Open as DRAFT until self-review is done. Reason: avoids premature CI runs / reviewer churn. last-cited: 2026-05-12

## Migrations

- [2026-05-12] (migration) New migration: `backend/src/migrations/NNN_<slug>.sql` with monotonic NNN. Check the highest existing NNN before naming. Reason: gaps cause runner confusion. last-cited: 2026-05-12
- [2026-05-12] (migration) Migrations run via `lib/migrate.ts` (transactional). Don't run them ad-hoc with psql in prod. Reason: schema_migrations table tracking. last-cited: 2026-05-12
- [2026-05-12] (migration) Destructive migrations (DROP COLUMN, etc.) need a deploy gap: ship migration that stops writing in deploy N, ship the DROP in deploy N+1. Reason: zero-downtime. last-cited: 2026-05-12

## Deploy

- [2026-05-12] (deploy) Backend: `pnpm cdk deploy --all --require-approval never`. Single stack: `pnpm cdk deploy StudyHelperApi`. Reason: stack list lives in `infra/lib/`. last-cited: 2026-05-12
- [2026-05-12] (deploy) Extension: `cd extension && pnpm build` → `dist/` → Chrome `Load unpacked`. For Web Store: bump version in `manifest.config.ts`. Reason: Web Store rejects duplicate versions. last-cited: 2026-05-12
- [2026-05-12] (deploy) After Chrome Web Store publish: lock CORS via `pnpm cdk deploy StudyHelperApi -c allowedCorsOrigins=chrome-extension://<id>`. Reason: pre-publish CORS is `*`. last-cited: 2026-05-12

## Reviewers / agent dispatch

- [2026-05-27] (dispatch) Before dispatching a reviewer / sub-agent OR before treating an uncommitted file as "my prior draft," re-verify state with `git status` + `git diff HEAD` + `git log -5`. Stale-snapshot reasoning has caused redundant reviewer cycles (spike-0.1 R1/R2 both received obsolete drafts; decision memo Resolution section read 2nd time after fact-check). Reason: time-passed + agent-dispatched contexts invalidate the mental cache. last-cited: 2026-05-27
- [2026-05-27] (dispatch) When dispatching reviewers on an artifact, send the CURRENT artifact path + git HEAD SHA, not pasted draft text. Reviewer value = artifact-vs-evidence comparison, not narrative-vs-evidence. Reason: pasted prose drifts from the committed file the moment a follow-up commit lands. last-cited: 2026-05-27
- [2026-05-27] (dispatch) SDD implementer prompts MUST include an explicit completion contract: "do not report back until the commit lands; early status = BLOCKED escalation." Without this, subagents (sonnet/haiku) report DONE after a failing-test step and never execute impl/commit steps, requiring SendMessage recovery. Reason: 2026-05-27 Plan 2 Tasks 2+3 each wasted ~10 min on truncate-then-resume; Tasks 4-18 with the contract completed in one shot. last-cited: 2026-05-27
- [2026-05-28] (lanes) Before starting work in a role-session, check `.claude/lanes.md` for the current worktree's declared lane + owned directories. If staged files include paths outside the owned set AND outside shared seams, either re-home work to the right lane's worktree OR add a `Cross-lane: <from> → <to>` trailer to the commit body (git-trailer convention; the subject stays standard `type(scope): summary` per commit-msg hook). Reason: without declared ownership, two parallel sessions silently diverge on the same file — next session's `git status` reads a dirty worktree with no provenance (2026-05-27 Plan 2 execution received a stale cross-session warning that took ~20 min to disambiguate). Soft-warned by pre-commit-check.sh section 7. last-cited: 2026-05-28
- [2026-05-28] (dispatch) Before creating a worktree + dispatching SDD for a plan, verify the work does not ALREADY exist: `ls <plan-output-dir>` + `git branch -a | grep <lane-branch>` + `git ls-remote origin '<lane-glob>'`. A parallel session may have already executed AND pushed the plan; a freshly-created local worktree does NOT reveal a remote branch. Extends `feedback_check_plan_status_before_sdd` (git log + ls outputs) to the multi-session / remote-branch case. Reason: 2026-05-28 Plan 7 was already complete + pushed on `origin/feat/v2-eval-harness` by a parallel session; this session skipped the check, dispatched redundant Task 0/1, and the resulting confusion contaminated the main repo. last-cited: 2026-05-28
- [2026-05-28] (dispatch) Implementer / reviewer subagents operate ONLY inside their assigned worktree path. They MUST NOT `cd` to another repo or run `git checkout` / `git pull` / `git branch -D` / `git reset` against any shared branch. On unexpected git state they report BLOCKED — never attempt repository surgery. Pin this in every dispatch prompt ("run `pwd` before each git command; confirm it ends in the worktree path"). Controller verifies post-task with `git status` + `git branch --show-current` in BOTH the worktree AND the shared repo — the subagent self-report hides breaches. Reason: 2026-05-28 a haiku Task 1 implementer ran `git checkout main` + `git pull --ff-only` + committed onto `main` in the SHARED repo and the local `spec/v2-note-creation-design` branch ended up deleted; ~20 min reflog recovery. last-cited: 2026-05-28

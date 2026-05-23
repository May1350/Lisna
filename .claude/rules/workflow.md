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

# Operations — GitHub-side guards

Runtime guards enforced by GitHub / repo settings, NOT by code. When a
session hits unexpected `git push` / `gh pr merge` rejection, open this
file BEFORE diagnosing.

## Guards in effect

- [2026-05-24] (ruleset) `main` is ruleset-protected: requires PR, status checks `ci` + `desktop-ci` both green, blocks force-push, blocks deletion, no signed-commits / linear-history requirement. Reason: enforces CLAUDE.md rule #3 — direct `git push origin main` is rejected at the remote with "protected branch hook declined". last-cited: 2026-05-24
- [2026-05-24] (auto-delete) "Automatically delete head branches" ON in repo Settings → General → Pull Requests. Reason: head branch is auto-removed by GitHub when PR merges; no manual cleanup needed. Verified live (PR #20, #21 branches deleted automatically on merge). last-cited: 2026-05-24
- [2026-05-24] (secret-scanning) Secret scanning + push protection ON in Settings → Advanced Security. Reason: commits containing recognised secret patterns (Stripe `sk_live_…`, AWS `AKIA…`, etc.) are blocked at push time. Scan baseline clean (verified 2026-05-24). last-cited: 2026-05-24
- [2026-05-24] (codeql) CodeQL code scanning ON (default-setup language matrix: actions, javascript-typescript, c-cpp). Reason: passive vulnerability check on every PR. NOT in the ruleset required-checks list, so CodeQL failure does NOT block merge — investigate via Security tab. last-cited: 2026-05-24
- [2026-05-24] (dependabot) Dependabot security updates + version updates ON. Reason: produces automatic PRs for upstream vulnerabilities (e.g. PR #20 next 16.2.4 → 16.2.6 security patch). Dependabot PRs use a SEPARATE secrets scope (Settings → Secrets → Dependabot tab) — see `(ci-secrets)` below. last-cited: 2026-05-24
- [2026-05-24] (ci-secrets) CI `Web — build` step uses `${{ secrets.NEXTAUTH_URL || 'https://example.com' }}` fallback pattern (introduced PR #21). Reason: lets Dependabot PRs build without secret duplication. Don't strip the fallback when adding new secrets — instead add the same fallback for each. last-cited: 2026-05-24
- [2026-05-24] (deploy-backend) `.github/workflows/deploy-backend.yml` deploys ALL CDK stacks via OIDC on main push to `backend/**`, `shared/**`, lockfile, or the workflow itself. Also `workflow_dispatch`. Concurrency group `deploy-backend-${ref}` with `cancel-in-progress: false` — never cancel a deploy mid-flight (partial CDK deploys leave Cloudformation in UPDATE_IN_PROGRESS). Requires `AWS_DEPLOY_ROLE_ARN` repo secret. last-cited: 2026-05-24
- [2026-05-24] (migrate) `.github/workflows/migrate.yml` is `workflow_dispatch` only — requires a typed `reason` string for audit trail. Invokes the CDK-managed MigrateFn Lambda (resolved via name prefix). Output includes the last 4 KB of CloudWatch logs so failures are debuggable from the run page. last-cited: 2026-05-24
- [2026-05-24] (monitor-backend) `.github/workflows/monitor-backend.yml` runs cron `0 */6 * * *`. Scans `${LOG_GROUP_PREFIX}*` for `ERROR|Timeout|Throttle|Exception`. On hit, opens (or comments on) a single open issue labelled `cloudwatch-alert`. Skips silently on schedule if OIDC secret missing; fails loudly on manual run. last-cited: 2026-05-24
- [2026-05-24] (oidc) GitHub Actions → AWS auth uses OIDC (no static keys). Setup: IAM → Identity providers → Add `token.actions.githubusercontent.com` with audience `sts.amazonaws.com` → create IAM Role with trust policy scoped to `repo:May1350/Lisna:ref:refs/heads/main` (or wildcard during initial testing) → grant deploy permissions (CDK requires CloudFormation/IAM/Lambda/RDS/S3/SecretsManager/VPC + APIGateway) → put Role ARN into repo secret `AWS_DEPLOY_ROLE_ARN` + Dependabot secret (same name/value). Reason: static AWS access keys in GitHub secrets are a long-running credential risk. last-cited: 2026-05-24

## What to do when you hit one

### `! [remote rejected] main -> main (refusing to allow ...)` on push

You tried to push to `main` directly. The ruleset blocks this — CLAUDE.md rule #3 says so for a reason. Open a branch (`fix/...`, `feat/...`, `chore/...`), commit there, open a PR. The ruleset will let the PR merge once `ci` + `desktop-ci` are green.

### Push blocked by "Push cannot contain secrets"

GitHub push protection caught a secret-shaped string. Do NOT bypass it with `--no-verify`. Steps:
1. Identify the secret (the error message names file + line).
2. If it's a real secret: **rotate it first** (revoke at the source — Stripe dashboard, AWS IAM, etc.), then remove from the diff.
3. If it's a false positive: report-it-as-such via the GitHub UI link in the error, then re-push.

### CodeQL annotation on a PR

CodeQL ran and found something. It does NOT block merge. Decide:
- High/critical severity → fix in this PR or a follow-up before merging.
- Low/medium with clear false-positive → dismiss with reason on the Security tab.

### Dependabot PR failing only `Web — build`

If the failure is `Process completed with exit code 1` on the Next.js build step and the fallback envs are present in `ci.yml` (introduced PR #21), Dependabot might be running against a base before the fallback landed. Comment `@dependabot rebase` on the PR to pull current main.

### `deploy-backend.yml` fails with "AWS_DEPLOY_ROLE_ARN secret not configured"

One-time OIDC setup is missing. Steps:

1. **AWS Console → IAM → Identity providers → Add provider**
   - Type: OpenID Connect
   - URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`

2. **IAM → Roles → Create role** (Web identity)
   - Identity provider: the one just created
   - Audience: `sts.amazonaws.com`
   - GitHub org: `May1350`, repo: `Lisna`, branch: `main` (or `*` for first test)
   - Permissions: `PowerUserAccess` (quick) OR fine-grained: CloudFormation + IAM + Lambda + RDS + S3 + SecretsManager + VPC + APIGateway
   - Name: `GitHubActionsLisnaDeploy`
   - Copy the resulting Role ARN

3. **GitHub repo → Settings → Secrets and variables → Actions**
   - New repo secret: `AWS_DEPLOY_ROLE_ARN` = the ARN
   - Also add under the **Dependabot** tab (same name/value) per `(ci-secrets)` rule

4. **Test**: Actions tab → Deploy Backend → Run workflow on `main`.

### `migrate.yml` says "No Lambda matching prefix 'MigrateFn'"

The CDK stack hasn't deployed yet — run `Deploy Backend` first. Or the construct name changed; update `MIGRATE_FN_NAME_PREFIX` in `migrate.yml` to match the new construct name.

### `monitor-backend.yml` opens duplicate `cloudwatch-alert` issues

Should not happen — the script checks for an existing open issue with the label before creating a new one. If you see duplicates, the previous one likely got closed between scans. Close all but the latest manually; the next scan will respect the survivor.

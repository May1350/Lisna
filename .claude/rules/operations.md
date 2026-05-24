# Operations — GitHub-side guards

Runtime guards enforced by GitHub / repo settings, NOT by code. When a
session hits unexpected `git push` / `gh pr merge` rejection, open this
file BEFORE diagnosing.

## Guards in effect

- [2026-05-24] (ruleset) `main` is ruleset-protected: requires PR, status checks `ci` + `desktop-ci` both green, blocks force-push, blocks deletion, no signed-commits / linear-history requirement. Reason: enforces CLAUDE.md rule #3 — direct `git push origin main` is rejected at the remote with "protected branch hook declined". last-cited: 2026-05-24
- [2026-05-24] (auto-delete) "Automatically delete head branches" ON in repo Settings → General → Pull Requests. Reason: head branch is auto-removed by GitHub when PR merges; no manual cleanup needed. Verified live (PR #20, #21 brunches deleted automatically on merge). last-cited: 2026-05-24
- [2026-05-24] (secret-scanning) Secret scanning + push protection ON in Settings → Advanced Security. Reason: commits containing recognised secret patterns (Stripe `sk_live_…`, AWS `AKIA…`, etc.) are blocked at push time. Scan baseline clean (verified 2026-05-24). last-cited: 2026-05-24
- [2026-05-24] (codeql) CodeQL code scanning ON (default-setup language matrix: actions, javascript-typescript, c-cpp). Reason: passive vulnerability check on every PR. NOT in the ruleset required-checks list, so CodeQL failure does NOT block merge — investigate via Security tab. last-cited: 2026-05-24
- [2026-05-24] (dependabot) Dependabot security updates + version updates ON. Reason: produces automatic PRs for upstream vulnerabilities (e.g. PR #20 next 16.2.4 → 16.2.6 security patch). Dependabot PRs use a SEPARATE secrets scope (Settings → Secrets → Dependabot tab) — see `(ci-secrets)` below. last-cited: 2026-05-24
- [2026-05-24] (ci-secrets) CI `Web — build` step uses `${{ secrets.NEXTAUTH_URL || 'https://example.com' }}` fallback pattern (introduced PR #21). Reason: lets Dependabot PRs build without secret duplication. Don't strip the fallback when adding new secrets — instead add the same fallback for each. last-cited: 2026-05-24

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

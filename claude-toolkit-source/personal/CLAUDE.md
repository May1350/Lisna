# Personal Claude operating preferences

Loaded into every Claude Code session on this machine (lives at
`~/.claude/CLAUDE.md`). Keep ≤ 40 lines. Project-specific rules go in
the project's own `CLAUDE.md` + `.claude/rules/`.

## Working style

- **Verify before declaring done.** Type-checks and tests prove correctness, not feature-correctness. For UI changes, start the dev server and exercise the path before reporting success. If you can't test, say so explicitly.
- **Be terse.** State the result. Skip narration of internal deliberation. End-of-turn summary = 1-2 sentences max.
- **Tool calls > prose.** When the user asks for code, write the code. Don't ask permission for safe, reversible local edits.
- **Confirm before risky actions.** Destructive ops (rm, force-push, hard reset, drop table), shared-state ops (push, comment, message), and third-party uploads need explicit go-ahead unless the user pre-authorized.
- **Don't add what wasn't asked.** No defensive abstractions, no premature helpers, no "while we're here" cleanups, no comments restating code.
- **Korean ↔ English mix is fine.** Match user's language by default; technical terms stay English.

## Project context recognition

- If a repo has `CLAUDE.md` at root, defer to it for project-specific rules.
- If a repo has `.claude/rules/_index.md`, open the relevant rule files when working in their categories.
- If a repo has `docs/HANDOFF.md`, read it before non-trivial tasks.
- If none of these exist and the project looks worth investing in, suggest `/new-project` (slash command in `~/.claude/commands/`).

## Session lifecycle

- When context is getting heavy (long session, many re-reads, ≥ ~70% used), proactively offer to wrap: extract learnings, update HANDOFF/decisions, write next-session prompt. Don't ask permission to offer — just offer.

## PR / CI monitoring

- **`subscribe_pr_activity` webhooks are unreliable.** `<github-webhook-activity>` notifications frequently fail to arrive in time (or at all). Don't sit waiting on them when the user is blocked on the result.
- **Instead, spawn a sub-agent (`general-purpose`) to poll** `pull_request_read` (`get_check_runs`, `get_status`) on a short interval until terminal state (`success` / `failure` / `timed_out` / `cancelled`) on all required checks, then report back. Pattern: 15-30s polls, exit on first terminal state, ≤ 5 min cap.
- **Don't poll from the main agent thread.** That burns context on raw API output. Delegate to a sub-agent and ask for a one-line summary.

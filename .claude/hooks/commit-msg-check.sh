#!/usr/bin/env bash
# Commit-msg hook — validates subject against CLAUDE.md rule #4.
# Installed by .claude/hooks/session-start.sh as .git/hooks/commit-msg.

set -u
MSG_FILE="${1:-}"
[ -z "$MSG_FILE" ] && exit 0
[ -f "$MSG_FILE" ] || exit 0

SUBJECT="$(head -n1 "$MSG_FILE")"

# Skip auto-generated subjects we can't / shouldn't second-guess.
case "$SUBJECT" in
  "Merge "*|"Revert "*|"fixup! "*|"squash! "*|"amend! "*) exit 0 ;;
esac

# Length cap (CLAUDE.md rule #4)
if [ "${#SUBJECT}" -gt 72 ]; then
  echo "commit-msg-check FAIL: subject is ${#SUBJECT} chars (max 72)."
  echo "  → $SUBJECT"
  echo "Reword. CLAUDE.md rule #4: 'Subject ≤ 72 chars'."
  exit 1
fi

# Type-prefix check.
# Allowed types match workflow.md plus widely-accepted extras (test, ci, build, perf, revert).
if ! printf '%s' "$SUBJECT" | grep -qE '^(fix|feat|chore|refactor|docs|test|perf|ci|style|build|revert)(\([^)]+\))?(!)?: .+'; then
  echo "commit-msg-check FAIL: subject must start with 'type(scope): summary' or 'type: summary'."
  echo "  → $SUBJECT"
  echo "Allowed types: fix, feat, chore, refactor, docs, test, perf, ci, style, build, revert."
  echo "See CLAUDE.md rule #4 + .claude/rules/workflow.md (commit)."
  exit 1
fi

exit 0

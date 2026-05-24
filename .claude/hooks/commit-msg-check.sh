#!/usr/bin/env bash
# Commit-msg hook — validates subject against CLAUDE.md rule #4.
# Installed by .claude/hooks/session-start.sh as .git/hooks/commit-msg.

set -u
MSG_FILE="${1:-}"
[ -z "$MSG_FILE" ] && exit 0
[ -f "$MSG_FILE" ] || exit 0

SUBJECT="$(sed -n '1p' "$MSG_FILE")"

# Skip auto-generated subjects we can't / shouldn't second-guess.
case "$SUBJECT" in
  "Merge "*|"Revert "*|"fixup! "*|"squash! "*|"amend! "*) exit 0 ;;
esac

# Character count (NOT byte count — `${#x}` in bash counts bytes which would
# falsely reject Japanese / emoji subjects below the visual 72-char limit).
# `wc -m` counts characters under any UTF-8 locale; falls back gracefully.
LEN="$(printf '%s' "$SUBJECT" | LC_ALL=C.UTF-8 wc -m | tr -d ' ')"

# Length cap (CLAUDE.md rule #4)
if [ "$LEN" -gt 72 ]; then
  echo "commit-msg-check FAIL: subject is $LEN chars (max 72)."
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

# Body separator: if a body exists, line 2 must be blank (Conventional Commits + kernel style).
TOTAL_LINES="$(wc -l < "$MSG_FILE")"
if [ "$TOTAL_LINES" -ge 2 ]; then
  SECOND_LINE="$(sed -n '2p' "$MSG_FILE")"
  if [ -n "$SECOND_LINE" ]; then
    echo "commit-msg-check FAIL: missing blank line between subject and body."
    echo "  Insert an empty line after the subject."
    exit 1
  fi
fi

exit 0

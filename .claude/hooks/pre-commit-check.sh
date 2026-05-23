#!/usr/bin/env bash
# Pre-commit sanity checks. Run by hand or wire to .git/hooks/pre-commit.
# Exits non-zero on hard failures so the commit aborts.

set -u
FAIL=0

cd "$(git rev-parse --show-toplevel)" || exit 1

# 1. CLAUDE.md line cap
if [ -f "CLAUDE.md" ]; then
  LINES="$(wc -l < CLAUDE.md)"
  if [ "$LINES" -gt 150 ]; then
    echo "FAIL: CLAUDE.md is $LINES lines (cap 150). Run /rules-compress."
    FAIL=1
  fi
fi

# 2. Migration numbering
MIG_DIR="backend/src/migrations"
if [ -d "$MIG_DIR" ]; then
  PREV=0
  for f in $(ls "$MIG_DIR"/*.sql 2>/dev/null | sort); do
    NUM="$(basename "$f" | grep -oE '^[0-9]+' || echo 0)"
    if [ "$NUM" -eq "$PREV" ]; then
      echo "FAIL: migration $f has DUPLICATE number $NUM (collides with previous)"
      FAIL=1
    elif [ "$NUM" -lt "$PREV" ]; then
      echo "FAIL: migration $f out of order ($NUM < $PREV)"
      FAIL=1
    fi
    PREV="$NUM"
  done
fi

# 3. Block direct edits to root CLAUDE.md unless committer also touched .claude/rules/ or it's a meta commit
STAGED="$(git diff --cached --name-only)"
if echo "$STAGED" | grep -qx "CLAUDE.md"; then
  if ! echo "$STAGED" | grep -q "^\.claude/rules/"; then
    if ! echo "$STAGED" | grep -q "^\.claude/commands/"; then
      echo "WARN: CLAUDE.md edited without touching .claude/rules/ or .claude/commands/."
      echo "      Rules should go through /learn → .claude/rules/<file>.md."
      echo "      Override: commit with --no-verify if this is intentional (top-20 update)."
    fi
  fi
fi

# 4. Rule format sanity — every rule line should have last-cited
if [ -d ".claude/rules" ]; then
  BAD="$(grep -L 'last-cited:' .claude/rules/*.md 2>/dev/null | grep -v '_index.md' | grep -v 'archived')"
  for f in $BAD; do
    if grep -q '^- \[20' "$f"; then
      echo "WARN: $f has rule lines without last-cited:"
    fi
  done
fi

if [ "$FAIL" -eq 0 ]; then
  echo "pre-commit-check: ok"
fi
exit "$FAIL"

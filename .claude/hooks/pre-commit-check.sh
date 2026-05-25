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

# 5. i18n consistency — when a commit touches `web/`, every key in en.json
# must exist in ja.json and ko.json (and vice versa). Hard fail on parity
# breaks; warnings (value parity, hardcoded CJK) surface but don't block —
# CI runs in strict mode for full enforcement. See .claude/skills/i18n-check
# for resolution recipes.
if echo "$STAGED" | grep -qE '^web/(src/(app|components|messages|i18n)/|scripts/check-i18n\.mjs$)'; then
  if [ -f "web/scripts/check-i18n.mjs" ]; then
    if ! node web/scripts/check-i18n.mjs; then
      echo "FAIL: i18n check failed (key parity)."
      echo "      Run \`pnpm --filter lisna-web check:i18n\` locally for details."
      echo "      See .claude/skills/i18n-check/SKILL.md for resolution steps."
      FAIL=1
    fi
  fi
fi

# 6. New backend handlers MUST have a matching test (testing.md mandates one
# for every new route). Fail-by-default; explicit env override leaves an
# audit trail in shell history instead of being a silent "warning ignored".
NEW_HANDLERS="$(echo "$STAGED" | grep -E '^backend/src/handlers/[^/]+\.ts$' || true)"
for h in $NEW_HANDLERS; do
  if git diff --cached --name-status -- "$h" 2>/dev/null | grep -q '^A'; then
    base="$(basename "$h" .ts)"
    if ! find backend/tests -name "${base}*.test.ts" 2>/dev/null | grep -q .; then
      if [ "${SKIP_HANDLER_TEST_CHECK:-0}" = "1" ]; then
        echo "WARN: new handler $h has no test (override: SKIP_HANDLER_TEST_CHECK=1)."
      else
        echo "FAIL: new handler $h needs a test in backend/tests/**/${base}*.test.ts."
        echo "      .claude/rules/testing.md mandates it for every new backend route."
        echo "      Audited override: SKIP_HANDLER_TEST_CHECK=1 git commit ..."
        FAIL=1
      fi
    fi
  fi
done

if [ "$FAIL" -eq 0 ]; then
  echo "pre-commit-check: ok"
fi
exit "$FAIL"

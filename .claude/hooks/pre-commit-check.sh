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

# 7. Lane boundary soft warning. Reads `.claude/lanes.md` parseable block.
# Warns (does NOT block) when staged files fall outside the current
# worktree's owned dirs AND outside shared seams. See .claude/lanes.md.
LANES_FILE=".claude/lanes.md"
if [ -f "$LANES_FILE" ]; then
  MAIN_PATH="$(git worktree list --porcelain | awk '/^worktree / {print $2; exit}')"
  CURRENT_PATH="$(pwd)"
  if [ "$MAIN_PATH" = "$CURRENT_PATH" ]; then
    CURRENT_WT="."
  else
    CURRENT_WT="${CURRENT_PATH#$MAIN_PATH/}"
  fi

  PARSEABLE="$(awk '/^<!-- BEGIN PARSEABLE -->/,/^<!-- END PARSEABLE -->/' "$LANES_FILE" | sed '1d;$d')"
  LANE_ROW="$(echo "$PARSEABLE" | awk -F'|' -v wt="$CURRENT_WT" '$1 == wt {print; exit}')"
  SEAMS_LINE="$(echo "$PARSEABLE" | grep '^seams: ' | sed 's/^seams: //')"

  if [ -z "$LANE_ROW" ]; then
    echo "WARN: worktree '$CURRENT_WT' not listed in .claude/lanes.md — add an entry before pushing."
  else
    OWNED="$(echo "$LANE_ROW" | awk -F'|' '{print $2}')"
    LANE_NAME="$(echo "$LANE_ROW" | awk -F'|' '{print $3}')"
    OUT_OF_LANE=""
    for f in $STAGED; do
      IN_OWNED=0
      for dir in $OWNED; do
        case "$f" in "$dir"*) IN_OWNED=1; break;; esac
      done
      IN_SEAM=0
      for seam in $SEAMS_LINE; do
        case "$f" in "$seam"*) IN_SEAM=1; break;; esac
      done
      if [ "$IN_OWNED" -eq 0 ] && [ "$IN_SEAM" -eq 0 ]; then
        OUT_OF_LANE="$OUT_OF_LANE $f"
      fi
    done
    if [ -n "$OUT_OF_LANE" ]; then
      # Skip warning if commit subject is already cross-lane tagged.
      # The hook can't see the message at PreCommitUse time, so just
      # show the warning every time; founder ignores when intentional.
      echo "WARN: lane '$LANE_NAME' (worktree '$CURRENT_WT') — staged files outside owned dirs:"
      for f in $OUT_OF_LANE; do echo "  $f"; done
      echo "      Either add a 'Cross-lane: $LANE_NAME → <target>' trailer to commit body,"
      echo "      or move work to the correct lane's worktree."
      echo "      See .claude/lanes.md for ownership."
    fi
  fi
fi

if [ "$FAIL" -eq 0 ]; then
  echo "pre-commit-check: ok"
fi
exit "$FAIL"

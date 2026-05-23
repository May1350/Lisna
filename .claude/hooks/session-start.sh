#!/usr/bin/env bash
# SessionStart hook — runs once when Claude Code starts a session in this repo.
# Prints a compact briefing so the agent doesn't waste tokens re-discovering state.
# Exits 0 always — never block a session on hook failure.

set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 0

echo "=== Lisna session briefing ==="
echo "Branch:  $(git branch --show-current 2>/dev/null || echo '?')"
echo "Updated: $(date -u +%Y-%m-%dT%H:%MZ)"
echo ""

# Files Claude should know about
if [ -f "docs/HANDOFF.md" ]; then
  LAST_HANDOFF="$(grep -m1 '^\*\*Last updated\*\*' docs/HANDOFF.md | sed 's/^\*\*Last updated\*\*: //' || true)"
  echo "HANDOFF.md last updated: ${LAST_HANDOFF:-unknown}"
fi

if [ -f "CLAUDE.md" ]; then
  CLAUDE_LINES="$(wc -l < CLAUDE.md)"
  if [ "$CLAUDE_LINES" -gt 150 ]; then
    echo "WARN: CLAUDE.md is ${CLAUDE_LINES} lines (cap 150). Consider /rules-compress."
  fi
fi

# Backlog top 3
if [ -f "docs/REFACTOR_BACKLOG.md" ]; then
  echo ""
  echo "Backlog (top 3 from 'Now'):"
  awk '
    /^## Now/ { in_now=1; next }
    /^## / { in_now=0 }
    in_now && /^- / { print; count++; if (count >= 3) exit }
  ' docs/REFACTOR_BACKLOG.md || true
fi

# Uncommitted state
DIRTY="$(git status --porcelain 2>/dev/null | head -5)"
if [ -n "$DIRTY" ]; then
  echo ""
  echo "Uncommitted changes:"
  echo "$DIRTY"
fi

echo ""
echo "=== Read CLAUDE.md → top rules + index ==="
echo "=== Read docs/HANDOFF.md before non-trivial work ==="
echo ""

exit 0

# Review Automation Strengthening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a precommit review gate (mirror of existing prepush gate) + enhance both gates' brief to enforce typecheck/test execution, 9-key Lisna invariant checklist, and JSON marker validation — closing the reviewer-omission and lying-reviewer gaps that founder (who cannot read code) cannot catch.

**Architecture:** PreToolUse hook on `Bash(git commit *)` that mirrors prepush gate pattern: per-staged-tree JSON marker with fail-closed validation. Shared `_lib_marker.py` for schema. Prepush gate edited to consult precommit markers per commit in `base..HEAD` range, eliminating duplicate review. Per-project opt-in via `.claude/review-gate-on` marker (scope: main-only initially, all-worktrees after stability check). Emergency bypass via `CLAUDE_REVIEW_BYPASS` env with 60-min TTL.

**Tech Stack:** Python 3 (stdlib only — `subprocess`, `shlex`, `re`, `json`, `hashlib`, `os`, `sys`, `time`, `random`, `datetime`). Claude Code hooks (PreToolUse, SessionStart). Bash. No external deps.

**Spec:** [docs/superpowers/specs/2026-05-30-review-automation-strengthening-design.md](../specs/2026-05-30-review-automation-strengthening-design.md) (commit `cf3172d`).

---

## Pre-flight checklist (Phase 0 — backup)

### Task 0: Backup existing global hook config

**Files:**
- Backup: `~/.claude/settings.json` → `~/.claude/settings.json.backup-YYYYMMDD`
- Backup: `~/.claude/hooks/prepush-review-gate.py` → `~/.claude/hooks/prepush-review-gate.py.backup-YYYYMMDD`

- [ ] **Step 1: Verify existing files exist**

Run:
```bash
ls -la ~/.claude/settings.json ~/.claude/hooks/prepush-review-gate.py
```
Expected: Both files listed, no errors.

- [ ] **Step 2: Create timestamped backups**

Run:
```bash
DATE=$(date +%Y%m%d)
cp ~/.claude/settings.json ~/.claude/settings.json.backup-$DATE
cp ~/.claude/hooks/prepush-review-gate.py ~/.claude/hooks/prepush-review-gate.py.backup-$DATE
ls -la ~/.claude/*.backup-$DATE ~/.claude/hooks/*.backup-$DATE
```
Expected: Two `.backup-<date>` files listed.

- [ ] **Step 3: Verify settings.json parses as JSON (baseline)**

Run:
```bash
python3 -c 'import json; print(len(json.load(open("/Users/guntak/.claude/settings.json"))))'
```
Expected: Integer printed (top-level key count, currently 7 or so), no JSONDecodeError.

No commit (global ~/.claude/ is not git-tracked in Lisna repo).

---

## Phase 1 — `_lib_marker.py` (shared validation, TDD)

### Task 1: Scaffold `_lib_marker.py` with module docstring + constants

**Files:**
- Create: `~/.claude/hooks/_lib_marker.py`

- [ ] **Step 1: Write the module skeleton**

```python
"""Shared marker JSON schema + validation for precommit + prepush gates.

Single source of truth — changes here propagate to both gates atomically.
fail-closed on any defect (parse error, missing field, enum violation,
"fail" verdict in checklist).
"""
import json

ALLOWED_CHECKLIST = {"ok", "n/a", "fail"}
REQUIRED_CHECKLIST_KEYS = [
    "pool_max_2", "api_gw_30s", "withauth_zoderror", "shframe_source",
    "sentinel_guard", "function_url_cors", "content_type_json",
    "i18n_parity", "security",
]
SUPPORTED_SCHEMA_VERSIONS = {1}


def validate_marker(path):
    """Return True iff marker is honest APPROVE with green checks + valid checklist.

    fail-closed on:
    - file missing or unreadable
    - JSON parse error
    - unknown/missing schema_version
    - verdict != "APPROVE"
    - missing/non-zero checks.{typecheck,test}.exit
    - missing checklist keys
    - checklist enum violation (not in {ok, n/a, fail})
    - any checklist value == "fail" (honest fail = marker invalid)
    """
    pass  # Placeholder — implemented in Task 3
```

Write this content to `~/.claude/hooks/_lib_marker.py`.

- [ ] **Step 2: Verify module imports cleanly**

Run:
```bash
python3 -c "import sys; sys.path.insert(0, '/Users/guntak/.claude/hooks'); from _lib_marker import validate_marker, ALLOWED_CHECKLIST, REQUIRED_CHECKLIST_KEYS, SUPPORTED_SCHEMA_VERSIONS; print('OK', len(REQUIRED_CHECKLIST_KEYS))"
```
Expected: `OK 9`

No commit yet.

### Task 2: Write 10 failing unit tests for `validate_marker`

**Files:**
- Create: `~/.claude/hooks/test__lib_marker.py`

- [ ] **Step 1: Write all 10 tests in a single test module**

```python
"""Unit tests for _lib_marker.validate_marker.

Run: python3 -m unittest test__lib_marker -v
Or: cd ~/.claude/hooks && python3 -m unittest test__lib_marker
"""
import sys, os, json, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib_marker import validate_marker, REQUIRED_CHECKLIST_KEYS


def _write_marker(data):
    """Write a marker JSON to a temp file, return path."""
    f = tempfile.NamedTemporaryFile("w", suffix=".ok", delete=False)
    json.dump(data, f)
    f.close()
    return f.name


def _valid_marker_data():
    """Return a minimal valid marker dict (all 9 checklist keys = ok)."""
    return {
        "schema_version": 1,
        "reviewer_id": "test",
        "verdict": "APPROVE",
        "checks": {
            "typecheck": {"exit": 0, "duration_ms": 1000, "command": "pnpm typecheck"},
            "test": {"exit": 0, "duration_ms": 1000, "command": "pnpm test"},
        },
        "checklist": {k: "ok" for k in REQUIRED_CHECKLIST_KEYS},
        "approved_at_unix": 1748600000,
    }


class TestValidateMarker(unittest.TestCase):

    def test_01_valid_full_marker_returns_true(self):
        p = _write_marker(_valid_marker_data())
        self.assertTrue(validate_marker(p))

    def test_02_empty_file_returns_false(self):
        f = tempfile.NamedTemporaryFile(suffix=".ok", delete=False)
        f.close()
        self.assertFalse(validate_marker(f.name))

    def test_03_missing_checklist_key_returns_false(self):
        data = _valid_marker_data()
        del data["checklist"]["pool_max_2"]
        p = _write_marker(data)
        self.assertFalse(validate_marker(p))

    def test_04_typecheck_exit_nonzero_returns_false(self):
        data = _valid_marker_data()
        data["checks"]["typecheck"]["exit"] = 1
        p = _write_marker(data)
        self.assertFalse(validate_marker(p))

    def test_05_unknown_schema_version_returns_false(self):
        data = _valid_marker_data()
        data["schema_version"] = 999
        p = _write_marker(data)
        self.assertFalse(validate_marker(p))

    def test_06_enum_violation_returns_false(self):
        data = _valid_marker_data()
        data["checklist"]["pool_max_2"] = "yes"  # not in {ok, n/a, fail}
        p = _write_marker(data)
        self.assertFalse(validate_marker(p))

    def test_07_honest_fail_value_returns_false(self):
        data = _valid_marker_data()
        data["checklist"]["security"] = "fail"
        p = _write_marker(data)
        self.assertFalse(validate_marker(p))

    def test_08_missing_top_level_checklist_returns_false(self):
        data = _valid_marker_data()
        del data["checklist"]
        p = _write_marker(data)
        self.assertFalse(validate_marker(p))

    def test_09_missing_top_level_verdict_returns_false(self):
        data = _valid_marker_data()
        del data["verdict"]
        p = _write_marker(data)
        self.assertFalse(validate_marker(p))

    def test_10_missing_schema_version_returns_false(self):
        data = _valid_marker_data()
        del data["schema_version"]
        p = _write_marker(data)
        self.assertFalse(validate_marker(p))


if __name__ == "__main__":
    unittest.main()
```

Write to `~/.claude/hooks/test__lib_marker.py`.

- [ ] **Step 2: Run tests, verify all 10 FAIL (validate_marker is a placeholder)**

Run:
```bash
cd ~/.claude/hooks && python3 -m unittest test__lib_marker -v 2>&1 | tail -20
```
Expected: `FAILED (failures=10)` or similar — all 10 tests fail because validate_marker returns None.

### Task 3: Implement `validate_marker` to pass all 10 tests

**Files:**
- Modify: `~/.claude/hooks/_lib_marker.py:25` (replace `pass` placeholder)

- [ ] **Step 1: Replace `validate_marker` body with real impl**

In `~/.claude/hooks/_lib_marker.py`, replace the `validate_marker` function body:

```python
def validate_marker(path):
    """Return True iff marker is honest APPROVE with green checks + valid checklist.

    fail-closed on:
    - file missing or unreadable
    - JSON parse error
    - unknown/missing schema_version
    - verdict != "APPROVE"
    - missing/non-zero checks.{typecheck,test}.exit
    - missing checklist keys
    - checklist enum violation (not in {ok, n/a, fail})
    - any checklist value == "fail" (honest fail = marker invalid)
    """
    try:
        with open(path) as f:
            data = json.load(f)
    except (IOError, OSError, json.JSONDecodeError):
        return False
    if data.get("schema_version") not in SUPPORTED_SCHEMA_VERSIONS:
        return False
    if data.get("verdict") != "APPROVE":
        return False
    checks = data.get("checks", {})
    for kind in ("typecheck", "test"):
        c = checks.get(kind)
        if not isinstance(c, dict):
            return False
        if c.get("exit") != 0:
            return False
    checklist = data.get("checklist", {})
    if not isinstance(checklist, dict):
        return False
    for k in REQUIRED_CHECKLIST_KEYS:
        v = checklist.get(k)
        if v not in ALLOWED_CHECKLIST:
            return False
        if v == "fail":
            return False
    return True
```

- [ ] **Step 2: Run tests, verify all 10 PASS**

Run:
```bash
cd ~/.claude/hooks && python3 -m unittest test__lib_marker -v 2>&1 | tail -20
```
Expected: `Ran 10 tests in ... OK`. No failures.

- [ ] **Step 3: Verify py_compile**

Run:
```bash
python3 -m py_compile ~/.claude/hooks/_lib_marker.py
echo "exit=$?"
```
Expected: `exit=0` (no output before that).

No commit (~/.claude/ is not in repo).

---

## Phase 2 — `precommit-review-gate.py` (the new gate)

This phase implements the precommit gate in vertical slices: helpers → command parsing → opt-in → bypass → tree/stats → loop counter → main flow → brief. Each task adds one tier.

### Task 4: Scaffold precommit-review-gate.py with module-level setup

**Files:**
- Create: `~/.claude/hooks/precommit-review-gate.py`

- [ ] **Step 1: Write module header + constants + sys.path bootstrap**

```python
#!/usr/bin/env python3
"""PreToolUse gate on `git commit`: require independent reviewer per staged tree.

Mirror of prepush-review-gate.py with these differences:
- Matcher: Bash(git commit *)
- Marker key: tree SHA (not HEAD SHA) — works on -a, amend, stash-snapshot
- Marker format: JSON (not touch) — encodes checks + checklist verdicts
- Opt-in: project must have .claude/review-gate-on marker file
- Trivial-skip: small diffs (<10 ins, <10 del, <3 files) pass without review
"""
import sys
import os
import re
import json
import shlex
import time
import random
import hashlib
import subprocess
import datetime

# === Bootstrap: sys.path for _lib_marker ===
_HOOK_DIR = os.path.dirname(os.path.abspath(__file__))
if _HOOK_DIR not in sys.path:
    sys.path.insert(0, _HOOK_DIR)
try:
    from _lib_marker import validate_marker
except ImportError:
    # FAIL-CLOSED at module load: validation unavailable = lying reviewer can pass.
    # Emit deny JSON and exit. (Cannot call deny() helper — not defined yet.)
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason":
            "_lib_marker.py missing — review gate cannot validate. "
            "Install ~/.claude/hooks/_lib_marker.py or rollback per "
            "docs/superpowers/specs/2026-05-30-review-automation-strengthening-design.md."
    }}))
    sys.exit(0)

PRECOMMIT_MARKER_DIR = os.path.expanduser("~/.claude/precommit-reviews")
BYPASS_LOG = os.path.expanduser("~/.claude/review-bypass-log.jsonl")
CLEANUP_DAYS = 3
CLEANUP_SAMPLE_RATE = 0.01
TRIVIAL_INS = 10
TRIVIAL_DEL = 10
TRIVIAL_FILES = 3
BYPASS_TTL_SECONDS = 60 * 60
LOOP_DETECTION_THRESHOLD = 3

os.makedirs(PRECOMMIT_MARKER_DIR, exist_ok=True)
```

Write to `~/.claude/hooks/precommit-review-gate.py` and `chmod +x` it.

- [ ] **Step 2: Make executable + verify py_compile**

Run:
```bash
chmod +x ~/.claude/hooks/precommit-review-gate.py
python3 -m py_compile ~/.claude/hooks/precommit-review-gate.py
echo "exit=$?"
```
Expected: `exit=0`.

- [ ] **Step 3: Verify _lib_marker import path works**

Run:
```bash
python3 -c "exec(open('/Users/guntak/.claude/hooks/precommit-review-gate.py').read())" </dev/null
echo "exit=$?"
```
Expected: `exit=0` (module loads, but main() isn't called because there's no `if __name__ == "__main__"` block yet — that's fine for now).

### Task 5: Add 7 helper functions

**Files:**
- Modify: `~/.claude/hooks/precommit-review-gate.py` (append helpers after constants)

- [ ] **Step 1: Append helper definitions**

Append to `~/.claude/hooks/precommit-review-gate.py`:

```python


# === Helpers ===

def run_git(*args):
    """Run git subprocess with 10s timeout. Returns CompletedProcess or None."""
    try:
        return subprocess.run(
            ["git", *args], capture_output=True, text=True, timeout=10)
    except Exception:
        return None


def ok(r):
    """True if subprocess succeeded with non-empty stdout."""
    return r is not None and r.returncode == 0 and bool(r.stdout.strip())


def allow():
    """Exit cleanly — hook returns no decision → tool proceeds normally."""
    sys.exit(0)


def allow_with_warning(msg):
    """Allow + emit warning to stderr (for bypass banner etc)."""
    sys.stderr.write(msg + "\n")
    sys.exit(0)


def deny(reason):
    """Block the tool call with reason string shown to model + user."""
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


def read_command_from_stdin():
    """Parse hook stdin payload, extract command string. Returns '' on failure."""
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        return (payload.get("tool_input", {}) or {}).get("command", "") or ""
    except Exception:
        return ""


def sampled_cleanup(marker_dir, days):
    """1% probabilistic prune of markers older than `days`. Never fatal."""
    if random.random() >= CLEANUP_SAMPLE_RATE:
        return
    try:
        cutoff = time.time() - days * 86400
        for name in os.listdir(marker_dir):
            if not (name.endswith(".ok") or name.endswith(".attempts")):
                continue
            p = os.path.join(marker_dir, name)
            try:
                if os.path.getmtime(p) < cutoff:
                    os.remove(p)
            except OSError:
                pass
    except OSError:
        pass
```

- [ ] **Step 2: Verify py_compile**

Run:
```bash
python3 -m py_compile ~/.claude/hooks/precommit-review-gate.py
echo "exit=$?"
```
Expected: `exit=0`.

- [ ] **Step 3: Smoke test helpers (read_command_from_stdin)**

Run:
```bash
echo '{"tool_input":{"command":"git commit -m test"}}' | python3 -c "
import sys; sys.path.insert(0, '/Users/guntak/.claude/hooks')
exec(open('/Users/guntak/.claude/hooks/precommit-review-gate.py').read().split('# === Main flow ===')[0])
print(repr(read_command_from_stdin()))
"
```
Expected: `'git commit -m test'`

### Task 6: Add command parsing (regex + shlex)

**Files:**
- Modify: `~/.claude/hooks/precommit-review-gate.py` (append after helpers)

- [ ] **Step 1: Append `_COMMIT_RE` + `parse_git_commit` + `uses_all_flag`**

Append:

```python


# === Tier 1: command parsing (regex at boundary + shlex on args) ===
# Mirror of prepush gate's _PUSH_RE — catches `cd path && git commit -am ...`,
# `FOO=bar git commit ...`, etc. Pure shlex (tokens[0]=="git") would miss those.
_COMMIT_RE = re.compile(
    r'(?:^|[\n;|]|&&|\|\|)\s*'
    r'(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*'
    r'git\b(?:\s+(?:-C\s+\S+|-[^\s]+))*\s+commit(?:\s|$)'
)


def parse_git_commit(command):
    """Return (is_git_commit, uses_all_flag)."""
    m = _COMMIT_RE.search(command or "")
    if not m:
        return False, False
    # Extract args after "commit" keyword, stopping at next shell boundary
    after = command[m.end():]
    for sep in ("\n", ";", "&&", "||", "|"):
        if sep in after:
            after = after.split(sep, 1)[0]
    try:
        args = shlex.split(after)
    except ValueError:
        return True, False  # malformed args, treat as no -a (still gate)
    return True, uses_all_flag(args)


def uses_all_flag(args):
    """Detect -a / --all / -am / -aem etc. Stops at -- separator."""
    SINGLE_LETTER_FLAGS = set("aeimsnvqSFcCtuoip")  # git commit single-letter set
    for t in args:
        if t == "--":
            break  # pathspec after this
        if t == "--all" or t == "-a":
            return True
        if t.startswith("-") and not t.startswith("--"):
            body = t[1:].split("=", 1)[0]
            if "a" in body and all(c in SINGLE_LETTER_FLAGS for c in body):
                return True
    return False
```

- [ ] **Step 2: Smoke-test parse_git_commit in 7 scenarios**

Run:
```bash
python3 -c "
import sys; sys.path.insert(0, '/Users/guntak/.claude/hooks')
exec(open('/Users/guntak/.claude/hooks/precommit-review-gate.py').read().split('# === Main flow ===')[0])
cases = [
    ('git commit -m x', (True, False)),
    ('git commit -am x', (True, True)),
    ('git commit -aem x', (True, True)),
    ('git commit --all -m x', (True, True)),
    ('cd /tmp && git commit -m x', (True, False)),
    ('FOO=bar git commit -am x', (True, True)),
    ('echo git commit', (False, False)),
    ('git commit-tree abc', (False, False)),
    ('git commit -- -am foo.txt', (True, False)),  # pathspec after --
]
for cmd, expected in cases:
    got = parse_git_commit(cmd)
    status = 'OK' if got == expected else 'FAIL'
    print(f'{status}: parse_git_commit({cmd!r}) = {got}, expected {expected}')
"
```
Expected: 9 `OK:` lines. Any `FAIL:` line indicates parsing bug — fix before continuing.

### Task 7: Add opt-in detection (project_opted_in + validate_scope)

**Files:**
- Modify: `~/.claude/hooks/precommit-review-gate.py` (append)

- [ ] **Step 1: Append `project_opted_in` + `validate_scope`**

Append:

```python


# === Tier 2: project opt-in (worktree fallback) ===

def project_opted_in(toplevel):
    """Check both worktree root AND main repo root (for worktree scope).

    Returns True iff opt-in marker exists AND scope allows this location.

    HIGH FIX (plan reviewer #4): worktree-ness is determined ONCE via
    git-common-dir, then passed to both direct and fallback scope checks.
    The old version always passed is_worktree=False to direct path, which
    let a worktree with its own marker bypass `scope: main-only`.
    """
    # Step 1: Determine real worktree-ness first (single source of truth)
    common = run_git("rev-parse", "--git-common-dir")
    if ok(common):
        common_path = common.stdout.strip()
        if not os.path.isabs(common_path):
            common_path = os.path.join(toplevel, common_path)
        # common_path is absolute path to .git directory (main repo's .git, even from worktree).
        # CRITICAL: do NOT use rstrip("/.git") — character-class strip; corrupts /a/b/.gitconfig.it.
        if common_path.endswith(os.sep + ".git"):
            main_root = common_path[:-len(os.sep + ".git")]
        elif common_path.endswith("/.git"):
            main_root = common_path[:-len("/.git")]
        else:
            main_root = os.path.dirname(common_path)
        is_worktree = (main_root != toplevel)
    else:
        # Can't determine — be conservative: assume NOT a worktree (no fallback path).
        is_worktree = False
        main_root = None

    # Step 2: Direct check — toplevel's own marker, using REAL is_worktree
    direct = os.path.join(toplevel, ".claude", "review-gate-on")
    if os.path.isfile(direct):
        return validate_scope(direct, is_worktree=is_worktree)

    # Step 3: Fallback — main repo's marker (only useful if we're actually in a worktree)
    if not is_worktree or main_root is None:
        return False
    fallback = os.path.join(main_root, ".claude", "review-gate-on")
    if not os.path.isfile(fallback):
        return False
    return validate_scope(fallback, is_worktree=True)


def validate_scope(marker_path, is_worktree):
    """Read marker header for `scope:` line. Default = main-only."""
    try:
        with open(marker_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("#"):
                    if "scope:" in line:
                        scope = line.split("scope:", 1)[1].strip()
                        if scope == "all-worktrees":
                            return True
                        if scope == "main-only":
                            return not is_worktree
        # Default: main-only (conservative for first deploy)
        return not is_worktree
    except (IOError, OSError):
        return False  # opt-in IO failure → treat as not-opted-in
```

- [ ] **Step 2: Smoke-test main_root path calculation (the CRITICAL Round 5 fix)**

Run:
```bash
python3 -c "
import os
cases = [
    ('/Users/guntak/Lisna/.git', '/Users/guntak/Lisna'),
    ('/Users/guntak/Lisna/.git/worktrees/foo', '/Users/guntak/Lisna/.git/worktrees'),  # unusual but valid
    ('/a/b/.gitconfig.it', '/a/b'),  # rstrip would corrupt this
]
for common_path, expected in cases:
    if common_path.endswith(os.sep + '.git'):
        main_root = common_path[:-len(os.sep + '.git')]
    elif common_path.endswith('/.git'):
        main_root = common_path[:-len('/.git')]
    else:
        main_root = os.path.dirname(common_path)
    status = 'OK' if main_root == expected else 'FAIL'
    print(f'{status}: {common_path} → {main_root!r}, expected {expected!r}')
"
```
Expected: 3 `OK:` lines.

- [ ] **Step 3: Verify py_compile**

Run: `python3 -m py_compile ~/.claude/hooks/precommit-review-gate.py && echo OK`
Expected: `OK`.

### Task 8: Add escape hatch (check_bypass + emit_bypass_banner + log_bypass)

**Files:**
- Modify: `~/.claude/hooks/precommit-review-gate.py` (append)

- [ ] **Step 1: Append escape hatch functions**

Append:

```python


# === Tier 3: escape hatch with TTL ===

def check_bypass():
    """Parse CLAUDE_REVIEW_BYPASS env. Return reason str if valid + fresh, else None."""
    raw = os.environ.get("CLAUDE_REVIEW_BYPASS", "").strip()
    if not raw:
        return None
    # Format: "<ISO-timestamp> <reason>"
    parts = raw.split(None, 1)
    if len(parts) < 2:
        return None  # malformed → require review
    ts_str, reason = parts
    try:
        ts = datetime.datetime.fromisoformat(ts_str).timestamp()
    except (ValueError, TypeError):
        return None
    if abs(time.time() - ts) > BYPASS_TTL_SECONDS:
        return None  # expired
    return reason


def emit_bypass_banner(reason, command_kind):
    """ASCII banner to stderr — visual cue user can't miss."""
    banner = (
        "\n" + "=" * 60 + "\n"
        + "  [REVIEW GATE BYPASSED]\n"
        + "  command: %s\n  reason: %s\n" % (command_kind, reason)
        + "  Logged to: ~/.claude/review-bypass-log.jsonl\n"
        + "=" * 60 + "\n"
    )
    sys.stderr.write(banner)


def log_bypass(toplevel, head_sha, reason, command_kind):
    """Append-only JSON Lines audit log. Never fatal."""
    try:
        with open(BYPASS_LOG, "a") as f:
            f.write(json.dumps({
                "ts_unix": int(time.time()),
                "repo": toplevel,
                "head": head_sha,
                "command_kind": command_kind,
                "reason": reason,
            }) + "\n")
    except (IOError, OSError):
        pass
```

- [ ] **Step 2: Smoke-test check_bypass**

Run:
```bash
python3 -c "
import os, sys, datetime, time
sys.path.insert(0, '/Users/guntak/.claude/hooks')
exec(open('/Users/guntak/.claude/hooks/precommit-review-gate.py').read().split('# === Main flow ===')[0])

# Case 1: no env → None
os.environ.pop('CLAUDE_REVIEW_BYPASS', None)
print('case1:', check_bypass())  # None

# Case 2: malformed → None
os.environ['CLAUDE_REVIEW_BYPASS'] = 'no-timestamp-here'
print('case2:', check_bypass())  # None

# Case 3: fresh + reason → reason
now = datetime.datetime.fromtimestamp(time.time()).isoformat(timespec='minutes')
os.environ['CLAUDE_REVIEW_BYPASS'] = f'{now} test reason'
print('case3:', check_bypass())  # 'test reason'

# Case 4: expired (2hr old) → None
old = datetime.datetime.fromtimestamp(time.time() - 7200).isoformat(timespec='minutes')
os.environ['CLAUDE_REVIEW_BYPASS'] = f'{old} stale'
print('case4:', check_bypass())  # None
"
```
Expected:
```
case1: None
case2: None
case3: test reason
case4: None
```

### Task 9: Add tree+stats computation (with -a fallback)

**Files:**
- Modify: `~/.claude/hooks/precommit-review-gate.py` (append)

- [ ] **Step 1: Append compute_tree_and_stats + parse_shortstat**

Append:

```python


# === Tier 4: tree SHA + diff stats (with N1 fallback) ===

def compute_tree_and_stats(uses_all):
    """Returns (tree_sha, ins, dels, files). Side-effect-free (git stash create
    only emits SHA, doesn't modify stash list or working tree)."""
    if uses_all:
        r = run_git("stash", "create")
        tree = (r.stdout if r else "").strip()
        if not tree:
            # N1 fallback: stash empty → no working-tree-only changes,
            # but staged may still exist (git add foo && git commit -am ...)
            r = run_git("write-tree")
            tree = r.stdout.strip()
            stats = run_git("diff", "--cached", "--shortstat")
        else:
            stats = run_git("diff", "HEAD", "--shortstat")
    else:
        r = run_git("write-tree")
        tree = r.stdout.strip()
        stats = run_git("diff", "--cached", "--shortstat")
    ins, dels, files = parse_shortstat((stats.stdout if stats else ""))
    return tree, ins, dels, files


def parse_shortstat(s):
    """' 3 files changed, 12 insertions(+), 4 deletions(-)' → (12, 4, 3)."""
    ins = int(re.search(r'(\d+) insertion', s).group(1)) if 'insertion' in s else 0
    dels = int(re.search(r'(\d+) deletion', s).group(1)) if 'deletion' in s else 0
    files = int(re.search(r'(\d+) file', s).group(1)) if 'file' in s else 0
    return ins, dels, files
```

- [ ] **Step 2: Smoke-test parse_shortstat**

Run:
```bash
python3 -c "
import sys; sys.path.insert(0, '/Users/guntak/.claude/hooks')
exec(open('/Users/guntak/.claude/hooks/precommit-review-gate.py').read().split('# === Main flow ===')[0])
cases = [
    (' 3 files changed, 12 insertions(+), 4 deletions(-)', (12, 4, 3)),
    (' 1 file changed, 5 insertions(+)', (5, 0, 1)),
    (' 1 file changed, 2 deletions(-)', (0, 2, 1)),
    ('', (0, 0, 0)),
]
for inp, expected in cases:
    got = parse_shortstat(inp)
    status = 'OK' if got == expected else 'FAIL'
    print(f'{status}: parse_shortstat({inp!r}) = {got}, expected {expected}')
"
```
Expected: 4 `OK:` lines.

### Task 10: Add loop detection counter

**Files:**
- Modify: `~/.claude/hooks/precommit-review-gate.py` (append)

- [ ] **Step 1: Append attempts_counter**

Append:

```python


# === Tier 5: loop detection (T13 — repeated BLOCK on same tree SHA) ===

def attempts_counter(marker_path):
    """Track repeated BLOCK attempts for same tree SHA → loop detection.

    Stores count in a sibling file (.attempts instead of .ok). Returns
    the new count after incrementing.
    """
    counter_path = marker_path[:-3] + ".attempts"  # .ok → .attempts
    try:
        with open(counter_path) as f:
            count = int(f.read().strip())
    except (IOError, ValueError, OSError):
        count = 0
    count += 1
    try:
        with open(counter_path, "w") as f:
            f.write(str(count))
    except IOError:
        pass
    return count
```

- [ ] **Step 2: Smoke-test attempts_counter**

Run:
```bash
python3 -c "
import sys, tempfile, os
sys.path.insert(0, '/Users/guntak/.claude/hooks')
exec(open('/Users/guntak/.claude/hooks/precommit-review-gate.py').read().split('# === Main flow ===')[0])
# Fresh tempdir marker path
tmpdir = tempfile.mkdtemp()
marker = os.path.join(tmpdir, 'test-abc.ok')
print('1st:', attempts_counter(marker))  # 1
print('2nd:', attempts_counter(marker))  # 2
print('3rd:', attempts_counter(marker))  # 3
# Counter file should exist
print('file:', os.path.isfile(marker[:-3] + '.attempts'))  # True
import shutil; shutil.rmtree(tmpdir)
"
```
Expected:
```
1st: 1
2nd: 2
3rd: 3
file: True
```

### Task 11: Add build_brief (the long template)

**Files:**
- Modify: `~/.claude/hooks/precommit-review-gate.py` (append)

- [ ] **Step 1: Append build_brief**

Append:

```python


# === Brief template ===

def build_brief(tree, ins, dels, files, marker_path, toplevel):
    """Render the deny-reason brief with substitutions.

    Source of truth: docs/superpowers/specs/2026-05-30-review-automation-strengthening-design.md
    Section 5.2. Edits here must mirror Section 5.2.
    """
    return (
        "PRECOMMIT EXPERT REVIEW REQUIRED — no valid review marker for staged tree {tree}.\n\n"
        "⚠️ MARKER FORMAT (changed 2026-05-30): JSON only. `touch` is fail-closed "
        "and will loop forever.\n"
        "   See JSON schema below. Old `mkdir -p && touch` pattern WILL FAIL.\n\n"
        "Staged diff: {ins} insertions / {dels} deletions / {files} files.\n\n"
        "REVIEWER BRIEF:\n"
        "1. Spawn an INDEPENDENT reviewer (Agent tool, subagent_type=general-purpose, "
        "model=opus). You (author) must NOT review your own work.\n\n"
        "2. Reviewer reads `git diff --cached` (or `git diff HEAD` if -a/--all was used).\n\n"
        "3. Reviewer ACTUALLY EXECUTES typecheck + test on affected packages.\n"
        "   - Identify owning packages from changed file paths (backend/, extension/, web/, desktop/, shared/).\n"
        "   - Path → package: backend/** → backend, extension/** → extension, web/** → web, desktop/** → desktop, shared/** → shared.\n"
        "   - For each owning package, try in priority order until success or all skipped:\n"
        "     typecheck:\n"
        "       (a) If <pkg>/package.json has scripts.typecheck: `pnpm --filter <pkg> typecheck`\n"
        "       (b) Else if TS package (tsconfig.json exists): `pnpm --filter <pkg> exec tsc --noEmit`\n"
        "       (c) Else: record {{\"exit\": 0, \"command\": \"skip-no-typecheck\"}} and continue\n"
        "     test:\n"
        "       (a) If <pkg>/package.json has scripts.test: `pnpm --filter <pkg> test`\n"
        "       (b) Else if pkg has vitest.config.* or tests/ dir: `pnpm --filter <pkg> exec vitest run`\n"
        "       (c) Else: record {{\"exit\": 0, \"command\": \"skip-no-test\"}} and continue\n"
        "   - DO NOT run full monorepo typecheck (3-5 min cost). Filter to affected packages only.\n\n"
        "4. Reviewer evaluates each of these 9 invariants explicitly. Each gets:\n"
        "   'ok' (passed) | 'n/a' (영역 미관련, 확신할 때만) | 'fail' (위반 OR 영역 건드리는데 불확신).\n"
        "   'n/a' is for clear non-applicability; uncertainty in a touched area = 'fail'.\n"
        "   - pool_max_2          (pg.Pool max:2, transactions via pool.connect())\n"
        "   - api_gw_30s          (no new handler > 30s)\n"
        "   - withauth_zoderror   (new protected handlers wrapped in withAuth)\n"
        "   - shframe_source      (cross-frame postMessage has source: 'sh-frame'/'sh-parent')\n"
        "   - sentinel_guard      (content-script listeners inside __SH_CONTENT_BOOTED__)\n"
        "   - function_url_cors   (Function URL CORS configured separately)\n"
        "   - content_type_json   (all JSON responses set Content-Type: application/json)\n"
        "   - i18n_parity         (web/messages EN/JA/KO key-parity intact)\n"
        "   - security            (no SQLi/XSS/auth-bypass — secret-shape is secret-guard.py's job)\n\n"
        "5. AUTO-BLOCK triggers (verdict=BLOCK regardless of other checks):\n"
        "   - new line in package.json deps/devDeps (supply-chain review)\n"
        "   - new HTTP endpoint without test in backend/tests/\n"
        "   - ≥200-line NEW CODE FILE (.ts/.tsx/.py/.go/.rs etc); 제외 디렉터리:\n"
        "     backend/tests/fixtures/, */baselines/, */messages/, web/public/, extension/test-results/\n\n"
        "6. EXTERNAL KNOWLEDGE GROUNDING (only when diff touches deps / external APIs / framework "
        "patterns / auth / security): use WebSearch + WebFetch for up-to-date best practices, "
        "breaking changes for specific library versions in diff, known CVEs. Skip for pure internal logic.\n\n"
        "7. **DEFAULT TO BLOCK ON UNCERTAINTY**. If you cannot say 'ok' or 'n/a' definitively, "
        "mark 'fail' and BLOCK. This is the author's safety net.\n\n"
        "8. On APPROVE, write marker (JSON only — `touch` is fail-closed):\n"
        "   mkdir -p {marker_dir}\n"
        "   cat > '{marker_path}' <<'JSON'\n"
        "   {{\n"
        '     "schema_version": 1,\n'
        '     "reviewer_id": "<your-agent-id>",\n'
        '     "verdict": "APPROVE",\n'
        '     "checks": {{\n'
        '       "typecheck": {{"exit": 0, "duration_ms": <int>, "command": "<actual command run>"}},\n'
        '       "test": {{"exit": 0, "duration_ms": <int>, "summary": "<N passed>", "command": "<actual>"}}\n'
        "     }},\n"
        '     "checklist": {{\n'
        '       "pool_max_2": "<ok|n/a>", "api_gw_30s": "<ok|n/a>",\n'
        '       "withauth_zoderror": "<ok|n/a>", "shframe_source": "<ok|n/a>",\n'
        '       "sentinel_guard": "<ok|n/a>", "function_url_cors": "<ok|n/a>",\n'
        '       "content_type_json": "<ok|n/a>", "i18n_parity": "<ok|n/a>",\n'
        '       "security": "<ok|n/a>"\n'
        "     }},\n"
        '     "approved_at_unix": <unix-epoch>\n'
        "   }}\n"
        "   JSON\n"
        "   Then re-run the original `git commit ...` — same tree SHA → marker hits → allow.\n\n"
        "9. On BLOCK: do NOT write marker. Report defects as path:line — defect — why — fix.\n"
        "   Author fixes → new staged tree → fresh marker needed.\n\n"
        "Emergency bypass (60-min TTL, audit logged):\n"
        "  CLAUDE_REVIEW_BYPASS=\"$(date -Iminutes) <reason>\" git commit ..."
    ).format(
        tree=tree[:12], ins=ins, dels=dels, files=files,
        toplevel=toplevel, marker_dir=PRECOMMIT_MARKER_DIR,
        marker_path=marker_path,
    )
```

- [ ] **Step 2: Verify py_compile + brief renders**

Run:
```bash
python3 -c "
import sys; sys.path.insert(0, '/Users/guntak/.claude/hooks')
exec(open('/Users/guntak/.claude/hooks/precommit-review-gate.py').read().split('# === Main flow ===')[0])
brief = build_brief('abc123def456', 15, 3, 2, '/tmp/marker.ok', '/Users/guntak/Lisna')
assert 'abc123def456' in brief
assert '15 insertions' in brief
assert 'pool_max_2' in brief
assert 'CLAUDE_REVIEW_BYPASS' in brief
print('brief OK, length:', len(brief))
"
```
Expected: `brief OK, length: 3000+` (some integer >3000).

### Task 12: Add main flow + entry point

**Files:**
- Modify: `~/.claude/hooks/precommit-review-gate.py` (append)

- [ ] **Step 1: Append main + `if __name__`**

Append:

```python


# === Main flow ===

def main():
    command = read_command_from_stdin()
    is_commit, uses_all = parse_git_commit(command)
    if not is_commit:
        allow()

    top = run_git("rev-parse", "--show-toplevel")
    if not ok(top):
        allow()
    toplevel = top.stdout.strip()

    if not project_opted_in(toplevel):
        allow()

    bypass = check_bypass()
    if bypass is not None:
        head_r = run_git("rev-parse", "HEAD")
        head_sha = head_r.stdout.strip() if ok(head_r) else "unknown"
        log_bypass(toplevel, head_sha, bypass, "commit")
        emit_bypass_banner(bypass, "commit")
        allow()

    try:
        tree, ins, dels, files = compute_tree_and_stats(uses_all)
    except Exception:
        allow()  # fail-open

    if ins < TRIVIAL_INS and dels < TRIVIAL_DEL and files < TRIVIAL_FILES:
        allow()

    repo_id = hashlib.sha256(toplevel.encode()).hexdigest()[:12]
    marker = os.path.join(PRECOMMIT_MARKER_DIR, "%s-%s.ok" % (repo_id, tree))
    sampled_cleanup(PRECOMMIT_MARKER_DIR, CLEANUP_DAYS)
    if validate_marker(marker):
        allow()

    # Loop detection (T13)
    attempts = attempts_counter(marker)
    loop_warning = ""
    if attempts >= LOOP_DETECTION_THRESHOLD:
        loop_warning = (
            "\n\n⚠️ LOOP DETECTED (%d attempts for tree %s).\n"
            "If reviewer keeps failing to write a valid marker, escape with:\n"
            "  CLAUDE_REVIEW_BYPASS=\"$(date -Iminutes) loop-recovery: <reason>\" git commit ..."
            % (attempts, tree[:12])
        )

    deny(build_brief(tree, ins, dels, files, marker, toplevel) + loop_warning)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify py_compile**

Run: `python3 -m py_compile ~/.claude/hooks/precommit-review-gate.py && echo OK`
Expected: `OK`.

### Task 13: Run 5 smoke tests against the assembled hook

**Files:** none (testing only)

- [ ] **Step 1: Smoke test 1 — opt-out (no marker)**

Run in a fresh tmp repo:
```bash
mkdir -p /tmp/smoke-test-1 && cd /tmp/smoke-test-1 && git init -q
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"},"hook_event_name":"PreToolUse"}' \
  | python3 ~/.claude/hooks/precommit-review-gate.py
echo "exit=$?"
cd - >/dev/null && rm -rf /tmp/smoke-test-1
```
Expected: `exit=0` with no stdout (silent allow because no opt-in marker).

- [ ] **Step 2: Smoke test 2 — opt-in + trivial diff**

```bash
mkdir -p /tmp/smoke-test-2 && cd /tmp/smoke-test-2 && git init -q
git config user.email t@t && git config user.name t
echo "init" > a.txt && git add a.txt && git commit -qm init
mkdir -p .claude && touch .claude/review-gate-on
echo "one line change" > a.txt && git add a.txt
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"},"hook_event_name":"PreToolUse"}' \
  | python3 ~/.claude/hooks/precommit-review-gate.py
echo "exit=$?"
cd - >/dev/null && rm -rf /tmp/smoke-test-2
```
Expected: `exit=0`, no stdout (allow — trivial-skip).

- [ ] **Step 3: Smoke test 3 — opt-in + non-trivial + no marker**

```bash
mkdir -p /tmp/smoke-test-3 && cd /tmp/smoke-test-3 && git init -q
git config user.email t@t && git config user.name t
echo "init" > a.txt && git add a.txt && git commit -qm init
mkdir -p .claude && touch .claude/review-gate-on
seq 1 15 > a.txt && git add a.txt
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"},"hook_event_name":"PreToolUse"}' \
  | python3 ~/.claude/hooks/precommit-review-gate.py
echo "exit=$?"
cd - >/dev/null && rm -rf /tmp/smoke-test-3
```
Expected: `exit=0`, stdout contains JSON with `"permissionDecision": "deny"` and `"permissionDecisionReason"` starting with `"PRECOMMIT EXPERT REVIEW REQUIRED"`.

- [ ] **Step 4: Smoke test 4 — false positive (echo git commit)**

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"echo git commit"},"hook_event_name":"PreToolUse"}' \
  | python3 ~/.claude/hooks/precommit-review-gate.py
echo "exit=$?"
```
Expected: `exit=0`, no stdout (allow — not a real `git commit`).

- [ ] **Step 5: Smoke test 5 — `git commit-tree` (unrelated subcommand)**

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git commit-tree abc -m x"},"hook_event_name":"PreToolUse"}' \
  | python3 ~/.claude/hooks/precommit-review-gate.py
echo "exit=$?"
```
Expected: `exit=0`, no stdout (allow — `commit-tree` ≠ `commit`).

If any smoke test fails, FIX before continuing. Do NOT proceed to settings.json registration if any of these 5 tests fail.

No commit (~/.claude/ is not in repo).

---

## Phase 3 — `prepush-review-gate.py` edits

### Task 14: Patch prepush gate with `_lib_marker` import + base..HEAD lookup

**Files:**
- Modify: `~/.claude/hooks/prepush-review-gate.py:9-19` (add imports, sys.path bootstrap)
- Modify: `~/.claude/hooks/prepush-review-gate.py:99-110` (add base..HEAD precommit lookup)

- [ ] **Step 1: Read current prepush gate to find exact insertion points**

Run:
```bash
sed -n '1,30p' ~/.claude/hooks/prepush-review-gate.py
echo "..."
sed -n '95,115p' ~/.claude/hooks/prepush-review-gate.py
```
Expected: See module imports + base check section (around line 99-110 in original).

- [ ] **Step 2: Add sys.path bootstrap + _lib_marker import**

In `~/.claude/hooks/prepush-review-gate.py`, after the existing `import subprocess` line (~line 17), insert:

```python

# === Bootstrap: sys.path for _lib_marker ===
_HOOK_DIR = os.path.dirname(os.path.abspath(__file__))
if _HOOK_DIR not in sys.path:
    sys.path.insert(0, _HOOK_DIR)
try:
    from _lib_marker import validate_marker
except ImportError:
    # FAIL-CLOSED: validation unavailable = lying reviewer can pass
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason":
            "_lib_marker.py missing — push gate cannot validate. "
            "Install ~/.claude/hooks/_lib_marker.py or rollback."
    }}))
    sys.exit(0)

PREPUSH_MARKER_DIR = os.path.expanduser("~/.claude/prepush-reviews")
PRECOMMIT_MARKER_DIR = os.path.expanduser("~/.claude/precommit-reviews")
os.makedirs(PREPUSH_MARKER_DIR, exist_ok=True)
```

- [ ] **Step 3: Rename helper `git()` → `run_git()` (5 sites) and `MARKER_DIR` → `PREPUSH_MARKER_DIR` (5 sites)**

In `~/.claude/hooks/prepush-review-gate.py`:

```bash
# Verify rename targets first
grep -n '^def git(' ~/.claude/hooks/prepush-review-gate.py    # should show 1 def
grep -nE 'git\(' ~/.claude/hooks/prepush-review-gate.py | grep -v 'sub\.\(run\|Popen\)' | wc -l   # call count
grep -nE '\bMARKER_DIR\b' ~/.claude/hooks/prepush-review-gate.py | wc -l   # MARKER_DIR uses
```

Then in-file replace `def git(*args)` → `def run_git(*args)` and every callsite `git(...)` → `run_git(...)` — verify count matches. Same for `MARKER_DIR` → `PREPUSH_MARKER_DIR`.

(Why: Tasks 4-5 below paste code using `run_git`/`PREPUSH_MARKER_DIR` names. Without this rename, NameError on first invocation.)

- [ ] **Step 4: Verify py_compile + rename completeness**

Run:
```bash
python3 -m py_compile ~/.claude/hooks/prepush-review-gate.py && echo OK
# Verify zero remaining bare-name references
! grep -nE '\bMARKER_DIR\b|\bdef git\b|\bgit\(' ~/.claude/hooks/prepush-review-gate.py | grep -v 'run_git\|subprocess' \
  && echo "rename complete"
```
Expected: `OK` and `rename complete`.

- [ ] **Step 5: Locate `head_sha` assignment (must precede base resolution insert)**

Run:
```bash
grep -nE 'head_sha\s*=' ~/.claude/hooks/prepush-review-gate.py
```
Expected: One line, e.g. `97:    head_sha = head.stdout.strip()`. **Remember this line number — base resolution block must come AFTER it.**

- [ ] **Step 6: Delete the existing base resolution block (the one being replaced)**

Find and DELETE the existing block (in original it's lines ~99-105, just after `head_sha` assignment):

```python
    # ORIGINAL — DELETE THIS BLOCK:
    base = None
    up = run_git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    if ok(up):
        base = up.stdout.strip()
        up_sha = run_git("rev-parse", base)
        if ok(up_sha) and up_sha.stdout.strip() == head_sha:
            allow()
```

(Use sed or your editor to remove these lines. Verify with `grep -n 'base = None' ~/.claude/hooks/prepush-review-gate.py` — should return 0 results.)

- [ ] **Step 7: Insert NEW base resolution chain (A2 fix) at the same position**

Insert AFTER `head_sha = head.stdout.strip()` line:

```python
    base = None
    used_30_fallback = False
    up = run_git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    if ok(up):
        base = up.stdout.strip()
        up_sha = run_git("rev-parse", base)
        if ok(up_sha) and up_sha.stdout.strip() == head_sha:
            allow()  # nothing ahead of upstream
    else:
        sym = run_git("symbolic-ref", "refs/remotes/origin/HEAD")
        if ok(sym):
            base = sym.stdout.strip().replace("refs/remotes/", "")
        else:
            for ref in ("origin/main", "origin/master", "origin/trunk", "origin/develop"):
                if ok(run_git("rev-parse", ref)):
                    base = ref
                    break
```

- [ ] **Step 8: Locate the existing `repo_id = hashlib.sha256(...)` assignment and MOVE it up if needed**

Run:
```bash
grep -nE 'repo_id\s*=\s*hashlib' ~/.claude/hooks/prepush-review-gate.py
```
Expected: One line. If line number > insertion point for Step 9 (cross-marker check), MOVE the `repo_id = hashlib.sha256(toplevel.encode()).hexdigest()[:12]` line to BEFORE the cross-marker block. The cross-marker block references `repo_id`.

- [ ] **Step 9: Insert cross-marker check (Fix #4 + T9 batch query)**

Insert AFTER Step 7's base resolution block (and AFTER `repo_id =` per Step 8):

```python
    # === Cross-marker check (precommit gate sharing) ===
    if base:
        trees_r = run_git("log", "--format=%T", base + "..HEAD")
    else:
        trees_r = run_git("log", "--format=%T", "-30", "HEAD")
        used_30_fallback = True

    if ok(trees_r):
        trees = [t for t in trees_r.stdout.strip().split("\n") if t]
        if not trees:
            allow()  # 0 commits ahead → nothing to push

        all_reviewed = True
        for tree in trees:
            pc_marker = os.path.join(
                PRECOMMIT_MARKER_DIR, "%s-%s.ok" % (repo_id, tree))
            if not validate_marker(pc_marker):
                all_reviewed = False
                break
        # A1 fix: -30 fallback never auto-allows (might miss commit #31+)
        if all_reviewed and not used_30_fallback:
            allow()
```

- [ ] **Step 10: Update existing HEAD-marker check to use validate_marker**

Find the existing `marker = os.path.join(MARKER_DIR, ...)` + `if os.path.exists(marker): allow()` block and REPLACE with:

```python
    prepush_marker = os.path.join(
        PREPUSH_MARKER_DIR, "%s-%s.ok" % (repo_id, head_sha))
    if validate_marker(prepush_marker):
        allow()
```

**Note:** the existing `deny(reason)` block (in original ~line 123-157) references the OLD `marker` variable, which is now `prepush_marker` AND will be entirely rewritten in Task 15. **Do NOT smoke-test prepush gate between this step and Task 15 — the deny path is in a broken-by-design state.**

- [ ] **Step 11: Verify py_compile**

Run: `python3 -m py_compile ~/.claude/hooks/prepush-review-gate.py && echo OK`
Expected: `OK`. If NameError on `marker` or `reason`, that's expected — proceeds to Task 15 to rewrite.

### Task 15: Update prepush gate brief to match precommit brief format

**Files:**
- Modify: `~/.claude/hooks/prepush-review-gate.py` (delete the existing `reason = (...)` block at ~line 123-157, add `build_push_brief` function, replace `deny(reason)` call)

- [ ] **Step 1: Add `build_push_brief` function (paste this complete code)**

Add this function definition near the top of prepush-review-gate.py (after constants, before `main`):

```python
def build_push_brief(head_sha, base, prepush_marker):
    """Brief shown when prepush gate denies. Mirrors precommit brief structure
    but adapted for push context. Source of truth: spec Section 6.2."""
    diff_cmd = "git diff %s...HEAD" % base if base else "git diff origin/HEAD...HEAD"
    log_cmd = "git log --oneline %s..HEAD" % base if base else "git log --oneline -20"
    return (
        "PRE-PUSH EXPERT REVIEW REQUIRED — no valid marker for HEAD {head}.\n\n"
        "⚠️ MARKER FORMAT (changed 2026-05-30): JSON only. `touch` is fail-closed.\n"
        "   Old `mkdir -p && touch` pattern WILL FAIL.\n\n"
        "Spawn an INDEPENDENT reviewer (Agent, subagent_type=general-purpose, model=opus). "
        "Author ≠ reviewer.\n\n"
        "REVIEWER TASK:\n"
        "1. Read diff: `{diff_cmd}`. Also `{log_cmd}` for commit context. Open changed files in-situ.\n\n"
        "2. ACTUALLY EXECUTE typecheck + test on affected packages.\n"
        "   - Path → package: backend/** → backend, extension/** → extension, web/** → web, desktop/** → desktop, shared/** → shared.\n"
        "   - For each owning package, try in priority order:\n"
        "     typecheck: (a) scripts.typecheck → pnpm --filter <pkg> typecheck (b) tsconfig → pnpm --filter <pkg> exec tsc --noEmit (c) skip-record\n"
        "     test: (a) scripts.test → pnpm --filter <pkg> test (b) vitest.config.*/tests dir → pnpm --filter <pkg> exec vitest run (c) skip-record\n"
        "   - DO NOT run full monorepo typecheck. Filter to affected packages.\n\n"
        "3. Evaluate 9 invariants (each: ok | n/a | fail; n/a only when영역 미관련 명확, uncertainty in touched area = fail):\n"
        "   - pool_max_2 / api_gw_30s / withauth_zoderror / shframe_source / sentinel_guard\n"
        "   - function_url_cors / content_type_json / i18n_parity / security\n\n"
        "4. AUTO-BLOCK triggers (BLOCK regardless of other checks):\n"
        "   - new line in package.json deps/devDeps (supply-chain)\n"
        "   - new HTTP endpoint without test in backend/tests/\n"
        "   - ≥200-line NEW CODE FILE (.ts/.tsx/.py/.go/.rs); 제외: fixtures/baselines/messages/public/test-results\n\n"
        "5. EXTERNAL GROUNDING (only when touching deps / external APIs / framework / auth / security): WebSearch + WebFetch.\n\n"
        "6. **DEFAULT TO BLOCK ON UNCERTAINTY**. Author cannot read code.\n\n"
        "7. On APPROVE, write marker (JSON only — `touch` fail-closed):\n"
        "   mkdir -p {marker_dir}\n"
        "   cat > '{marker_path}' <<'JSON'\n"
        "   {{\n"
        '     "schema_version": 1, "reviewer_id": "<your-id>", "verdict": "APPROVE",\n'
        '     "checks": {{"typecheck": {{"exit": 0, "duration_ms": <int>, "command": "<actual>"}},\n'
        '                "test": {{"exit": 0, "duration_ms": <int>, "summary": "<N passed>", "command": "<actual>"}}}},\n'
        '     "checklist": {{"pool_max_2": "<ok|n/a>", "api_gw_30s": "<ok|n/a>",\n'
        '       "withauth_zoderror": "<ok|n/a>", "shframe_source": "<ok|n/a>",\n'
        '       "sentinel_guard": "<ok|n/a>", "function_url_cors": "<ok|n/a>",\n'
        '       "content_type_json": "<ok|n/a>", "i18n_parity": "<ok|n/a>",\n'
        '       "security": "<ok|n/a>"}},\n'
        '     "approved_at_unix": <unix-epoch>\n'
        "   }}\n"
        "   JSON\n"
        "   Then re-run the original `git push`. HEAD unchanged → marker hits → allow.\n\n"
        "8. On BLOCK: do NOT write marker. Report defects as path:line — defect — why — fix.\n"
        "   New commit (new HEAD) → fresh review.\n\n"
        "Emergency bypass (60-min TTL, audit logged):\n"
        "  CLAUDE_REVIEW_BYPASS=\"$(date -Iminutes) <reason>\" git push ..."
    ).format(
        head=head_sha[:12], diff_cmd=diff_cmd, log_cmd=log_cmd,
        marker_dir=PREPUSH_MARKER_DIR, marker_path=prepush_marker,
    )
```

- [ ] **Step 2: Delete the old `reason = (` block + replace `deny(reason)` call**

Find the line `reason = (` in prepush-review-gate.py (was around line 123 in original) and delete that block through its closing `)`. Then find the final `deny(reason)` call and replace with:

```python
    deny(build_push_brief(head_sha, base, prepush_marker))
```

- [ ] **Step 3: Verify py_compile**

Run: `python3 -m py_compile ~/.claude/hooks/prepush-review-gate.py && echo OK`
Expected: `OK`.

- [ ] **Step 4: Smoke test — non-push command (should allow silently)**

Run:
```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git status"},"hook_event_name":"PreToolUse"}' \
  | python3 ~/.claude/hooks/prepush-review-gate.py
echo "exit=$?"
```
Expected: `exit=0`, no stdout.

- [ ] **Step 5: Smoke test — render brief locally**

Run:
```bash
python3 -c "
import sys, os; sys.path.insert(0, '/Users/guntak/.claude/hooks')
exec(open('/Users/guntak/.claude/hooks/prepush-review-gate.py').read().split('def main():')[0])
b = build_push_brief('abc123def456', 'origin/main', '/tmp/marker.ok')
assert 'abc123def456' in b and 'pool_max_2' in b and 'CLAUDE_REVIEW_BYPASS' in b
print('brief OK, length:', len(b))
"
```
Expected: `brief OK, length: 2000+`.

---

## Phase 4 — `lisna-session-precheck.py` (bypass freq audit)

### Task 16: Add bypass frequency check to existing session-start hook

**Files:**
- Modify: `~/.claude/hooks/lisna-session-precheck.py` (append before `exit 0`)

- [ ] **Step 1: Read current hook to find insertion point**

Run:
```bash
sed -n '1,20p' ~/.claude/hooks/lisna-session-precheck.py
echo "..."
tail -20 ~/.claude/hooks/lisna-session-precheck.py
```
Expected: See top + bottom of existing hook.

- [ ] **Step 2: Append bypass freq audit before final exit**

Insert before the final `sys.exit(0)` (or `exit 0` if shell script — check the file):

```python


# === Review bypass frequency audit (24h window) ===

def _check_bypass_freq():
    """Warn if recent 24h has ≥3 review-gate bypasses (silent overuse signal)."""
    import json as _json
    import time as _time
    import os as _os
    log_path = _os.path.expanduser("~/.claude/review-bypass-log.jsonl")
    if not _os.path.isfile(log_path):
        return
    try:
        cutoff = _time.time() - 86400
        count = 0
        with open(log_path) as f:
            for line in f:
                try:
                    entry = _json.loads(line)
                except _json.JSONDecodeError:
                    continue
                if entry.get("ts_unix", 0) >= cutoff:
                    count += 1
        if count >= 3:
            print(f"⚠️ [review-gate] {count} bypasses in last 24h. "
                  f"Audit log: ~/.claude/review-bypass-log.jsonl")
    except (IOError, OSError):
        pass

_check_bypass_freq()
```

(`lisna-session-precheck.py` is confirmed Python per `ls -la ~/.claude/hooks/`. Append the function definition + call before the existing `sys.exit(0)`/`exit 0` at the file end. If file uses no explicit final exit, just append at EOF.)

- [ ] **Step 3: Verify py_compile**

Run: `python3 -m py_compile ~/.claude/hooks/lisna-session-precheck.py && echo OK`
Expected: `OK`.

- [ ] **Step 4: Smoke test — file absence is no-op**

Run:
```bash
[ -f ~/.claude/review-bypass-log.jsonl ] && mv ~/.claude/review-bypass-log.jsonl /tmp/bypass-bak
python3 -c "
import sys
sys.path.insert(0, '/Users/guntak/.claude/hooks')
# Execute the audit function definition + call
exec(open('/Users/guntak/.claude/hooks/lisna-session-precheck.py').read())
"
echo "exit=$?"
[ -f /tmp/bypass-bak ] && mv /tmp/bypass-bak ~/.claude/review-bypass-log.jsonl
```
Expected: `exit=0`, no extra stdout from bypass check (file absent → silent return).

---

## Phase 5 — `settings.json` registration

### Task 17: Register precommit gate in settings.json

**Files:**
- Modify: `~/.claude/settings.json` (PreToolUse → Bash hooks array, between vitest hook and push gate)

- [ ] **Step 1: Re-verify backup exists**

Run:
```bash
ls -la ~/.claude/settings.json.backup-* | head -1
```
Expected: At least one `.backup-YYYYMMDD` file (from Task 0).

- [ ] **Step 2: Read current settings.json hooks structure**

Run:
```bash
python3 -c "
import json
s = json.load(open('/Users/guntak/.claude/settings.json'))
bash_hooks = [h for h in s['hooks']['PreToolUse'] if h.get('matcher') == 'Bash']
for entry in bash_hooks:
    for h in entry['hooks']:
        print(h.get('if', '(no if)'), '→', h.get('command', '?')[:60])
"
```
Expected: List of existing Bash hooks (git-verify-reminder for commit/push/ci, lisna-stt-test-env for vitest, prepush-review-gate for push).

- [ ] **Step 3: Insert precommit gate hook (between vitest and push gate)**

Edit `~/.claude/settings.json` — find the `PreToolUse → matcher: Bash → hooks` array. After the `vitest` hook (`"if": "Bash(*vitest*)"`) and BEFORE the `git push *` hook, insert:

```json
{
  "type": "command",
  "if": "Bash(git commit *)",
  "statusMessage": "커밋 게이트: 전문가 리뷰 확인 중…",
  "command": "python3 $HOME/.claude/hooks/precommit-review-gate.py"
}
```

Important ordering (per spec Section 8.1): git-verify-reminder must remain BEFORE precommit gate (so advisory text injects even on deny).

- [ ] **Step 4: Validate JSON syntax**

Run:
```bash
python3 -c "import json; json.load(open('/Users/guntak/.claude/settings.json')); print('OK')"
```
Expected: `OK`. If JSONDecodeError, restore from backup and retry.

- [ ] **Step 5: Verify hook order**

Run:
```bash
python3 -c "
import json
s = json.load(open('/Users/guntak/.claude/settings.json'))
bash_hooks = [h for h in s['hooks']['PreToolUse'] if h.get('matcher') == 'Bash'][0]['hooks']
for h in bash_hooks:
    print(h.get('if', '(no if)'))
"
```
Expected output should show, in order:
- `Bash(git commit *)` (git-verify-reminder)
- `Bash(git push *)` (git-verify-reminder)
- `Bash(git ci *)` (git-verify-reminder)
- `Bash(*vitest*)` (lisna-stt-test-env)
- `Bash(git commit *)` (NEW precommit gate)
- `Bash(git push *)` (prepush gate)

The two `Bash(git commit *)` entries (advisory reminder + new precommit gate) both fire — advisory first per Claude Code hook order.

---

## Phase 6 — Lisna opt-in marker

### Task 18: Create opt-in marker in Lisna repo

**Files:**
- Create: `/Users/guntak/Lisna/.claude/review-gate-on`
- Commit on: branch `docs/review-automation-spec`

- [ ] **Step 1: Verify current branch**

Run:
```bash
cd /Users/guntak/Lisna && git branch --show-current
```
Expected: `docs/review-automation-spec`.

- [ ] **Step 2: Create the marker file with scope: main-only**

Write to `/Users/guntak/Lisna/.claude/review-gate-on`:

```
# Opt-in marker: presence enables ~/.claude/hooks/precommit-review-gate.py
# + prepush-review-gate.py for this repo. See ~/.claude/hooks/_lib_marker.py
# for marker schema.
# scope: main-only
```

(scope: main-only restricts the gate to the main repo path. Worktrees stay opt-out until Phase 3 expansion.)

- [ ] **Step 3: Verify file content + git tracking**

Run:
```bash
cat /Users/guntak/Lisna/.claude/review-gate-on
git -C /Users/guntak/Lisna status --short .claude/review-gate-on
```
Expected:
- File contents printed (4 lines).
- `?? .claude/review-gate-on` (untracked, ready to add).

- [ ] **Step 4: Add + commit**

Run:
```bash
cd /Users/guntak/Lisna
CLAUDE_REVIEW_BYPASS="$(date -Iminutes) bootstrap-import-review-automation" \
  git add .claude/review-gate-on
CLAUDE_REVIEW_BYPASS="$(date -Iminutes) bootstrap-import-review-automation" \
  git commit -m "chore(hooks): enable review gate opt-in for Lisna (Phase 1, main-only)

Presence of this marker activates ~/.claude/hooks/precommit-review-gate.py
+ prepush-review-gate.py for this repo. scope: main-only restricts to the
main repo path (worktrees remain opt-out until stability check).

Bootstrap commit uses CLAUDE_REVIEW_BYPASS — the new gate would otherwise
require itself to review its own activation."
```
Expected: Commit lands. Pre-commit hook may emit ASCII banner showing the bypass (since the new gate IS active starting this commit).

- [ ] **Step 5: Verify gate is now active for next commit**

Run:
```bash
cd /Users/guntak/Lisna
echo "test" >> /tmp/dummy
git -C /Users/guntak/Lisna diff --cached --shortstat || true
```
(Just verifying — no actual commit. Next non-trivial commit will hit the new gate.)

---

## Phase 7 — Final verification + audit setup

### Task 19: Run all 9 post-deploy scenarios from spec Section 10.2

**Files:** none (testing only)

- [ ] **Step 1: Scenario 1 — opt-out other project (no marker)**

```bash
mkdir -p /tmp/scenario-1 && cd /tmp/scenario-1 && git init -q
git config user.email t@t && git config user.name t
echo init > a && git add a && git commit -qm init
echo "more" >> a && git add a
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"},"hook_event_name":"PreToolUse"}' \
  | python3 ~/.claude/hooks/precommit-review-gate.py
echo "exit=$?"
cd - >/dev/null && rm -rf /tmp/scenario-1
```
Expected: `exit=0`, no stdout (opt-out → silent allow).

- [ ] **Step 2: Scenario 2 — Lisna main + trivial commit**

```bash
cd /Users/guntak/Lisna
# Verify on main repo (not worktree). If you're elsewhere, switch first.
echo "trivial" > /tmp/.lisna-trivial-test
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"},"hook_event_name":"PreToolUse","cwd":"/Users/guntak/Lisna"}' \
  | python3 ~/.claude/hooks/precommit-review-gate.py
echo "exit=$?"
```
Expected: `exit=0`, no stdout (trivial-skip — no actual staged diff).

- [ ] **Step 3: Scenario 3 — Lisna + non-trivial + no marker → BLOCK**

Create a non-trivial staged change in a scratch branch:
```bash
cd /Users/guntak/Lisna
git switch -c scratch/gate-smoke
seq 1 20 > /tmp/gate-test.txt
mv /tmp/gate-test.txt docs/test-only-gate-smoke.tmp
git add docs/test-only-gate-smoke.tmp
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"},"hook_event_name":"PreToolUse"}' \
  | python3 ~/.claude/hooks/precommit-review-gate.py
echo "exit=$?"
```
Expected: `exit=0`, stdout contains JSON with `"permissionDecision": "deny"` and reason starting `PRECOMMIT EXPERT REVIEW REQUIRED`.

Cleanup:
```bash
git restore --staged docs/test-only-gate-smoke.tmp
rm docs/test-only-gate-smoke.tmp
git switch docs/review-automation-spec
git branch -d scratch/gate-smoke 2>/dev/null || git branch -D scratch/gate-smoke
# NOTE: -d first (safe). -D fallback only because scratch/gate-smoke is unmerged
# throwaway test branch (smoke-test artifact, no other use).
```

- [ ] **Step 4: Scenario 4 — push marker share (PARTIAL coverage → BLOCK)**

This branch has 3 commits ahead (spec, spec-patch, opt-in-marker). Synthesizing a marker for ONE tree (HEAD only) leaves 2 trees unmarked → prepush gate BLOCKS (fail-closed for partial coverage):

```bash
cd /Users/guntak/Lisna
TREE=$(git rev-parse HEAD^{tree})
REPO_ID=$(python3 -c "import hashlib; print(hashlib.sha256('/Users/guntak/Lisna'.encode()).hexdigest()[:12])")
MARKER=~/.claude/precommit-reviews/$REPO_ID-$TREE.ok
mkdir -p ~/.claude/precommit-reviews
cat > "$MARKER" <<'JSON'
{"schema_version":1,"reviewer_id":"smoke","verdict":"APPROVE","checks":{"typecheck":{"exit":0,"duration_ms":0,"command":"skip"},"test":{"exit":0,"duration_ms":0,"command":"skip"}},"checklist":{"pool_max_2":"n/a","api_gw_30s":"n/a","withauth_zoderror":"n/a","shframe_source":"n/a","sentinel_guard":"n/a","function_url_cors":"n/a","content_type_json":"n/a","i18n_parity":"n/a","security":"n/a"},"approved_at_unix":0}
JSON
echo '{"tool_name":"Bash","tool_input":{"command":"git push origin docs/review-automation-spec"},"hook_event_name":"PreToolUse"}' \
  | python3 ~/.claude/hooks/prepush-review-gate.py
echo "exit=$?"
rm "$MARKER"
```
Expected: `exit=0`, stdout contains `"permissionDecision": "deny"` (partial coverage → BLOCK). Single marker validates the all_reviewed loop, but missing markers on the other 2 commits cause `all_reviewed=False` → falls through to prepush HEAD marker check (also missing) → deny.

(Full coverage test = synthesize markers for ALL 3 trees → silent allow. Deferred to manual verification — fixture too complex for plan.)

- [ ] **Step 5: Scenario 5 — `-a` flag bypass blocked**

```bash
mkdir -p /tmp/scenario-5 && cd /tmp/scenario-5 && git init -q
git config user.email t@t && git config user.name t
echo init > a.txt && git add a.txt && git commit -qm init
mkdir -p .claude && touch .claude/review-gate-on
seq 1 20 > a.txt  # tracked modified, NOT staged
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -am big-change"},"hook_event_name":"PreToolUse"}' \
  | python3 ~/.claude/hooks/precommit-review-gate.py
echo "exit=$?"
cd - >/dev/null && rm -rf /tmp/scenario-5
```
Expected: `exit=0`, stdout `deny` JSON. The `-a` flag triggers `git stash create` path which DOES see the working-tree change.

- [ ] **Step 6: Scenario 6 — escape hatch with TTL**

```bash
mkdir -p /tmp/scenario-6 && cd /tmp/scenario-6 && git init -q
git config user.email t@t && git config user.name t
echo init > a && git add a && git commit -qm init
mkdir -p .claude && touch .claude/review-gate-on
seq 1 20 > a && git add a
CLAUDE_REVIEW_BYPASS="$(date -Iminutes) smoke-test" \
  python3 ~/.claude/hooks/precommit-review-gate.py < <(echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"},"hook_event_name":"PreToolUse"}') 2>&1 | tail -20
echo "exit=$?"
# Check log
grep smoke-test ~/.claude/review-bypass-log.jsonl | tail -1
cd - >/dev/null && rm -rf /tmp/scenario-6
```
Expected: ASCII banner on stderr, `exit=0`, log line contains `smoke-test`.

- [ ] **Step 7: Scenarios 7-9 (worktree fallback, base fallback chain, mkdir parent dir)**

These are partially deferred (worktree fallback requires `scope: all-worktrees` which is Phase 3 expansion). Document as "verified via Phase 1 only — scenario 7-9 to be exercised in Phase 3 audit."

Run:
```bash
ls ~/.claude/precommit-reviews/  # Should be created automatically on first fire (Task 4 os.makedirs)
ls ~/.claude/prepush-reviews/    # Should be created automatically on first fire (Task 14 os.makedirs)
```
Expected: Both directories exist.

### Task 20: Verify bypass audit warning fires

**Files:** none (testing only)

- [ ] **Step 1: Inject 3 fake bypass entries into log**

```bash
for i in 1 2 3; do
  echo "{\"ts_unix\":$(date +%s),\"repo\":\"/tmp/test\",\"head\":\"abc\",\"command_kind\":\"commit\",\"reason\":\"audit-test-$i\"}" \
    >> ~/.claude/review-bypass-log.jsonl
done
tail -3 ~/.claude/review-bypass-log.jsonl
```
Expected: 3 lines printed with `audit-test-1/2/3`.

- [ ] **Step 2: Run session-precheck hook manually**

Run:
```bash
python3 ~/.claude/hooks/lisna-session-precheck.py 2>&1 | grep -i bypass
```
Expected: Line `⚠️ [review-gate] N bypasses in last 24h. Audit log: ...` where N≥3.

- [ ] **Step 3: Cleanup test entries**

```bash
grep -v 'audit-test-' ~/.claude/review-bypass-log.jsonl > /tmp/log.clean
mv /tmp/log.clean ~/.claude/review-bypass-log.jsonl
```

### Task 21: Plan-level acceptance verification (spec Section 12)

**Files:** none (final check)

- [ ] **Step 1: AC1 — All 9 post-deploy scenarios pass**

Already verified in Task 19. Document any deferrals (scenarios 7-9 partial per Phase plan).

- [ ] **Step 2: AC2 — _lib_marker unit tests all pass**

Run:
```bash
cd ~/.claude/hooks && python3 -m unittest test__lib_marker -v 2>&1 | tail -3
```
Expected: `Ran 10 tests in ... OK`.

- [ ] **Step 3: AC3 — Bootstrap commit landed**

Run:
```bash
cd /Users/guntak/Lisna
git log --oneline -3 .claude/review-gate-on
```
Expected: At least one commit touching `.claude/review-gate-on`.

- [ ] **Step 4: AC5 — Non-Lisna project unaffected**

Re-run Scenario 1 (Task 19 Step 1). Confirmed earlier; re-verify if any infra changed.

- [ ] **Step 5: AC6 — Rollback procedure verified**

Do NOT actually rollback. Just verify the backup files still exist:
```bash
ls -la ~/.claude/settings.json.backup-* ~/.claude/hooks/prepush-review-gate.py.backup-* | head -2
```
Expected: Both backups present.

- [ ] **Step 6: AC4 — Phase 1 audit window (3-7 days)**

This is a TIME-DEFERRED acceptance criterion. After 3-7 days of normal usage, run:
```bash
# Count bypass entries
wc -l ~/.claude/review-bypass-log.jsonl
# Inspect
cat ~/.claude/review-bypass-log.jsonl
```
Expected: ≤2 entries (per AC4: "실수 빈도 임계값"). If >2, investigate root cause (reviewer infinite loop? misuse?) before Phase 3.

---

## Phase 8 (deferred — after 3-7 day audit)

### Task 22 (deferred): Phase 3 worktree expansion

Once Phase 1 audit shows ≤2 bypasses in 7 days:

- [ ] **Step 1: Update opt-in marker to scope: all-worktrees**

Edit `/Users/guntak/Lisna/.claude/review-gate-on`, change `# scope: main-only` → `# scope: all-worktrees`.

- [ ] **Step 2: Commit (trivial-skip eligible — silent allow expected)**

```bash
cd /Users/guntak/Lisna
git add .claude/review-gate-on
git commit -m "chore(hooks): expand review gate to all worktrees (Phase 3)"
```
Expected: trivial-skip silent allow (1 ins / 1 del / 1 file → all < threshold). No reviewer needed. (If gate unexpectedly fires, fall back to `CLAUDE_REVIEW_BYPASS="$(date -Iminutes) phase-3-scope-expansion" git commit ...`.)

- [ ] **Step 3: Smoke test from a worktree**

```bash
cd /Users/guntak/Lisna/.claude/worktrees/<any-lane>
seq 1 15 > /tmp/wt-smoke.txt
mv /tmp/wt-smoke.txt docs/wt-smoke-test.tmp
git add docs/wt-smoke-test.tmp
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"},"hook_event_name":"PreToolUse"}' \
  | python3 ~/.claude/hooks/precommit-review-gate.py
echo "exit=$?"
git restore --staged docs/wt-smoke-test.tmp
rm docs/wt-smoke-test.tmp
```
Expected: `exit=0`, deny JSON in stdout (worktree fallback active, marker now applies).

---

## Final commit

### Task 23: Commit the Lisna-side opt-in marker + (optionally) update CLAUDE.md/rules

**Files:**
- Already committed: `/Users/guntak/Lisna/.claude/review-gate-on` (Task 18)
- Future task: update `CLAUDE.md` "7 Lisna-specific invariants" → 9 (deferred per Round 5 LOW)

- [ ] **Step 1: Push spec + plan + marker branch to origin**

```bash
cd /Users/guntak/Lisna
git log --oneline -5
```
Expected: Recent commits include:
- `chore(hooks): enable review gate opt-in for Lisna ...`
- `docs(spec): absorb Round 5 reviewer fixes ...`
- `docs(spec): review automation strengthening ...`

Push the initial-setup bootstrap. The new prepush gate is now active and will see 3 commit trees ahead (spec, spec-patch, opt-in-marker) — none of which have precommit markers yet (created retroactively during plan execution).

Two options:

**Option A (recommended for initial setup)** — single bypass for the one-time setup push:
```bash
CLAUDE_REVIEW_BYPASS="$(date -Iminutes) initial-setup-bootstrap: spec+plan+marker first push" \
  git push -u origin docs/review-automation-spec
```
The bypass is logged to `~/.claude/review-bypass-log.jsonl` (audit trail). Subsequent pushes from this branch will require proper reviewer markers per the normal flow.

**Option B (full normal flow)** — spawn 3 sequential reviewers, one per commit tree, write 3 JSON markers:
```bash
# For each commit in base..HEAD: get tree, spawn reviewer, write marker
git log --format='%H %T' origin/main..HEAD
# Per-tree: cat > ~/.claude/precommit-reviews/<repo_id>-<tree>.ok <<JSON ... JSON
git push -u origin docs/review-automation-spec
```
More work but no bypass entry. Use this for "real" pushes after Phase 1.

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "docs+chore: review automation strengthening (commit gate + brief)" \
  --body "$(cat <<'EOF'
## Summary
- Spec: precommit gate mirror of prepush + per-staged-tree JSON marker + 9-key Lisna invariant brief + per-project opt-in + bypass with TTL
- Plan: 23 bite-sized tasks across 8 phases (TDD-style, ~570 lines / 6 files)
- Opt-in marker enables the new gate for Lisna main repo (scope: main-only initially)

## Test plan
- [x] _lib_marker unit tests 10/10 pass
- [x] precommit gate smoke tests 5/5 pass
- [x] Post-deploy scenarios 1-6 pass (7-9 deferred to Phase 3)
- [x] Bypass audit warning fires correctly
- [ ] Phase 1 monitor: ≤2 bypasses in 7 days (TIME-DEFERRED)
- [ ] Phase 3: worktree expansion after Phase 1 success

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR URL returned.

---

## Out-of-scope (for separate task)

- Update root `CLAUDE.md` line 175 "7 Lisna-specific invariants" → "9 invariants" (per Round 5 LOW item — coordination doc fix, not architectural).
- Add CI json-schema lint for marker schema validation (spec Section 11.4 open question — not blocking).
- Dotfile sync for `~/.claude/` across multiple founder machines (spec Section 11.4 open question — out of scope for this plan).

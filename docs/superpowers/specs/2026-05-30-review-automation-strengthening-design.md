# Review automation strengthening — commit gate + brief 강화

**Date**: 2026-05-30
**Status**: SPEC (post-brainstorming, post 4-round reviewer cycle)
**Scope**: 글로벌 `~/.claude/` hooks + Lisna opt-in marker
**Authoring context**: founder는 코드 직접 검토 불가, reviewer subagent에 100% 위임 상태. 메인 에이전트의 reviewer 호출 누락과 reviewer false approve 두 구멍을 모두 차단하는 게 목적.

---

## 1. Problem

현재 자동 review 게이트는 `git push` 단계에 1개만 존재한다 ([prepush-review-gate.py](~/.claude/hooks/prepush-review-gate.py)). 그 이전 단계에서는:

1. **메인 에이전트의 reviewer 호출 누락** — 코드 수정 후 reviewer 호출을 깜빡해도 잡히지 않음
2. **reviewer의 false approve** — 1명의 리뷰어가 표면적으로 통과시키면 사용자가 알 길 없음
3. **prepush brief의 약한 강제력** — 체크리스트 없음, "확신 없으면 통과" 행동 권장 없음, 테스트 실제 실행 강제 없음

founder가 코드 직접 검토 불가 상황이라 위 세 구멍은 사용자가 catch 불가. 자동화 강화로 막아야 한다.

---

## 2. Goals

- **G1**: 메인 에이전트가 코드 수정 후 reviewer 호출 누락 시 차단 (hook-enforced)
- **G2**: reviewer가 단순 텍스트 APPROVE만으로 통과되지 않도록 검증 강화 (체크리스트 + 테스트 실행 결과 기재 의무)
- **G3**: 비-Lisna 프로젝트에 영향 0 (글로벌 hook이지만 per-project opt-in)
- **G4**: 기존 prepush gate와 자연스럽게 합성 (cost 중복 없이 2층 방어)
- **G5**: 실수로 자동화가 wedge되지 않도록 escape hatch + fail-policy 명시

---

## 3. Non-goals

- Lisna 외 프로젝트의 자동 활성화 (모든 프로젝트는 opt-in 마커 명시적 생성 후 활성)
- reviewer 자체의 hallucination / lying 방어 (브리프 강제력은 80% 차단, 100%는 별도 신뢰 메커니즘 필요 — future work)
- UserPromptSubmit / Stop hook 같은 매 응답 단위 강제 (검토 결과 부적합 — section 9 결정 로그 참조)
- 자동 코드 수정 / auto-fix (게이트는 BLOCK까지만, fix는 메인 에이전트 책임)

---

## 4. Architecture overview

추가/변경되는 것 4개 + Lisna 마커 1개:

```
NEW    ~/.claude/hooks/precommit-review-gate.py            ← PreToolUse on Bash(git commit *)
EDIT   ~/.claude/hooks/prepush-review-gate.py              ← base..HEAD 마커 공유 + brief 강화
NEW    ~/.claude/hooks/_lib_marker.py                      ← shared JSON marker validation
EDIT   ~/.claude/settings.json                             ← precommit gate 등록 (push gate 위)
NEW    /Users/guntak/Lisna/.claude/review-gate-on          ← Lisna opt-in 마커 (git-tracked, 헤더 코멘트 1줄)
```

### 흐름

```
[Main agent: edits + tries git commit]
   ↓
[precommit-review-gate fires]
   ↓
1. shlex 토큰 검사: 실제 git commit 아님 → allow
2. .claude/review-gate-on 마커 검사 (worktree fallback 포함) → 없음 → allow (opt-out 프로젝트)
3. CLAUDE_REVIEW_BYPASS env (with timestamp TTL) → set → allow + 로그 + stderr banner
4. -a / --all 플래그 감지 → 있으면 git stash create 사용, 없으면 git write-tree
5. trivial-skip (<10 ins AND <10 del AND <3 files) → allow
6. ~/.claude/precommit-reviews/<repo>-<tree>.ok 마커 JSON validation → 통과 → allow
7. 위 모두 실패 → deny + 강화된 brief
   ↓
[Main: independent reviewer Agent (general-purpose, opus)]
   ↓
[Reviewer: typecheck + test 실행 + 9 checklist verdict + JSON marker 작성]
   ↓ APPROVE
[mkdir -p ~/.claude/precommit-reviews && cat > <marker> <<JSON ...]
   ↓
[Re-run git commit] → marker 적중 → allow → commit 성공
   ↓ 나중에
[git push 시도]
   ↓
[prepush-review-gate fires]
   ↓
A. base..HEAD 각 commit의 tree SHA 추출 (batch query: git log --format="%T")
B. 각 tree SHA로 precommit marker 조회 → 전부 적중 → allow (중복 review 0)
C. 일부 미적중 OR base 결정 실패 → 기존 HEAD-marker 검사로 fallback
D. HEAD marker도 없음 → BLOCK + 강화된 brief
   ↓ reviewer → APPROVE marker → push 진행
```

### 2층 방어 의미

| Layer | 역할 |
|---|---|
| precommit gate (early, cheap) | 변경 단위별 조기 검토. Lisna 인바리언트, 작은 결함 잡기. |
| prepush gate (final, hard) | 외부로 나가기 직전 최종 점검. 회귀/통합/보안 관점. |
| 두 gate 공유 | 동일 JSON marker schema, 동일 brief 9-key 체크리스트. precommit이 잡은 commit은 prepush 자동 skip → 중복 review 0. |

---

## 5. precommit-review-gate.py 사양

### 5.1 명세 (pseudo-code; 실제 구현 1:1)

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
import sys, os, json, shlex, time, random, hashlib, subprocess, datetime

# === Bootstrap: sys.path for _lib_marker ===
_HOOK_DIR = os.path.dirname(os.path.abspath(__file__))
if _HOOK_DIR not in sys.path:
    sys.path.insert(0, _HOOK_DIR)
try:
    from _lib_marker import validate_marker
except ImportError as e:
    # FAIL-CLOSED: validation unavailable = lying reviewer can pass
    deny("_lib_marker.py missing — review gate cannot validate. Install or rollback.")

PRECOMMIT_MARKER_DIR = os.path.expanduser("~/.claude/precommit-reviews")
BYPASS_LOG = os.path.expanduser("~/.claude/review-bypass-log.jsonl")
CLEANUP_DAYS = 3
CLEANUP_SAMPLE_RATE = 0.01
TRIVIAL_INS = 10
TRIVIAL_DEL = 10
TRIVIAL_FILES = 3
BYPASS_TTL_SECONDS = 60 * 60  # 60 min
LOOP_DETECTION_THRESHOLD = 3   # attempts per tree SHA

# Ensure marker dir exists (defense alongside brief's mkdir -p instruction)
os.makedirs(PRECOMMIT_MARKER_DIR, exist_ok=True)


# === Tier 1: command parsing (shlex, not regex) ===

def parse_git_commit(command):
    """Return (is_git_commit, uses_all_flag)."""
    try:
        tokens = shlex.split(command)
    except ValueError:
        return False, False
    i = 0
    while i < len(tokens) and is_env_token(tokens[i]):
        i += 1
    if i + 1 >= len(tokens):
        return False, False
    if tokens[i] != "git" or tokens[i+1] != "commit":
        return False, False
    return True, uses_all_flag(tokens[i+2:])

def is_env_token(t):
    if "=" not in t: return False
    name = t.split("=", 1)[0]
    if not name: return False
    if not (name[0].isalpha() or name[0] == "_"): return False
    return all(c.isalnum() or c == "_" for c in name)

def uses_all_flag(args):
    """-a / --all / -am / -aem etc. Stops at -- separator."""
    SINGLE_LETTER_FLAGS = set("aeimsnvqSFcCtuoip")
    for t in args:
        if t == "--": break
        if t == "--all" or t == "-a": return True
        if t.startswith("-") and not t.startswith("--"):
            body = t[1:].split("=", 1)[0]
            if "a" in body and all(c in SINGLE_LETTER_FLAGS for c in body):
                return True
    return False


# === Tier 2: project opt-in (worktree fallback) ===

def project_opted_in(toplevel):
    """Check both worktree root AND main repo root (for worktree scope)."""
    # Direct: worktree's own .claude/review-gate-on
    direct = os.path.join(toplevel, ".claude", "review-gate-on")
    if os.path.isfile(direct):
        return validate_scope(direct, is_worktree=False)

    # Fallback: main repo via --git-common-dir (only for worktrees)
    common = run_git("rev-parse", "--git-common-dir")
    if not ok(common):
        return False
    common_path = common.stdout.strip()
    if not os.path.isabs(common_path):
        common_path = os.path.join(toplevel, common_path)
    main_root = os.path.dirname(common_path.rstrip("/.git"))
    if main_root == toplevel:
        return False  # not a worktree
    fallback = os.path.join(main_root, ".claude", "review-gate-on")
    if not os.path.isfile(fallback):
        return False
    return validate_scope(fallback, is_worktree=True)

def validate_scope(marker_path, is_worktree):
    """Read marker header for scope: line. Default = main-only."""
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
        return False  # opt-in IO failure = treat as not-opted-in (opt-out)


# === Tier 3: escape hatch with TTL ===

def check_bypass():
    raw = os.environ.get("CLAUDE_REVIEW_BYPASS", "").strip()
    if not raw: return None
    # Format: "<ISO-timestamp> <reason>"
    parts = raw.split(None, 1)
    if len(parts) < 2:
        return None  # malformed, ignore (fail-closed for bypass = require review)
    ts_str, reason = parts
    try:
        ts = datetime.datetime.fromisoformat(ts_str).timestamp()
    except (ValueError, TypeError):
        return None
    if abs(time.time() - ts) > BYPASS_TTL_SECONDS:
        return None  # expired
    return reason

def emit_bypass_banner(reason, command_kind):
    banner = (
        "\n" + "=" * 60 + "\n"
        + "  [REVIEW GATE BYPASSED]\n"
        + "  command: %s\n  reason: %s\n" % (command_kind, reason)
        + "  Logged to: ~/.claude/review-bypass-log.jsonl\n"
        + "=" * 60 + "\n"
    )
    sys.stderr.write(banner)

def log_bypass(toplevel, head_sha, reason, command_kind):
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
        pass  # log failure never fatal


# === Tier 4: tree SHA + diff stats (with N1 fallback) ===

def compute_tree_and_stats(uses_all):
    """Returns (tree_sha, ins, dels, files)."""
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
    import re
    ins = int(re.search(r'(\d+) insertion', s).group(1)) if 'insertion' in s else 0
    dels = int(re.search(r'(\d+) deletion', s).group(1)) if 'deletion' in s else 0
    files = int(re.search(r'(\d+) file', s).group(1)) if 'file' in s else 0
    return ins, dels, files


# === Tier 5: loop detection ===

def attempts_counter(marker_path):
    """Track repeated BLOCK attempts for same tree SHA → loop detection."""
    counter_path = marker_path[:-3] + ".attempts"  # .ok → .attempts
    try:
        with open(counter_path) as f:
            count = int(f.read().strip())
    except (IOError, ValueError):
        count = 0
    count += 1
    try:
        with open(counter_path, "w") as f:
            f.write(str(count))
    except IOError:
        pass
    return count


# === Main flow ===

def main():
    command = read_command_from_stdin()
    is_commit, uses_all = parse_git_commit(command)
    if not is_commit: allow()

    top = run_git("rev-parse", "--show-toplevel")
    if not ok(top): allow()
    toplevel = top.stdout.strip()

    if not project_opted_in(toplevel): allow()

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
    if validate_marker(marker): allow()

    # Loop detection
    attempts = attempts_counter(marker)
    loop_warning = ""
    if attempts >= LOOP_DETECTION_THRESHOLD:
        loop_warning = (
            "\n⚠️ LOOP DETECTED (%d attempts for tree %s).\n"
            "If reviewer keeps failing to write valid marker, use:\n"
            "  CLAUDE_REVIEW_BYPASS=\"$(date -Iminutes) loop-recovery: <reason>\" git commit ...\n"
            % (attempts, tree[:12])
        )

    deny(build_brief(tree, ins, dels, files, marker, toplevel) + loop_warning)
```

### 5.2 빌드 brief (deny 시 반환되는 reason)

```
PRECOMMIT EXPERT REVIEW REQUIRED — no valid review marker for staged tree <tree-sha12>.

⚠️ MARKER FORMAT (changed 2026-05-30): JSON only. `touch` is fail-closed and will loop forever.
   See JSON schema below. Old `mkdir -p && touch` pattern WILL FAIL.

Staged diff: <N> insertions / <M> deletions / <F> files.

REVIEWER BRIEF:
1. Spawn an INDEPENDENT reviewer (Agent tool, subagent_type=general-purpose, model=opus).
   You (author) must NOT review your own work.

2. Reviewer reads `git diff --cached` (or `git diff HEAD` if -a/--all was used).

3. Reviewer ACTUALLY EXECUTES `pnpm --filter <owning-pkg-list> typecheck` and
   `pnpm --filter <owning-pkg-list> test` in <toplevel>. Record exit + duration.
   - Identify owning packages from changed file paths (backend/, extension/, web/, desktop/, shared/)
   - DO NOT run full monorepo `pnpm typecheck` (3-5 min cost). Filter to affected packages only.

4. Reviewer evaluates each of these 9 invariants explicitly:
   Each gets a value of "ok" (passed) | "n/a" (영역 미관련, 확신할 때만) | "fail" (위반 발견 OR 영역
   건드리는데 위반 여부 판단 불가). 'n/a'는 영역 미관련이 명확할 때만; 영역 건드리는데 확신 못 함 = 'fail'.
   - pool_max_2: pg.Pool max:2 honored, transactions via pool.connect()
   - api_gw_30s: no new handler exceeds API GW 30s ceiling
   - withauth_zoderror: new protected handlers use withAuth wrapper
   - shframe_source: cross-frame postMessage carries source: 'sh-frame'/'sh-parent'
   - sentinel_guard: content-script listeners inside __SH_CONTENT_BOOTED__ guard
   - function_url_cors: Function URL CORS configured separately from API GW
   - content_type_json: all JSON responses set Content-Type: application/json
   - i18n_parity: web/messages catalogs EN/JA/KO key-parity intact
   - security: no SQLi, XSS, auth bypass (secret-shape는 secret-guard.py가 별도 차단)

5. AUTO-BLOCK triggers (verdict=BLOCK regardless of other checks):
   - new line in package.json dependencies/devDependencies (supply-chain review)
   - new HTTP endpoint added without test in backend/tests/
   - single function ≥30 lines without justification
   - ≥200-line NEW CODE FILE (.ts/.tsx/.py/.go/.rs etc); 제외: .txt/.json/.sql/.md/.csv/.yaml +
     디렉터리 backend/tests/fixtures/, */baselines/, */messages/, web/public/, extension/test-results/

6. EXTERNAL KNOWLEDGE GROUNDING (only when diff touches deps / external APIs / framework patterns /
   auth / security): use WebSearch + WebFetch to verify against current best practices, recent
   breaking changes for specific library versions in diff, known CVEs. Skip for pure internal logic.

7. **DEFAULT TO BLOCK ON UNCERTAINTY**. If you cannot definitively say a checklist item is "ok" or
   "n/a", mark "fail" and BLOCK. This is the author's safety net — author cannot read code themselves.

8. On APPROVE, write marker (NOT touch — JSON only):

   mkdir -p ~/.claude/precommit-reviews
   cat > '<marker-path>' <<'JSON'
   {
     "schema_version": 1,
     "reviewer_id": "<your-agent-id>",
     "verdict": "APPROVE",
     "checks": {
       "typecheck": {"exit": 0, "duration_ms": <int>, "command": "pnpm --filter <pkg> typecheck"},
       "test": {"exit": 0, "duration_ms": <int>, "summary": "<N> passed",
                "command": "pnpm --filter <pkg> test"}
     },
     "checklist": {
       "pool_max_2": "<ok|n/a>",
       "api_gw_30s": "<ok|n/a>",
       "withauth_zoderror": "<ok|n/a>",
       "shframe_source": "<ok|n/a>",
       "sentinel_guard": "<ok|n/a>",
       "function_url_cors": "<ok|n/a>",
       "content_type_json": "<ok|n/a>",
       "i18n_parity": "<ok|n/a>",
       "security": "<ok|n/a>"
     },
     "approved_at_unix": <unix-epoch>
   }
   JSON

   Then re-run the original `git commit ...` — same tree SHA → marker hits → allow.

9. On BLOCK: do NOT write marker. Report defects as path:line — defect — why — fix.
   Author fixes → new staged tree → fresh marker needed.

Emergency bypass (60-min TTL, logged to ~/.claude/review-bypass-log.jsonl):
  CLAUDE_REVIEW_BYPASS="$(date -Iminutes) <reason>" git commit ...
```

### 5.3 Fail policy

| 케이스 | 정책 | 이유 |
|---|---|---|
| shlex.split malformed command | fail-open | non-commit/push 가능성 |
| `git rev-parse` 실패 (not-a-repo, detached) | fail-open | wedge 안 됨 |
| `git stash create` / `write-tree` 실패 | fail-open | git 자체 결함 hook 책임 X |
| `git diff --shortstat` 실패 | fail-open | 동상 |
| marker dir 생성 실패 | fail-open | 디스크/권한 문제 |
| **`_lib_marker.py` import 실패** | **fail-closed** | 검증 불능 = lying reviewer 통과 risk |
| **marker file IO/parse 실패** | **fail-closed** | lying/lazy reviewer 방어 |
| **marker schema validation 실패** | **fail-closed** | 동상 |
| **unknown `schema_version`** | **fail-closed** | forward-compat 안전판 |
| opt-in marker IO 실패 (permission) | opt-out 처리 (allow) | 마커 없음으로 간주 |
| matcher false positive (Bash if 절이 잘못 매칭) | hook 자체 토큰 검사 후 allow | 2층 방어 |
| `CLAUDE_REVIEW_BYPASS` valid + 신선 | fail-open + 로그 + banner | 사용자 명시 우회 |

---

## 6. prepush-review-gate.py 변경 사양

### 6.1 추가 로직 (기존 95-110줄 사이에 삽입)

```python
import sys, os
_HOOK_DIR = os.path.dirname(os.path.abspath(__file__))
if _HOOK_DIR not in sys.path:
    sys.path.insert(0, _HOOK_DIR)
try:
    from _lib_marker import validate_marker
except ImportError:
    deny("_lib_marker.py missing — push gate cannot validate. Install or rollback.")

PREPUSH_MARKER_DIR = os.path.expanduser("~/.claude/prepush-reviews")
PRECOMMIT_MARKER_DIR = os.path.expanduser("~/.claude/precommit-reviews")
os.makedirs(PREPUSH_MARKER_DIR, exist_ok=True)

# === base 결정 chain (A2 fix) ===
base = None
used_30_fallback = False
up = run_git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
if ok(up):
    base = up.stdout.strip()
else:
    sym = run_git("symbolic-ref", "refs/remotes/origin/HEAD")
    if ok(sym):
        base = sym.stdout.strip().replace("refs/remotes/", "")
    else:
        for ref in ("origin/main", "origin/master", "origin/trunk", "origin/develop"):
            if ok(run_git("rev-parse", ref)):
                base = ref
                break

# === base..HEAD precommit marker 조회 (Fix #4) ===
if base:
    commits_r = run_git("rev-list", "%s..HEAD" % base)
else:
    commits_r = run_git("rev-list", "-30", "HEAD")
    used_30_fallback = True

if ok(commits_r):
    commits = [c for c in commits_r.stdout.strip().split("\n") if c]
    if not commits:
        allow()  # N5: 0 commits ahead

    # T9 fix: batch query — single subprocess for all tree SHAs
    trees_r = run_git("log", "--format=%T", base + "..HEAD" if base else "-30 HEAD")
    if ok(trees_r):
        trees = [t for t in trees_r.stdout.strip().split("\n") if t]
        all_reviewed = True
        for tree in trees:
            pc_marker = os.path.join(
                PRECOMMIT_MARKER_DIR, "%s-%s.ok" % (repo_id, tree))
            if not validate_marker(pc_marker):
                all_reviewed = False
                break
        # A1 fix: -30 fallback 시 all_reviewed=True여도 HEAD marker 추가 검사
        if all_reviewed and not used_30_fallback:
            allow()

# === Fallback: 기존 HEAD-marker (prepush) ===
prepush_marker = os.path.join(
    PREPUSH_MARKER_DIR, "%s-%s.ok" % (repo_id, head_sha))
if validate_marker(prepush_marker):
    allow()

# === 마지막으로 BLOCK + 강화된 brief ===
deny(build_enhanced_brief(...))
```

### 6.2 강화된 brief

precommit gate brief와 동일 구조 (9-key checklist, AUTO-BLOCK 4개 트리거, EXTERNAL KNOWLEDGE 조건부, JSON marker schema). 차이점:
- "Staged tree" → "HEAD <sha>"
- marker path: `~/.claude/prepush-reviews/<repo>-<head>.ok`
- diff: `git diff <base>...HEAD`

---

## 7. _lib_marker.py 사양 (shared)

```python
"""Shared marker JSON schema + validation for precommit + prepush gates.
Single source of truth — changes here propagate to both gates atomically.
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
    """fail-closed on any defect."""
    try:
        with open(path) as f:
            data = json.load(f)
    except (IOError, json.JSONDecodeError):
        return False
    # Schema version (B2 backward-compat)
    if data.get("schema_version") not in SUPPORTED_SCHEMA_VERSIONS:
        return False
    if data.get("verdict") != "APPROVE": return False
    checks = data.get("checks", {})
    for kind in ("typecheck", "test"):
        c = checks.get(kind)
        if not isinstance(c, dict) or c.get("exit") != 0:
            return False
    checklist = data.get("checklist", {})
    for k in REQUIRED_CHECKLIST_KEYS:
        v = checklist.get(k)
        if v not in ALLOWED_CHECKLIST: return False
        if v == "fail": return False
    return True
```

### Schema 진화 정책

- 신규 schema_version (v2 등) 추가 시 SUPPORTED_SCHEMA_VERSIONS에 둘 다 포함하는 transition window (≥7일)
- transition 끝나면 cleanup으로 자연 폐기 (precommit 3일 / prepush 14일 TTL)

---

## 8. Supporting infrastructure

### 8.1 settings.json 변경

`~/.claude/settings.json` PreToolUse → Bash 매처에서, **git-verify-reminder 다음, prepush gate 위**:

```json
{
  "type": "command",
  "if": "Bash(*vitest*)",
  "command": "python3 $HOME/.claude/hooks/lisna-stt-test-env.py"
},
{
  "type": "command",
  "if": "Bash(git commit *)",
  "statusMessage": "커밋 게이트: 전문가 리뷰 확인 중…",
  "command": "python3 $HOME/.claude/hooks/precommit-review-gate.py"
},
{
  "type": "command",
  "if": "Bash(git push *)",
  "statusMessage": "푸시 게이트: 전문가 리뷰 확인 중…",
  "command": "python3 $HOME/.claude/hooks/prepush-review-gate.py"
}
```

순서가 중요: git-verify-reminder가 먼저 advisory text 주입 → precommit gate가 다음 decision deny. 역순이면 deny 발생 시 reminder 손실.

### 8.2 Lisna opt-in marker (`/Users/guntak/Lisna/.claude/review-gate-on`)

내용 (`scope: main-only`가 default):

```
# Opt-in marker: presence enables ~/.claude/hooks/precommit-review-gate.py
# + prepush-review-gate.py for this repo. See ~/.claude/hooks/_lib_marker.py
# for marker schema.
# scope: main-only
```

- `scope: main-only` (default): main repo에서만 활성, worktree에서는 미활성 (단계적 rollout)
- `scope: all-worktrees` (옵션): worktree fallback도 활성 (T_CRIT fix — 단계적 활성화 후 변경)

git-tracked YES. PR diff에 헤더 코멘트 보임으로 의도 명확.

### 8.3 Escape hatch

```bash
CLAUDE_REVIEW_BYPASS="$(date -Iminutes) <reason>" git commit -m "..."
# 또는
CLAUDE_REVIEW_BYPASS="2026-05-30T15:30 emergency hotfix for X" git push
```

- timestamp prefix 필수 (ISO format)
- 60분 TTL → 만료 시 hook이 거부 (재지정 필요)
- 로그: `~/.claude/review-bypass-log.jsonl`, append-only
- stderr ASCII banner (시각적 인지 강제)

### 8.4 Bypass audit (SessionStart 통합)

`~/.claude/hooks/lisna-session-precheck.py`에 추가 (이미 SessionStart 단계, Lisna 한정 모니터링 정합):

```python
def check_bypass_freq():
    """최근 24h bypass ≥3건이면 stdout으로 warn."""
    try:
        cutoff = time.time() - 86400
        count = 0
        with open(os.path.expanduser("~/.claude/review-bypass-log.jsonl")) as f:
            for line in f:
                entry = json.loads(line)
                if entry.get("ts_unix", 0) >= cutoff:
                    count += 1
        if count >= 3:
            print(f"⚠️ [review-gate] {count} bypasses in last 24h. "
                  f"Audit ~/.claude/review-bypass-log.jsonl.")
    except (IOError, json.JSONDecodeError):
        pass
```

### 8.5 Cleanup 정책

| Marker | TTL | Sample rate |
|---|---|---|
| precommit | 3일 | 1% per fire |
| prepush | 14일 | 1% per fire (기존 유지) |
| `.attempts` counter | precommit과 동일 (3일) | 동일 |

Exception은 silent.

---

## 9. Decision log (4-round reviewer cycle)

### Round 1 — 원안 BLOCK
원안: Stop hook으로 응답 종료 직전 검토 누락 차단. Reviewer 1차 BLOCK 사유:
- (C) `stop_hook_active`는 한 응답당 1회만 fire → post-fix 무방비 (CRITICAL)
- (C) Stop hook matcher 없음 → 글로벌 blast radius (CRITICAL)
- (H) 코드 파일 1줄 발동 임계값 너무 낮음 (HIGH)
- (H) Bash heredoc/sed/tee로 Edit 우회 자명 (HIGH)
- 권고: commit gate (PreToolUse on git commit) + 프로젝트 opt-in으로 대체

### Round 2 — Commit gate 안으로 전환
대안 채택. Reviewer 2차 NEEDS-REVISION:
- (C) `git commit -a` staging 우회 → working tree 변경 못 봄
- (H) staged tree marker가 amend message-only와 충돌
- (H) 2층 방어 reviewer 호출 중복 비용
- (H) brief의 typecheck/test 실행 강제력 약함 (텍스트 권고만)
- + 6개 spec 빈틈

### Round 3 — fix 적용 후 Section 3 검증
3 CRITICAL/HIGH 모두 흡수 후 prepush gate 변경 검증. Reviewer NEEDS-REVISION:
- (H) `-30` fallback false-allow + origin/HEAD chain trunk 환경 실패
- (H) sys.path[0] 의존성 + `_lib_marker` 부재 정책 미정
- (H) secret-shape AUTO-BLOCK false positive (AWS 공식 예제 등)
- + 4개 MEDIUM

### Round 4 — Section 4 + 5 검증
모든 fix 흡수 후 인프라/테스트 검증. 최종 NEEDS-REVISION:
- (C) N2 worktree fallback ↔ T12 단계적 rollout 충돌 — per-worktree scope 옵션으로 해결
- (H) loop detection 없음 → 무한 BLOCK 가능
- (H) base..HEAD N×subprocess 비효율
- + 5개 MEDIUM

### 4-round 누적 결함 — 모두 spec 흡수

총 21개 결함 (4 CRITICAL + 9 HIGH + 8 MEDIUM/LOW) 모두 위 사양에 반영됨.

### REJECTED 옵션 (참고)

- **UserPromptSubmit reminder** — 글로벌 노이즈 위험 (결함 #2 변형 재발). 도입 안 함.
- **single layer (precommit만, prepush 폐지)** — rebase/cherry-pick으로 marker 없는 commit이 push에 묶일 수 있어 안전망 손실. 도입 안 함.
- **post-commit hook** — git native, commit 이미 발생 → reviewer BLOCK 시 `git reset --soft HEAD~` 필요해 UX 나쁨. 도입 안 함.

---

## 10. Testing / validation / rollback

### 10.1 Pre-deploy 검증

1. **Backup (필수)**:
   ```bash
   cp ~/.claude/settings.json ~/.claude/settings.json.backup-$(date +%Y%m%d)
   cp ~/.claude/hooks/prepush-review-gate.py ~/.claude/hooks/prepush-review-gate.py.backup-$(date +%Y%m%d)
   ```

2. **JSON / Python syntax 검증**:
   ```bash
   python3 -c 'import json; json.load(open("/Users/guntak/.claude/settings.json"))'
   python3 -m py_compile ~/.claude/hooks/precommit-review-gate.py
   python3 -m py_compile ~/.claude/hooks/prepush-review-gate.py
   python3 -m py_compile ~/.claude/hooks/_lib_marker.py
   ```

3. **_lib_marker unit tests 10개** (각 fail-closed 분기 cover):
   - T1 valid full marker → True
   - T2 빈 파일 (touch-style) → False
   - T3 missing checklist key → False
   - T4 typecheck exit != 0 → False
   - T5 unknown schema_version → False
   - T6 enum 위반 (`"yes"` 또는 `True`) → False
   - T7 honest "fail" 값 → False (정직한 reviewer가 일부 항목 fail 표시)
   - T8 missing top-level `checklist` 키 → False
   - T9 missing top-level `verdict` 키 → False
   - T10 schema_version 부재 → False

4. **Smoke test (stdin payload schema)**:

   Claude Code PreToolUse payload 형식:
   ```json
   {
     "tool_name": "Bash",
     "tool_input": {"command": "git commit -m 'x'"},
     "hook_event_name": "PreToolUse",
     "session_id": "...",
     "cwd": "/Users/guntak/Lisna",
     "transcript_path": "..."
   }
   ```

   - SmokeCase 1 (opt-out): tmp 디렉터리에서 fire → exit 0, stdout empty
   - SmokeCase 2 (trivial): Lisna에서 1줄 변경 fire → exit 0, stdout empty
   - SmokeCase 3 (non-trivial, marker 없음): Lisna에서 15줄 변경 fire → exit 0, stdout JSON `{"hookSpecificOutput": {"permissionDecision": "deny", "permissionDecisionReason": "PRECOMMIT EXPERT REVIEW..."}}`
   - SmokeCase 4 (false positive 차단): `{"tool_input": {"command": "echo git commit"}}` → exit 0, stdout empty
   - SmokeCase 5 (commit-tree): `{"tool_input": {"command": "git commit-tree abc"}}` → exit 0, stdout empty

### 10.2 Post-deploy 시나리오 9개

각 expected output 명시:

1. **opt-out 다른 프로젝트**: hook fire → exit 0 stdout empty → commit 진행
2. **Lisna main + trivial**: trivial-skip → silent allow
3. **Lisna main + non-trivial + marker 없음**: BLOCK → reviewer → marker JSON 작성 → re-commit → 성공
4. **push 시 precommit marker 공유**: silent allow (reviewer 0회 추가 호출)
5. **`-a` flag 우회 차단**: working tree 큰 변경 + `git commit -am` → stash create → 큰 diff 감지 → BLOCK
6. **escape hatch with TTL**: `CLAUDE_REVIEW_BYPASS="$(date -Iminutes) test" git commit` → allow + banner + 로그 append
7. **worktree fallback (scope=main-only)**: Lisna worktree에서 commit → opt-out 처리 (rollout 1단계)
8. **base fallback chain**: detached HEAD / 신규 branch (upstream 미설정) → `origin/HEAD` symbolic-ref → success
9. **mkdir parent dir on first fire**: `precommit-reviews/` 디렉터리 사전 삭제 → first fire 시 `os.makedirs` 자동 생성 → reviewer marker 작성 성공

### 10.3 Rollback (5단계)

```bash
# 1. settings.json revert (backup에서 복원)
cp ~/.claude/settings.json.backup-YYYYMMDD ~/.claude/settings.json

# 2. 새 hook 파일 제거
rm ~/.claude/hooks/precommit-review-gate.py
rm ~/.claude/hooks/_lib_marker.py

# 3. prepush-review-gate.py 복원
cp ~/.claude/hooks/prepush-review-gate.py.backup-YYYYMMDD ~/.claude/hooks/prepush-review-gate.py

# 4. marker 디렉터리 제거 (선택, 디스크 정리)
rm -rf ~/.claude/precommit-reviews/

# 5. Lisna opt-in marker 제거 (선택, PR 필요하지만 hook이 이미 비활성화라 no-op)
rm /Users/guntak/Lisna/.claude/review-gate-on  # git commit + PR

# 검증
python3 -c 'import json; json.load(open("/Users/guntak/.claude/settings.json"))'
```

Rollback 자체는 settings.json 편집만 거치므로 `git commit *` 매처가 fire 안 됨 → self-block 없음.

### 10.4 Performance baseline

- precommit gate latency: 50-200ms (5 git subprocess: rev-parse toplevel, write-tree/stash create, diff shortstat, marker stat, optional cleanup)
- prepush gate latency: 100-400ms (batch query: `git log --format=%T base..HEAD` 단일 호출로 N×subprocess → 1×subprocess. 100 commits @ ~50ms)
- reviewer 호출 latency: 30s-3min (pnpm filter typecheck 10-30s + filter test 30-60s + opus reviewer 60s)
- 사용자 경험: 작은 trivial commit (대다수) = 100ms 미만. non-trivial = reviewer 1회 (분 단위)

### 10.5 단계적 Rollout

| Phase | Period | Setting | 활성 범위 |
|---|---|---|---|
| Phase 1 (bootstrap) | 첫 3-7일 | Lisna main `scope: main-only` | Lisna main repo만 |
| Phase 2 (확장 검토) | bypass log audit | 동상 | 동상 |
| Phase 3 (worktree 활성화) | 안정 확인 후 | `scope: all-worktrees`로 변경 | Lisna main + 6 worktrees |
| Phase 4 (선택) | 필요 시 | 다른 프로젝트에 `.claude/review-gate-on` 추가 | 해당 프로젝트 |

**Phase 1 부트스트랩 첫 import**:
```bash
CLAUDE_REVIEW_BYPASS="$(date -Iminutes) bootstrap-import-review-automation" \
  git commit -m "chore(hooks): introduce precommit review gate (Phase 1, main-only)"
```

Marker 추가 commit은 trivial-skip 통과하지만 (0 ins / 0 del / 1 file → <10/<10/<3), 안전성으로 명시적 bypass 권장.

---

## 11. Implementation notes (for writing-plans skill)

### 11.1 File touch list

| 파일 | 변경 종류 | 라인 추정 |
|---|---|---|
| `~/.claude/hooks/precommit-review-gate.py` | NEW | ~250 |
| `~/.claude/hooks/_lib_marker.py` | NEW | ~50 |
| `~/.claude/hooks/prepush-review-gate.py` | EDIT (+30, brief 강화 -50 +130) | net ~+110 |
| `~/.claude/hooks/lisna-session-precheck.py` | EDIT (+20 bypass freq check) | +20 |
| `~/.claude/settings.json` | EDIT (+8 lines: precommit gate 등록) | +8 |
| `/Users/guntak/Lisna/.claude/review-gate-on` | NEW | 4 (헤더 코멘트) |

총 ~440 라인 신규/변경.

### 11.2 Dependency graph

```
_lib_marker.py (no deps)
   ↑
   ├── precommit-review-gate.py (imports _lib_marker)
   └── prepush-review-gate.py (imports _lib_marker)

settings.json (lists precommit-review-gate.py)
review-gate-on (read by precommit-review-gate.py)
lisna-session-precheck.py (reads bypass log)
```

### 11.3 Implementation order (suggested)

1. `_lib_marker.py` + unit tests 10개 → 통과 확인
2. `precommit-review-gate.py` + smoke test 5개 → 통과 확인
3. `prepush-review-gate.py` edit + smoke test → 통과 확인
4. `settings.json` 편집 (위 backup 선행)
5. `/Users/guntak/Lisna/.claude/review-gate-on` 생성 (`scope: main-only`)
6. `lisna-session-precheck.py` bypass freq check 추가
7. 부트스트랩 첫 import (`CLAUDE_REVIEW_BYPASS=...` 명시)
8. Phase 1 모니터링 3-7일 (bypass log audit)
9. Phase 3 worktree 활성화 (`scope: all-worktrees`)

### 11.4 Open questions for plan

- **smoke test 실행 자동화**: shell script로 묶을지 별도 Python harness 만들지?
- **CI 통합**: 이 hook들이 사용자 머신에만 영향이라 CI는 무관. 단 `_lib_marker.py` JSON schema는 CI에서 lint 가능 (json-schema 도구). 도입할지?
- **다른 founders / 다른 머신 propagation**: 현재 `~/.claude/`는 머신 로컬. 만약 founder가 다른 머신을 쓰면 별도 setup 필요. dotfile sync 같은 거 도입할지는 별도 결정.

---

## 12. Acceptance criteria

1. ✅ Section 5의 9개 시나리오 모두 expected output 일치
2. ✅ `_lib_marker.py` unit tests 10개 모두 통과
3. ✅ 부트스트랩 commit이 main repo에 안착, hook이 다른 commit에서 정상 fire
4. ✅ Phase 1 3-7일 모니터링에서 bypass log entry ≤2건 (실수 빈도 임계값)
5. ✅ 비-Lisna 프로젝트에서 hook fire하지 않음 (opt-out 검증)
6. ✅ rollback 절차로 hook 완전 무력화 가능

---

## 13. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| reviewer가 brief 무시하고 빈 marker 작성 | Med | High (무한 BLOCK) | N6 transition warning + loop detection 카운터 + bypass escape hatch |
| `git commit -a` 사용 패턴 우회 시도 | Low | High (게이트 무력) | -a 감지 + stash create 사용 |
| 부트스트랩 첫 commit이 self-block | Low | Med (인지 후 bypass로 해결 가능) | trivial-skip 통과 + bypass 명시적 안내 |
| 6 worktrees 동시 활성화로 reviewer 거부율 spike | Med | High (자동화 마비) | Phase 1-3 단계적 rollout (scope: main-only → all-worktrees) |
| `_lib_marker.py` import 실패 | Low | High (게이트 자체 죽음) | fail-closed + 명시적 error message |
| schema 진화 시 기존 marker 일괄 무효 | Med | Med (push 폭주) | SUPPORTED_SCHEMA_VERSIONS에 transition window |
| reviewer가 typecheck/test 거짓 기재 | Low | High (lying) | brief 강제력 80% + future work (reviewer trust 메커니즘 별도) |

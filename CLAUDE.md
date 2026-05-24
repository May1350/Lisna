# Lisna — Claude operating manual

This file is loaded into every Claude Code session. Keep it ≤ 150 lines.
Detailed rules live in `.claude/rules/`; this file is the entry index +
the top-20 highest-impact rules. When you find yourself wanting to add
a 21st, run `/rules-compress` first.

---

## Where things live

| File | Purpose |
|---|---|
| `docs/HANDOFF.md` | **Live state-of-the-world.** Read first for any non-trivial task. |
| `docs/PRD.md` | Locked product yardstick. Decisions defer to this. |
| `docs/REFACTOR_BACKLOG.md` | Prioritized refactor + maintenance queue. `/refactor-next` reads this. |
| `docs/superpowers/{plans,specs,decisions}/` | Spec stubs, plans, decision records. |
| `.claude/rules/_index.md` | What rule lives in which file. Open when looking up a category. |
| `.claude/rules/operations.md` | GitHub-side guards (ruleset, secret scanning, etc.). Open when push / merge / CI behaves unexpectedly. |
| `.claude/commands/` | Slash commands (`/learn`, `/handoff`, `/audit`, etc.) |

## Repo layout (one screen)

Monorepo, pnpm workspaces. TypeScript everywhere.
- `backend/` — AWS CDK + Lambda (Node 20) + RDS Postgres + API GW HTTP + WS API + S3.
- `extension/` — Chrome MV3 (Vite + React 18 + CRX plugin + Tailwind 4).
- `web/` — Next.js landing/legal pages (out of scope for product work).
- `desktop/` — v2 native shell (parked).
- `shared/` — cross-package types.

Detailed module map: `.claude/rules/architecture.md`.

---

## Top 20 rules (always loaded)

### Workflow

1. **Read `docs/HANDOFF.md` first** on any task involving runtime behavior, deployments, or recent changes. It is the authoritative live state.
2. **Defer to `docs/PRD.md`** when product scope is ambiguous. Don't add scope; ask.
3. **Branch convention**: feature branches off `main` (`fix/...`, `feat/...`, `chore/...`). Never push to `main` directly — the ruleset rejects it (see `.claude/rules/operations.md`).
4. **Conventional commit prefixes** match what `git log` shows: `fix(scope):`, `feat(scope):`, `chore(scope):`, `refactor(scope):`. Subject ≤ 72 chars.
5. **One PR = one concern.** If the diff spans backend + extension because of a shared type change, that's fine. If it spans unrelated bug fixes, split.

### Code

6. **Don't add new abstractions** unless 3+ existing call sites need them. Inline duplication is preferred over premature shared helpers (see `.claude/rules/architecture.md`).
7. **Don't add comments that restate code.** Comments explain WHY (invariant, workaround, surprise), not WHAT.
8. **Don't add error handling for cases that can't happen.** Validate at boundaries (HTTP handlers, message receivers); trust internal callers. Zod at the edge, plain TS inside.
9. **Don't keep dead code "just in case."** Delete it; git remembers.
10. **No backwards-compat shims** between internal modules. If you change a type, update the callers in the same PR.

### Lisna-specific invariants (full list in `rules/domain.md`)

11. **DB Pool is `max:2`.** Transactions need `pool.connect()` + same-client query (see `lib/migrate.ts`). Don't run multi-statement transactions through `pool.query`.
12. **API Gateway HTTP timeout is 30s and unraiseable.** Long-running handlers go behind a Lambda Function URL (curator pattern). Never add a >30s handler to API GW.
13. **`withAuth` wrapper catches `ZodError` → 400.** Body validation inside handlers should `throw` via `.parse()`; wrapper handles. New handlers MUST wrap.
14. **Cross-frame messaging** uses `source: 'sh-frame'` (iframe→top) and `source: 'sh-parent'` (top→iframe). Top frame relays modal control msgs to iframes. Don't post without source tag.
15. **Content-script re-injection guard**: `__SH_CONTENT_BOOTED__` window sentinel. New content-script listeners MUST be inside the guarded block, otherwise SPA navigations stack them.
16. **Function URL CORS is separate from API GW CORS.** Both must be locked post-publish. `cdk deploy -c allowedCorsOrigins=...`.
17. **All JSON API responses set `Content-Type: application/json`,** especially 4xx/5xx. Frontend SW JSON-parses every response.

### Self-maintenance (meta-rules — do not skip)

18. **On context pressure** (long session, repeated re-reads, ≥ ~70% context used), proactively propose `/handoff`: extract learnings → propose CLAUDE.md / rules diff → update `docs/HANDOFF.md` → suggest fresh-session prompt. Don't ask permission to suggest; do propose.
19. **When you find a new invariant or pitfall**, route via `/learn`. Don't write directly to root `CLAUDE.md`; the command picks the right file. Root stays ≤ 150 lines.
20. **All rule changes go through PRs.** Claude proposes diffs; the human merges. No direct push to `main` for rules.

---

## Slash commands (full list in `.claude/commands/`)

- `/learn "<insight>"` — route insight to right rules file
- `/handoff` — wrap up session (HANDOFF + decisions + next-prompt)
- `/audit` — weekly health check (file size, type drift, migration numbering, stale rules)
- `/refactor-next` — pick top item from `REFACTOR_BACKLOG.md`
- `/spec-new <name>` — scaffold a spec under `docs/superpowers/specs/`
- `/rules-compress` — propose merges of similar rules
- `/rules-sunset` — archive rules untouched > 90 days
- `/backlog-sync` — reconcile `REFACTOR_BACKLOG.md` ↔ GitHub Issues

## Project-specific shorthand

- "the modal" = `extension/src/side-panel/App.tsx` rendered inside `in-page-modal.ts` iframe
- "the curator" = `backend/src/lib/curator.ts` + `handlers/session-curate.ts`
- "the wrapper" = `backend/src/lib/auth.ts::withAuth`
- "the sentinel" = `__SH_CONTENT_BOOTED__`

---

**Self-check before responding to a non-trivial ask**:
- Did I read HANDOFF.md (or know its contents)?
- Does this touch one of the 7 Lisna-specific invariants above?
- Is there a rule in `.claude/rules/` for this category I should consult?
- If I'm about to add a workaround, should this become a `/learn` after the task?

# Testing rules

Lisna's test surface is intentionally focused. We test boundaries and
expensive-to-debug logic; we don't unit-test everything.

## Layout

- `backend/tests/` — Vitest. Categories: `auth/`, `db/`, `quota/`, `stt/`, `markdown-obsidian/`.
- `backend/tests/fixtures/transcripts/` — Whisper output samples for curator eval.
- `backend/tests/fixtures/baselines/` — frozen curator outputs for regression scoring.
- `extension/test-results/`, `extension/playwright-report/` — Playwright E2E artifacts (gitignored).

## Rules

- [2026-05-12] (scope) Test handlers via the wrapped `withAuth` form (i.e., HTTP-ish input + output). Don't test the inner anonymous function in isolation. Reason: the wrapper IS part of the behavior. last-cited: 2026-05-12
- [2026-05-12] (fixtures) New STT/curator features need a fixture transcript + a baseline. Add to `tests/fixtures/transcripts/` and freeze baseline via `pnpm tsx scripts/eval-curator.ts --baseline <name>`. Reason: regression detection. last-cited: 2026-05-12
- [2026-05-12] (db) DB tests use the dev pool (`max:2`). Don't bump pool size for tests — masks the real production constraint. Reason: prod parity. last-cited: 2026-05-12
- [2026-05-12] (network) Don't mock at the Lambda handler level. Mock the boundary library (`stt.ts`, `s3-presigned.ts`, etc.). Reason: handler logic worth testing is what's left after the boundary mock. last-cited: 2026-05-12

## When skipping a test is fine

- Pure UI tweaks (className, copy, color)
- Adding a new component that's just composition of existing tested primitives
- Migrations that only ALTER TABLE / ADD COLUMN with no backfill

## When NOT to skip

- New backend route (always add a `tests/<area>/` test)
- New curator prompt branch (always add eval fixture + baseline)
- Any change to `withAuth`, `migrate.ts`, `pool` config, or `quota.ts`
- Any cross-frame messaging change

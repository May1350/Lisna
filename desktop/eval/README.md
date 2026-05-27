# Lisna v2 eval harness

See `docs/superpowers/plans/2026-05-27-v2-plan-7-eval-harness.md` for the full plan.

Quick start (filled in at Task 25):
- `pnpm --filter @lisna/desktop eval:notes --family lecture` — run Lecture suite
- `pnpm --filter @lisna/desktop eval:notes --family lecture --baseline v0` — freeze baseline
- `pnpm --filter @lisna/desktop eval:notes --family lecture --against v0` — compare against baseline

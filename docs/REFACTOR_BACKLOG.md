# Refactor backlog

**Last updated**: 2026-05-23
**Last synced** (`/backlog-sync`): 2026-05-23

Living queue of maintenance / refactor / tech-debt items. NOT the
product roadmap — that lives in `docs/PRD.md` and `docs/HANDOFF.md` §4.

## How this file works

- Three sections: **Now** (P0/P1, actively planned), **Next** (P2, ready when capacity opens), **Parking lot** (P3, idea-stage).
- Each item one line. Format:
  ```
  - [P0|P1|P2|P3] **<title>** — <one-line reason>. Touches: <files>. Effort: S/M/L. [#<issue-num>]
  ```
- Mark completed items as `✅ DONE (YYYY-MM-DD)` and KEEP them in the file (history is useful). Sweep to `## Archive` annually.
- Edits land via PR. `/refactor-next` reads from "Now"; `/backlog-sync` reconciles with GitHub Issues.

---

## Now

_(Top priority — actively planned this sprint. Keep ≤ 5 items.)_

- [P1] **Resolve duplicate migration `004_*`** — `004_curate_cooldown.sql` and `004_processed_stripe_events.sql` share number 004. Caught by `pre-commit-check.sh` on first run. Need to renumber one (probably stripe → 004a or shift to 005, depending on which already ran in prod). Touches: `backend/src/migrations/`, `schema_migrations` table on every env. Effort: S (if not yet in prod) / M (if both ran). Verify against prod `schema_migrations` first.
- [P1] **Lock CORS post-publish** — both API GW and Function URL still `*`. Run `cdk deploy -c allowedCorsOrigins=chrome-extension://<id>` after Web Store publish. Touches: `infra/lib/api-stack.ts`, `infra/lib/curate-stack.ts`. Effort: S.
- [P2] **Anthropic SDK static import in SessCurateFn** — bundle bloat for a dormant `CURATOR_PROVIDER='anthropic'` branch. Move to dynamic import before flipping the env. Touches: `backend/src/lib/curator.ts`. Effort: S.
- [P2] **Drop legacy `notes` JSONB column** — new handlers don't write; UI ignores. Two-deploy migration (stop reading first, then DROP). Touches: `backend/src/migrations/`, `handlers/session-get.ts`. Effort: M.

## Next

_(Ready but waiting for capacity. Promote to Now when slot opens.)_

- [P2] **Promote `Outline` type to `shared/`** — currently duplicated in `backend/src/lib/curator.ts` and `extension/src/side-panel/api-client.ts`. Drift caused at least one 404. Touches: `shared/`, both call sites. Effort: M.
- [P3] **Eval baseline coverage** — add fixture transcripts for the underserved cases (60+ min lectures, JA/EN mixed, low-SNR). Touches: `backend/tests/fixtures/transcripts/`, baselines via `scripts/eval-curator.ts`. Effort: M.

## Parking lot

_(Ideas only — no commitment. Move up only after a real trigger.)_

- [P3] **Anki cloze export** — outline → cloze deletion cards via `check_question` items. Deferred until v0.3+. Effort: L.
- [P3] **Per-section curator** — re-curate just one section instead of full outline. Cost win on long lectures. Effort: L.

---

## Archive

_(Completed items — kept for history. Annual sweep moves to git only.)_

<!-- ✅ DONE (YYYY-MM-DD) <title> — <one-line> -->

# Refactor backlog

**Last updated**: 2026-05-27
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

- [P1] **Spike 0.2 Path F — 1B re-spike** — controller-recommended next after Path E (commit `d9d333d`). Run 3-sample sweep at `SPIKE_LLM_MODEL_PATH=…/Llama-3.2-1B-Instruct-Q4_K_M.gguf`; if ≤30 s/chunk with comparable slot emergence → Spike 0.2 PASS + picker default 1B on ≤12 GB Macs. Touches: `desktop/spikes/phase-0/02-3b-lecture-grammar/run-spike.ts` (env-only), `decision-0.2-latency.md`. Effort: S (~15 min).
- [P1] **Plan 2 wrapper failing-test enforcement** — paper mandate today (`decision-0.1-fail.md` line 236-243). First Plan 2 task = failing test asserting `maxAttempts`, fresh-seed contract, JSON+Zod catch→retry, surface `attemptsUsed`/`reason`. Without it the same failure modes hit production unchanged. Touches: `desktop/src/main/sidecar/wrapper.test.ts` (new), `wrapper.ts` (new). Effort: M.
- [P1] **Lock CORS post-publish** — both API GW and Function URL still `*`. Run `cdk deploy -c allowedCorsOrigins=chrome-extension://<id>` after Web Store publish. Touches: `infra/lib/api-stack.ts`, `infra/lib/curate-stack.ts`. Effort: S.
- [P2] **Per-attempt wall-time cap (90-120 s) + UI retry counter** — alpha-gate mitigation for triple-runaway 24-min UI hang (U2 production-risk reviewer). Cap stops a single mode-B exhaustion from burning the full budget; renderer shows "Retrying 2/3…" so spinner doesn't read as broken. Pair with Plan 2 wrapper. Touches: Plan 2 wrapper + `desktop/src/renderer/...`. Effort: M.
- [P2] **Anthropic SDK static import in SessCurateFn** — bundle bloat for a dormant `CURATOR_PROVIDER='anthropic'` branch. Move to dynamic import before flipping the env. Touches: `backend/src/lib/curator.ts`. Effort: S.
- [P2] **Drop legacy `notes` JSONB column** — new handlers don't write; UI ignores. Two-deploy migration (stop reading first, then DROP). Touches: `backend/src/migrations/`, `handlers/session-get.ts`. Effort: M.

## Next

_(Ready but waiting for capacity. Promote to Now when slot opens.)_

- [P2] **Promote `Outline` type to `shared/`** — currently duplicated in `backend/src/lib/curator.ts` and `extension/src/side-panel/api-client.ts`. Drift caused at least one 404. Touches: `shared/`, both call sites. Effort: M.
- [P3] **Eval baseline coverage** — add fixture transcripts for the underserved cases (60+ min lectures, JA/EN mixed, low-SNR). Touches: `backend/tests/fixtures/transcripts/`, baselines via `scripts/eval-curator.ts`. Effort: M.
- [P3] **Passkey sign-in (WebAuthn)** — add passkeys as a returning-user method on the signin page (2026 passwordless standard; complements the existing magic-link + OAuth). Needs an Auth.js WebAuthn provider + a credential-storage table + the "last used" hint already shipped on the signin page. Touches: `web/src/lib/auth.ts`, `web/src/components/ui/sign-in-panel.tsx`, a `webauthn_credentials` migration. Effort: L.
- [P2] **Extract design tokens to `shared/`** — color / type / scale / spacing currently live only in `web/tailwind.config.ts`. Promote to `shared/design/tokens.ts` so web + the future app consume one source (brand-drift prevention, same pattern as the `Outline`-type item). Touches: `shared/`, `web/tailwind.config.ts`. Effort: M. Spec: `docs/superpowers/specs/2026-05-25-app-design-system-layering.md`.
- [P3] **App design layer (desktop)** — give the unstyled desktop app its product-component layer + `.claude/rules/app-design.md`, built on the shared tokens (NOT a forked design system). Set up Tailwind v4 in `desktop/`, self-host fonts (offline), reuse legal-pad CSS only on low-density screens (SignIn/Setup), keep Recording function-first. Gated on desktop un-park. Touches: `desktop/`, `shared/design`. Effort: L. Spec: `docs/superpowers/specs/2026-05-25-app-design-system-layering.md`.

## Parking lot

_(Ideas only — no commitment. Move up only after a real trigger.)_

- [P3] **Anki cloze export** — outline → cloze deletion cards via `check_question` items. Deferred until v0.3+. Effort: L.
- [P3] **Per-section curator** — re-curate just one section instead of full outline. Cost win on long lectures. Effort: L.

---

## Archive

_(Completed items — kept for history. Annual sweep moves to git only.)_

- ✅ DONE (2026-05-23) **Resolve duplicate migration `004_*`** — renamed `004_processed_stripe_events.sql` → `008_processed_stripe_events.sql` and added bookkeeping migration `009_renumber_004_stripe_bookkeeping.sql` (DELETE stale `schema_migrations` row). Closed by #18.

<!-- ✅ DONE (YYYY-MM-DD) <title> — <one-line> -->

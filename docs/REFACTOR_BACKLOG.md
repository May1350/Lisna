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

- [P0] **Land C++ grammar-constrained generation — unblocks Plan 3/4/5/7 runtime** — the merged note pipeline cannot run end-to-end: C++ `LlamaEngine::generate` has no GBNF sampler and `GenOpts` lacks `seed`/`grammar` (`desktop/sidecar/src/llm/llama_engine.h:9`, `.cpp:148/193`); `SidecarClient.generateWithGrammar` is unimplemented (only the `GrammarCapableSidecar` interface + test mocks — `grammar-call.ts:113`); `session/finalize` is registered but not wired to the renderer (`ipc.ts:156`, no preload/renderer caller). When wiring, MUST extend `GenOpts` with `seed` and feed it to the sampler, or the Spike-0.1 fresh-seed retry contract silently no-ops. Coordinate with the active `fix+live-overflow-chunked-note` lane (chunked finalize overlaps). Lane: ai-infra (C++/main) + app-design (renderer). Effort: L.
- [P1] **Lock CORS post-publish** — both API GW and Function URL still `*`. Run `cdk deploy -c allowedCorsOrigins=chrome-extension://<id>` after Web Store publish. Touches: `infra/lib/api-stack.ts`, `infra/lib/curate-stack.ts`. Effort: S.
- [P2] **Per-attempt wall-time cap (90-120 s) + UI retry counter** — alpha-gate mitigation for triple-runaway 24-min UI hang (U2 production-risk reviewer). Cap stops a single mode-B exhaustion from burning the full budget; renderer shows "Retrying 2/3…" so spinner doesn't read as broken. Pair with Plan 2 wrapper. Touches: Plan 2 wrapper + `desktop/src/renderer/...`. Effort: M.
- [P2] **Anthropic SDK static import in SessCurateFn** — bundle bloat for a dormant `CURATOR_PROVIDER='anthropic'` branch. Move to dynamic import before flipping the env. Touches: `backend/src/lib/curator.ts`. Effort: S.
- [P2] **Drop legacy `notes` JSONB column** — new handlers don't write; UI ignores. Two-deploy migration (stop reading first, then DROP). Touches: `backend/src/migrations/`, `handlers/session-get.ts`. Effort: M.

## Next

_(Ready but waiting for capacity. Promote to Now when slot opens.)_

- [P2] **`itemTs` sort allowlist silent-fail risk** — `desktop/src/shared/post-decode/deterministic-merge.ts:53` reads `ts_start ?? ts` for `sortByTs` concat-only fields. A future family keying on a different temporal name (e.g. `startTs`) won't sort and raises no error — the exact failure mode that needed #61. Make `sortMaybe` fail loud on an unsortable item when `sortByTs`, or adopt one canonical temporal key across families. Touches: `deterministic-merge.ts`, family schemas. Effort: S.
- [P2] **Plan 6 merge gate: eval contract ↔ family-schema parity** — the eval harness (on main) defines interview/brainstorm contract rules, judge prompts, and ground-truth fixture field names independently of the Plan 6 family schemas (on `feat/v2-interview-brainstorm`, Phase D done+pushed). Field-name drift → eval mis-scores or fails silently. Gate: run `desktop/eval` contract tests against the new schemas before merging Plan 6. Touches: `desktop/eval/contract/families/`, `desktop/src/shared/families/{interview,brainstorm}/`. Effort: S.
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

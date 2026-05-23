# Architecture rules

Module-level constraints. See `docs/HANDOFF.md` §3 for the full module
map (Lambda handlers, extension components). This file holds the rules
that govern HOW we add or change modules.

## Layering

- [2026-05-12] (layers) Lambda handlers in `backend/src/handlers/` are thin orchestrators: parse → call lib → format. Business logic lives in `backend/src/lib/`. Reason: handlers are the boundary; logic in `lib/` is testable without simulating API Gateway. last-cited: 2026-05-12
- [2026-05-12] (layers) `backend/src/lib/` modules MUST NOT import from `handlers/`. Reason: one-way dependency keeps lib/ reusable in scripts/ too. last-cited: 2026-05-12
- [2026-05-12] (layers) `extension/src/shared/` types are the canonical request/response shapes shared with backend. Don't re-declare. If the backend type changes, update `shared/` and let both sides break-build into alignment. Reason: drift here = silent runtime bugs. last-cited: 2026-05-12
- [2026-05-12] (bundles) Anything imported by a Lambda handler ends up in that Lambda's bundle. Keep `scripts/` (judge, eval, measure) outside `src/` so they don't bloat Lambdas. `scripts/lib/judge.ts` was moved here specifically for this. Reason: cold-start size matters. last-cited: 2026-05-12

## Abstractions

- [2026-05-12] (DRY) Don't introduce a shared helper until 3+ call sites need it. Two duplications are fine; the third is the trigger. Reason: premature abstractions ossify the wrong shape. last-cited: 2026-05-12
- [2026-05-12] (wrappers) `withAuth<T>` is the ONE wrapper for protected handlers. Don't write a second wrapper variant; extend this one with options if needed. Exceptions: `auth-google.ts` (no Bearer yet) and `stripe-webhook.ts` (signature-verified, not Bearer). Reason: divergent auth surfaces are how holes appear. last-cited: 2026-05-12

## Cross-package boundaries

- [2026-05-12] (types) Outline shape lives in `backend/src/lib/curator.ts`. Extension mirrors it in `extension/src/side-panel/api-client.ts`. Both must update together; ideally promote to `shared/` when stable. Reason: live drift caused at least one UI 404 (2026-05-08). last-cited: 2026-05-12
- [2026-05-12] (bundling) Lambda bundling config: `minify + sourceMap + externalModules:['@aws-sdk/*']`. Don't change without measuring cold-start delta. Reason: aws-sdk in bundle adds ~3 MB → ~400 ms cold start. last-cited: 2026-05-12

## What goes where

- New backend route → handler in `handlers/` + lib in `lib/` + Zod schema in handler + test in `tests/<area>/` + CDK integration in `infra/lib/api-stack.ts` + (if protected) wrap in `withAuth`.
- New extension UI → component in `extension/src/side-panel/components/` + state in `App.tsx::applyEvent` if it reacts to a WS/postMessage event.
- New content-script behavior → guarded by `__SH_CONTENT_BOOTED__` in `content/index.ts`.
- New migration → `backend/src/migrations/NNN_<slug>.sql` with monotonic NNN. Run via `migrate.ts`.

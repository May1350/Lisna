# Pitfalls — battle scars

Bugs we've already paid for. Open this file before:
- Adding retries / timeouts to network calls
- Touching cross-frame messaging
- Adding listeners in content scripts
- Writing DB transactions
- Returning error responses

Migrated from `docs/HANDOFF.md` §6. Future pitfalls land here via `/learn`.

---

- [2026-05-12] (audio) Whisper segment timestamps drift ±1s within a 10s chunk. We accept this; do NOT try to reconcile across chunks. Reason: chunk-uniform was worse. last-cited: 2026-05-12
- [2026-05-12] (audio) Comparing wall-clock chunk advancement to `video.currentTime` via sample-rate math BREAKS at 2× playback (resets every chunk → infinite loop). Use `lastObservedVideoTime` jump detection (>2s) instead. Reason: playback-rate-agnostic = only safe form. last-cited: 2026-05-12
- [2026-05-12] (cross-frame) K-LMS / Vimeo / Canvas Studio embed in cross-origin iframes. Modal mounts in TOP, capture in IFRAME. Coordination via `window.postMessage` with `source: 'sh-frame'` (iframe→top) and `source: 'sh-parent'` (top→iframe). Top relays modal control msgs to iframes. Reason: silent no-op if source tag missing. last-cited: 2026-05-12
- [2026-05-12] (content-script) SPA navigations re-run content scripts in the same document. `__SH_CONTENT_BOOTED__` window sentinel guards listener registration. Without it, MutationObservers + chrome.runtime listeners stack on every nav. Reason: zombie listeners. last-cited: 2026-05-12
- [2026-05-12] (api-gw) API Gateway HTTP 30s timeout is HARD — cannot raise. Curator uses Lambda Function URL to bypass. Do NOT put long-running handlers behind API GW. Reason: physics. last-cited: 2026-05-12
- [2026-05-12] (db) DB Pool is `max:2`. Multi-statement transactions need `pool.connect()` + same-client query for BEGIN/COMMIT (see `lib/migrate.ts`). `pool.query` calls get DIFFERENT connections → BEGIN/COMMIT on different conns → transaction is a no-op. Reason: data loss. last-cited: 2026-05-12
- [2026-05-12] (zod) `withAuth` wrapper catches `ZodError` → 400. New handlers should call `Body.parse()` inside the inner function (it'll throw; wrapper handles). Don't try/catch around `.parse()` in the handler. Reason: divergence in error format. last-cited: 2026-05-12
- [2026-05-12] (api) Slide upload (`stream-slide`) body MUST include `url`. Same Zod schema as `stream-audio`. Easy to forget when adding new endpoints — they share the shape. Reason: was a 500 for a week. last-cited: 2026-05-12
- [2026-05-12] (api) API JSON responses MUST set `Content-Type: application/json`, especially 4xx/5xx. Frontend SW JSON-parses every response; without the header browser may treat as text/plain. Reason: inconsistent parse failures. last-cited: 2026-05-12
- [2026-05-12] (cors) Function URL CORS is a SEPARATE config from API GW CORS. Both must be locked post-publish. Both currently `*` pre-launch. Reason: forgetting one = data leak. last-cited: 2026-05-12
- [2026-05-12] (network) `stream-audio` chunk POST retries once after 1.5s on 5xx. Mitigates the ~22% API-GW-upstream-503 rate observed in real usage. Don't increase retry count without re-measuring — duplicate STT cost. Reason: budget + idempotency. last-cited: 2026-05-12

---

## How to add a pitfall

Don't edit this file by hand. Use `/learn "pitfall: <one-line>. Reason: <bug>."` and the command will format + insert.

# Manifest version sunset tracker

Tracks when each `manifest_version` Lambda handler can be removed.

**Rule** (from spec §2.2.1): manifest_v(N) handler removed in the release where `MIN_SUPPORTED_APP_VERSION` ≥ first app version that ships v(N+1) understanding.

## Active versions

| Version | First-shipped app version | Min-supported app version that retires this | Status | Notes |
|---|---|---|---|---|
| v1 | v0.2.0 (TBD — first ship after Plan A merges) | v0.4.0 (hypothetical — bump `MIN_SUPPORTED_APP_VERSION` first) | active | Initial Whisper kotoba-v2.0-q5_0 + Llama 3.2 3B Q4_K_M; default tier; ja + multi langs |

## Retired

(none yet)

## Procedure to bump (manifest_v1 → v2)

1. Decide breaking change (e.g. add required field `model.checksum_algorithm`)
2. Implement v2 handler in `backend/src/handlers/models-manifest.ts` alongside v1; route by `User-Agent` parse → version-compare
3. Ship app v0.3.0 with manifest_v2 understanding
4. After population on v0.3.0+ exceeds N% (e.g. 95% via telemetry), bump `MIN_SUPPORTED_APP_VERSION` to v0.3.0 → v1 clients see 410
5. Remove v1 handler code + this row → move to "Retired"

## Related

- Spec: `docs/superpowers/specs/2026-05-25-model-download-arch-design.md` §2.2.1 + §4.4 (version compat matrix) + §4.5 (schema migration)
- Plan: `docs/superpowers/plans/2026-05-25-model-download-A-backend.md` Task 15

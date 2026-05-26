# Phase 0 Spike Scorecard

Per `docs/superpowers/specs/2026-05-26-v2-structured-note-creation-design.md` §7.

| Spike | Acceptance | Result | Notes |
|---|---|---|---|
| 0.1 zod-to-gbnf | 10/10 round-trip + grammar parses + < 100ms first-call | **BLOCKED** (best 8/10 after 3 iterations; grammar parse OK; converter first-call fast) | HARD GATE — see `01-zod-to-gbnf/decision-0.1-fail.md`, escalation pending |
| 0.2 3B Lecture | Zod validates + ≥1 slot emergence + < 30s per chunk | PENDING | Depends on 0.1 |
| 0.3 Diarization JA | DER < 15% + warm-up < 30s + chunk latency < 1s | PENDING | Founder fixtures needed |
| 0.4 Chunking | All 4 edge cases pass + 90-min synth bounded | PENDING | Independent |

**On failure**: see spec §7 fallback ladder. Write `decision-<spike-id>.md` next to results.

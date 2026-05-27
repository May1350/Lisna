# Phase 0 Spike Scorecard

Per `docs/superpowers/specs/2026-05-26-v2-structured-note-creation-design.md` §7.

| Spike | Acceptance | Result | Notes |
|---|---|---|---|
| 0.1 zod-to-gbnf | 5/5 round-trip within ≤ 3 attempts + grammar parses + < 100ms first-call | **PASS** (take-4 2026-05-27: 5/5 in 5.79 min; attempt-1 hit = 4, attempt-2 hit = 1, attempt-3 hit = 0; mean attempts = 1.20; 3B Llama-3.2 Q4_K_M) | Path 2 retry loop (per `01-zod-to-gbnf/decision-0.1-fail.md`). HARD GATE cleared. |
| 0.2 3B Lecture | Zod validates + ≥1 slot emergence + < 30s per chunk | PENDING | Depends on 0.1 |
| 0.3 Diarization JA | DER < 15% + warm-up < 30s + chunk latency < 1s | PENDING | Founder fixtures needed |
| 0.4 Chunking | All 4 edge cases pass + 90-min synth bounded | **PASS** (5 edge-case tests pass; 153-min synth → 5 chunks ∈ [4, 12], all ≤ 9600 tokens, 907/907 segments preserved) | Independent |

**On failure**: see spec §7 fallback ladder. Write `decision-<spike-id>.md` next to results.

# Phase 0 Spike Scorecard

Per `docs/superpowers/specs/2026-05-26-v2-structured-note-creation-design.md` §7.

| Spike | Acceptance | Result | Notes |
|---|---|---|---|
| 0.1 zod-to-gbnf | 5/5 round-trip within ≤ 3 attempts + grammar parses + < 100ms first-call | **PASS** (take-4 2026-05-27: 5/5 in 5.79 min; attempt-1 hit = 4, attempt-2 hit = 1, attempt-3 hit = 0; mean attempts = 1.20; 3B Llama-3.2 Q4_K_M) | Path 2 retry loop (per `01-zod-to-gbnf/decision-0.1-fail.md`). HARD GATE cleared. |
| 0.2 3B Lecture | Zod validates + ≥1 slot emergence + < 30s per chunk | **MIXED** (2026-05-27: 3/3 Zod-valid · 3/3 ≥1 slot (counts 4/2/4, all formula) · latency p50 = 90 s, p90 = 99 s — 3× over 30 s budget on M3/8GB · 11.3K transcript chars / 13.4K prompt chars / 8 K JA tokens, at top of §2.3 ~8K chunk budget) | **Path E (2026-05-27):** cost split MIXED (PE 48% / EV 52%, neither ≥65%). Path B alone insufficient. Recommended Path F. **Path F (2026-05-27):** 1B Q4_K_M re-spike. Latency PASS (runs 0/1 mean 17.8 s, 3.23× faster than 3B). **Quality FAIL: slot emergence 0/3** (target ≥ 1/3). Content = placeholder filler / heading-duplicate summaries / NO formula extras. Run 2 runaway (4095 gen tokens + invalid JSON) reproduces Spike 0.1 failure modes even at temp 0.4 + grammar. **Verdict: 1B NOT viable as ≤ 12 GB default at current prompt design.** Plan 6 prompt engineering becomes load-bearing OR 3B stays default for lecture path. Path G (`.max(N)` bounds) elevated to tail-risk mitigation for **3B production**, not just 1B stack-on. Memos: `decision-0.2-latency.md`, `decision-0.2-path-e.md`, `decision-0.2-path-f.md`. |
| 0.3 Diarization JA | DER < 15% + warm-up < 30s + chunk latency < 1s | PENDING | Founder fixtures needed |
| 0.4 Chunking | All 4 edge cases pass + 90-min synth bounded | **PASS** (5 edge-case tests pass; 153-min synth → 5 chunks ∈ [4, 12], all ≤ 9600 tokens, 907/907 segments preserved) | Independent |

**On failure**: see spec §7 fallback ladder. Write `decision-<spike-id>.md` next to results.

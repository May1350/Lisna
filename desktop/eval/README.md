# Lisna v2 Eval Harness

Per `docs/superpowers/plans/2026-05-27-v2-plan-7-eval-harness.md`.

## Quickstart

```bash
# Plumbing smoke (no LLM, no sidecar, stub runner) — under 5 seconds
pnpm --filter @lisna/desktop eval:notes --family lecture --runner stub --no-llm-judge

# Real LLM judge against stub notes (requires GROQ_API_KEY)
pnpm --filter @lisna/desktop eval:notes --family lecture --runner stub

# Score the v0 Spike 0.2 baseline (uses already-produced spike JSONs)
GROQ_API_KEY=... pnpm --filter @lisna/desktop eval:spike-0.2

# Regression check against a saved baseline
pnpm --filter @lisna/desktop eval:notes --family lecture --runner stub --against v0-spike-0.2-lecture
```

## CLI flags (`eval:notes`)

| Flag | Default | Notes |
|---|---|---|
| `--family <name>` | `lecture` | One of `lecture`/`meeting`/`interview`/`brainstorm` |
| `--fixture <substr>` | (all) | Filter fixture IDs by substring within the family |
| `--runner <id>` | `stub` | `stub` / `offline-3b` (Plan 2) / `offline-1b` (Plan 2) |
| `--baseline <name>` | (none) | Save current run as `eval/baselines/<name>.json` |
| `--against <name>` | (none) | Load `eval/baselines/<name>.json` + print diff |
| `--judge <model-id>` | `llama-3.3-70b-versatile` | Use `claude-opus-4-x` etc. for cross-vendor |
| `--no-llm-judge` | `false` | Skip LLM judge — ContractTest + metrics only (offline) |
| `--dry-run` | `false` | Echo what would run + exit |

Exit codes: `0` = pass, `2` = regression detected (when `--against` is set).

## Fixture layout

```
desktop/eval/fixtures/<family>/<scenarioSlug>/
├── meta.json           — FixtureMeta (Zod, see fixtures/_schema.ts)
├── transcript.json     — FixtureTranscript (Zod)
└── ground-truth.json   — FixtureGroundTruth (Zod), optional for Lecture
```

Adding a new fixture:
1. Create folder + 3 files (validate via `FixtureMetaSchema.parse`).
2. Add fixtureId to the relevant `FamilyDefinition.evalBaselines: string[]` in `shared/families/<family>/eval-baselines.ts` (Plan 2 wires this).
3. `_validator.ts` enforces presence at boot — `pnpm --filter @lisna/desktop test` catches missing fixtures.

## Judges

- **ContractTest** — `desktop/eval/contract/contract-test.ts` + per-family rules. Deterministic, cheap, runs in CI. Severity `error` blocks; `warning` surfaces. Add a rule = append to `contract/families/<family>.ts`. **Catches mode collapse** that LLM-judges miss.
- **LLM-judge** — `desktop/eval/judges/llm-judge.ts`. 6 common axes (coverage / accuracy / hierarchy / conciseness / importance / provenance) + per-family axes (Lecture: sectionCoherence + contentFidelity; Meeting: decisionCapture + actionItemClarity + participantAttribution; etc.). Default Groq Llama-3.3-70b, optional Anthropic via `--judge claude-*`.
- **Content-fidelity judge** — `desktop/eval/judges/content-fidelity-judge.ts`. Standalone anti-parroting check. Run automatically for Lecture; can be invoked manually for other families.
- **Pairwise judge** — `desktop/eval/judges/pairwise-judge.ts` + `computeBradleyTerry()`. Use when absolute scores plateau but A/B preference still measurable.

## Baselines

- `desktop/eval/baselines/<name>.json` (gitignored — large, ephemeral).
- Each baseline pins `modelId`, `promptVariantId`, `judgeModelId` so diffs are honest.
- Suggested naming: `v0-spike-0.2-lecture`, `v1-prompt-iter-1`, `v1-qwen-2.5`, etc.

Regression criteria (`diff.ts`):
- Any fixture's `judge.overall` drops by ≥ 0.3 → regression.
- Any fixture flips ContractTest `PASS → FAIL` → regression.
- Any fixture's `contentFidelity.score` drops by > 1.0 → regression.

Warnings (non-fatal): `modelId`, `promptVariantId`, or `judgeModelId` mismatch across baselines being compared.

## Judge-swap matrix

```bash
pnpm --filter @lisna/desktop eval:judge-swap \
  --family lecture \
  --fixture procedural-physics-em \
  --judges llama-3.3-70b-versatile,claude-opus-4-x,llama-3.1-8b-instant
```
Prints per-fixture cross-judge spread. Spread > 1.5 = high calibration drift; investigate before locking a new baseline.

## Hardware safety

- All CLI subcommands at this layer are LLM-as-judge over network — no local-sidecar load. Safe to run anywhere.
- The `offline-3b` / `offline-1b` runners (added in Plan 2) WILL invoke the local Llama sidecar. Those obey the `(spike-llm)` rule: foreground only, `afterAll` cleanup in tests, `ps` check + `kill -9` survivors. **Do not** run them as `run_in_background: true`.

## Carry-forward map (Phase 0 VERDICT)

| VERDICT item | Lives in |
|---|---|
| LLM-as-judge content-fidelity | `judges/content-fidelity-judge.ts` (standalone) + `judges/families/lecture-judge.ts` (axis) |
| Retry-rate histogram | `metrics/retry-histogram.ts` |
| DER skeleton | `metrics/der.ts` (Plan 4 ships pyannote-grade impl) |
| slotTypes vs slotsEmerged | `metrics/slot-distribution.ts` |
| Anti-parroting JS heuristic (preceding LLM layer) | `contract/anti-parroting.ts` |
| Spike 0.2 v0 baseline | `desktop/scripts/score-spike-0.2.ts` |

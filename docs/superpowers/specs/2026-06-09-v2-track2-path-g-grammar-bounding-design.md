# Design — Path G grammar-level array bounding (route c)

**Date:** 2026-06-09
**Status:** STUB. **NOT ready for `writing-plans` — 3 founder questions in §7 block implementation.**
**Branch:** `spec/v2-track2-path-g-grammar-bounding`
**Owner:** controller session (single-controller model)
**Parents:**
- `docs/superpowers/specs/2026-06-08-v2-track2-quality-prioritization-design.md` (TRACK 2 prioritization; §5 Phase-1 routing)
- Memory `v2_track2_path_g_grammar_gap_2026-06-09.md` (the empirical finding)

---

## 1. Problem

The TRACK 2 prioritization spec (§5) defers the 1B-vs-3B latency/quality
trade-off behind Phase 0 measurements. The first 1B-vs-3B scorecard
(memory `v2_track2_first_scorecard_2026-06-08`) returned a real-model
finding for 1B: `CHUNK_FAILED:0` unterminated JSON across all 3 retries,
414 s wall, no baseline produced. The failure family is
`pitfalls.md (llm-grammar)` — model runs past EOS until `maxGenTokens`
truncates the JSON mid-string.

The fix surface named in the parent spec is **Path G** ("bounded
`n_predict` + `.max(N)`"). The discovery (2026-06-09, see memory) is
that Path G is only **half wired**:

- ✓ Lecture schema has `.max(N)` on every array
  (`desktop/src/shared/families/lecture/schema.ts:16-45`).
- ✗ `desktop/src/shared/note-schema/zod-to-gbnf.ts:133-138` emits every
  ZodArray as the unbounded form below — `.max()` is never read.
- ✗ `desktop/src/shared/models/profiles.ts:55-77` has **identical**
  `maxGenTokens` for 1B and 3B (lecture/meeting 3000, interview/brainstorm
  3500). 1B's narrower effective context has no per-model headroom.

So today, Zod `.max(N)` is **validation-only post-decode**. The LLM is
unconstrained at decode time; only `maxGenTokens` stops it. For the 1B
this means "truncate mid-string" instead of "emit `]` after N items."

A 1B re-eval **cannot move** without this gap closed. The parent spec's
Phase-1 routing assumed Path G was already a decode-time bound; it isn't.

---

## 2. The grammar gap, in code

Current emission (`zod-to-gbnf.ts:133-138`):

```typescript
if (def.typeName === 'ZodArray') {
  const elemRuleName = sanitize(`${name}_elem`);
  emit(def.type!, elemRuleName, rules, visited);
  rules.push(`${name} ::= "[" ws (${elemRuleName} (ws "," ws ${elemRuleName})*)? ws "]"`);
  return;
}
```

Produces e.g. `LectureNote_sections ::= "[" ws (elem (ws "," ws elem)*)? ws "]"`.
0..∞ elements allowed.

Lecture schema bounds (snippet from
`desktop/src/shared/families/lecture/schema.ts`):

```
heading: z.string().min(1).max(MAX_HEADING_CHARS),
})).max(MAX_KEY_TERMS_PER_SECTION),
})).max(MAX_EXAMPLES_PER_SECTION),
})).max(MAX_POINTS_PER_SECTION),
extras: z.array(LectureSlotInstanceSchema).max(MAX_EXTRAS_PER_SECTION).optional(),
sections: z.array(LectureSectionSchema).max(MAX_SECTIONS),
```

The bounds exist on the Zod side. The converter just doesn't propagate
them. (Meeting / interview / brainstorm schemas have analogous bounds —
unverified by file read in this stub; the implementation task does that
sweep.)

The converter already encodes one similar single-bit refinement —
`hasMin1` for ZodString (line 126) — so the precedent for reading
Zod `_def.checks` exists. Extending to `_def.maxLength` (the Zod v3
ZodArray field for `.max()`) is mechanical.

---

## 3. Two implementation patterns

GBNF does **not** support `{N,M}` quantifiers (verified against
`desktop/sidecar/deps/llama.cpp/grammars/` precedent grammars +
`llama-grammar.cpp` parser source — only `*`, `+`, `?` and explicit
alternation are accepted). So a bounded array must be expressed by
unrolling.

### Pattern A — cascading rules (recommended in this stub)

For an array with `.max(N)`:

```
name      ::= "[" ws (name-1)? ws "]"
name-1    ::= elem (ws "," ws name-2)?
name-2    ::= elem (ws "," ws name-3)?
...
name-N    ::= elem
```

Rule count: `N+1`. Each level is locally readable. Empty array `[]` is
naturally permitted by the leading `?` on `name-1`. Each elem position
has exactly one rule to match against, so the parser has zero
backtracking ambiguity.

### Pattern B — alternation enumeration (alternative)

```
name ::= "[" ws "]"
      | "[" ws elem ws "]"
      | "[" ws elem ws "," ws elem ws "]"
      | ...                                    # up to N elements
```

Rule count: `1` (with `N+1` alternations). Each form is right there in
the text, easier to debug visually. But the rule grows quadratically in
visible bytes (each alternation embeds all preceding `elem`s + commas).
For `MAX_SECTIONS = 20` and a heavy `elem` rule, this gets long fast.

### Why Pattern A is recommended

- Scales linearly in rule count AND total grammar bytes.
- The converter already maintains a `visited: Set<string>` to dedupe
  emitted rule names; cascading naturally hits that path (each
  `name-i` defined once).
- Empty-array case is one quiet `?`, not its own alternation.
- llama.cpp's GBNF parser is "happy with named rules" (its prelude
  carries unused rules with no warning — see line 169-172 comment in
  the converter).

(Founder may still prefer B for visual debugging. See §7 Q3.)

---

## 4. 1B `maxGenTokens` proposal

Today (`profiles.ts:55-77`): 1B inherits 3B's 3000/3500 values verbatim.

Spike-0.2 history note: the prior reduction from `4096 → 3000` is
documented in `decision-0.2-path-f.md` as a tail-risk mitigation; THAT
calibration was done with the 3B in mind. The 1B was tested at the same
3000 budget and that's where the truncation failure showed up.

Two angles to consider (no decision in this stub):

| Angle | Effect | Risk |
|---|---|---|
| Lower 1B further (e.g. 2000) | Less rope to truncate mid-string | If grammar isn't also bounded, model just truncates earlier — doesn't fix root cause |
| Pair lower 1B + bounded grammar | Bounded grammar forces `]` after N; smaller budget enforces brevity inside elems | Best combination — but the size of "further reduction" needs the bounded-grammar measurement first |
| Leave 1B at 3000, only bound grammar | Bounded grammar should suffice — if model emits valid bounded JSON within 3000 tokens, we're good | Cleanest experiment; isolates the grammar-bound's effect |

Recommendation in this stub: **bound the grammar FIRST**, leave
`maxGenTokens` alone, re-eval. If 1B still truncates, lower
`maxGenTokens` in a second iteration. (Cleaner empirical loop than
two-variable change.)

---

## 5. Reverse-survey: does any current `.max(N)` already conflict with 3B output?

**Open empirical question.** If 3B currently emits e.g. 5-section notes
on real lectures and `MAX_SECTIONS = 4`, then bounding the grammar to
`.max(4)` would actively reject 3B output that the eval previously
accepted — a regression on the model we ARE shipping.

Cheap audit (1 eval run, ~5 min):

1. Add a logging hook to `runPostDecodePipeline` (or callWithGrammar
   pre-Zod) that records each array's emitted length.
2. Run the existing smoke-ja-mini fixture against 3B.
3. Compare emitted lengths to schema `.max(N)` values.
4. If any emitted length ≥ schema max, that's a "bound is already too
   tight" warning — either raise the bound, or accept that 3B's emission
   is over-spec and we're tightening it intentionally.

This audit costs ~5 min and answers a real risk. **Implementation task
MUST do this audit before changing any `.max()` values.**

---

## 6. Risks

1. **Existing 3B tests assume unbounded arrays.** Some fixtures may
   produce arrays at or above schema max; making the grammar bound
   tightens them at decode time. Mitigation: §5 audit before code, then
   per-failure decision (raise bound vs accept tightening).
2. **Grammar text grows from O(1) to O(N) rules per array.** Total
   grammar bytes for lecture jumps from ~1 KB to ~maybe 5-8 KB
   (estimate). Sidecar parses grammar once per generate() call — likely
   negligible cost, but worth measuring before-vs-after. Bounded by
   one `time` measurement.
3. **The 1B's failure might NOT be grammar-bound.** Even with bounded
   arrays, 1B may emit nonsensical string content within bounds (mode-
   collapse on short slots, the [[v2_track2_escape_literal_phase1]]
   pattern at a different level). Path G fixes the runaway-JSON family
   but not the model-quality family. The eval will tell us which.
4. **Schema-version coupling.** Changing schema `.max()` values is a
   ContentVersion bump (potentially breaking forward-incompat checks
   in `load-note.ts`). The implementation MUST decide whether to
   bump or keep `schemaVersion=1`.
5. **The converter is shared across 4 families.** A converter bug
   regresses all 4 families' grammars simultaneously. TDD coverage
   must hit each family's grammar generation, not just lecture's.

---

## 7. Open questions for founder (verbatim from memory)

These three questions are reproduced verbatim from
`v2_track2_path_g_grammar_gap_2026-06-09.md` §"Open questions for the
founder." This spec stub deliberately presents trade-offs above; the
**implementation does not start until founder picks an answer to each**:

> 1. Do you want to land this BEFORE retesting #89's latency
>    instrumentation (so retest exercises Path G too)? Or AFTER (so the
>    latency retest is a clean comparison against PR #88 sanitize)?
>
> 2. Are smaller `.max(N)` values acceptable on existing schemas, or
>    should the current values be the floor? (e.g. if 3B currently emits
>    4-section notes but lecture schema says `.max(3)`, that's the test
>    we'd be tightening.)
>
> 3. Cascading rule generation OK, or prefer alt-enumeration despite
>    the verbosity?

---

## 8. Test plan (when greenlit)

- TDD entry: extend `desktop/src/shared/note-schema/__tests__/zod-to-gbnf.test.ts` with:
  - bounded array of `max(3)`: grammar accepts 0/1/2/3 elements, rejects 4.
  - unbounded array (no `.max()`): grammar identical to current output.
  - empty array `[]` valid in bounded form.
  - all 4 families' grammars compile through llama.cpp's GBNF validator
    (existing test harness uses `test-gbnf-validator`).
- Behavior preservation: run all family orchestrator tests; they must
  stay green (their fixtures produce within-spec output, by construction).
- 1B re-eval: spawn the existing `eval:notes --model 1b --fixture
  smoke-ja-mini` after the change; verdict is "fewer/no truncation
  failures" — not "high quality" (that's a separate dial).

---

## 9. Branch + commit shape (when greenlit)

`feat/v2-track2-path-g-grammar` off `main` (after #88/#89/#90 merge).
Two commits:

1. `feat(track2): emit bounded GBNF arrays from Zod .max(N)` — converter
   change + tests + the §5 reverse-survey logging hook landed as part
   of the eval harness.
2. (Conditional, depends on §7 Q-?) `feat(track2): lower 1B maxGenTokens
   for tighter decode budget` — only if the 1B re-eval shows it's needed
   after the grammar bound is in.

Each commit verifies independently (`pnpm --filter @lisna/desktop verify`).

---

## 10. References

- Memory `v2_track2_path_g_grammar_gap_2026-06-09.md` (this stub's
  empirical findings)
- Memory `v2_track2_first_scorecard_2026-06-08.md` (1B prior failure mode)
- Memory `v2_track2_escape_literal_phase1_2026-06-09.md` (route a, PR #88)
- Memory `v2_track2_latency_instrumentation_2026-06-09.md` (route b, PR #89)
- Memory `v2_track2_extract_runchunk_2026-06-09.md` (PR #90)
- `docs/superpowers/specs/2026-06-08-v2-track2-quality-prioritization-design.md` (parent)
- `docs/superpowers/specs/2026-05-28-cpp-grammar-constrained-generation-design.md` (grammar engine precedent)
- `.claude/rules/pitfalls.md (llm-grammar)` (the 1B failure-mode family)

---

## 11. Next step

Founder answers §7 Q1/Q2/Q3 inline (PR comment or commit-on-this-branch).
Once answered, controller session uses `writing-plans` skill to convert
this spec into a task plan, then `subagent-driven-development` for
execution.

Until then: this stub stays as a placeholder. No code change happens.

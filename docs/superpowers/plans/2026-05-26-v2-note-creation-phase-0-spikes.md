# Lisna v2 Note Creation — Phase 0 Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the four load-bearing architectural assumptions of the v2 structured note creation design via empirical spikes BEFORE committing to broader implementation. Output: pass/fail verdict per spike + concrete data to either green-light Plan 2 (Foundation) or trigger spec revision.

**Architecture:** Spikes are intentionally minimal — each answers ONE empirical question against the spec's assumptions and either passes (continue with main plans) or fails (escalate fallback path documented in spec §7). No production code, no broader infra, no families. Spike artifacts live under `desktop/spikes/phase-0/` (gitignored after acceptance verdict captured).

**Tech Stack:** TypeScript (Vitest), Zod, llama.cpp (existing sidecar), sherpa-onnx (new), Llama 3.2 3B Q4_K_M (existing), kotoba-whisper-v2 (existing).

**Sub-plan position:** Plan 1 of 7 (see spec status header for the full sequence).

**Spec reference:** `docs/superpowers/specs/2026-05-26-v2-structured-note-creation-design.md` §7 "Phase 0 spike" + commit `af3af63`.

---

## Spike sequencing

```
Spike 0.1 (HARD GATE) ── if PASS ──→  Spike 0.2 ─┐
                                                  │
                                                  ├──→ All 4 PASS → Phase 0 complete → Plan 2 starts
                                                  │
Spike 0.3 (independent, FOUNDER fixtures needed)─┤
Spike 0.4 (independent, pure algorithm)─────────┘

Any FAIL → document in §7 fallback ladder + write decision memo + return to spec author
```

**Hard gate**: Spike 0.1. If `zod-to-gbnf` can't round-trip the Zod constructs the schemas need, the entire grammar-constrained-JSON architecture is invalidated. Don't proceed to 0.2 until 0.1 passes.

---

## File structure

```
desktop/
└── spikes/
    └── phase-0/
        ├── README.md                       # acceptance scorecard, owner-edited
        ├── 01-zod-to-gbnf/
        │   ├── zod-to-gbnf.ts              # converter (~150 LOC target)
        │   ├── zod-to-gbnf.test.ts         # construct-by-construct tests
        │   ├── round-trip.test.ts          # 10-sample LLM round-trip
        │   └── fixtures/
        │       └── lecture-mini-schema.ts  # minimal Lecture Zod (extras as DiscriminatedUnion)
        ├── 02-3b-lecture-grammar/
        │   ├── run-spike.ts                # generate via existing sidecar
        │   ├── lecture-prompt.ts           # minimal system + user template
        │   └── results/                    # JSON output samples + metrics
        ├── 03-diarization-ja/
        │   ├── run-spike.ts                # sherpa-onnx invocation
        │   ├── fixtures/
        │   │   ├── ja-interview-2spk-30min.wav   # FOUNDER provides
        │   │   ├── ja-meeting-4spk-30min.wav     # FOUNDER provides
        │   │   └── ja-brainstorm-6spk-20min.wav  # FOUNDER provides
        │   └── results/                     # DER, warm-up, latency, RAM
        └── 04-chunking/
            ├── chunking.ts                  # chunkTranscript() per spec §5.2a
            ├── chunking.test.ts             # 4 edge cases + 90-min synth
            └── fixtures/
                └── synth-90min.json         # concatenated v1 transcript
```

`desktop/spikes/` added to `.gitignore` for produced JSON (keep .ts + .md + .test.ts).

---

## Pre-flight (do once before Spike 0.1)

### Task 0: Set up spike workspace

**Files:**
- Create: `desktop/spikes/phase-0/README.md`
- Modify: `desktop/.gitignore` (add `spikes/phase-0/results/`, `spikes/phase-0/03-diarization-ja/fixtures/*.wav`)

- [ ] **Step 1: Create the spike directory skeleton**

```bash
mkdir -p desktop/spikes/phase-0/{01-zod-to-gbnf/fixtures,02-3b-lecture-grammar/results,03-diarization-ja/fixtures,03-diarization-ja/results,04-chunking/fixtures}
```

- [ ] **Step 2: Write README scorecard**

```markdown
# Phase 0 Spike Scorecard

Per `docs/superpowers/specs/2026-05-26-v2-structured-note-creation-design.md` §7.

| Spike | Acceptance | Result | Notes |
|---|---|---|---|
| 0.1 zod-to-gbnf | N/N round-trip within ≤ 3 attempts + grammar parses + < 100ms first-call (N=5 per Amendment 1, hardware-reduced from original 10/10) | **PASS** (take-4 2026-05-27: 5/5 in 5.79 min wall; attempt-1=4, attempt-2=1; mean 1.20 attempts; 3B Q4_K_M) | HARD GATE cleared via Path 2 retry loop. See `01-zod-to-gbnf/decision-0.1-fail.md`. |
| 0.2 3B Lecture | Zod validates + ≥1 slot emergence + < 30s per chunk | PENDING | Depends on 0.1 |
| 0.3 Diarization JA | DER < 15% + warm-up < 30s + chunk latency < 1s | PENDING | Founder fixtures needed |
| 0.4 Chunking | All 4 edge cases pass + 90-min synth bounded | **PASS** (5 edge-case tests pass; 153-min synth → 5 chunks ∈ [4, 12], all ≤ 9600 tokens, 907/907 segments preserved) | Independent |

**On failure**: see spec §7 fallback ladder. Write `decision-<spike-id>.md` next to results.
```

- [ ] **Step 3: Update .gitignore**

Append to `desktop/.gitignore`:
```
# Phase 0 spikes — ephemeral outputs
spikes/phase-0/results/
spikes/phase-0/**/results/
spikes/phase-0/03-diarization-ja/fixtures/*.wav
```

- [ ] **Step 4: Commit pre-flight**

```bash
git add desktop/spikes/phase-0/README.md desktop/.gitignore
git commit -m "chore(spikes): scaffold Phase 0 spike workspace"
```

---

## Spike 0.1: `zod-to-gbnf` converter — HARD GATE

> **Amendment 1 (2026-05-27, founder decision)** — Acceptance reduced from
> `10/10 samples` to `N/N samples within ≤ 3 attempts each`, where N is
> the largest sample count that fits the development hardware's safe
> sustained-load envelope. Currently **N=5** on the M3-8GB dev machine
> (per `.claude/rules/pitfalls.md (spike-llm)` kernel-panic post-mortem).
> Take-4 PASSed at 5/5 within ≤ 2 attempts (commit `46ed08a`). Take-5
> (1B Q4_K_M co-validation) PASSed 5/5 at the same retry profile.
> Full 10/10 validation on i=5..9 (esp. iter-3 failure-mode-B sample
> "Maxwell" at i=8) is **deferred** — production risk acknowledged and
> covered by the mandatory retry budget per Plan 2 wrapper mandate (see
> `01-zod-to-gbnf/decision-0.1-fail.md` Resolution + Capability-floor
> sections). All `10/10` text in this Spike 0.1 section below is the
> historic-N context; the operational gate is **N/N at the current N**.
> Recovery path to full 10/10 also documented in the decision memo
> (Path 2.A foreground isolated rig / Path 2.B relocate ≥16GB machine
> / Path 2.C combine with Path 1 bounded-array grammar).

**Goal:** Produce a converter that takes Zod schemas (covering ALL constructs the 4 family schemas use) and emits GBNF that (a) `llama_grammar_init` accepts, (b) round-trips: schema → grammar → LLM output → parse via original schema, N/N samples (see Amendment 1).

**Acceptance** (from spec §7.4, as amended):
- `llama_grammar_init` succeeds on every test grammar
- N LLM samples, 100% Zod-parse pass within ≤ 3 attempts each (N=5 per Amendment 1)
- Converter < 100ms first-call, < 10ms cached, per family

**Zod constructs to support** (derived from spec §3 schemas):
- `z.object({...})` — schema bodies
- `z.string()`, `z.number()`, `z.boolean()` — scalars
- `z.array(T)` — collections
- `z.optional(T)` — `?:` fields
- `z.enum([...])` — `family`, `outcome`, `atmosphere`, `language`, etc.
- `z.literal(...)` — narrowed family discriminator
- `z.discriminatedUnion('type', [...])` — Lecture `extras: SlotInstance[]`
- `z.record(z.string(), z.unknown())` — `TranscriptSegment.meta?`
- `.meta({ postDecodeOnly: true })` — strip from grammar (custom)

### Task 1: Set up the converter file and a smoke test

**Files:**
- Create: `desktop/spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.ts`
- Create: `desktop/spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.test.ts`

- [ ] **Step 1: Write the failing scalar test**

```typescript
// desktop/spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToGbnf } from './zod-to-gbnf';

describe('zodToGbnf', () => {
  it('emits GBNF for a simple object with string + number', () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const gbnf = zodToGbnf(schema, 'Person');
    expect(gbnf).toContain('root ::= Person');
    expect(gbnf).toContain('Person ::=');
    expect(gbnf).toContain('"name"');
    expect(gbnf).toContain('"age"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter desktop test spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.test.ts`
Expected: FAIL with "Cannot find module './zod-to-gbnf'"

- [ ] **Step 3: Implement minimal scalar converter**

```typescript
// desktop/spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.ts
import { z } from 'zod';

export function zodToGbnf(schema: z.ZodType, rootName: string): string {
  const rules: string[] = [`root ::= ${rootName}`];
  const visited = new Set<string>();
  emit(schema, rootName, rules, visited);
  return rules.join('\n') + '\n' + scalarRules();
}

function emit(schema: z.ZodType, name: string, rules: string[], visited: Set<string>): void {
  if (visited.has(name)) return;
  visited.add(name);
  const def = (schema as any)._def;

  if (def.typeName === 'ZodObject') {
    const fields = Object.entries(def.shape()) as [string, z.ZodType][];
    const fieldRules = fields.map(([k, v]) => {
      const fieldRuleName = `${name}_${k}`;
      emit(v, fieldRuleName, rules, visited);
      return `"\\"${k}\\"" ":" ws ${fieldRuleName}`;
    });
    rules.push(`${name} ::= "{" ws ${fieldRules.join(' "," ws ')} ws "}"`);
    return;
  }

  // scalars
  if (def.typeName === 'ZodString') { rules.push(`${name} ::= json_string`); return; }
  if (def.typeName === 'ZodNumber') { rules.push(`${name} ::= json_number`); return; }
  if (def.typeName === 'ZodBoolean') { rules.push(`${name} ::= "true" | "false"`); return; }

  throw new Error(`Unsupported Zod type: ${def.typeName} for rule ${name}`);
}

function scalarRules(): string {
  return [
    'ws ::= [ \\t\\n]*',
    'json_string ::= "\\"" char* "\\""',
    'char ::= [^"\\\\] | "\\\\" ["\\\\/bfnrt]',
    'json_number ::= "-"? ("0" | [1-9] [0-9]*) ("." [0-9]+)? ([eE] [-+]? [0-9]+)?',
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter desktop test spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/spikes/phase-0/01-zod-to-gbnf/
git commit -m "spike(0.1): zod-to-gbnf scalar object converter"
```

### Task 2: Array support

**Files:**
- Modify: `desktop/spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.ts`
- Modify: `desktop/spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.test.ts`

- [ ] **Step 1: Write the failing array test**

```typescript
// Append to zod-to-gbnf.test.ts
it('emits GBNF for array of objects', () => {
  const Item = z.object({ text: z.string() });
  const schema = z.object({ items: z.array(Item) });
  const gbnf = zodToGbnf(schema, 'Container');
  expect(gbnf).toContain('Container_items ::= "[" ws (');
  expect(gbnf).toContain(') "]"');
});
```

- [ ] **Step 2: Run test to confirm fail**

Expected: FAIL with "Unsupported Zod type: ZodArray"

- [ ] **Step 3: Add ZodArray case**

```typescript
// In emit(), before the throw:
if (def.typeName === 'ZodArray') {
  const elemRuleName = `${name}_elem`;
  emit(def.type, elemRuleName, rules, visited);
  rules.push(`${name} ::= "[" ws (${elemRuleName} (ws "," ws ${elemRuleName})*)? ws "]"`);
  return;
}
```

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "spike(0.1): zod-to-gbnf array support"
```

### Task 3: Optional support

- [ ] **Step 1: Write failing optional test**

```typescript
it('omits optional field from grammar when absent', () => {
  const schema = z.object({ required: z.string(), maybe: z.string().optional() });
  const gbnf = zodToGbnf(schema, 'X');
  expect(gbnf).toMatch(/X ::= "{" ws .* ws "}"/);
  // Optional should produce a branch with the field absent
  expect(gbnf).toContain('X_optional_maybe');
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Add ZodOptional case + object emission needs to track which fields are optional**

```typescript
// Replace the ZodObject case in emit() with optional-aware version:
if (def.typeName === 'ZodObject') {
  const fields = Object.entries(def.shape()) as [string, z.ZodType][];
  const requiredParts: string[] = [];
  const optionalParts: string[] = [];
  for (const [k, v] of fields) {
    const fieldRuleName = `${name}_${k}`;
    const isOptional = (v as any)._def.typeName === 'ZodOptional';
    const inner = isOptional ? (v as any)._def.innerType : v;
    emit(inner, fieldRuleName, rules, visited);
    const entry = `"\\"${k}\\"" ":" ws ${fieldRuleName}`;
    if (isOptional) optionalParts.push(entry);
    else requiredParts.push(entry);
  }
  // Emit as: required_first (, optional)* — simple form (order not enforced)
  // For each optional, branch present/absent via union:
  const optionalUnion = optionalParts.map(p => `(${p})?`).join(' ');
  rules.push(`${name} ::= "{" ws ${requiredParts.join(' "," ws ')} ${optionalParts.map(p => `("," ws ${p})?`).join(' ')} ws "}"`);
  return;
}
// Remove the now-unused ZodOptional case (handled above), keep a trivial guard:
if (def.typeName === 'ZodOptional') {
  // Should only be reached via plain emit() outside ZodObject — emit the inner type
  emit(def.innerType, name, rules, visited);
  return;
}
```

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "spike(0.1): zod-to-gbnf optional fields"
```

### Task 4: Enum + literal support

- [ ] **Step 1: Write failing enum test**

```typescript
it('emits GBNF for enum values', () => {
  const schema = z.object({ family: z.enum(['lecture', 'meeting']) });
  const gbnf = zodToGbnf(schema, 'X');
  expect(gbnf).toContain(`"\\"lecture\\"" | "\\"meeting\\""`);
});

it('emits GBNF for literal value', () => {
  const schema = z.object({ kind: z.literal('lecture') });
  const gbnf = zodToGbnf(schema, 'X');
  expect(gbnf).toContain(`"\\"lecture\\""`);
});
```

- [ ] **Step 2: Run tests, expect FAIL**

- [ ] **Step 3: Add ZodEnum + ZodLiteral cases**

```typescript
// In emit(), add:
if (def.typeName === 'ZodEnum') {
  const opts = def.values.map((v: string) => `"\\"${v}\\""`).join(' | ');
  rules.push(`${name} ::= ${opts}`);
  return;
}
if (def.typeName === 'ZodLiteral') {
  rules.push(`${name} ::= "\\"${def.value}\\""`);
  return;
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "spike(0.1): zod-to-gbnf enum + literal"
```

### Task 5: DiscriminatedUnion support (for Lecture extras)

- [ ] **Step 1: Write failing discriminated-union test**

```typescript
it('emits GBNF for discriminated union (Lecture extras pattern)', () => {
  const Step = z.object({ type: z.literal('procedure_steps'), items: z.array(z.string()) });
  const Formula = z.object({ type: z.literal('formula'), items: z.array(z.string()) });
  const Extras = z.discriminatedUnion('type', [Step, Formula]);
  const schema = z.object({ extras: z.array(Extras).optional() });
  const gbnf = zodToGbnf(schema, 'Lecture');
  expect(gbnf).toContain('Lecture_extras_elem ::=');
  // Both variants should appear as alternatives
  expect(gbnf).toMatch(/Lecture_extras_elem_.*procedure_steps/);
  expect(gbnf).toMatch(/Lecture_extras_elem_.*formula/);
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Add ZodDiscriminatedUnion case**

```typescript
if (def.typeName === 'ZodDiscriminatedUnion') {
  const variants: string[] = [];
  for (let i = 0; i < def.options.length; i++) {
    const variantName = `${name}_v${i}`;
    emit(def.options[i], variantName, rules, visited);
    variants.push(variantName);
  }
  rules.push(`${name} ::= ${variants.join(' | ')}`);
  return;
}
```

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "spike(0.1): zod-to-gbnf discriminated union"
```

### Task 6: postDecodeOnly meta marker stripping

- [ ] **Step 1: Write failing meta-strip test**

```typescript
it('strips fields marked .meta({ postDecodeOnly: true })', () => {
  const schema = z.object({
    text: z.string(),
    from: z.enum(['transcript', 'inferred']).meta({ postDecodeOnly: true }),
  });
  const gbnf = zodToGbnf(schema, 'Item');
  expect(gbnf).not.toContain(`"\\"from\\""`);  // field absent
  expect(gbnf).toContain(`"\\"text\\""`);
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Update object emission to skip postDecodeOnly fields**

```typescript
// In the ZodObject case, before iterating fields:
const filtered = fields.filter(([_, v]) => {
  const meta = (v as any)._def.meta?.();
  // Also check unwrapped for ZodOptional
  const innerMeta = (v as any)._def.innerType?._def?.meta?.();
  return !(meta?.postDecodeOnly || innerMeta?.postDecodeOnly);
});
// Use `filtered` instead of `fields` for the rest
```

Note: Zod v3's meta API is `.describe(string)` for descriptions; we use `.meta({...})` per Zod v4 / future API. **If using Zod v3** (project pinned per `lisna_jp_phase_a_complete_2026-05-20.md`), use `.describe(JSON.stringify({ postDecodeOnly: true }))` and parse `description` here.

- [ ] **Step 4: Run test, expect PASS** (adjust for actual Zod API in repo)

- [ ] **Step 5: Commit**

```bash
git commit -am "spike(0.1): zod-to-gbnf postDecodeOnly meta strip"
```

### Task 7: Build the round-trip fixture (mini Lecture schema)

**Files:**
- Create: `desktop/spikes/phase-0/01-zod-to-gbnf/fixtures/lecture-mini-schema.ts`

- [ ] **Step 1: Write the mini Lecture schema covering all constructs**

```typescript
// desktop/spikes/phase-0/01-zod-to-gbnf/fixtures/lecture-mini-schema.ts
import { z } from 'zod';

const Provenance = z.enum(['transcript', 'inferred']);

const KeyTerm = z.object({
  term: z.string(),
  definition: z.string(),
  ts: z.number(),
  // post-decode field — should NOT appear in grammar:
  from: Provenance, // remove .meta() if Zod v3, or use describe-encoded marker
});

const Step = z.object({
  type: z.literal('procedure_steps'),
  items: z.array(z.object({ text: z.string(), order: z.number().optional() })),
});
const Formula = z.object({
  type: z.literal('formula'),
  items: z.array(z.object({ expression: z.string(), label: z.string().optional() })),
});
const Extras = z.discriminatedUnion('type', [Step, Formula]);

const Section = z.object({
  heading: z.string(),
  ts: z.number(),
  summary: z.string(),
  key_terms: z.array(KeyTerm),
  extras: z.array(Extras).optional(),
});

export const LectureMiniSchema = z.object({
  schemaVersion: z.number(),
  family: z.literal('lecture'),
  title: z.string(),
  tldr: z.string().optional(),
  sections: z.array(Section),
});

export type LectureMini = z.infer<typeof LectureMiniSchema>;
```

- [ ] **Step 2: Generate the grammar and write it to disk for llama.cpp parse test**

```typescript
// Add a script: desktop/spikes/phase-0/01-zod-to-gbnf/generate-grammar.ts
import { writeFileSync } from 'node:fs';
import { zodToGbnf } from './zod-to-gbnf';
import { LectureMiniSchema } from './fixtures/lecture-mini-schema';

const gbnf = zodToGbnf(LectureMiniSchema, 'LectureNote');
writeFileSync('desktop/spikes/phase-0/01-zod-to-gbnf/lecture-mini.gbnf', gbnf);
console.log('Wrote lecture-mini.gbnf:', gbnf.length, 'bytes');
```

- [ ] **Step 3: Run it**

Run: `pnpm --filter desktop tsx desktop/spikes/phase-0/01-zod-to-gbnf/generate-grammar.ts`
Expected: success + file written

- [ ] **Step 4: Verify llama.cpp accepts the grammar**

The existing sidecar binary supports `--grammar-file`. Use the sidecar test rig from `desktop/src/main/sidecar/__tests__/`:

```bash
# Inline check: invoke sidecar with the grammar + a trivial prompt to confirm parse
./desktop/resources/sidecar/lisna_sidecar \
  --grammar-file desktop/spikes/phase-0/01-zod-to-gbnf/lecture-mini.gbnf \
  --validate-grammar-only
```

If sidecar lacks `--validate-grammar-only`, fall back to running a 5-token generation against the grammar — any non-error response indicates `llama_grammar_init` succeeded.

Expected: no parse error from sidecar.

**On FAIL**: examine grammar, identify which rule llama.cpp rejects, fix converter, regenerate, re-test.

- [ ] **Step 5: Commit**

```bash
git add desktop/spikes/phase-0/01-zod-to-gbnf/
git commit -m "spike(0.1): lecture-mini round-trip fixture + grammar generation"
```

### Task 8: 10-sample round-trip test

**Files:**
- Create: `desktop/spikes/phase-0/01-zod-to-gbnf/round-trip.test.ts`

- [ ] **Step 1: Write the round-trip test**

```typescript
// desktop/spikes/phase-0/01-zod-to-gbnf/round-trip.test.ts
import { describe, it, expect } from 'vitest';
import { zodToGbnf } from './zod-to-gbnf';
import { LectureMiniSchema } from './fixtures/lecture-mini-schema';
import { writeFileSync } from 'node:fs';
import { runSidecarGenerate } from '../../../src/main/sidecar/__tests__/test-rig';  // hypothetical path

describe('zod-to-gbnf round trip on LectureMiniSchema', () => {
  it('10/10 LLM samples Zod-parse cleanly', async () => {
    const gbnf = zodToGbnf(LectureMiniSchema, 'LectureNote');
    const grammarPath = '/tmp/lecture-mini-rt.gbnf';
    writeFileSync(grammarPath, gbnf);

    const passes: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      const out = await runSidecarGenerate({
        prompt: 'Generate a lecture note JSON about photosynthesis with 2 sections, one with formula extras.',
        grammarPath,
        maxTokens: 1500,
        temperature: 0.4 + (i * 0.05),  // slight variation
      });
      try {
        const json = JSON.parse(out);
        // Strip post-decode-only fields BEFORE Zod parse, since grammar omits them
        // (alternatively: relax the test schema to make from optional)
        LectureMiniSchema.parse(json);
        passes.push(true);
      } catch (e) {
        passes.push(false);
        console.error(`Sample ${i} failed:`, e instanceof Error ? e.message : e);
      }
    }
    const passRate = passes.filter(Boolean).length;
    expect(passRate).toBe(10);  // 10/10 required
  }, 120_000);  // 2 min timeout — 10 generations × ~10s each
});
```

- [ ] **Step 2: If `runSidecarGenerate` test rig doesn't exist, create a minimal one**

```typescript
// desktop/src/main/sidecar/__tests__/test-rig.ts (create if missing)
import { spawn } from 'node:child_process';

export async function runSidecarGenerate(opts: {
  prompt: string;
  grammarPath: string;
  maxTokens: number;
  temperature: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '--model', process.env.SPIKE_LLM_MODEL_PATH ?? './models/llama-3.2-3b-q4_k_m.gguf',
      '--grammar-file', opts.grammarPath,
      '--n-predict', String(opts.maxTokens),
      '--temp', String(opts.temperature),
      '--prompt', opts.prompt,
    ];
    const proc = spawn('./desktop/resources/sidecar/lisna_sidecar', args);
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', code => code === 0 ? resolve(out) : reject(new Error(`sidecar exit ${code}`)));
  });
}
```

- [ ] **Step 3: Run the round-trip test**

Run: `SPIKE_LLM_MODEL_PATH=/path/to/llama-3.2-3b.gguf pnpm --filter desktop test desktop/spikes/phase-0/01-zod-to-gbnf/round-trip.test.ts`
Expected: 10/10 pass within ~100s

**On < 10/10**: identify which Zod construct or grammar rule the model trips on. Common causes:
- Whitespace rule too strict (model emits trailing newlines)
- Enum value escaping mismatch
- DiscriminatedUnion with no `oneOf`-style enforcement

Fix converter, regenerate grammar, re-run.

**Acceptance gate**: 10/10 required to mark Spike 0.1 PASS in the scorecard. If pass rate stays < 10/10 after 3 converter iterations, escalate to spec author with the specific construct identified.

- [ ] **Step 4: Update scorecard with PASS verdict**

Edit `desktop/spikes/phase-0/README.md`, set Spike 0.1 row to PASS with metrics:
```
| 0.1 zod-to-gbnf | 10/10 round-trip + grammar parses + < 100ms first-call | **PASS** (10/10, grammar parse OK, converter 47ms first-call) | HARD GATE — green-light Spike 0.2 |
```

- [ ] **Step 5: Commit**

```bash
git add desktop/spikes/phase-0/01-zod-to-gbnf/ desktop/spikes/phase-0/README.md desktop/src/main/sidecar/__tests__/test-rig.ts
git commit -m "spike(0.1): 10-sample round-trip PASS — GREEN for Phase 0 continuation"
```

---

## Spike 0.2: Llama 3.2 3B + grammar JSON on Lecture schema

**Goal:** Verify a 3B Q4_K_M model produces structurally valid Lecture notes with non-zero slot emergence on a real v1 transcript, given grammar constraint.

**Acceptance** (from spec §7.2):
- Zod validates the output
- ≥1 slot emergence in a fixture where triggers apply (use the existing v1 physics fixture with timeline triggers)
- Latency < 30s per chunk on M1 8GB

**Depends on:** Spike 0.1 PASS (uses the converter).

### Task 9: Source the fixture transcript

**Files:**
- Reference: `/Users/guntak/Lisna/backend/tests/fixtures/transcripts/` (existing v1 fixtures)
- Create: `desktop/spikes/phase-0/02-3b-lecture-grammar/fixture-transcript.json`

- [ ] **Step 1: Identify a v1 fixture with timeline/formula triggers**

```bash
ls /Users/guntak/Lisna/backend/tests/fixtures/transcripts/
# Look for: procedural-physics-em (auto-cap, 322 chunks per memory curator_phase_abc) — has formula triggers
```

- [ ] **Step 2: Copy into spike dir** (just the transcript JSON, no LLM output)

```bash
cp backend/tests/fixtures/transcripts/<chosen>/transcript.json \
   desktop/spikes/phase-0/02-3b-lecture-grammar/fixture-transcript.json
```

- [ ] **Step 3: Verify it's a bucketedTranscript shape** (`{ts: number; text: string}[]`)

```bash
head -c 200 desktop/spikes/phase-0/02-3b-lecture-grammar/fixture-transcript.json
```

Expected: JSON array starting with `[{"ts": 0, "text":"..."`

- [ ] **Step 4: Commit fixture**

```bash
git add desktop/spikes/phase-0/02-3b-lecture-grammar/fixture-transcript.json
git commit -m "spike(0.2): import v1 physics fixture transcript"
```

### Task 10: Write the minimal Lecture prompt

**Files:**
- Create: `desktop/spikes/phase-0/02-3b-lecture-grammar/lecture-prompt.ts`

- [ ] **Step 1: Write the prompt builder**

```typescript
// desktop/spikes/phase-0/02-3b-lecture-grammar/lecture-prompt.ts

export function buildLectureSpikePrompt(transcript: { ts: number; text: string }[]): {
  system: string;
  user: string;
} {
  const transcriptText = transcript
    .map(b => `[${fmtTs(b.ts)}] ${b.text}`)
    .join('\n');

  const system = [
    'You are a lecture note writer. Given a Japanese lecture transcript with timestamps, output a structured JSON note matching the LectureNote schema.',
    '',
    'Rules:',
    '- All user-visible text in Japanese.',
    '- Each section has heading, ts (integer seconds), summary, key_terms[].',
    '- If the transcript mentions specific years/dates with events (e.g., 1991年, 2014年), include a timeline extra slot for that section.',
    '- If the transcript mentions formulas or equations (e.g., E=mc²), include a formula extra slot.',
    '- Output ONLY valid JSON matching the schema. No markdown, no commentary.',
  ].join('\n');

  const user = `transcript:\n${transcriptText}\n\nProduce the LectureNote JSON.`;
  return { system, user };
}

function fmtTs(secs: number): string {
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
```

- [ ] **Step 2: Commit prompt builder**

```bash
git add desktop/spikes/phase-0/02-3b-lecture-grammar/lecture-prompt.ts
git commit -m "spike(0.2): minimal Lecture prompt for spike"
```

### Task 11: Run the spike + capture metrics

**Files:**
- Create: `desktop/spikes/phase-0/02-3b-lecture-grammar/run-spike.ts`

- [ ] **Step 1: Write the spike runner**

```typescript
// desktop/spikes/phase-0/02-3b-lecture-grammar/run-spike.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { LectureMiniSchema } from '../01-zod-to-gbnf/fixtures/lecture-mini-schema';
import { zodToGbnf } from '../01-zod-to-gbnf/zod-to-gbnf';
import { buildLectureSpikePrompt } from './lecture-prompt';
import { runSidecarGenerate } from '../../../src/main/sidecar/__tests__/test-rig';

async function main() {
  const transcript = JSON.parse(
    readFileSync('desktop/spikes/phase-0/02-3b-lecture-grammar/fixture-transcript.json', 'utf-8')
  ) as { ts: number; text: string }[];

  // Slice to ~8K tokens worth (chunked-at-end uses ~8K) — for JA ≈ 13K chars
  const sliced = sliceByCharBudget(transcript, 13_000);

  const grammarPath = '/tmp/lecture-spike.gbnf';
  writeFileSync(grammarPath, zodToGbnf(LectureMiniSchema, 'LectureNote'));

  const { system, user } = buildLectureSpikePrompt(sliced);
  const prompt = `<|system|>${system}<|/system|><|user|>${user}<|/user|><|assistant|>`;

  const t0 = Date.now();
  const out = await runSidecarGenerate({
    prompt,
    grammarPath,
    maxTokens: 4096,
    temperature: 0.4,
  });
  const elapsed = Date.now() - t0;

  // Try Zod parse
  let validationResult: 'PASS' | 'FAIL';
  let parsed: any = null;
  try {
    parsed = JSON.parse(out);
    LectureMiniSchema.parse(parsed);
    validationResult = 'PASS';
  } catch (e) {
    validationResult = 'FAIL';
    console.error('Validation error:', e instanceof Error ? e.message : e);
  }

  // Slot emergence count
  const slotsCount = parsed?.sections?.reduce(
    (acc: number, sec: any) => acc + (sec.extras?.length ?? 0),
    0
  ) ?? 0;

  const result = {
    elapsedMs: elapsed,
    outputBytes: out.length,
    validation: validationResult,
    slotsEmerged: slotsCount,
    sections: parsed?.sections?.length ?? 0,
    sample: parsed,
  };

  writeFileSync(
    `desktop/spikes/phase-0/02-3b-lecture-grammar/results/run-${Date.now()}.json`,
    JSON.stringify(result, null, 2)
  );
  console.log('Result:', { ...result, sample: '[omitted]' });
}

function sliceByCharBudget(t: { ts: number; text: string }[], budget: number): typeof t {
  const out: typeof t = [];
  let used = 0;
  for (const seg of t) {
    if (used + seg.text.length > budget) break;
    out.push(seg);
    used += seg.text.length;
  }
  return out;
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the spike** (3 invocations for variance)

```bash
mkdir -p desktop/spikes/phase-0/02-3b-lecture-grammar/results
for i in 1 2 3; do
  SPIKE_LLM_MODEL_PATH=/path/to/llama-3.2-3b-q4_k_m.gguf \
    pnpm --filter desktop tsx desktop/spikes/phase-0/02-3b-lecture-grammar/run-spike.ts
done
```

Expected per run: result printed with elapsedMs / validation / slotsEmerged / sections.

- [ ] **Step 3: Evaluate against acceptance**

Acceptance criteria:
- All 3 runs: `validation === 'PASS'`
- At least 1 of 3 runs: `slotsEmerged >= 1` (physics fixture has formula triggers — should hit)
- All 3 runs: `elapsedMs < 30000`

**On any FAIL**:
- Validation FAIL → check error; if grammar issue → return to Spike 0.1; if prompt issue → tighten system prompt
- slotsEmerged = 0 in all 3 → prompt iteration (stronger slot trigger hints), then re-run; if still 0 after 3 iterations → document as `decision-0.2-slot-emergence.md` and decide: (a) accept lower emergence + add eval/scoring for it; (b) escalate to Qwen 2.5 swap (per §7.2 fallback)
- Latency > 30s → check model load is reused across runs (warm cache); document, may indicate need for warmup signal in ModelProfile

- [ ] **Step 4: Update scorecard**

If PASS: mark `0.2 3B Lecture: **PASS**` with run metrics.
If FAIL: mark `0.2 3B Lecture: **FAIL — escalation**` and link the decision memo.

- [ ] **Step 5: Commit results + verdict**

```bash
git add desktop/spikes/phase-0/02-3b-lecture-grammar/run-spike.ts desktop/spikes/phase-0/README.md
# results/ is gitignored; verdict goes in README
git commit -m "spike(0.2): 3B+grammar Lecture spike — verdict: PASS|FAIL"
```

---

## Spike 0.3: Diarization on JA fixtures

**Goal:** Verify sherpa-onnx + pyannote-segmentation-3.0 + 3D-Speaker eres2net meets DER < 15% on 3 JA fixtures.

**Acceptance** (from spec §7.1):
- DER < 15% per fixture
- Warm-up time to label stability < 30s
- Per-chunk inference latency < 1s
- Peak RAM during processing fits in 8GB envelope (STT not loaded during this spike)

**Founder dependency**: 3 JA audio fixtures must be sourced before this spike. See Task 12.

### Task 12: Acquire/record JA fixtures (FOUNDER ACTION)

**This task is gated on founder providing audio.** Implementer documents the need; spike can't run without input. Three fixtures needed:

| Fixture name | Speakers | Duration | Setting | Use |
|---|---|---|---|---|
| ja-interview-2spk-30min.wav | 2 (Q&A pattern) | ~30 min | Quiet office | DER baseline on simple case |
| ja-meeting-4spk-30min.wav | 4 | ~30 min | Conference room (some echo) | DER on realistic meeting |
| ja-brainstorm-6spk-20min.wav | 6 | ~20 min | Energetic discussion (cross-talk) | DER stress test |

Each fixture also needs a hand-labeled ground-truth: a JSON file alongside the WAV with speaker labels per time range:
```json
[{ "start": 0.0, "end": 4.2, "speaker": "A" }, { "start": 4.5, "end": 9.8, "speaker": "B" }, ...]
```

Hand-labeling is ~10-15 min per fixture (use Audacity or similar with speaker-change markers).

**Place fixtures at**: `desktop/spikes/phase-0/03-diarization-ja/fixtures/<name>.wav` + `<name>.truth.json`

- [ ] **Step 1: Founder confirms fixtures landed** + commit ground-truth JSONs (WAVs are gitignored)

```bash
git add desktop/spikes/phase-0/03-diarization-ja/fixtures/*.truth.json
git commit -m "spike(0.3): JA fixture ground-truth labels (3 fixtures, audio gitignored)"
```

### Task 13: Set up sherpa-onnx + download models

**Files:**
- Modify: `desktop/sidecar/` build config to link sherpa-onnx (or use Node bindings for spike)
- Create: `desktop/spikes/phase-0/03-diarization-ja/setup.sh`

For the spike, use sherpa-onnx Node bindings (`npm install sherpa-onnx-node`) — simpler than C++ sidecar integration. Production integration into sidecar deferred to Plan 4 (Diarization).

- [ ] **Step 1: Install Node binding**

```bash
cd desktop
pnpm add -D sherpa-onnx-node
```

- [ ] **Step 2: Download models**

```bash
# setup.sh
mkdir -p desktop/spikes/phase-0/03-diarization-ja/models
cd desktop/spikes/phase-0/03-diarization-ja/models

# Pyannote segmentation 3.0 (~13MB)
curl -L -o sherpa-onnx-pyannote-segmentation-3-0.tar.bz2 \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2
tar -xjf sherpa-onnx-pyannote-segmentation-3-0.tar.bz2

# 3D-Speaker eres2net (~37MB)
curl -L -o 3dspeaker_speech_eres2net_base.onnx \
  https://huggingface.co/csukuangfj/3dspeaker/resolve/main/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx
```

Run: `bash desktop/spikes/phase-0/03-diarization-ja/setup.sh`

Expected: ~50MB of models in the models/ directory.

- [ ] **Step 3: Commit setup script** (models gitignored)

```bash
git add desktop/spikes/phase-0/03-diarization-ja/setup.sh desktop/package.json desktop/pnpm-lock.yaml
git commit -m "spike(0.3): sherpa-onnx setup + diarization model download script"
```

### Task 14: Implement DER computation

**Files:**
- Create: `desktop/spikes/phase-0/03-diarization-ja/der.ts`
- Create: `desktop/spikes/phase-0/03-diarization-ja/der.test.ts`

- [ ] **Step 1: Write the failing DER test**

```typescript
// desktop/spikes/phase-0/03-diarization-ja/der.test.ts
import { describe, it, expect } from 'vitest';
import { computeDER } from './der';

describe('computeDER', () => {
  it('returns 0 for identical hypothesis and reference', () => {
    const ref = [{ start: 0, end: 10, speaker: 'A' }];
    const hyp = [{ start: 0, end: 10, speaker: 'A' }];
    expect(computeDER(hyp, ref).der).toBe(0);
  });

  it('returns 0.5 for 50% speaker mismatch', () => {
    const ref = [{ start: 0, end: 10, speaker: 'A' }];
    const hyp = [
      { start: 0, end: 5, speaker: 'A' },
      { start: 5, end: 10, speaker: 'B' },
    ];
    // After optimal speaker map: hyp B's 5s is the only error → 5s/10s = 0.5
    expect(computeDER(hyp, ref).der).toBeCloseTo(0.5, 2);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement DER**

```typescript
// desktop/spikes/phase-0/03-diarization-ja/der.ts
export interface SpeakerTurn {
  start: number;
  end: number;
  speaker: string;
}

export interface DERResult {
  der: number;
  missedSpeechSec: number;
  falseAlarmSec: number;
  speakerErrorSec: number;
  totalRefSec: number;
}

export function computeDER(hyp: SpeakerTurn[], ref: SpeakerTurn[]): DERResult {
  // 1. Build the optimal speaker mapping (hyp speaker → ref speaker) via Hungarian-like greedy
  const mapping = optimalSpeakerMap(hyp, ref);
  const hypRemapped = hyp.map(t => ({ ...t, speaker: mapping[t.speaker] ?? t.speaker }));

  // 2. Compute frame-level (e.g., 10ms) per-frame agreement
  const frameSize = 0.01;
  const totalRef = ref.reduce((s, t) => s + (t.end - t.start), 0);
  const tEnd = Math.max(...ref.map(t => t.end), ...hyp.map(t => t.end));

  let missed = 0, falseAlarm = 0, speakerErr = 0;
  for (let t = 0; t < tEnd; t += frameSize) {
    const refSpk = ref.find(r => t >= r.start && t < r.end)?.speaker ?? null;
    const hypSpk = hypRemapped.find(h => t >= h.start && t < h.end)?.speaker ?? null;
    if (refSpk && !hypSpk) missed += frameSize;
    else if (!refSpk && hypSpk) falseAlarm += frameSize;
    else if (refSpk && hypSpk && refSpk !== hypSpk) speakerErr += frameSize;
  }

  return {
    der: (missed + falseAlarm + speakerErr) / totalRef,
    missedSpeechSec: missed,
    falseAlarmSec: falseAlarm,
    speakerErrorSec: speakerErr,
    totalRefSec: totalRef,
  };
}

function optimalSpeakerMap(hyp: SpeakerTurn[], ref: SpeakerTurn[]): Record<string, string> {
  // Greedy: for each unique hyp speaker, map to the ref speaker with which it has the most overlap.
  const hypSpeakers = [...new Set(hyp.map(t => t.speaker))];
  const refSpeakers = [...new Set(ref.map(t => t.speaker))];
  const map: Record<string, string> = {};
  for (const h of hypSpeakers) {
    let bestRef = refSpeakers[0], bestOverlap = -1;
    for (const r of refSpeakers) {
      const overlap = computeOverlap(hyp.filter(t => t.speaker === h), ref.filter(t => t.speaker === r));
      if (overlap > bestOverlap) { bestOverlap = overlap; bestRef = r; }
    }
    map[h] = bestRef;
  }
  return map;
}

function computeOverlap(a: SpeakerTurn[], b: SpeakerTurn[]): number {
  let sum = 0;
  for (const x of a) for (const y of b) {
    sum += Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start));
  }
  return sum;
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm --filter desktop test desktop/spikes/phase-0/03-diarization-ja/der.test.ts`

- [ ] **Step 5: Commit**

```bash
git add desktop/spikes/phase-0/03-diarization-ja/der.ts desktop/spikes/phase-0/03-diarization-ja/der.test.ts
git commit -m "spike(0.3): DER computation"
```

### Task 15: Run sherpa-onnx + score against truth

**Files:**
- Create: `desktop/spikes/phase-0/03-diarization-ja/run-spike.ts`

- [ ] **Step 1: Write the spike runner**

```typescript
// desktop/spikes/phase-0/03-diarization-ja/run-spike.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { OfflineSpeakerDiarization, OfflineSpeakerDiarizationConfig } from 'sherpa-onnx-node';
import { computeDER, SpeakerTurn } from './der';

interface SpikeRun {
  fixture: string;
  der: number;
  warmupTimeSec: number;
  perChunkLatencyMs: number[];
  peakRamMB: number;
}

const FIXTURES = [
  { wav: 'ja-interview-2spk-30min.wav', truth: 'ja-interview-2spk-30min.truth.json' },
  { wav: 'ja-meeting-4spk-30min.wav', truth: 'ja-meeting-4spk-30min.truth.json' },
  { wav: 'ja-brainstorm-6spk-20min.wav', truth: 'ja-brainstorm-6spk-20min.truth.json' },
];

async function runFixture(fixtureName: string, truthName: string): Promise<SpikeRun> {
  const config: OfflineSpeakerDiarizationConfig = {
    segmentation: {
      pyannote: { model: 'desktop/spikes/phase-0/03-diarization-ja/models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx' },
    },
    embedding: {
      model: 'desktop/spikes/phase-0/03-diarization-ja/models/3dspeaker_speech_eres2net_base.onnx',
    },
    clustering: { numClusters: -1, threshold: 0.5 },  // auto-detect cluster count
    minDurationOn: 0.3,
    minDurationOff: 0.5,
  };

  const diar = new OfflineSpeakerDiarization(config);
  const t0 = Date.now();
  const samples = readWav(`desktop/spikes/phase-0/03-diarization-ja/fixtures/${fixtureName}`);
  // (assume helper readWav returns Float32Array at 16kHz)

  const memBefore = process.memoryUsage().rss / 1024 / 1024;
  const segments = await diar.process(samples, 16_000);  // returns [{ start, end, speaker: 0|1|2|...}]
  const memAfter = process.memoryUsage().rss / 1024 / 1024;

  const elapsedTotal = Date.now() - t0;

  const hyp: SpeakerTurn[] = segments.map(s => ({
    start: s.start, end: s.end, speaker: `S${s.speaker}`,
  }));
  const ref: SpeakerTurn[] = JSON.parse(
    readFileSync(`desktop/spikes/phase-0/03-diarization-ja/fixtures/${truthName}`, 'utf-8')
  );

  const derResult = computeDER(hyp, ref);

  // Warm-up = time-to-first-stable-cluster (approximation: when 2 clusters present
  // and labels stop flipping for a 5-sec window). For spike: just record total elapsed
  // as a rough cap; detailed warm-up measurement is a follow-up.
  return {
    fixture: fixtureName,
    der: derResult.der,
    warmupTimeSec: 0,  // placeholder — refine if Pass criteria edge
    perChunkLatencyMs: [elapsedTotal],  // sherpa offline → single number; for streaming, populate per-chunk
    peakRamMB: memAfter - memBefore,
  };
}

async function main() {
  const results: SpikeRun[] = [];
  for (const f of FIXTURES) {
    console.log(`Running ${f.wav}...`);
    results.push(await runFixture(f.wav, f.truth));
  }
  writeFileSync(
    `desktop/spikes/phase-0/03-diarization-ja/results/run-${Date.now()}.json`,
    JSON.stringify(results, null, 2)
  );
  console.log('Results:', results);
}

main().catch(e => { console.error(e); process.exit(1); });

declare function readWav(path: string): Float32Array;
// (use wav-decoder or similar npm; skeleton omits for brevity)
```

- [ ] **Step 2: Implement readWav helper**

Use `wav-decoder` npm:
```bash
cd desktop && pnpm add -D wav-decoder
```

```typescript
import { readFileSync } from 'node:fs';
import * as WavDecoder from 'wav-decoder';

function readWav(path: string): Float32Array {
  const buffer = readFileSync(path);
  const decoded = WavDecoder.decode.sync(buffer);
  // Force mono + 16kHz if needed
  return decoded.channelData[0];  // assumes already correct format from founder
}
```

- [ ] **Step 3: Run the spike on all 3 fixtures**

```bash
mkdir -p desktop/spikes/phase-0/03-diarization-ja/results
pnpm --filter desktop tsx desktop/spikes/phase-0/03-diarization-ja/run-spike.ts
```

Expected: 3 result objects with DER measurements.

- [ ] **Step 4: Evaluate against acceptance**

For each fixture:
- DER < 0.15 ✓
- Per-chunk latency < 1000ms ✓ (sherpa offline computes whole file; calculate proportionally: latency_ms / (duration_sec × 100))
- Peak RAM (model + processing) < 600MB

**On any FAIL**:
- DER ≥ 0.15 on 1+ fixture: try NeMo TitaNet small embedding model (swap in `embedding.model` path). Spec §7.1 fallback ladder.
- DER ≥ 0.15 on ALL fixtures with both embeddings: escalate, may drop diarization from v2 alpha (single-speaker labels only; per spec §7.1 final fallback).
- Latency > 1s/chunk: profile, identify bottleneck (likely embedding pass), document.
- RAM > 600MB: less critical (post-Stop, STT unloaded), but document for ModelProfile.ramBudgetMB.

- [ ] **Step 5: Update scorecard + commit**

```bash
git add desktop/spikes/phase-0/03-diarization-ja/run-spike.ts desktop/spikes/phase-0/README.md
git commit -m "spike(0.3): JA diarization spike — verdict: PASS|FAIL"
```

---

## Spike 0.4: Chunking algorithm

**Goal:** Implement `chunkTranscript()` per spec §5.2a and verify it handles all 4 edge cases plus a realistic 90-min synthesized transcript.

**Acceptance** (from spec §5.2a):
- All 4 edge cases pass (no silence in window / remaining fits / single-segment / empty)
- 90-min synthesized transcript produces sensible chunk count
- Token budgets respected (each chunk ≤ `maxTokens`)

**Depends on:** None. Pure algorithm.

### Task 16: Implement chunkTranscript

**Files:**
- Create: `desktop/spikes/phase-0/04-chunking/chunking.ts`
- Create: `desktop/spikes/phase-0/04-chunking/chunking.test.ts`

- [ ] **Step 1: Write the failing edge-case tests**

```typescript
// desktop/spikes/phase-0/04-chunking/chunking.test.ts
import { describe, it, expect } from 'vitest';
import { chunkTranscript, SessionTranscript } from './chunking';

const mkTranscript = (segs: Array<{ ts: number; text: string }>): SessionTranscript => ({
  sessionId: 'test',
  speakers: [{ id: 0 }],
  transcriptSegments: segs.map(s => ({ ...s, speakerId: 0 })),
});

describe('chunkTranscript', () => {
  it('empty transcript returns []', () => {
    expect(chunkTranscript(mkTranscript([]), 8000, 30)).toEqual([]);
  });

  it('single segment under budget returns [transcript]', () => {
    const t = mkTranscript([{ ts: 0, text: 'short' }]);
    const chunks = chunkTranscript(t, 8000, 30);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].transcriptSegments).toHaveLength(1);
  });

  it('multiple segments fitting budget returns one chunk', () => {
    const t = mkTranscript([
      { ts: 0, text: 'hi' },
      { ts: 1, text: 'there' },
      { ts: 2, text: 'all' },
    ]);
    expect(chunkTranscript(t, 8000, 30)).toHaveLength(1);
  });

  it('splits at silence > 1.5s within slack window', () => {
    const t = mkTranscript([
      { ts: 0, text: 'A'.repeat(5000) },     // bulky segment
      { ts: 10, text: 'B' },                  // first segment
      { ts: 20, text: 'C' },                  // silence: 20-10=10s gap before this... wait, gap between B and C is 19s
      // Use proper gap math:
      { ts: 22, text: 'D' },
    ]);
    // Provide a budget that triggers split between A and B (after the bulky segment)
    // With JA ~0.6 t/char, 5000 chars ≈ 3000 tokens; budget 2500 → forces split
    const chunks = chunkTranscript(t, 2500, 30);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('hard-cuts at token budget when no silence in slack window', () => {
    // Dense transcript with no large gaps: all segments tightly packed
    const segs: Array<{ ts: number; text: string }> = [];
    for (let i = 0; i < 200; i++) segs.push({ ts: i * 0.5, text: 'x'.repeat(100) });
    const t = mkTranscript(segs);
    const chunks = chunkTranscript(t, 1000, 5);  // small slack to force no-silence case
    expect(chunks.length).toBeGreaterThan(1);
    // No chunk should exceed budget significantly
    for (const c of chunks) {
      const totalChars = c.transcriptSegments.reduce((s, x) => s + x.text.length, 0);
      expect(totalChars).toBeLessThan(2500);  // 1000 tokens × ~2 char/token + slack overshoot
    }
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

- [ ] **Step 3: Implement chunkTranscript**

```typescript
// desktop/spikes/phase-0/04-chunking/chunking.ts

export interface TranscriptSegment {
  ts: number;
  text: string;
  speakerId: number;
}

export interface SessionTranscript {
  sessionId: string;
  speakers: { id: number; name?: string }[];
  transcriptSegments: TranscriptSegment[];
}

// Token estimation (JA-biased; refine when sidecar tokenizer is available)
function estimateTokens(text: string): number {
  // Simple heuristic: 1 char ≈ 0.6 tokens for JA, 0.25 for ASCII-heavy
  const cjkCount = (text.match(/[぀-ゟ゠-ヿ一-鿿]/g) ?? []).length;
  const asciiCount = text.length - cjkCount;
  return Math.ceil(cjkCount * 0.6 + asciiCount * 0.25);
}

interface SilenceGap {
  startTs: number;
  endTs: number;
  durationSec: number;
}

function findSilenceGaps(segs: TranscriptSegment[], windowStart: number, windowEnd: number, minGapSec: number): SilenceGap[] {
  const gaps: SilenceGap[] = [];
  for (let i = 0; i < segs.length - 1; i++) {
    // Estimate segment end as the next segment's ts (lower bound — real STT end may be later)
    const segEnd = segs[i + 1].ts;
    const segLastWord = segs[i].ts + (segs[i].text.length * 0.07);  // rough estimate
    const gapStart = Math.max(segLastWord, segs[i].ts);
    const gapEnd = segs[i + 1].ts;
    const gapDuration = gapEnd - gapStart;
    if (gapDuration >= minGapSec && gapStart >= windowStart && gapStart <= windowEnd) {
      gaps.push({ startTs: gapStart, endTs: gapEnd, durationSec: gapDuration });
    }
  }
  return gaps;
}

export function chunkTranscript(
  transcript: SessionTranscript,
  maxTokens: number,
  slackSec = 30,
): SessionTranscript[] {
  const segs = transcript.transcriptSegments;
  if (segs.length === 0) return [];

  const chunks: SessionTranscript[] = [];
  let cursorIdx = 0;

  while (cursorIdx < segs.length) {
    // Find soft end via token budget
    let tokens = 0;
    let softEndIdx = cursorIdx;
    for (let i = cursorIdx; i < segs.length; i++) {
      const segTokens = estimateTokens(segs[i].text);
      if (tokens + segTokens > maxTokens && i > cursorIdx) {
        softEndIdx = i - 1;
        break;
      }
      tokens += segTokens;
      softEndIdx = i;
    }

    if (softEndIdx >= segs.length - 1) {
      // Remaining fits — final chunk
      chunks.push({ ...transcript, transcriptSegments: segs.slice(cursorIdx) });
      break;
    }

    const softEndTs = segs[softEndIdx].ts;
    const candidates = findSilenceGaps(segs, softEndTs - slackSec, softEndTs + slackSec, 1.5);
    let hardEndIdx: number;
    if (candidates.length > 0) {
      const best = candidates.reduce((b, c) =>
        Math.abs(c.startTs - softEndTs) < Math.abs(b.startTs - softEndTs) ? c : b
      );
      // Snap chunk boundary to the segment ending at or before the silence
      hardEndIdx = segs.findIndex((s, i) => i > cursorIdx && s.ts >= best.endTs) - 1;
      if (hardEndIdx < cursorIdx) hardEndIdx = softEndIdx;  // safety
    } else {
      // Hard cut at soft end
      hardEndIdx = softEndIdx;
    }

    chunks.push({ ...transcript, transcriptSegments: segs.slice(cursorIdx, hardEndIdx + 1) });
    cursorIdx = hardEndIdx + 1;
  }

  return chunks;
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm --filter desktop test desktop/spikes/phase-0/04-chunking/chunking.test.ts`

- [ ] **Step 5: Commit**

```bash
git add desktop/spikes/phase-0/04-chunking/
git commit -m "spike(0.4): chunkTranscript algorithm + edge-case tests"
```

### Task 17: Synthesize 90-min transcript + validate chunking

**Files:**
- Create: `desktop/spikes/phase-0/04-chunking/fixtures/synth-90min.json`
- Create: `desktop/spikes/phase-0/04-chunking/synth.test.ts`

- [ ] **Step 1: Build the synth fixture** (concatenate 3 v1 fixtures with offset ts)

```typescript
// desktop/spikes/phase-0/04-chunking/build-synth.ts
import { readFileSync, writeFileSync } from 'node:fs';

const fixtures = [
  '/Users/guntak/Lisna/backend/tests/fixtures/transcripts/procedural-physics-em/transcript.json',
  '/Users/guntak/Lisna/backend/tests/fixtures/transcripts/narrative-ukraine-russia/transcript.json',
  // pick a third fixture, e.g. procedural-bookkeeping if exists
];

let allSegs: { ts: number; text: string; speakerId: number }[] = [];
let tsOffset = 0;
for (const path of fixtures) {
  const segs = JSON.parse(readFileSync(path, 'utf-8')) as { ts: number; text: string }[];
  for (const s of segs) allSegs.push({ ts: s.ts + tsOffset, text: s.text, speakerId: 0 });
  tsOffset = allSegs[allSegs.length - 1].ts + 60;  // 60s gap between fixtures
}

writeFileSync(
  'desktop/spikes/phase-0/04-chunking/fixtures/synth-90min.json',
  JSON.stringify({ sessionId: 'synth', speakers: [{ id: 0 }], transcriptSegments: allSegs }, null, 2)
);
console.log(`Wrote synth: ${allSegs.length} segments, ${allSegs[allSegs.length - 1].ts.toFixed(0)}s`);
```

Run: `pnpm --filter desktop tsx desktop/spikes/phase-0/04-chunking/build-synth.ts`

- [ ] **Step 2: Write the synth validation test**

```typescript
// desktop/spikes/phase-0/04-chunking/synth.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { chunkTranscript, SessionTranscript } from './chunking';

describe('chunkTranscript on 90-min synthesized transcript', () => {
  const transcript: SessionTranscript = JSON.parse(
    readFileSync('desktop/spikes/phase-0/04-chunking/fixtures/synth-90min.json', 'utf-8')
  );

  it('produces 4-12 chunks at 8K-token budget', () => {
    const chunks = chunkTranscript(transcript, 8000, 30);
    console.log(`Chunks: ${chunks.length}, total segments: ${transcript.transcriptSegments.length}`);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks.length).toBeLessThanOrEqual(12);
  });

  it('every chunk respects token budget (with slack tolerance)', () => {
    const chunks = chunkTranscript(transcript, 8000, 30);
    for (const c of chunks) {
      const tokens = c.transcriptSegments.reduce(
        (s, seg) => s + Math.ceil(seg.text.length * 0.6),
        0
      );
      expect(tokens).toBeLessThan(8000 * 1.2);  // 20% slack tolerance
    }
  });

  it('preserves all segments (no loss)', () => {
    const chunks = chunkTranscript(transcript, 8000, 30);
    const totalChunked = chunks.reduce((s, c) => s + c.transcriptSegments.length, 0);
    expect(totalChunked).toBe(transcript.transcriptSegments.length);
  });
});
```

- [ ] **Step 3: Run tests, expect PASS**

Run: `pnpm --filter desktop test desktop/spikes/phase-0/04-chunking/synth.test.ts`

- [ ] **Step 4: Update scorecard + commit**

```bash
git add desktop/spikes/phase-0/04-chunking/ desktop/spikes/phase-0/README.md
git commit -m "spike(0.4): chunking — 90-min synth validation PASS"
```

---

## Phase 0 closeout

### Task 18: Write Phase 0 verdict memo

**Files:**
- Create: `desktop/spikes/phase-0/VERDICT.md`

- [ ] **Step 1: Synthesize results**

```markdown
# Phase 0 Verdict — 2026-MM-DD

## Summary
| Spike | Status | Key metric |
|---|---|---|
| 0.1 zod-to-gbnf | PASS/FAIL | 10/10 round-trip, converter Xms first-call |
| 0.2 3B Lecture | PASS/FAIL | Zod parse OK; slots emerged X of 3 runs; latency Xs |
| 0.3 Diarization JA | PASS/FAIL | DER X% / X% / X% (interview/meeting/brainstorm) |
| 0.4 Chunking | PASS | X chunks for 90-min synth, all under budget |

## Decisions
- [If all PASS] → green-light Plan 2 (Foundation infrastructure) per the spec sequencing
- [If 0.1 FAIL] → spec revision needed; document escalation in `docs/superpowers/decisions/`
- [If 0.2 FAIL slot emergence] → prompt iteration first; if persistent, consider Qwen 2.5 swap
- [If 0.3 FAIL DER] → try NeMo TitaNet small fallback; if still FAIL, drop diarization to single-speaker labels for alpha

## Carry-forward items to Plan 2 (Foundation)
- [List specific items learned during spikes that should inform Plan 2 design choices, e.g.:]
  - Converter LOC actual: X (vs estimated 150)
  - Zod construct that needed extra handling: discriminated union depth-N
  - Latency measurements per family to inform `ModelProfile.recommendedChunkTokens`
  - Diarization model that won (3D-Speaker vs NeMo)

## Links
- Round 1 reviewer transcript: [internal log]
- Scorecard: desktop/spikes/phase-0/README.md
- Spec: docs/superpowers/specs/2026-05-26-v2-structured-note-creation-design.md
```

- [ ] **Step 2: Fill in actual values from spike results**

- [ ] **Step 3: Commit verdict**

```bash
git add desktop/spikes/phase-0/VERDICT.md
git commit -m "spike(phase-0): verdict memo — green-light Plan 2 OR escalate"
```

### Task 19: Push branch + open PR (optional)

- [ ] **Step 1: Push the spike branch**

```bash
git push -u origin spec/v2-note-creation-design  # or whatever branch the spike was done on
```

- [ ] **Step 2: Open PR for review**

```bash
gh pr create \
  --base main \
  --title "Phase 0 spikes for v2 structured note creation" \
  --body "$(cat desktop/spikes/phase-0/VERDICT.md)"
```

---

## Self-review checklist (do not skip)

After all 19 tasks complete, run through:

- [ ] Every Phase 0 spike has run and produced a verdict
- [ ] Scorecard in `desktop/spikes/phase-0/README.md` is updated with actual measurements
- [ ] Verdict memo references the spec by commit hash
- [ ] Any FAIL has a corresponding decision memo or escalation in `docs/superpowers/decisions/`
- [ ] All tests pass: `pnpm --filter desktop test`
- [ ] No stale `process.exit()` calls or hardcoded credentials in spike code
- [ ] `.gitignore` updated for fixtures/results (no large audio in commits)

## Next plan dependencies

Plan 2 (Foundation infrastructure) is unblocked when:
- Spike 0.1 = PASS (converter ready for production move-in)
- Spike 0.2 = PASS (3B model viability confirmed for Lecture)
- Spike 0.4 = PASS (chunking algorithm has tests + impl ready to move into `shared/`)

Spike 0.3 (diarization) can be carried into Plan 4 (Diarization integration) independently — Plan 2 doesn't strictly need it. But if 0.3 FAILS catastrophically (DER > 30%), trigger spec revision before Plan 2 since speaker-aware schemas (Meeting/Interview/Brainstorm) lose meaning without diarization.

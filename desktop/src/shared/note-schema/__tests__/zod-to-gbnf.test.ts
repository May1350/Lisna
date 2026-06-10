import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToGbnf } from '../zod-to-gbnf';

describe('zodToGbnf', () => {
  it('emits GBNF for a simple object with string + number', () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const gbnf = zodToGbnf(schema, 'Person');
    expect(gbnf).toContain('root ::= Person');
    expect(gbnf).toContain('Person ::=');
    expect(gbnf).toContain(`"\\"name\\""`);
    expect(gbnf).toContain(`"\\"age\\""`);
  });

  it('emits GBNF for array of objects', () => {
    const Item = z.object({ text: z.string() });
    const schema = z.object({ items: z.array(Item) });
    const gbnf = zodToGbnf(schema, 'Container');
    // Rule-name segments are joined with `-` (not `_`) because llama.cpp's
    // GBNF parser only accepts [a-zA-Z0-9-] in rule identifiers — see
    // zod-to-gbnf.ts::sanitize. JSON-key string literals keep underscores.
    expect(gbnf).toContain('Container-items ::= "[" ws (');
    expect(gbnf).toContain(')? ws "]"');
  });

  it('omits optional field from grammar when absent', () => {
    const schema = z.object({ required: z.string(), maybe: z.string().optional() });
    const gbnf = zodToGbnf(schema, 'X');
    expect(gbnf).toMatch(/X ::= "{" ws .* ws "}"/);
    expect(gbnf).toContain('X-maybe');  // rule for maybe field exists (post-fix)
    expect(gbnf).toContain('("," ws "\\"maybe\\"" ":" ws X-maybe)?');  // present as an optional branch
  });

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

  it('emits GBNF for discriminated union (Lecture extras pattern)', () => {
    const Step = z.object({ type: z.literal('procedure_steps'), items: z.array(z.string()) });
    const Formula = z.object({ type: z.literal('formula'), items: z.array(z.string()) });
    const Extras = z.discriminatedUnion('type', [Step, Formula]);
    const schema = z.object({ extras: z.array(Extras).optional() });
    const gbnf = zodToGbnf(schema, 'Lecture');
    // Rule-name segments use `-`, but the literal value (`procedure_steps`)
    // inside JSON string quotes keeps its underscore — that's the actual
    // discriminator value the model emits in JSON.
    expect(gbnf).toContain('Lecture-extras-elem ::=');
    expect(gbnf).toMatch(/Lecture-extras-elem-.*procedure_steps/);
    expect(gbnf).toMatch(/Lecture-extras-elem-.*formula/);
  });

  it('strips fields marked .describe(JSON.stringify({ postDecodeOnly: true }))', () => {
    const schema = z.object({
      text: z.string(),
      from: z.enum(['transcript', 'inferred']).describe(JSON.stringify({ postDecodeOnly: true })),
    });
    const gbnf = zodToGbnf(schema, 'Item');
    expect(gbnf).not.toContain(`"\\"from\\""`);  // field absent in object rule
    expect(gbnf).toContain(`"\\"text\\""`);  // text field still present
  });

  // ---- P0a: propagate ZodString .min(N>=1) to GBNF (gate-fail fix 2026-05-30) ----
  // Without this, the grammar permits "" for fields the schema requires non-empty
  // (e.g. LectureNote.sections[0].heading), and the real-3B grammar gate fails in
  // runPostDecodePipeline with ZodError: too_small. Both samplers (the bespoke
  // grammar-first chain and llama.cpp `common_sampler`) respect the grammar, so
  // the fix must change what the grammar admits, not the sampler choice.

  it('emits json-string-nonempty for z.string().min(1)', () => {
    const schema = z.object({ heading: z.string().min(1) });
    const gbnf = zodToGbnf(schema, 'Note');
    // Both the prelude rule definition and the field reference must be present.
    expect(gbnf).toContain('json-string-nonempty ::= "\\"" char+ "\\""');
    expect(gbnf).toContain('Note-heading ::= json-string-nonempty');
  });

  it('keeps json-string (char*) for unconstrained z.string() — no regression', () => {
    const schema = z.object({ summary: z.string() });
    const gbnf = zodToGbnf(schema, 'Note');
    // The trailing \n distinguishes from a `json-string-nonempty\n` line —
    // catches a regression where every ZodString accidentally becomes nonempty.
    expect(gbnf).toContain('Note-summary ::= json-string\n');
  });

  it('treats z.string().min(N>1) the same as min(1) at grammar level', () => {
    // We encode only "non-empty" at the grammar; finer N stays a post-decode
    // Zod concern. Simpler grammar, equally safe (post-decode schema.parse
    // still rejects shorter strings).
    const schema = z.object({ text: z.string().min(5) });
    const gbnf = zodToGbnf(schema, 'X');
    expect(gbnf).toContain('X-text ::= json-string-nonempty');
  });

  // ---- Path G: propagate ZodArray .min(M) / .max(N) into bounded GBNF ----
  // llama.cpp's GBNF parser supports {m,n} quantifiers natively
  // (deps/llama.cpp/grammars/README.md + canonical json.gbnf). Encoding the
  // schema's array bounds into the grammar (a) helps the LLM emit `]` at the
  // expected time — fixing the runaway-JSON `CHUNK_FAILED:0` failure
  // (memory: v2_track2_path_g_grammar_gap_2026-06-09) — and (b) keeps the
  // grammar O(1) bytes per bounded array (no cascading N-deep rules).
  // Pattern C native quantifier per upstream README recommendation.

  it('emits bounded {0,N-1} quantifier for z.array(T).max(N)', () => {
    const schema = z.object({ items: z.array(z.string()).max(7) });
    const gbnf = zodToGbnf(schema, 'X');
    // 0–7 items: outer `?` admits empty, inner `{0,6}` admits 1–7 elements
    expect(gbnf).toContain('X-items ::= "[" ws (X-items-elem (ws "," ws X-items-elem){0,6})? ws "]"');
  });

  it('emits {M-1,N-1} (no outer ?) for z.array(T).min(M).max(N) with M>=1', () => {
    const schema = z.object({ items: z.array(z.string()).min(2).max(5) });
    const gbnf = zodToGbnf(schema, 'X');
    // 2–5 items: first element required, remaining count is in [M-1, N-1] = [1, 4]
    expect(gbnf).toContain('X-items ::= "[" ws X-items-elem (ws "," ws X-items-elem){1,4} ws "]"');
  });

  it('emits {M-1,} (no outer ?, no upper bound) for z.array(T).min(M) only', () => {
    const schema = z.object({ items: z.array(z.string()).min(2) });
    const gbnf = zodToGbnf(schema, 'X');
    expect(gbnf).toContain('X-items ::= "[" ws X-items-elem (ws "," ws X-items-elem){1,} ws "]"');
  });

  it('keeps unbounded * for z.array(T) with no bounds — no regression', () => {
    const schema = z.object({ items: z.array(z.string()) });
    const gbnf = zodToGbnf(schema, 'X');
    expect(gbnf).toContain('X-items ::= "[" ws (X-items-elem (ws "," ws X-items-elem)*)? ws "]"');
  });
});

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToGbnf } from './zod-to-gbnf';

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
    expect(gbnf).toContain('Container_items ::= "[" ws (');
    expect(gbnf).toContain(')? ws "]"');
  });

  it('omits optional field from grammar when absent', () => {
    const schema = z.object({ required: z.string(), maybe: z.string().optional() });
    const gbnf = zodToGbnf(schema, 'X');
    expect(gbnf).toMatch(/X ::= "{" ws .* ws "}"/);
    expect(gbnf).toContain('X_maybe');  // rule for maybe field exists (post-fix)
    expect(gbnf).toContain('("," ws "\\"maybe\\"" ":" ws X_maybe)?');  // present as an optional branch
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
    expect(gbnf).toContain('Lecture_extras_elem ::=');
    expect(gbnf).toMatch(/Lecture_extras_elem_.*procedure_steps/);
    expect(gbnf).toMatch(/Lecture_extras_elem_.*formula/);
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
});

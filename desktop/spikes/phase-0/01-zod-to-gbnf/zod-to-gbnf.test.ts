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
});

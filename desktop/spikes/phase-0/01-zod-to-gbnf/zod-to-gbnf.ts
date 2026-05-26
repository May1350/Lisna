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
    // Filter out fields marked .describe(JSON.stringify({ postDecodeOnly: true })).
    // Zod v3 has no .meta(); the v3 metadata channel is .describe(string), so the
    // marker is encoded as a JSON-stringified object on _def.description (or on the
    // inner ZodOptional's _def.description for `.optional().describe(...)` patterns).
    // Non-JSON descriptions are treated as plain human-readable text — field kept.
    const filtered = fields.filter(([_, v]) => {
      const fdef = (v as any)._def;
      const description = fdef.description ?? fdef.innerType?._def?.description;
      if (!description) return true;
      try {
        const meta = JSON.parse(description) as Record<string, unknown>;
        return !meta.postDecodeOnly;
      } catch {
        return true;  // non-JSON description is just human-readable text — keep field
      }
    });
    const requiredParts: string[] = [];
    const optionalParts: string[] = [];
    for (const [k, v] of filtered) {
      const fieldRuleName = `${name}_${k}`;
      const isOptional = (v as any)._def.typeName === 'ZodOptional';
      const inner = isOptional ? (v as any)._def.innerType : v;
      emit(inner, fieldRuleName, rules, visited);
      const entry = `"\\"${k}\\"" ":" ws ${fieldRuleName}`;
      if (isOptional) optionalParts.push(entry);
      else requiredParts.push(entry);
    }
    rules.push(`${name} ::= "{" ws ${requiredParts.join(' "," ws ')} ${optionalParts.map(p => `("," ws ${p})?`).join(' ')} ws "}"`);
    return;
  }

  // Trivial guard — should only be reached via plain emit() outside ZodObject:
  if (def.typeName === 'ZodOptional') {
    emit(def.innerType, name, rules, visited);
    return;
  }

  // scalars
  if (def.typeName === 'ZodString') { rules.push(`${name} ::= json_string`); return; }
  if (def.typeName === 'ZodNumber') { rules.push(`${name} ::= json_number`); return; }
  if (def.typeName === 'ZodBoolean') { rules.push(`${name} ::= "true" | "false"`); return; }

  if (def.typeName === 'ZodArray') {
    const elemRuleName = `${name}_elem`;
    emit(def.type, elemRuleName, rules, visited);
    rules.push(`${name} ::= "[" ws (${elemRuleName} (ws "," ws ${elemRuleName})*)? ws "]"`);
    return;
  }

  if (def.typeName === 'ZodEnum') {
    const opts = def.values.map((v: string) => `"\\"${v}\\""`).join(' | ');
    rules.push(`${name} ::= ${opts}`);
    return;
  }
  if (def.typeName === 'ZodLiteral') {
    rules.push(`${name} ::= "\\"${def.value}\\""`);
    return;
  }

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

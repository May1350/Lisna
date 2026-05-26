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

// Zod -> llama.cpp GBNF converter.
//
// Lifted from desktop/spikes/phase-0/01-zod-to-gbnf/zod-to-gbnf.ts
// (Spike 0.1, take-4 PASS at N=5 in 5.79 min wall; see VERDICT.md +
// decision-0.1-fail.md for the empirical narrative).
//
// Used by the production orchestrator (Plan 3+) to derive the grammar
// surface from a family's Zod schema. The grammar is the strict subset
// of the validated-note schema: fields marked
// .describe(JSON.stringify({ postDecodeOnly: true }))
// (the Zod v3 metadata channel) are stripped from the grammar but
// remain on the validated-note schema. See spec section 2.8.
//
// Runtime-cached in-memory per family (Plan 3 wires the cache).
//
// (Original spike-era comments preserved below for archaeology.)

import { z } from 'zod';

// Internal Zod v3 introspection: `._def` is the unstable internal API but
// is the only way to discriminate Zod schema shapes at runtime (Zod v3 has
// no public type-name discriminator). We narrow the access surface here so
// the rest of the file stays type-safe instead of sprinkling `any` casts.
interface ZodDef {
  typeName: string;
  description?: string;
  innerType?: z.ZodType;
  shape?: () => Record<string, z.ZodType>;
  type?: z.ZodType;
  values?: readonly string[];
  options?: readonly z.ZodType[];
  value?: string;
  // ZodString carries refinements (min, max, regex, email, …) on this array.
  // We currently only consult `kind === 'min'` to propagate non-empty to the
  // grammar; the rest stay a post-decode Zod concern.
  checks?: ReadonlyArray<{ kind: string; value?: number }>;
}

const getDef = (schema: z.ZodType): ZodDef =>
  (schema as unknown as { _def: ZodDef })._def;

// llama.cpp's GBNF parser accepts only [a-zA-Z0-9-] in rule names
// (src/llama-grammar.cpp::is_word_char). Underscores break the parse —
// our composite rule names (e.g. `LectureNote_sections_elem`) and field
// keys with underscores (e.g. `key_terms`, `schemaVersion`) must be
// sanitized into dashes before being used as a rule identifier. The
// underlying JSON string literal MUST keep the original key (line:
// `"\"key_terms\"" ":" ws ...`); only the rule-name identifier is
// rewritten. Caught by lecture-mini round-trip against
// test-gbnf-validator: composite names with `_` produced
// "expecting ::= at _schemaVersion ::= json_number".
function sanitize(name: string): string {
  return name.replace(/_/g, '-');
}

export function zodToGbnf(schema: z.ZodType, rootName: string): string {
  const safeRoot = sanitize(rootName);
  const rules: string[] = [`root ::= ${safeRoot}`];
  const visited = new Set<string>();
  emit(schema, safeRoot, rules, visited);
  return rules.join('\n') + '\n' + scalarRules();
}

function emit(schema: z.ZodType, name: string, rules: string[], visited: Set<string>): void {
  if (visited.has(name)) return;
  visited.add(name);
  const def = getDef(schema);

  if (def.typeName === 'ZodObject') {
    const fields = Object.entries(def.shape!()) as [string, z.ZodType][];
    // Filter out fields marked .describe(JSON.stringify({ postDecodeOnly: true })).
    // Zod v3 has no .meta(); the v3 metadata channel is .describe(string), so the
    // marker is encoded as a JSON-stringified object on _def.description (or on the
    // inner ZodOptional's _def.description for `.optional().describe(...)` patterns).
    // Non-JSON descriptions are treated as plain human-readable text — field kept.
    const filtered = fields.filter(([, v]) => {
      const fdef = getDef(v);
      const description =
        fdef.description ?? (fdef.innerType ? getDef(fdef.innerType).description : undefined);
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
      // Sanitize the field name when used as a rule identifier (k may itself
      // contain `_`, e.g. `key_terms`), but keep the original `k` in the
      // emitted JSON string literal so the grammar still matches actual keys.
      const fieldRuleName = sanitize(`${name}_${k}`);
      const vdef = getDef(v);
      const isOptional = vdef.typeName === 'ZodOptional';
      const inner = isOptional ? vdef.innerType! : v;
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
    emit(def.innerType!, name, rules, visited);
    return;
  }

  // scalars (rule names use `-` per is_word_char — see sanitize() above)
  if (def.typeName === 'ZodString') {
    // Propagate ZodString.min(N>=1) into the grammar so the model can't emit
    // `""` for fields the schema requires non-empty (e.g. LectureNote
    // `sections[0].heading` is `z.string().min(1)`). Without this, the
    // real-3B grammar gate fails in runPostDecodePipeline with
    // `ZodError: too_small` after the model has already produced grammar-valid
    // empty output — wasted retries and no recovery (the per-attempt schema is
    // z.unknown() in the production orchestrator, so callWithGrammar's
    // retry-on-Zod-rejection contract is a no-op for the real shape). Finer
    // min lengths (N > 1) stay a post-decode Zod concern — the grammar only
    // encodes the binary `non-empty?` distinction; the post-decode
    // schema.parse() still rejects shorter strings.
    const hasMin1 = def.checks?.some(c => c.kind === 'min' && (c.value ?? 0) >= 1) ?? false;
    rules.push(`${name} ::= ${hasMin1 ? 'json-string-nonempty' : 'json-string'}`);
    return;
  }
  if (def.typeName === 'ZodNumber') { rules.push(`${name} ::= json-number`); return; }
  if (def.typeName === 'ZodBoolean') { rules.push(`${name} ::= "true" | "false"`); return; }

  if (def.typeName === 'ZodArray') {
    const elemRuleName = sanitize(`${name}_elem`);
    emit(def.type!, elemRuleName, rules, visited);
    rules.push(`${name} ::= "[" ws (${elemRuleName} (ws "," ws ${elemRuleName})*)? ws "]"`);
    return;
  }

  if (def.typeName === 'ZodEnum') {
    const opts = def.values!.map((v: string) => `"\\"${v}\\""`).join(' | ');
    rules.push(`${name} ::= ${opts}`);
    return;
  }
  if (def.typeName === 'ZodLiteral') {
    rules.push(`${name} ::= "\\"${def.value}\\""`);
    return;
  }

  if (def.typeName === 'ZodDiscriminatedUnion') {
    const variants: string[] = [];
    const options = def.options!;
    for (let i = 0; i < options.length; i++) {
      const variantName = sanitize(`${name}_v${i}`);
      emit(options[i]!, variantName, rules, visited);
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
    'json-string ::= "\\"" char* "\\""',
    // Non-empty variant referenced when a ZodString has .min(N>=1). Emitted
    // unconditionally — the prelude already carries unused rules (e.g. `ws`
    // when no object is emitted) and the parser does not warn about them.
    'json-string-nonempty ::= "\\"" char+ "\\""',
    'char ::= [^"\\\\] | "\\\\" ["\\\\/bfnrt]',
    'json-number ::= "-"? ("0" | [1-9] [0-9]*) ("." [0-9]+)? ([eE] [-+]? [0-9]+)?',
  ].join('\n');
}

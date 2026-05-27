import type { MergeStrategy } from '@shared/families';

const JACCARD_THRESHOLD = 0.7;

function trigrams(text: string): Set<string> {
  const tg = new Set<string>();
  const t = text.toLowerCase().normalize('NFKC').trim();
  for (let i = 0; i <= t.length - 3; i++) tg.add(t.slice(i, i + 3));
  return tg;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

function dedupByText<T>(items: T[], textFn: (t: T) => string): T[] {
  const seen: { item: T; tg: Set<string> }[] = [];
  for (const it of items) {
    const tg = trigrams(textFn(it));
    let dup = false;
    for (const existing of seen) {
      if (jaccard(tg, existing.tg) > JACCARD_THRESHOLD) {
        dup = true;
        break;
      }
    }
    if (!dup) seen.push({ item: it, tg });
  }
  return seen.map(x => x.item);
}

function pickLongest(values: unknown[]): unknown {
  let best: unknown = undefined;
  let bestLen = -1;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    if (v.length > bestLen) { best = v; bestLen = v.length; }
  }
  return best ?? values.find(v => v !== undefined);
}

function concatArrays(partials: Array<Record<string, unknown>>, key: string): unknown[] {
  return partials.flatMap(p => Array.isArray(p[key]) ? (p[key] as unknown[]) : []);
}

function sortMaybe<T>(arr: T[], sortByTs: boolean | undefined): T[] {
  if (!sortByTs) return arr;
  return arr.slice().sort((a, b) => {
    const at = (a as { ts?: number } | null)?.ts;
    const bt = (b as { ts?: number } | null)?.ts;
    return (typeof at === 'number' && typeof bt === 'number') ? at - bt : 0;
  });
}

function dedupArrayByTextField(items: unknown[]): unknown[] {
  // Heuristic: dedup by the first available string field on each item
  // (text > term > expression > heading). Items without any string field
  // are kept unique by reference (no dedup).
  return dedupByText(items, (it) => {
    const o = it as Record<string, unknown> | null;
    if (typeof o?.text === 'string') return o.text;
    if (typeof o?.term === 'string') return o.term;
    if (typeof o?.expression === 'string') return o.expression;
    if (typeof o?.heading === 'string') return o.heading;
    return JSON.stringify(it);
  });
}

function guessFieldPolicy(
  key: string,
  partials: Array<Record<string, unknown>>,
  strategy: MergeStrategy,
): 'longest' | 'first' | 'concat-only' | 'concat-dedup' | 'merge-llm' | 'custom' {
  const anyValue = partials.map(p => p[key]).find(v => v !== undefined);
  if (Array.isArray(anyValue)) return strategy.arrayPolicy;
  // scalarPolicy 'merge-llm' is a no-op in deterministic merge (LLM call
  // happens outside via a separate orchestrator branch); fall back to longest.
  return strategy.scalarPolicy === 'merge-llm' ? 'longest' : strategy.scalarPolicy;
}

export function deterministicMerge<T extends Record<string, unknown>>(
  partials: Array<Partial<T>>,
  strategy: MergeStrategy,
): T {
  const result: Record<string, unknown> = {};
  const allKeys = new Set<string>();
  for (const p of partials) for (const k of Object.keys(p)) allKeys.add(k);

  for (const key of allKeys) {
    const override = strategy.fieldOverrides?.[key];
    const policy = override?.policy ?? guessFieldPolicy(key, partials as Array<Record<string, unknown>>, strategy);

    if (policy === 'longest') {
      result[key] = pickLongest(partials.map(p => p[key]));
    } else if (policy === 'first') {
      result[key] = partials.find(p => p[key] !== undefined)?.[key];
    } else if (policy === 'concat-only') {
      result[key] = sortMaybe(concatArrays(partials as Array<Record<string, unknown>>, key), strategy.sortByTs);
    } else if (policy === 'concat-dedup') {
      const concat = concatArrays(partials as Array<Record<string, unknown>>, key);
      result[key] = sortMaybe(dedupArrayByTextField(concat), strategy.sortByTs);
    } else if (policy === 'custom') {
      result[key] = override!.handler!(partials.map(p => p[key]));
    } else if (policy === 'merge-llm') {
      // No-op for deterministic merge — orchestrator's merge-LLM branch handles it.
      // Fallback to first non-undefined to keep the field present.
      result[key] = partials.find(p => p[key] !== undefined)?.[key];
    }
  }

  return result as T;
}

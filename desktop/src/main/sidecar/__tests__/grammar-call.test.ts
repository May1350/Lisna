import { describe, it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import {
  callWithGrammar,
  findEscapeLiteralInStrings,
  sanitizeEscapeLiteralsInStrings,
  makeSidecarGenerator,
  makeGrammarSidecar,
  type LlmGenerator,
} from '../grammar-call';
import { SidecarClient } from '../client';

const SimpleSchema = z.object({ name: z.string(), n: z.number() });

describe('callWithGrammar — happy path', () => {
  it('returns success with attemptsUsed=1 when first attempt parses+validates', async () => {
    const generator: LlmGenerator = vi.fn(async ({ seed }) => ({
      text: JSON.stringify({ name: 'ok', n: 7 }),
      seed,
    }));
    const out = await callWithGrammar({
      prompt: 'gen',
      schema: SimpleSchema,
      grammar: '<grammar-stub>',
      baseSeed: 1000,
      temperature: 0.6,
      maxAttempts: 3,
      maxTokens: 1024,
      generator,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.attemptsUsed).toBe(1);
      expect(out.attempts).toHaveLength(1);
      expect(out.value).toEqual({ name: 'ok', n: 7 });
      expect(out.attempts[0]!.seed).toBe(1000);
      expect(out.attempts[0]!.ok).toBe(true);
      expect(typeof out.attempts[0]!.latencyMs).toBe('number');
    }
    expect(generator).toHaveBeenCalledTimes(1);
  });
});

describe('callWithGrammar — surfaces seed + latencyMs per attempt', () => {
  it('exposes seed/latencyMs/reason on each attempt for Plan 7 eval consumption', async () => {
    const generator: LlmGenerator = vi.fn(async ({ seed }) => ({
      text: JSON.stringify({ name: 's', n: 1 }),
      seed,
    }));
    const out = await callWithGrammar({
      prompt: 'p',
      schema: SimpleSchema,
      grammar: 'g',
      baseSeed: 2000,
      temperature: 0.4,
      maxAttempts: 3,
      maxTokens: 512,
      generator,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      const a = out.attempts[0]!;
      expect(a).toMatchObject({ attempt: 1, seed: 2000, ok: true });
      expect(a.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('callWithGrammar — retry on JSON.parse failure', () => {
  it('records sidecar decode stats (tokensOut/genMs) on the attempt when present', async () => {
    const generator: LlmGenerator = vi.fn(async ({ seed }) => ({
      text: JSON.stringify({ name: 'ok', n: 7 }),
      seed,
      stats: { tokensOut: 1234, genMs: 60000 },
    }));
    const out = await callWithGrammar({
      prompt: 'gen',
      schema: SimpleSchema,
      grammar: '<grammar-stub>',
      baseSeed: 1000,
      temperature: 0.6,
      maxAttempts: 1,
      maxTokens: 1024,
      generator,
    });
    expect(out.ok).toBe(true);
    expect(out.attempts[0]!.tokensOut).toBe(1234);
    expect(out.attempts[0]!.genMs).toBe(60000);
  });

  it('attempt stats stay undefined when the generator reports none (older binary)', async () => {
    const generator: LlmGenerator = vi.fn(async ({ seed }) => ({
      text: JSON.stringify({ name: 'ok', n: 7 }),
      seed,
    }));
    const out = await callWithGrammar({
      prompt: 'gen',
      schema: SimpleSchema,
      grammar: '<grammar-stub>',
      baseSeed: 1000,
      temperature: 0.6,
      maxAttempts: 1,
      maxTokens: 1024,
      generator,
    });
    expect(out.attempts[0]!.tokensOut).toBeUndefined();
    expect(out.attempts[0]!.genMs).toBeUndefined();
  });

  it('retries when first attempt emits non-JSON, succeeds on attempt 2', async () => {
    let calls = 0;
    const generator: LlmGenerator = vi.fn(async ({ seed }) => {
      calls += 1;
      const text = calls === 1 ? '{"name": "ok", "n":' : JSON.stringify({ name: 'ok', n: 7 });
      return { text, seed };
    });
    const out = await callWithGrammar({
      prompt: 'p',
      schema: SimpleSchema,
      grammar: 'g',
      baseSeed: 1000,
      temperature: 0.6,
      maxAttempts: 3,
      maxTokens: 1024,
      generator,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.attemptsUsed).toBe(2);
      expect(out.attempts).toHaveLength(2);
      expect(out.attempts[0]!.ok).toBe(false);
      expect(out.attempts[0]!.reason).toMatch(/JSON|Unexpected/i);
      expect(out.attempts[1]!.ok).toBe(true);
      expect(out.attempts[0]!.seed).toBe(1000);
      expect(out.attempts[1]!.seed).toBe(1100);                  // fresh seed
    }
  });
});

describe('callWithGrammar — retry on Zod failure', () => {
  it('retries when first attempt fails schema validation', async () => {
    let calls = 0;
    const generator: LlmGenerator = vi.fn(async ({ seed }) => {
      calls += 1;
      const text =
        calls === 1
          ? JSON.stringify({ name: 'ok', n: 'not-a-number' })       // wrong type
          : JSON.stringify({ name: 'ok', n: 42 });
      return { text, seed };
    });
    const out = await callWithGrammar({
      prompt: 'p',
      schema: SimpleSchema,
      grammar: 'g',
      baseSeed: 500,
      temperature: 0.5,
      maxAttempts: 3,
      maxTokens: 1024,
      generator,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.attemptsUsed).toBe(2);
      expect(out.attempts[0]!.ok).toBe(false);
      // ZodError messages mention "Expected" / "number"
      expect(out.attempts[0]!.reason).toBeDefined();
      expect(out.attempts[1]!.seed).toBe(600);                      // 500 + 100
    }
  });
});

describe('callWithGrammar — exhaustion', () => {
  it('returns ok=false with full attempts log when maxAttempts exhausted', async () => {
    const generator: LlmGenerator = vi.fn(async ({ seed }) => ({
      text: 'not even close to JSON',
      seed,
    }));
    const out = await callWithGrammar({
      prompt: 'p',
      schema: SimpleSchema,
      grammar: 'g',
      baseSeed: 100,
      temperature: 0.6,
      maxAttempts: 3,
      maxTokens: 256,
      generator,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.attempts).toHaveLength(3);
      expect(out.attempts[0]!.seed).toBe(100);
      expect(out.attempts[1]!.seed).toBe(200);
      expect(out.attempts[2]!.seed).toBe(300);
      expect(out.finalReason).toBe(out.attempts[2]!.reason);
      expect(out.finalReason).toMatch(/JSON|Unexpected/i);
    }
    expect(generator).toHaveBeenCalledTimes(3);
  });
});

describe('callWithGrammar — maxAttempts = 1 is allowed', () => {
  it('no retry when maxAttempts=1 and first attempt fails', async () => {
    const generator: LlmGenerator = vi.fn(async ({ seed }) => ({
      text: '{bad',
      seed,
    }));
    const out = await callWithGrammar({
      prompt: 'p',
      schema: SimpleSchema,
      grammar: 'g',
      baseSeed: 0,
      temperature: 0.6,
      maxAttempts: 1,
      maxTokens: 256,
      generator,
    });
    expect(out.ok).toBe(false);
    expect(generator).toHaveBeenCalledTimes(1);
  });
});

describe('callWithGrammar — generator throw is captured as failed attempt', () => {
  it('treats generator rejection as failure + retries', async () => {
    let calls = 0;
    const generator: LlmGenerator = vi.fn(async ({ seed }) => {
      calls += 1;
      if (calls === 1) throw new Error('sidecar transient: ECONNRESET');
      return { text: JSON.stringify({ name: 'ok', n: 1 }), seed };
    });
    const out = await callWithGrammar({
      prompt: 'p',
      schema: SimpleSchema,
      grammar: 'g',
      baseSeed: 0,
      temperature: 0.6,
      maxAttempts: 3,
      maxTokens: 256,
      generator,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.attempts[0]!.ok).toBe(false);
      expect(out.attempts[0]!.reason).toMatch(/ECONNRESET/);
    }
  });
});

describe('findEscapeLiteralInStrings (helper)', () => {
  it('returns null for clean JA prose', () => {
    expect(findEscapeLiteralInStrings({
      heading: '【要点】',
      summary: '今日は就職活動について話しました。',
      items: ['新しい技術', 'AI機械学習'],
    })).toBeNull();
  });

  it('finds any backslash in a string slot (the union detector — covers both observed shapes)', () => {
    // Source `'\\hit'` parses to runtime `\hit` (1 backslash + "hit").
    // After JSON.parse on real model output, founder's `\u4eca` shape and this-
    // run's `\'` shape both decode to JS strings containing at least one
    // backslash — the walker only needs to find any backslash.
    const r = findEscapeLiteralInStrings({
      sections: [{ heading: '【要点】', body: 'before \\hit after' }],
    });
    expect(r).not.toBeNull();
    expect(r!.path).toBe('$.sections[0].body');
    expect(r!.sample).toContain('\\hit');
  });

  it('walks arrays + nested objects in document order, returns FIRST match', () => {
    const r = findEscapeLiteralInStrings({
      a: 'clean',
      b: ['clean', { c: 'still clean', d: 'first \\hit' }, 'second \\hit'],
    });
    expect(r!.path).toBe('$.b[1].d');
  });
});

describe('sanitizeEscapeLiteralsInStrings (helper)', () => {
  it('returns the value unchanged with empty slots[] for clean JA prose', () => {
    const input = {
      heading: '【要点】',
      summary: '今日は就職活動について話しました。',
      items: ['新しい技術', 'AI機械学習'],
    };
    const r = sanitizeEscapeLiteralsInStrings(input);
    expect(r.value).toEqual(input);
    expect(r.sanitizedSlots).toEqual([]);
  });

  it('decodes `\\uXXXX` literal sequences back to the CJK codepoint they encode', () => {
    // Source `'\\u4eca\\u306e'` parses to runtime `今の` — 12 ASCII
    // chars, the decoded form of the founder-reported `\u…` shape.
    const r = sanitizeEscapeLiteralsInStrings({
      sections: [{ heading: '\\u4eca\\u306e' }],
    });
    expect(r.value).toEqual({ sections: [{ heading: '今の' }] });
    expect(r.sanitizedSlots).toEqual(['$.sections[0].heading']);
  });

  it("strips this-run's `\\'<NL>...<NL>\\'` Python-source-LOOKING wrapping", () => {
    // Source `"\\'\\n就職活動\\'\\n"` parses to runtime
    // `\'<NL>就職活動\'<NL>` — backslash + apostrophe + newline + JA + …
    const r = sanitizeEscapeLiteralsInStrings({
      sections: [{ key_terms: [{ term: "\\'\n就職活動\\'\n" }] }],
    });
    expect(r.value).toEqual({
      sections: [{ key_terms: [{ term: '就職活動' }] }],
    });
    expect(r.sanitizedSlots).toEqual(['$.sections[0].key_terms[0].term']);
  });

  it('shape-agnostic: handles BOTH the founder shape AND this-run shape in the same value (reviewer contract)', () => {
    const r = sanitizeEscapeLiteralsInStrings({
      a: '\\u4eca\\u306e',       // founder shape
      b: "\\'\n新しい技術\\'\n",  // this-run shape
      c: 'clean prose',
    });
    expect(r.value).toEqual({
      a: '今の',
      b: '新しい技術',
      c: 'clean prose',
    });
    expect(r.sanitizedSlots).toEqual(['$.a', '$.b']);
  });

  it('does NOT touch non-string leaves (numbers, booleans, null)', () => {
    const input = { n: 42, b: true, x: null, s: 'clean' };
    const r = sanitizeEscapeLiteralsInStrings(input);
    expect(r.value).toEqual(input);
    expect(r.sanitizedSlots).toEqual([]);
  });
});

describe('LaTeX preservation — 2026-06-11 production false positive', () => {
  // Founder's 13-min JA finance lecture: the model legitimately wrote ROE as
  // LaTeX in a formula slot (formula promptHint says "LaTeX-style fine"), and
  // the all-backslash nuke rendered it as `frac{text{利益}}{text{資本}}`
  // (main.log `[finalize:lecture] sanitized=2`, 2026-06-11 11:04:06).
  const ROE_LATEX = 'ROE = \\frac{\\text{利益}}{\\text{資本}}';

  it('sanitize preserves the exact production LaTeX expression unchanged', () => {
    const input = {
      sections: [{ extras: [{ type: 'formula', expression: ROE_LATEX }] }],
    };
    const r = sanitizeEscapeLiteralsInStrings(input);
    expect(r.value).toEqual(input);
    expect(r.sanitizedSlots).toEqual([]);
  });

  it('final invariant does NOT flag allowlisted LaTeX (a hit would burn every retry on legit output)', () => {
    expect(findEscapeLiteralInStrings({ expression: ROE_LATEX })).toBeNull();
  });

  it('preserves common math commands beyond the production pair', () => {
    const s = '\\sqrt{2} \\times \\pi \\cdot \\alpha \\leq \\sum x_i';
    const r = sanitizeEscapeLiteralsInStrings({ expression: s });
    expect(r.value).toEqual({ expression: s });
    expect(r.sanitizedSlots).toEqual([]);
  });

  it('still nukes mode-collapse junk in the SAME string while keeping LaTeX', () => {
    const r = sanitizeEscapeLiteralsInStrings({
      expression: "\\'\n\\u4eca\\u306eROE = \\frac{\\text{利益}}{\\text{資本}}",
    });
    expect(r.value).toEqual({
      expression: '今のROE = \\frac{\\text{利益}}{\\text{資本}}',
    });
    expect(r.sanitizedSlots).toEqual(['$.expression']);
  });

  it('non-allowlisted backslash junk is still flagged by the final invariant', () => {
    // `\hit` is not a LaTeX command — the union detector must keep firing.
    const r = findEscapeLiteralInStrings({ body: 'before \\hit after' });
    expect(r).not.toBeNull();
    expect(r!.path).toBe('$.body');
  });

  it('end-to-end: callWithGrammar passes LaTeX through untouched on attempt 1', async () => {
    // Raw model text is properly JSON-escaped LaTeX (`\\frac` in the wire
    // bytes) — JSON.parse yields runtime `\frac…`, which must survive.
    const generator: LlmGenerator = vi.fn(async ({ seed }) => ({
      text: '{"name":"ROE = \\\\frac{\\\\text{利益}}{\\\\text{資本}}","n":1}',
      seed,
    }));
    const out = await callWithGrammar({
      prompt: 'p',
      schema: SimpleSchema,
      grammar: 'g',
      baseSeed: 5000,
      temperature: 0.4,
      maxAttempts: 3,
      maxTokens: 1024,
      generator,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.attemptsUsed).toBe(1);
      expect(out.attempts[0]!.sanitizedSlots).toBeUndefined();
      expect(out.value).toEqual({ name: ROE_LATEX, n: 1 });
    }
  });
});

describe('callWithGrammar — sanitize recovers in same attempt (no retry)', () => {
  it('sanitizes the founder shape on attempt 1, records sanitizedSlots, ok=true', async () => {
    const generator: LlmGenerator = vi.fn(async ({ seed }) => ({
      // Raw text contains JSON-syntax `\\u4eca` → JSON.parse decodes to
      // runtime `今` (6 chars). Sanitize stage 1 decodes this back to `今`.
      text: '{"name":"\\\\u4eca\\\\u306e","n":1}',
      seed,
    }));
    const out = await callWithGrammar({
      prompt: 'p',
      schema: SimpleSchema,
      grammar: 'g',
      baseSeed: 5000,
      temperature: 0.4,
      maxAttempts: 3,
      maxTokens: 1024,
      generator,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.attemptsUsed).toBe(1);                      // NO retry
      expect(out.attempts[0]!.ok).toBe(true);
      expect(out.attempts[0]!.sanitizedSlots).toEqual(['$.name']);
      expect(out.value).toEqual({ name: '今の', n: 1 });
    }
    expect(generator).toHaveBeenCalledTimes(1);
  });
});

describe('makeSidecarGenerator', () => {
  it('translates wrapper opts → SidecarClient.generate call with grammar attached', async () => {
    // Mock SidecarClient surface — only `generate` matters for the factory.
    const fakeClient = {
      generateWithGrammar: vi.fn(async (req: {
        prompt: string;
        grammar: string;
        seed: number;
        temperature: number;
        maxTokens: number;
      }) => ({ text: JSON.stringify({ name: 'x', n: 1 }), seed: req.seed })),
    };
    const generator = makeSidecarGenerator(fakeClient as unknown as {
      generateWithGrammar: (req: {
        prompt: string;
        grammar: string;
        seed: number;
        temperature: number;
        maxTokens: number;
      }) => Promise<{ text: string; seed: number }>;
    });
    const r = await generator({
      prompt: 'P',
      grammar: 'G',
      seed: 42,
      temperature: 0.5,
      maxTokens: 100,
    });
    expect(r.text).toContain('"name":"x"');
    expect(r.seed).toBe(42);
    expect(fakeClient.generateWithGrammar).toHaveBeenCalledWith({
      prompt: 'P',
      grammar: 'G',
      seed: 42,
      temperature: 0.5,
      maxTokens: 100,
    });
  });
});

describe('makeGrammarSidecar.generateWithGrammar (against /bin/cat)', () => {
  it('sends grammar+seed as a single user message and accumulates tokens into {text, seed}', async () => {
    const proc = spawn('cat', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      const client = new SidecarClient(proc);
      const sidecar = makeGrammarSidecar(client);
      let sent: Record<string, unknown> | null = null;
      client.onRawLine((line) => {
        let obj: Record<string, unknown>;
        try { obj = JSON.parse(line) as Record<string, unknown>; } catch { return; }
        if (obj.type !== 'generate') return;   // ignore cat's echo of our token/done lines
        sent = obj;
        proc.stdin!.write(JSON.stringify({ id: obj.id, type: 'token', token: '{"a":' }) + '\n');
        proc.stdin!.write(JSON.stringify({ id: obj.id, type: 'token', token: '1}' }) + '\n');
        proc.stdin!.write(JSON.stringify({ id: obj.id, type: 'done' }) + '\n');
      });
      const out = await sidecar.generateWithGrammar({
        prompt: 'P', grammar: 'root ::= "{"', seed: 4242, temperature: 0.4, maxTokens: 256,
      });
      expect(out).toEqual({ text: '{"a":1}', seed: 4242 });
      expect(sent).not.toBeNull();
      expect(sent!.messages).toEqual([{ role: 'user', content: 'P' }]);
      expect(sent!.grammar).toBe('root ::= "{"');
      expect(sent!.seed).toBe(4242);
      expect(sent!.maxTokens).toBe(256);
    } finally {
      proc.kill('SIGKILL');
    }
  });
});

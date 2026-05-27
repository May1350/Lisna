import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  callWithGrammar,
  makeSidecarGenerator,
  type LlmGenerator,
} from '../grammar-call';

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

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  callWithGrammar,
  type LlmGenerator,
  type GrammarCallSuccess,
  type GrammarCallFailure,
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
      expect(out.attempts[0].seed).toBe(1000);
      expect(out.attempts[0].ok).toBe(true);
      expect(typeof out.attempts[0].latencyMs).toBe('number');
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
      const a = out.attempts[0];
      expect(a).toMatchObject({ attempt: 1, seed: 2000, ok: true });
      expect(a.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});

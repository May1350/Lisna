import { describe, it, expect } from 'vitest';
import { buildPass1Prompts, buildPass2Prompts, PASS1_EMPHASIS } from '../two-pass-prompts';

describe('buildPass1Prompts', () => {
  it('produces a JA-native free-prose system + a transcript-bearing user (ja)', () => {
    const { system, user } = buildPass1Prompts('interview', { chunkIndex: 0, totalChunks: 3, transcript: '[0:01] [話者0] こんにちは' }, 'ja');
    expect(system).toContain('日本語');
    expect(system).toContain('JSON');                       // explicit "no JSON" instruction present
    expect(system).toContain(PASS1_EMPHASIS.interview);
    expect(user).toContain('こんにちは');                    // transcript embedded
    expect(user).toContain('1');                            // chunk 1 of 3
  });
  it('emphasis differs per family', () => {
    expect(PASS1_EMPHASIS.lecture).not.toBe(PASS1_EMPHASIS.interview);
    expect(buildPass1Prompts('lecture', { chunkIndex: 0, totalChunks: 1, transcript: 'x' }, 'ja').system)
      .toContain(PASS1_EMPHASIS.lecture);
  });
  it('non-ja swaps the language word', () => {
    expect(buildPass1Prompts('meeting', { chunkIndex: 0, totalChunks: 1, transcript: 'x' }, 'en').system).toContain('English');
  });
});

describe('buildPass2Prompts', () => {
  it('instructs structure-only, no new info, concise title (ja)', () => {
    const { system, userPrefix } = buildPass2Prompts('ja');
    expect(system).toContain('日本語');
    expect(system).toMatch(/title/i);
    expect(userPrefix.length).toBeGreaterThan(0);
  });
});

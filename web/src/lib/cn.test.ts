import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins class strings', () => {
    expect(cn('a', 'b')).toBe('a b');
  });
  it('merges conflicting tailwind classes (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
  it('handles conditional values', () => {
    expect(cn('a', false && 'b', null, undefined, 'c')).toBe('a c');
  });
});

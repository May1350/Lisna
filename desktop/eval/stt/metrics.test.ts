import { it, expect } from 'vitest';
import { cer, wer } from './metrics';

it('cer is 0 for identical strings', () => { expect(cer('静電ポテンシャル', '静電ポテンシャル')).toBe(0); });
it('cer counts one substitution over reference length', () => { expect(cer('abc', 'abd')).toBeCloseTo(1 / 3, 6); });
it('cer counts an insertion', () => { expect(cer('abc', 'abxc')).toBeCloseTo(1 / 3, 6); });
it('cer of empty hyp against non-empty ref is 1', () => { expect(cer('abc', '')).toBe(1); });
it('wer tokenizes on whitespace', () => { expect(wer('the quick brown fox', 'the quick green fox')).toBeCloseTo(1 / 4, 6); });

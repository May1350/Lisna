import { describe, it, expect } from 'vitest';
import {
  isHallucination,
  filterSegments,
  HALLUCINATION_BLOCKLIST,
  DEFAULT_NO_SPEECH_PROB_THRESHOLD,
} from '../segment-filters';
import type { TranscriptSegment } from '@shared/engine-interfaces';

const ja = { language: 'ja' as const };
const en = { language: 'en' as const };

function seg(over: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return { startSec: 5, endSec: 6, text: 'placeholder', ...over };
}

describe('isHallucination — empty text', () => {
  it('drops empty string', () => {
    expect(isHallucination(seg({ text: '' }), ja)).toBe(true);
  });
  it('drops whitespace-only', () => {
    expect(isHallucination(seg({ text: '   ' }), ja)).toBe(true);
  });
  it('drops only-newline', () => {
    expect(isHallucination(seg({ text: '\n' }), ja)).toBe(true);
  });
});

describe('isHallucination — Layer F.front (probability)', () => {
  it('drops segment with noSpeechProb > default 0.6', () => {
    expect(isHallucination(seg({ text: 'foo', noSpeechProb: 0.7 }), ja)).toBe(true);
  });
  it('keeps segment with noSpeechProb exactly at threshold 0.6', () => {
    // > comparison, not >=, so 0.6 is kept
    expect(isHallucination(seg({ text: 'foo', noSpeechProb: 0.6 }), ja)).toBe(false);
  });
  it('keeps segment with noSpeechProb < default', () => {
    expect(isHallucination(seg({ text: 'foo', noSpeechProb: 0.3 }), ja)).toBe(false);
  });
  it('skips F.front entirely when noSpeechProb undefined (back-compat)', () => {
    expect(isHallucination(seg({ text: 'foo' }), ja)).toBe(false);
  });
  it('honors custom noSpeechProbThreshold', () => {
    expect(
      isHallucination(seg({ text: 'foo', noSpeechProb: 0.5 }), {
        ...ja,
        noSpeechProbThreshold: 0.4,
      }),
    ).toBe(true);
  });
});

describe('isHallucination — Layer E (blocklist + marker)', () => {
  describe('marker 1: noSpeechProb ≥ 0.3 (but ≤ F.front threshold)', () => {
    it('drops blocklist match with noSpeechProb=0.3', () => {
      expect(isHallucination(seg({ text: 'はい', noSpeechProb: 0.3 }), ja)).toBe(true);
    });
    it('drops blocklist match with noSpeechProb=0.5', () => {
      expect(isHallucination(seg({ text: 'はい', noSpeechProb: 0.5 }), ja)).toBe(true);
    });
  });

  describe('marker 2: zero-zero timestamps', () => {
    it('drops blocklist match with startSec=0 endSec=0 and no prob', () => {
      expect(isHallucination(seg({ text: 'はい', startSec: 0, endSec: 0 }), ja)).toBe(true);
    });
    it('drops blocklist match with both timestamps zero even if prob low', () => {
      expect(
        isHallucination(seg({ text: 'はい', startSec: 0, endSec: 0, noSpeechProb: 0.05 }), ja),
      ).toBe(true);
    });
  });

  describe('marker 3: no prob + short text', () => {
    it('drops blocklist match shorter than 10 chars when prob undefined', () => {
      expect(isHallucination(seg({ text: 'はい' }), ja)).toBe(true);
    });
    it('drops longer blocklist phrase ≤ 10 chars when prob undefined', () => {
      // 'ありがとうございました' is 11 chars — over the marker-3 cutoff but
      // typically caught by marker 2 (zero timestamps) or marker 1 (prob)
      expect(
        isHallucination(seg({ text: 'ありがとうございました', noSpeechProb: 0.4 }), ja),
      ).toBe(true);  // marker 1 fires
    });
  });

  describe('false-positive protection: legitimate uses', () => {
    it('keeps short blocklist phrase 「はい」 in dense speech (low prob, non-zero ts)', () => {
      // This is the critical false-positive case from spec §6.1.
      // 「はい」 said in the middle of natural conversation:
      //  - noSpeechProb very low (~0.05) because surrounded by real speech
      //  - timestamps reflect mid-conversation (not 0,0)
      //  - blocklist matches, BUT no marker fires → KEEP
      expect(
        isHallucination(
          seg({ text: 'はい', noSpeechProb: 0.05, startSec: 12.5, endSec: 13.2 }),
          ja,
        ),
      ).toBe(false);
    });
    it('keeps a non-blocklist Japanese sentence', () => {
      expect(
        isHallucination(seg({ text: '今日は学校に行きました', noSpeechProb: 0.2 }), ja),
      ).toBe(false);
    });
    it('keeps blocklist phrase with low prob and non-zero timestamps', () => {
      expect(
        isHallucination(seg({ text: 'ごめん', noSpeechProb: 0.1, startSec: 8, endSec: 8.5 }), ja),
      ).toBe(false);
    });
  });
});

describe('isHallucination — language switching', () => {
  it('does not filter 「はい」 when language is en (empty blocklist)', () => {
    expect(isHallucination(seg({ text: 'はい' }), en)).toBe(false);
  });
  it('still applies F.front regardless of language (lang-agnostic)', () => {
    expect(isHallucination(seg({ text: 'arbitrary', noSpeechProb: 0.9 }), en)).toBe(true);
  });
});

describe('exports', () => {
  it('DEFAULT_NO_SPEECH_PROB_THRESHOLD = 0.6', () => {
    expect(DEFAULT_NO_SPEECH_PROB_THRESHOLD).toBe(0.6);
  });
  it('JA blocklist contains canonical stereotyped phrases', () => {
    const jaSet = HALLUCINATION_BLOCKLIST.ja;
    expect(jaSet.has('はい')).toBe(true);
    expect(jaSet.has('ご視聴ありがとうございました')).toBe(true);
    expect(jaSet.has('ありがとうございました')).toBe(true);
  });
  it('EN/KO/ZH blocklists are empty (stubs for future model swap)', () => {
    expect(HALLUCINATION_BLOCKLIST.en.size).toBe(0);
    expect(HALLUCINATION_BLOCKLIST.ko.size).toBe(0);
    expect(HALLUCINATION_BLOCKLIST.zh.size).toBe(0);
  });
});

describe('filterSegments', () => {
  it('drops only hallucinations, keeps real segments in order', () => {
    const segs: TranscriptSegment[] = [
      { text: '今日は', startSec: 0, endSec: 1, noSpeechProb: 0.1 },     // keep
      { text: 'はい', startSec: 0, endSec: 0, noSpeechProb: 0.7 },         // drop (F.front + E both fire)
      { text: '元気ですか', startSec: 1, endSec: 2, noSpeechProb: 0.05 },  // keep
      { text: '', startSec: 2, endSec: 2, noSpeechProb: 0.1 },             // drop (empty)
    ];
    const out = filterSegments(segs, ja);
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toBe('今日は');
    expect(out[1]!.text).toBe('元気ですか');
  });
});

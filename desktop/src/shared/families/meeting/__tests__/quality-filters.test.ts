import { describe, it, expect } from 'vitest';
import {
  stripSpeakerMarker,
  hasLeakedMarker,
  hasMixedScript,
  isPlaceholderAtom,
  isVerbatimSegmentCopy,
} from '../quality-filters';

// Strings taken verbatim from the real 2026-06-23 founder failure dump.
describe('stripSpeakerMarker', () => {
  it('strips a leading "[ts] [話者id]" marker the 3B echoed from the prompt', () => {
    expect(stripSpeakerMarker('[0] [話者0] はい、完成です!')).toBe('はい、完成です!');
    expect(stripSpeakerMarker('[581] [話者0] まだ作っていないところが')).toBe('まだ作っていないところが');
  });
  it('strips stray markers anywhere and collapses whitespace', () => {
    expect(stripSpeakerMarker('決定事項 [12] [話者3] 続き')).toBe('決定事項 続き');
  });
  it('leaves clean text untouched', () => {
    expect(stripSpeakerMarker('予算案を承認する')).toBe('予算案を承認する');
    expect(stripSpeakerMarker('  trim me  ')).toBe('trim me');
  });
});

describe('hasLeakedMarker', () => {
  it('flags surviving markers', () => {
    expect(hasLeakedMarker('[0] [話者0] はい')).toBe(true);
    expect(hasLeakedMarker('[42] something')).toBe(true);
    expect(hasLeakedMarker('[話者2] foo')).toBe(true);
  });
  it('does not flag clean text or normal brackets', () => {
    expect(hasLeakedMarker('予算案を承認')).toBe(false);
    expect(hasLeakedMarker('[重要] メモ')).toBe(false); // non-numeric, non-話者 bracket
  });
});

describe('hasMixedScript (DRY-evasion homoglyph garble)', () => {
  it('flags the real mutated action_items (hangul / arabic / cyrillic)', () => {
    expect(hasMixedScript('ビジョン、ミッ션、バリュールの解像度')).toBe(true); // 션 hangul
    expect(hasMixedScript('ビジョン、ミッيشن、バリュール')).toBe(true); // arabic
    expect(hasMixedScript('ビジョン、ミッшн、バリュール')).toBe(true); // cyrillic ш/н
    expect(hasMixedScript('壊れた�文字')).toBe(true); // replacement char
  });
  it('does NOT flag legitimate JA / EN / numbers / brands', () => {
    expect(hasMixedScript('ビジョン、ミッション、バリュール')).toBe(false); // clean katakana
    expect(hasMixedScript('プロプランを3,480円に値上げする')).toBe(false);
    expect(hasMixedScript('EYのIT監査、KGIを設定')).toBe(false); // ASCII latin brands
    expect(hasMixedScript('全角ＡＢＣ１２３も会議メモ')).toBe(false); // fullwidth latin/digits
  });
});

describe('isPlaceholderAtom (hallucinated meta-questions)', () => {
  it('flags the real placeholder questions/risks', () => {
    expect(isPlaceholderAtom('この会議で何が話されましたか?')).toBe(true);
    expect(isPlaceholderAtom('この会議の結果は何ですか?')).toBe(true);
    expect(isPlaceholderAtom('この会議でどのようなリスクが生じるか?')).toBe(true);
  });
  it('still flags when a marker is prepended', () => {
    expect(isPlaceholderAtom('[5] [話者0] この会議で何が話されましたか?')).toBe(true);
  });
  it('does NOT flag a real question that merely mentions 会議', () => {
    expect(isPlaceholderAtom('次回の会議はいつにしますか?')).toBe(false);
    expect(isPlaceholderAtom('予算は誰が承認しますか?')).toBe(false);
    expect(isPlaceholderAtom('この会議室の予約を延長すべきか?')).toBe(false); // "この会議室" not the meta-template
  });
});

describe('isVerbatimSegmentCopy (scoring only)', () => {
  const segs = ['はい、完成です!', 'めちゃくちゃ楽しみにしてるから', 'プロプランの価格を見直す'];
  it('flags an extracted "decision" that is a verbatim transcript segment', () => {
    expect(isVerbatimSegmentCopy('はい、完成です!', segs)).toBe(true);
    expect(isVerbatimSegmentCopy('[0] [話者0] はい、完成です!', segs)).toBe(true); // marker-tolerant
  });
  it('does not flag an abstracted decision not present verbatim', () => {
    expect(isVerbatimSegmentCopy('価格改定を決定', segs)).toBe(false);
  });
  it('ignores trivially short text', () => {
    expect(isVerbatimSegmentCopy('はい', ['はい'])).toBe(false);
  });
});

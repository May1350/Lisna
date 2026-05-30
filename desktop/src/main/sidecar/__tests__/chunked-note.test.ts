import { describe, it, expect } from 'vitest';
import {
  mergeChunkNotes,
  splitTextHalf,
  generateChunkedNote,
  generateChunkWithSubsplit,
  estimatePromptTokens,
} from '../chunked-note';
import type { Language, TranscriptSegment, ChatMessage } from '@shared/engine-interfaces';
import { buildJaNoteV1Prompt } from '../prompts/ja-note-v1';

describe('mergeChunkNotes', () => {
  it('returns the single note unchanged when given one chunk', () => {
    expect(mergeChunkNotes(['【要点】\n・あ'])).toBe('【要点】\n・あ');
  });

  it('groups bullets under one header across chunks (first-seen order)', () => {
    const merged = mergeChunkNotes([
      '【要点】\n・point1\n【決定事項】\n・dec1',
      '【要点】\n・point2',
    ]);
    expect(merged.match(/【要点】/g)).toHaveLength(1);
    expect(merged).toContain('・point1');
    expect(merged).toContain('・point2');
    expect(merged).toContain('【決定事項】');
    expect(merged).toContain('・dec1');
    expect(merged.indexOf('【要点】')).toBeLessThan(merged.indexOf('【決定事項】'));
  });

  it('raw-concatenates losslessly when NO chunk has a recognizable header', () => {
    const merged = mergeChunkNotes(['just prose A', 'just prose B']);
    expect(merged).toContain('just prose A');
    expect(merged).toContain('just prose B');
  });

  it('attaches preamble (lines before first header) to the first section', () => {
    const merged = mergeChunkNotes([
      'intro line\n【要点】\n・p1',
      '【要点】\n・p2',
    ]);
    expect(merged).toContain('intro line');
    expect(merged).toContain('・p1');
    expect(merged).toContain('・p2');
    expect(merged.match(/【要点】/g)).toHaveLength(1);
  });

  it('drops empty/whitespace chunk outputs', () => {
    expect(mergeChunkNotes(['', '   ', '【要点】\n・only'])).toBe('【要点】\n・only');
    expect(mergeChunkNotes(['', '  '])).toBe('');
  });
});

describe('splitTextHalf', () => {
  it('splits on sentence boundary near the middle', () => {
    expect(splitTextHalf('一文目。二文目。三文目。四文目。')).toEqual([
      '一文目。二文目。',
      '三文目。四文目。',
    ]);
  });

  it('falls back to char midpoint when there is no sentence boundary', () => {
    expect(splitTextHalf('abcdef')).toEqual(['abc', 'def']);
  });

  it('returns a single element for trivially short text', () => {
    expect(splitTextHalf('あ')).toEqual(['あ']);
  });
});

// ─── shared test helpers (single-pass / chunked / subsplit / regression) ───

// A buildPrompt whose content length tracks the transcript so estimateTokens
// reflects size: one short system line + the joined transcript text.
const testBuildPrompt = (_lang: Language, segs: TranscriptSegment[]): ChatMessage[] => [
  { role: 'system', content: 'sys' },
  { role: 'user', content: segs.map((s) => s.text).join('\n') },
];

// A fake streaming generate that records calls and returns a canned note.
function fakeGenerate(reply: (m: ChatMessage[]) => string) {
  const calls: ChatMessage[][] = [];
  const gen = async function* (m: ChatMessage[]): AsyncIterable<string> {
    calls.push(m);
    yield reply(m);
  };
  return { gen, calls };
}

const seg = (i: number, text: string): TranscriptSegment => ({
  startSec: i * 10,
  endSec: i * 10 + 10,
  text,
});

describe('generateChunkedNote — single pass', () => {
  it('does exactly ONE pass and returns raw output when under the threshold', async () => {
    const { gen, calls } = fakeGenerate(() => '【要点】\n・x');
    const out = await generateChunkedNote({
      segments: [seg(0, 'みじかい')],
      language: 'ja',
      buildPrompt: testBuildPrompt,
      generate: gen,
    });
    expect(calls).toHaveLength(1);
    expect(out).toBe('【要点】\n・x');
  });
});

describe('generateChunkedNote — chunked branch', () => {
  it('chunks an over-threshold transcript, generates per chunk, and merges', async () => {
    // ~60 segments × ~400 JA chars × 0.6 t/char ≈ 14400 est tokens > 10788 → chunked.
    const big = Array.from({ length: 60 }, (_, i) => seg(i, 'あ'.repeat(400)));
    let n = 0;
    const { gen, calls } = fakeGenerate(() => {
      n += 1;
      return `【要点】\n・point${n}`;
    });
    const out = await generateChunkedNote({
      segments: big,
      language: 'ja',
      buildPrompt: testBuildPrompt,
      generate: gen,
    });
    expect(calls.length).toBeGreaterThanOrEqual(2); // multiple chunks
    expect(out.match(/【要点】/g)).toHaveLength(1); // merged to one header
    expect(out).toContain('・point1');
    expect(out).toContain(`・point${calls.length}`); // every chunk's bullet survived
  });
});

describe('generateChunkWithSubsplit — reactive overflow backstop', () => {
  it('subsplits when a chunk returns empty, until halves fit', async () => {
    const seen: number[] = [];
    const runPass = async (segs: TranscriptSegment[]): Promise<string> => {
      seen.push(segs.length);
      return segs.length > 4 ? '' : `【要点】\n・${segs.length}seg`; // "overflow" if >4 segs
    };
    const eight = Array.from({ length: 8 }, (_, i) => seg(i, 'x'));
    const out = await generateChunkWithSubsplit(eight, runPass, 0);
    expect(seen).toEqual([8, 4, 4]); // 8 overflowed → split into 4 + 4, both fit
    expect(out).toContain('・4seg');
  });

  it('splits a single oversized segment by its text', async () => {
    const runPass = async (segs: TranscriptSegment[]): Promise<string> =>
      segs[0]!.text.length > 10 ? '' : `【要点】\n・${segs[0]!.text}`;
    const out = await generateChunkWithSubsplit(
      [seg(0, '一文目。二文目。三文目。四文目。')], // 16 chars > 10 → overflow
      runPass,
      0,
    );
    expect(out).toContain('一文目。二文目。');
    expect(out).toContain('三文目。四文目。');
  });

  it('falls back to raw transcript text at the depth cap (lossless, never empty)', async () => {
    const runPass = async (): Promise<string> => ''; // always "overflow"
    const out = await generateChunkWithSubsplit([seg(0, 'これは消えてはいけない本文')], runPass, 0);
    expect(out.trim().length).toBeGreaterThan(0); // never empty
    expect(out).toContain('[0.0s]'); // fell back to raw verbatim
    // lossless: stripping the [ts] markers + whitespace reconstructs the original text
    const reconstructed = out.replace(/\[\d+\.\d+s\]\s*/g, '').replace(/\s+/g, '');
    expect(reconstructed).toContain('これは消えてはいけない本文');
  });
});

describe('overflow regression — fail-first demonstration', () => {
  // Simulate the sidecar: empty output once the prompt exceeds the context.
  const SIM_CTX_EST = 12000;
  const simGenerate = async function* (m: ChatMessage[]): AsyncIterable<string> {
    if (estimatePromptTokens(m) > SIM_CTX_EST) {
      yield ''; // silent overflow — matches llama_engine.cpp:201 (break, emits nothing)
      return;
    }
    yield '【要点】\n・ok';
  };

  // ~80 segments × 400 JA chars → est ≈ 19200 tokens in a single pass (> SIM_CTX_EST).
  const big = Array.from({ length: 80 }, (_, i) => seg(i, 'あ'.repeat(400)));

  it('OLD single-pass strategy produces an EMPTY note (the bug)', async () => {
    let oldOut = '';
    for await (const tok of simGenerate(buildJaNoteV1Prompt('ja', big))) oldOut += tok;
    expect(oldOut.trim()).toBe(''); // empirical fail-first: today's path loses everything
  });

  it('NEW generateChunkedNote produces a COMPLETE note', async () => {
    const out = await generateChunkedNote({
      segments: big,
      language: 'ja',
      buildPrompt: buildJaNoteV1Prompt,
      generate: simGenerate,
    });
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).toContain('・ok');
  });
});

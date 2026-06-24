import { describe, it, expect } from 'vitest';
import { noteToMarkdown, transcriptToText } from './note-export';

// Shapes mirror the real family Zod schemas (note-schema/base ProvenanceSchema +
// SpeakerRefSchema): every leaf carries `from: 'transcript'|'inferred'`
// (provenance, NOT a speaker) and speakers are separate numeric refs
// (made_by/owner/asked_by/answered_by/raised_by/proposed_by/contributed_by/speakerRef).
const meetingNote = {
  schemaVersion: 2,
  family: 'meeting',
  title: 'Q3 全社会議',
  generatedAt: '2026-06-24T01:00:00.000Z',
  generatedBy: { model: 'llama-3.2-3b', promptVersion: 3 },
  language: 'ja',
  durationSec: 1692,
  validation_warnings: [],
  purpose: '四半期のKPIレビューと価格改定の決定。',
  executive_summary: 'MRRは目標を上回り、価格改定を決定した。',
  decisions: [
    { text: 'プロプランを3,480円へ値上げ', ts: 120, from: 'transcript', made_by: 1 },
    { text: 'ローンチ日を10月14日に確定', ts: 300, from: 'transcript' },
  ],
  next_steps: [{ text: '社内告知ドラフトを提出', due: '9月26日', ts: 1500, from: 'transcript', owner: 2 }],
  open_questions: [{ text: 'データリージョンは国内か', ts: 900, from: 'inferred' }],
  discussions: [
    { topic: '価格改定', ts_start: 60, ts_end: 400, summary: '競合より安すぎた。', key_points: ['17%値上げ', '6ヶ月据え置き'] },
  ],
};

describe('noteToMarkdown', () => {
  it('emits a H1 title and humanized section headings', () => {
    const md = noteToMarkdown(meetingNote);
    expect(md).toMatch(/^# Q3 全社会議/);
    expect(md).toContain('## Decisions');
    expect(md).toContain('## Next steps');
    expect(md).toContain('## Open questions');
  });

  it('renders array-item text as bullets, keeping numbers/proper-nouns verbatim', () => {
    const md = noteToMarkdown(meetingNote);
    expect(md).toContain('- プロプランを3,480円へ値上げ');
    expect(md).toContain('- ローンチ日を10月14日に確定');
  });

  it('renders prose string fields as paragraphs', () => {
    const md = noteToMarkdown(meetingNote);
    expect(md).toContain('## Executive summary');
    expect(md).toContain('MRRは目標を上回り、価格改定を決定した。');
  });

  it('NEVER leaks the provenance enum (`from`) into output', () => {
    const md = noteToMarkdown(meetingNote);
    expect(md).not.toContain('transcript');
    expect(md).not.toContain('inferred');
  });

  it('renders the real numeric speaker ref (made_by/owner), not `from`', () => {
    const md = noteToMarkdown(meetingNote);
    expect(md).toContain('話者1'); // decision made_by: 1
    expect(md).toContain('話者2'); // next_step owner: 2
  });

  it('marks inferred items with ※ (mirrors the on-screen marker)', () => {
    const md = noteToMarkdown(meetingNote);
    // the open_question is from:'inferred'
    const line = md.split('\n').find((l) => l.includes('データリージョンは国内か'));
    expect(line).toContain('※');
  });

  it('never leaks raw JSON / system header keys / [object Object]', () => {
    const md = noteToMarkdown(meetingNote);
    expect(md).not.toContain('schemaVersion');
    expect(md).not.toContain('generatedBy');
    expect(md).not.toContain('"text"');
    expect(md).not.toContain('[object Object]');
  });

  it('renders nested sub-items (discussion key_points) as indented bullets', () => {
    const md = noteToMarkdown(meetingNote);
    expect(md).toContain('17%値上げ');
    expect(md).toContain('6ヶ月据え置き');
  });

  it('renders interview qa_pairs (real shape) with both question and answer', () => {
    const md = noteToMarkdown({
      schemaVersion: 2, family: 'interview', title: 'T', generatedAt: '', language: 'ja',
      durationSec: 1, generatedBy: { model: 'm', promptVersion: 0 },
      subject_summary: '概要。',
      qa_pairs: [{ question: '採用方針は?', answer: '1名のみ即採用。', ts: 5, asked_by: 0, answered_by: 1, from: 'transcript' }],
    });
    expect(md).toContain('採用方針は?');
    expect(md).toContain('1名のみ即採用。');
  });

  it('renders lecture key_terms nested in sections[] (the dropped-content regression)', () => {
    const md = noteToMarkdown({
      schemaVersion: 2, family: 'lecture', title: 'T', generatedAt: '', language: 'ja',
      durationSec: 1, generatedBy: { model: 'm', promptVersion: 0 },
      sections: [{
        heading: '財務指標', ts: 0, summary: 'KPIの定義。', takeaway: 'NRRが最重要。',
        key_terms: [{ term: 'NRR', definition: '純収益維持率', ts: 1, from: 'transcript' }],
        examples: [], points: [],
      }],
    });
    expect(md).toContain('NRR');
    expect(md).toContain('純収益維持率');
    expect(md).toContain('NRRが最重要。'); // takeaway not dropped
  });

  it('renders brainstorm idea_clusters with nested idea text', () => {
    const md = noteToMarkdown({
      schemaVersion: 2, family: 'brainstorm', title: 'T', generatedAt: '', language: 'ja',
      durationSec: 1, generatedBy: { model: 'm', promptVersion: 0 },
      idea_clusters: [{ theme: 'オンボーディング', ideas: [{ id: 'x', text: 'チュートリアル動画を追加', contributed_by: 0, ts: 3, from: 'inferred' }] }],
    });
    expect(md).toContain('オンボーディング');
    expect(md).toContain('チュートリアル動画を追加');
  });

  it('passes a legacy markdown note through unchanged', () => {
    const legacy = { markdown: '# Already markdown\n\n- a\n- b', transcriptSegments: [] };
    expect(noteToMarkdown(legacy)).toBe('# Already markdown\n\n- a\n- b');
  });
});

describe('transcriptToText', () => {
  const segs = [
    { startSec: 0, text: 'はい、完成です!' },
    { startSec: 65, text: 'やりましょう!' },
  ];

  it('renders one [m:ss] text line per segment', () => {
    expect(transcriptToText(segs)).toBe('[0:00] はい、完成です!\n[1:05] やりましょう!');
  });

  it('omits timestamps when withTimestamps=false', () => {
    expect(transcriptToText(segs, { withTimestamps: false })).toBe('はい、完成です!\nやりましょう!');
  });
});

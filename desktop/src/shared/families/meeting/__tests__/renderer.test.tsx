/**
 * Tests for MeetingRenderer.
 *
 * SSR-rendering via react-dom/server so tests run in plain node — matches
 * the LectureRenderer test pattern (vitest config has no DOM env).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MeetingNote } from '../schema';
import { MeetingRenderer } from '../renderer';

function baseNote(overrides: Partial<MeetingNote> = {}): MeetingNote {
  return {
    schemaVersion: 1,
    family: 'meeting',
    title: '2026-Q3 ロードマップ会議',
    generatedAt: '2026-05-30T00:00:00Z',
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 1800,
    purpose: 'Q3優先順位の合意',
    executive_summary: '3つの主要機能の優先順位を合意した。',
    topic_arc: [
      { topic: '優先順位の検討', ts: 0, speakers_involved: [0, 1] },
      { topic: '懸念事項の整理', ts: 600, speakers_involved: [0] },
    ],
    discussions: [
      {
        topic: '優先順位',
        ts_start: 0,
        ts_end: 600,
        summary: '機能A、B、Cの順番を議論。',
        key_points: ['Aは顧客要望', 'Bは技術的負債', 'Cは新規市場'],
      },
    ],
    decisions: [
      { text: '機能Aを最優先に', ts: 540, made_by: 1, from: 'transcript' },
    ],
    open_questions: [
      { text: 'リソース配分はどうするか', ts: 1200, from: 'inferred' },
    ],
    ...overrides,
  };
}

describe('MeetingRenderer', () => {
  it('renders title, purpose, and executive_summary in header section', () => {
    const html = renderToStaticMarkup(<MeetingRenderer note={baseNote()} />);
    expect(html).toContain('2026-Q3 ロードマップ会議');
    expect(html).toContain('Q3優先順位の合意');
    expect(html).toContain('3つの主要機能の優先順位を合意した');
  });

  it('renders atmosphere only when present', () => {
    const without = renderToStaticMarkup(<MeetingRenderer note={baseNote()} />);
    expect(without).not.toContain('atmosphere');
    const withAtm = renderToStaticMarkup(
      <MeetingRenderer note={baseNote({ atmosphere: 'collaborative' })} />,
    );
    expect(withAtm).toContain('class="atmosphere"');
    expect(withAtm).toContain('collaborative');
  });

  it('emits ※ inferred marker on provenance="inferred" leaves only', () => {
    const html = renderToStaticMarkup(<MeetingRenderer note={baseNote() } />);
    // 1 inferred (open_question), 1 transcript (decision) → exactly 1 marker.
    const markerCount = (html.match(/provenance-inferred/g) ?? []).length;
    expect(markerCount).toBe(1);
  });

  it('hides speakerRef tag when ref is 0 (single-speaker alpha)', () => {
    const html = renderToStaticMarkup(
      <MeetingRenderer
        note={baseNote({
          decisions: [
            { text: 'X', ts: 10, made_by: 0, from: 'transcript' },
          ],
        })}
      />,
    );
    // 話者0 should NOT appear when made_by===0
    expect(html).not.toContain('話者0');
  });

  it('shows speakerRef tag when ref > 0 (multi-speaker case)', () => {
    const html = renderToStaticMarkup(<MeetingRenderer note={baseNote()} />);
    // baseNote has decisions[0].made_by=1 → 話者1 appears
    expect(html).toContain('話者1');
    expect(html).toContain('決定者');
  });

  it('omits optional sections entirely when undefined or empty', () => {
    const html = renderToStaticMarkup(<MeetingRenderer note={baseNote()} />);
    // baseNote has no agenda/participants/proposals/risks/conclusions/next_steps
    expect(html).not.toContain('class="agenda"');
    expect(html).not.toContain('class="participants"');
    expect(html).not.toContain('class="proposals"');
    expect(html).not.toContain('class="risks"');
    expect(html).not.toContain('class="conclusions"');
    expect(html).not.toContain('class="next-steps"');
  });

  it('renders proposals with outcome class when provided', () => {
    const html = renderToStaticMarkup(
      <MeetingRenderer
        note={baseNote({
          proposals: [
            { text: '採用しよう', ts: 100, outcome: 'accepted', from: 'transcript' },
            { text: '見送る', ts: 200, outcome: 'rejected', from: 'inferred' },
          ],
        })}
      />,
    );
    expect(html).toContain('outcome-accepted');
    expect(html).toContain('outcome-rejected');
    expect(html).toContain('採用しよう');
    expect(html).toContain('見送る');
    // The accepted has from=transcript, rejected has from=inferred → exactly 2 markers in this run (1 open_question + 1 rejected proposal)
    expect((html.match(/provenance-inferred/g) ?? []).length).toBe(2);
  });

  it('renders next_steps with owner and due when provided', () => {
    const html = renderToStaticMarkup(
      <MeetingRenderer
        note={baseNote({
          next_steps: [
            { text: '設計書を準備', owner: 2, due: '2026-06-15', ts: 1700, from: 'transcript' },
          ],
        })}
      />,
    );
    expect(html).toContain('設計書を準備');
    expect(html).toContain('担当');
    expect(html).toContain('話者2');
    expect(html).toContain('期限: 2026-06-15');
  });

  it('renders ts-anchor in mm:ss format on decisions + topics', () => {
    const html = renderToStaticMarkup(<MeetingRenderer note={baseNote()} />);
    // topic_arc[0].ts=0 → 00:00; decisions[0].ts=540 → 09:00
    expect(html).toContain('[00:00]');
    expect(html).toContain('[09:00]');
    // open_questions[0].ts=1200 → 20:00
    expect(html).toContain('[20:00]');
  });

  it('renders gracefully without crashing on minimum-valid note', () => {
    // Same shape session-finalize.test.ts uses for the minimal valid meeting:
    // no decisions, no open_questions, etc.
    const minimal: MeetingNote = {
      schemaVersion: 1,
      family: 'meeting',
      title: '空ミーティング',
      generatedAt: '2026-05-30T00:00:00Z',
      generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
      language: 'ja',
      durationSec: 60,
      purpose: '進捗確認',
      executive_summary: '報告のみ。',
      topic_arc: [{ topic: '進捗', ts: 0, speakers_involved: [] }],
      discussions: [{ topic: '進捗', ts_start: 0, summary: '報告がありました。' }],
      decisions: [],
      open_questions: [],
    };
    expect(() => renderToStaticMarkup(<MeetingRenderer note={minimal} />)).not.toThrow();
  });

  it('renders validation_warnings aside when present', () => {
    const html = renderToStaticMarkup(
      <MeetingRenderer note={baseNote({ validation_warnings: ['SINGLE_SPEAKER_WARNING'] })} />,
    );
    expect(html).toContain('validation-warnings');
    expect(html).toContain('SINGLE_SPEAKER_WARNING');
  });
});

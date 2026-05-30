/**
 * Tests for InterviewRenderer.
 *
 * SSR-rendering via react-dom/server so tests run in plain node — mirrors
 * the LectureRenderer + MeetingRenderer test pattern (vitest config has
 * no DOM env).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InterviewNote } from '../schema';
import { InterviewRenderer } from '../renderer';

function baseNote(overrides: Partial<InterviewNote> = {}): InterviewNote {
  return {
    schemaVersion: 1,
    family: 'interview',
    title: '創業者インタビュー',
    generatedAt: '2026-05-31T00:00:00Z',
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 1800,
    purpose: '創業背景の聞き取り',
    subject_summary: '創業者は5年前に最初のプロダクトを立ち上げた。',
    qa_pairs: [
      {
        question: 'なぜ起業しましたか?',
        answer: '既存ツールに不満があったからです。',
        ts: 30,
        asked_by: 1,
        answered_by: 2,
        themes: ['動機'],
        from: 'transcript',
      },
      {
        question: '最初の困難は何でしたか?',
        answer: '資金調達でした。',
        ts: 540,
        asked_by: 1,
        answered_by: 2,
        from: 'inferred',
      },
    ],
    themes: [
      { name: '起業の動機', description: '個人的な不満が出発点', appears_at_ts: [30, 90] },
      { name: '初期の困難', appears_at_ts: [540] },
    ],
    quotable_lines: [
      { text: '不満が一番の燃料でした。', speakerRef: 2, ts: 35, why_notable: '創業の核心' },
    ],
    key_takeaways: [
      { text: '創業の出発点は個人的な不満。', from: 'transcript' },
      { text: '資金調達が最大の壁。', from: 'inferred' },
    ],
    ...overrides,
  };
}

describe('InterviewRenderer', () => {
  it('renders title, purpose, and subject_summary in header section', () => {
    const html = renderToStaticMarkup(<InterviewRenderer note={baseNote()} />);
    expect(html).toContain('創業者インタビュー');
    expect(html).toContain('創業背景の聞き取り');
    expect(html).toContain('創業者は5年前に最初のプロダクトを立ち上げた');
  });

  it('renders each qa_pair with question, answer, and timestamp', () => {
    const html = renderToStaticMarkup(<InterviewRenderer note={baseNote()} />);
    expect(html).toContain('なぜ起業しましたか?');
    expect(html).toContain('既存ツールに不満があったからです。');
    expect(html).toContain('最初の困難は何でしたか?');
    expect(html).toContain('資金調達でした。');
    // qa_pairs[0].ts=30 → 00:30; qa_pairs[1].ts=540 → 09:00
    expect(html).toContain('[00:30]');
    expect(html).toContain('[09:00]');
  });

  it('renders qa_pair themes as inline tags when present', () => {
    const html = renderToStaticMarkup(<InterviewRenderer note={baseNote()} />);
    expect(html).toContain('動機');
  });

  it('renders themes section with appears_at_ts anchors in mm:ss', () => {
    const html = renderToStaticMarkup(<InterviewRenderer note={baseNote()} />);
    expect(html).toContain('起業の動機');
    expect(html).toContain('個人的な不満が出発点');
    expect(html).toContain('初期の困難');
    // theme[0].appears_at_ts=[30,90] → 00:30, 01:30
    expect(html).toContain('00:30');
    expect(html).toContain('01:30');
  });

  it('renders quotable_lines with text and why_notable', () => {
    const html = renderToStaticMarkup(<InterviewRenderer note={baseNote()} />);
    expect(html).toContain('不満が一番の燃料でした。');
    expect(html).toContain('創業の核心');
  });

  it('renders key_takeaways list', () => {
    const html = renderToStaticMarkup(<InterviewRenderer note={baseNote()} />);
    expect(html).toContain('創業の出発点は個人的な不満。');
    expect(html).toContain('資金調達が最大の壁。');
  });

  it('renders participants section only when present', () => {
    const without = renderToStaticMarkup(<InterviewRenderer note={baseNote()} />);
    expect(without).not.toContain('class="participants"');
    const withP = renderToStaticMarkup(
      <InterviewRenderer
        note={baseNote({
          participants: [
            { speakerRef: 1, role: 'interviewer' },
            { speakerRef: 2, role: 'interviewee' },
          ],
        })}
      />,
    );
    expect(withP).toContain('class="participants"');
    expect(withP).toContain('interviewer');
    expect(withP).toContain('interviewee');
  });

  it('emits ※ inferred marker on provenance="inferred" leaves only', () => {
    const html = renderToStaticMarkup(<InterviewRenderer note={baseNote()} />);
    // qa_pairs[1].from=inferred (1) + key_takeaways[1].from=inferred (1) = 2 markers.
    // qa_pairs[0]/[1] question — answered_by/asked_by are NOT provenance-tagged,
    // only the qa_pair-level `from` field is.
    const markerCount = (html.match(/provenance-inferred/g) ?? []).length;
    expect(markerCount).toBe(2);
  });

  it('hides speakerRef tag when ref is 0 (single-speaker alpha)', () => {
    const html = renderToStaticMarkup(
      <InterviewRenderer
        note={baseNote({
          qa_pairs: [
            {
              question: 'Q?',
              answer: 'A.',
              ts: 0,
              asked_by: 0,
              answered_by: 0,
              from: 'transcript',
            },
          ],
        })}
      />,
    );
    expect(html).not.toContain('話者0');
  });

  it('shows speakerRef tag when ref > 0 (multi-speaker case)', () => {
    const html = renderToStaticMarkup(<InterviewRenderer note={baseNote()} />);
    // baseNote qa_pairs asked_by=1, answered_by=2
    expect(html).toContain('話者1');
    expect(html).toContain('話者2');
    expect(html).toContain('質問者');
    expect(html).toContain('回答者');
  });

  it('renders validation_warnings aside when present', () => {
    const html = renderToStaticMarkup(
      <InterviewRenderer note={baseNote({ validation_warnings: ['SINGLE_SPEAKER_WARNING'] })} />,
    );
    expect(html).toContain('validation-warnings');
    expect(html).toContain('SINGLE_SPEAKER_WARNING');
  });

  it('renders gracefully on minimum-valid note (empty optional arrays)', () => {
    const minimal: InterviewNote = {
      schemaVersion: 1,
      family: 'interview',
      title: '最小インタビュー',
      generatedAt: '2026-05-31T00:00:00Z',
      generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
      language: 'ja',
      durationSec: 60,
      purpose: 'テスト',
      subject_summary: '空のインタビュー。',
      qa_pairs: [],
      themes: [],
      quotable_lines: [],
      key_takeaways: [],
    };
    expect(() => renderToStaticMarkup(<InterviewRenderer note={minimal} />)).not.toThrow();
  });
});

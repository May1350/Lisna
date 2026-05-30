/**
 * Tests for LectureRenderer (Plan 3 Task 11).
 *
 * Uses react-dom/server's renderToStaticMarkup so tests run in plain node
 * without a DOM environment — Lisna's vitest config has no jsdom and we
 * don't want to add it just for these renderer unit tests. The renderer is
 * a pure function of props, so SSR-equivalent HTML is sufficient evidence.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LectureNote } from '../schema';
import { LectureRenderer } from '../renderer';

// Side-effect import already happens in renderer.tsx (registerFamilyRenderer).
// Importing LectureRenderer triggers it.

function baseNote(overrides: Partial<LectureNote> = {}): LectureNote {
  return {
    schemaVersion: 1,
    family: 'lecture',
    title: '量子力学入門',
    generatedAt: '2026-05-30T00:00:00Z',
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 120,
    sections: [
      {
        heading: 'プランク定数',
        ts: 0,
        summary: '量子力学の基礎定数。',
        key_terms: [
          { term: 'h', definition: '6.626e-34 J·s', ts: 5, from: 'transcript' },
          { term: 'ħ', definition: 'h / 2π', ts: 30, from: 'inferred' },
        ],
        examples: [
          { text: '光子のエネルギー E=hν', ts: 60, from: 'transcript' },
        ],
        points: [
          { text: 'プランクは1900年に発見', ts: 80, important: true, from: 'transcript' },
        ],
      },
    ],
    ...overrides,
  };
}

describe('LectureRenderer', () => {
  it('renders title, optional lecturer/course/tldr, and sections', () => {
    const note = baseNote({
      lecturer: '田中教授',
      course: '物理学I',
      tldr: '量子の基本',
    });
    const html = renderToStaticMarkup(<LectureRenderer note={note} />);
    expect(html).toContain('量子力学入門');
    expect(html).toContain('田中教授');
    expect(html).toContain('物理学I');
    expect(html).toContain('量子の基本');
    expect(html).toContain('プランク定数');
  });

  it('omits optional header fields when undefined', () => {
    const note = baseNote();  // no lecturer/course/tldr
    const html = renderToStaticMarkup(<LectureRenderer note={note} />);
    expect(html).not.toContain('class="lecturer"');
    expect(html).not.toContain('class="course"');
    expect(html).not.toContain('class="tldr"');
  });

  it('emits ※ inferred marker on provenance="inferred" leaves only', () => {
    const note = baseNote();
    const html = renderToStaticMarkup(<LectureRenderer note={note} />);
    // The 'ħ' key_term has from='inferred' → one ※ marker.
    // 'h', the example, and the point are all 'transcript' → no marker.
    const markerCount = (html.match(/provenance-inferred/g) ?? []).length;
    expect(markerCount).toBe(1);
  });

  it('renders ts-anchor in mm:ss format', () => {
    const note = baseNote();
    const html = renderToStaticMarkup(<LectureRenderer note={note} />);
    // ts=80 → 01:20 on the points entry
    expect(html).toContain('[01:20]');
    // ts=5 → 00:05 on the first key_term
    expect(html).toContain('[00:05]');
  });

  it('renders extras via SlotRendererMap — formula slot shows monospace expression', () => {
    const note = baseNote({
      sections: [
        {
          heading: '式',
          ts: 0,
          summary: '',
          key_terms: [],
          examples: [],
          points: [],
          extras: [
            {
              type: 'formula',
              expression: 'E = mc^2',
              label: 'エネルギー質量等価',
              ts: 10,
              from: 'transcript',
            },
          ],
        },
      ],
    });
    const html = renderToStaticMarkup(<LectureRenderer note={note} />);
    expect(html).toContain('<code>E = mc^2</code>');
    expect(html).toContain('エネルギー質量等価');
  });

  it('renders procedure_steps and timeline extras in source order', () => {
    const note = baseNote({
      sections: [
        {
          heading: '実験手順',
          ts: 0,
          summary: '',
          key_terms: [],
          examples: [],
          points: [],
          extras: [
            {
              type: 'procedure_steps',
              steps: [
                { order: 1, text: '装置を準備', ts: 5, from: 'transcript' },
                { order: 2, text: '測定開始', ts: 10, from: 'transcript' },
              ],
            },
            {
              type: 'timeline',
              events: [
                { when: '1900', text: 'プランク', ts: 30, from: 'transcript' },
                { when: '1905', text: 'アインシュタイン', ts: 35, from: 'transcript' },
              ],
            },
          ],
        },
      ],
    });
    const html = renderToStaticMarkup(<LectureRenderer note={note} />);
    expect(html).toContain('procedure-steps');
    expect(html).toContain('装置を準備');
    expect(html).toContain('timeline');
    expect(html).toContain('プランク');
    // Order check — procedure_steps closes before timeline opens
    const procedureIdx = html.indexOf('procedure-steps');
    const timelineIdx = html.indexOf('timeline');
    expect(procedureIdx).toBeLessThan(timelineIdx);
  });

  it('renders gracefully when extras is undefined', () => {
    const note = baseNote();  // no extras
    expect(() => renderToStaticMarkup(<LectureRenderer note={note} />)).not.toThrow();
  });

  it('renders validation_warnings aside when present', () => {
    const note = baseNote({
      validation_warnings: ['LLM cleaned up duplicate section'],
    });
    const html = renderToStaticMarkup(<LectureRenderer note={note} />);
    expect(html).toContain('validation-warnings');
    expect(html).toContain('LLM cleaned up duplicate section');
  });

  it('does not render validation_warnings aside when undefined or empty', () => {
    const html1 = renderToStaticMarkup(<LectureRenderer note={baseNote()} />);
    expect(html1).not.toContain('validation-warnings');
    const html2 = renderToStaticMarkup(
      <LectureRenderer note={baseNote({ validation_warnings: [] })} />,
    );
    expect(html2).not.toContain('validation-warnings');
  });
});

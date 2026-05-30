/**
 * Tests for BrainstormRenderer.
 *
 * SSR-rendering via react-dom/server so tests run in plain node — mirrors
 * the LectureRenderer + MeetingRenderer test pattern (vitest config has
 * no DOM env).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrainstormNote } from '../schema';
import { BrainstormRenderer } from '../renderer';

function baseNote(overrides: Partial<BrainstormNote> = {}): BrainstormNote {
  return {
    schemaVersion: 1,
    family: 'brainstorm',
    title: '新機能ブレインストーミング',
    generatedAt: '2026-05-31T00:00:00Z',
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 900,
    purpose: 'Q3新機能候補の洗い出し',
    idea_clusters: [
      {
        theme: 'オンボーディング改善',
        ideas: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            text: 'チュートリアル動画を埋め込む',
            contributed_by: 1,
            ts: 60,
            from: 'transcript',
          },
          {
            id: '22222222-2222-2222-2222-222222222222',
            text: 'ツールチップを充実',
            ts: 120,
            from: 'inferred',
          },
        ],
      },
      {
        theme: 'パフォーマンス',
        ideas: [
          {
            id: '33333333-3333-3333-3333-333333333333',
            text: 'キャッシュ層を追加',
            contributed_by: 2,
            ts: 480,
            from: 'transcript',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('BrainstormRenderer', () => {
  it('renders title and purpose in header section', () => {
    const html = renderToStaticMarkup(<BrainstormRenderer note={baseNote()} />);
    expect(html).toContain('新機能ブレインストーミング');
    expect(html).toContain('Q3新機能候補の洗い出し');
  });

  it('renders each idea_cluster with theme heading and its ideas', () => {
    const html = renderToStaticMarkup(<BrainstormRenderer note={baseNote()} />);
    expect(html).toContain('オンボーディング改善');
    expect(html).toContain('チュートリアル動画を埋め込む');
    expect(html).toContain('ツールチップを充実');
    expect(html).toContain('パフォーマンス');
    expect(html).toContain('キャッシュ層を追加');
  });

  it('renders ts-anchor in mm:ss on each idea', () => {
    const html = renderToStaticMarkup(<BrainstormRenderer note={baseNote()} />);
    // ideas ts: 60→01:00, 120→02:00, 480→08:00
    expect(html).toContain('[01:00]');
    expect(html).toContain('[02:00]');
    expect(html).toContain('[08:00]');
  });

  it('renders atmosphere only when present', () => {
    const without = renderToStaticMarkup(<BrainstormRenderer note={baseNote()} />);
    expect(without).not.toContain('class="atmosphere"');
    const withAtm = renderToStaticMarkup(
      <BrainstormRenderer note={baseNote({ atmosphere: 'energetic' })} />,
    );
    expect(withAtm).toContain('class="atmosphere"');
    expect(withAtm).toContain('energetic');
  });

  it('renders parking_lot section only when non-empty', () => {
    const without = renderToStaticMarkup(<BrainstormRenderer note={baseNote()} />);
    expect(without).not.toContain('class="parking-lot"');
    const withP = renderToStaticMarkup(
      <BrainstormRenderer
        note={baseNote({
          parking_lot: [
            { text: '後で検討すべき項目', ts: 300, from: 'transcript' },
          ],
        })}
      />,
    );
    expect(withP).toContain('class="parking-lot"');
    expect(withP).toContain('後で検討すべき項目');
  });

  it('emits ※ inferred marker on provenance="inferred" leaves only', () => {
    const html = renderToStaticMarkup(<BrainstormRenderer note={baseNote()} />);
    // ideas: cluster0/idea1 inferred (1), cluster0/idea0 + cluster1/idea0 transcript (0)
    const markerCount = (html.match(/provenance-inferred/g) ?? []).length;
    expect(markerCount).toBe(1);
  });

  it('hides speakerRef tag when contributed_by is 0 (single-speaker alpha)', () => {
    const html = renderToStaticMarkup(
      <BrainstormRenderer
        note={baseNote({
          idea_clusters: [
            {
              theme: 'X',
              ideas: [
                {
                  id: '11111111-1111-1111-1111-111111111111',
                  text: 'idea',
                  contributed_by: 0,
                  ts: 0,
                  from: 'transcript',
                },
              ],
            },
          ],
        })}
      />,
    );
    expect(html).not.toContain('話者0');
  });

  it('hides speakerRef tag when contributed_by is undefined', () => {
    const html = renderToStaticMarkup(
      <BrainstormRenderer
        note={baseNote({
          idea_clusters: [
            {
              theme: 'X',
              ideas: [
                {
                  id: '11111111-1111-1111-1111-111111111111',
                  text: 'idea',
                  ts: 0,
                  from: 'transcript',
                },
              ],
            },
          ],
        })}
      />,
    );
    expect(html).not.toContain('話者');
  });

  it('shows speakerRef tag when contributed_by > 0', () => {
    const html = renderToStaticMarkup(<BrainstormRenderer note={baseNote()} />);
    // baseNote: cluster0/idea0 contributed_by=1, cluster1/idea0 contributed_by=2
    expect(html).toContain('話者1');
    expect(html).toContain('話者2');
    expect(html).toContain('提案者');
  });

  it('renders validation_warnings aside when present', () => {
    const html = renderToStaticMarkup(
      <BrainstormRenderer note={baseNote({ validation_warnings: ['MERGE_FALLBACK'] })} />,
    );
    expect(html).toContain('validation-warnings');
    expect(html).toContain('MERGE_FALLBACK');
  });

  it('renders gracefully on minimum-valid note', () => {
    const minimal: BrainstormNote = {
      schemaVersion: 1,
      family: 'brainstorm',
      title: '最小ブレスト',
      generatedAt: '2026-05-31T00:00:00Z',
      generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
      language: 'ja',
      durationSec: 60,
      purpose: 'テスト',
      idea_clusters: [
        {
          theme: 'テーマ',
          ideas: [
            {
              id: '99999999-9999-9999-9999-999999999999',
              text: '唯一のアイデア',
              ts: 0,
              from: 'transcript',
            },
          ],
        },
      ],
    };
    expect(() => renderToStaticMarkup(<BrainstormRenderer note={minimal} />)).not.toThrow();
  });
});

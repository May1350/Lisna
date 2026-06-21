import { describe, it, expect } from 'vitest';
import { dedupFitArray } from '@shared/post-decode/cap-fit';
import { normalizeFigureValue, unionKeyFigures, unionContentAtoms } from '../dedup';
import { detectTopicBoundaries, assignToTopics, deriveTopicLabel } from '../topic-synth';
import { assembleMeetingNote } from '../assemble';
import { MeetingExtractSchema } from '../extract-schema';
import { MeetingNoteSchema } from '../schema';
import { runPostDecodePipeline } from '@shared/post-decode/pipeline';
import { MeetingFamilyCore } from '../core';
import type { SessionTranscript } from '@shared/note-schema';

// ---------------------------------------------------------------------------
// Task 2: dedup helpers + number-trap FAIL-FIRST regression
// ---------------------------------------------------------------------------

describe('unionKeyFigures — adversarial number traps survive dedup', () => {
  // The load-bearing regression: the spec's adversarial MRR traps — distinct
  // values 4,200万 / 4,400万 / 3,600万 / 4,000万 (the "misheard 4,200 vs 4,400"
  // case) plus Proプラン 3,480円 / 3,800円 — must ALL survive value-keyed dedup.
  // unionKeyFigures keys on label + normalized value, so distinctness is
  // guaranteed regardless of trigram similarity.
  const figs = [
    [{ label: 'MRR', value: '4,200万' }, { label: 'MRR', value: '4,400万' }, { label: 'MRR', value: '3,600万' }],
    [{ label: 'MRR', value: '4,000万' }, { label: 'Proプラン', value: '3,480円' }, { label: 'Proプラン', value: '3,800円' }],
  ];

  it('FAIL-FIRST: the naive trigram dedup (dedupFitArray on value text) over-collapses distinct figures with a long shared label', () => {
    // A long shared label dominates the trigram set, so two GENUINELY distinct
    // values (4,200万 vs 4,400万) reach jaccard ≥ 0.7 and the naive path collapses
    // them. Empirically: jaccard("…ベース） 4,200万", "…ベース） 4,400万") ≈ 0.778.
    const trap = [
      { label: '月次経常収益（MRR・継続課金ベース）', value: '4,200万' },
      { label: '月次経常収益（MRR・継続課金ベース）', value: '4,400万' },
    ];
    const { kept } = dedupFitArray(trap, (f) => `${f.label} ${f.value}`, 50);
    // Hazard documented: the naive trigram path destroys a distinct figure.
    expect(kept.length).toBeLessThan(trap.length);
  });

  it('value+label-keyed dedup keeps every distinct number (incl. 4,400万 and 4,000万)', () => {
    const out = unionKeyFigures(figs);
    const values = out.map((f) => `${f.label}:${f.value}`).sort();
    expect(values).toEqual(
      [
        'MRR:4,200万',
        'MRR:4,400万',
        'MRR:3,600万',
        'MRR:4,000万',
        'Proプラン:3,480円',
        'Proプラン:3,800円',
      ].sort(),
    );
    expect(out).toHaveLength(6);
  });

  it('collapses only true duplicates (same label + same normalized value)', () => {
    const out = unionKeyFigures([[{ label: 'MRR', value: '4,200万円' }], [{ label: 'MRR', value: '4,200万' }]]);
    expect(out).toHaveLength(1);
  });

  it('normalizeFigureValue keeps magnitude (万) but strips separators/円', () => {
    expect(normalizeFigureValue('4,200万円')).toBe(normalizeFigureValue('4200万'));
    expect(normalizeFigureValue('4,200')).not.toBe(normalizeFigureValue('4,200万'));
  });
});

describe('unionContentAtoms — content-anchor + trigram', () => {
  it('dedups a decision restated across a chunk boundary', () => {
    const out = unionContentAtoms([
      [{ text: 'プロプランを3,480円に値上げする', ts: 10 }],
      [{ text: 'プロプランを3,480円に値上げすることに決定', ts: 11 }],
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps two decisions that differ by number even if wording overlaps', () => {
    const out = unionContentAtoms([
      [{ text: '解約9社をウィンバックする', ts: 10 }],
      [{ text: '解約14社をウィンバックする', ts: 60 }],
    ]);
    expect(out).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Task 3: topic-boundary synthesis
// ---------------------------------------------------------------------------

const seg = (ts: number, text: string, speakerId = 0) => ({ ts, endTs: ts + 5, text, speakerId });
const tx = (segs: ReturnType<typeof seg>[]): SessionTranscript => ({ sessionId: 's', speakers: [{ id: 0 }], transcriptSegments: segs });

describe('detectTopicBoundaries', () => {
  it('seeds boundaries on transition cues', () => {
    const b = detectTopicBoundaries(tx([
      seg(0, '料金改定について話します'),
      seg(60, '次は、解約対策の議題です'),
      seg(120, '続いて、英語版の開発状況'),
    ]));
    expect(b.length).toBeGreaterThanOrEqual(2);
    expect(b.map((x) => x.ts)).toContain(60);
  });

  it('falls back to even ts-buckets when no cues found', () => {
    const b = detectTopicBoundaries(tx([seg(0, 'aaa'), seg(50, 'bbb'), seg(100, 'ccc'), seg(150, 'ddd')]), { target: 2 });
    expect(b.length).toBe(2);
    expect(b[0]!.ts).toBe(0);
  });

  it('never returns more than 7 topics', () => {
    const segs = Array.from({ length: 20 }, (_, i) => seg(i * 30, `次は議題${i}`));
    expect(detectTopicBoundaries(tx(segs)).length).toBeLessThanOrEqual(7);
  });
});

describe('assignToTopics', () => {
  it('buckets atoms by ts into the containing boundary range', () => {
    const boundaries = [{ ts: 0, label: 'A' }, { ts: 100, label: 'B' }];
    const m = assignToTopics([
      { atom: { ts: 10 }, fallbackTs: 10 },
      { atom: { ts: 150 }, fallbackTs: 150 },
      // ts=0 is treated as "unreliable 0" → uses fallbackTs=55 → topic 0 (55 < 100)
      { atom: { ts: 0 }, fallbackTs: 55 },
    ], boundaries);
    expect(m.get(0)).toHaveLength(2); // ts 10 and fallbackTs 55
    expect(m.get(1)).toHaveLength(1); // ts 150
  });
});

// ---------------------------------------------------------------------------
// P1 tuning: deriveTopicLabel — concise keyword/figure label, not a sentence fragment
// ---------------------------------------------------------------------------

const emptyBucket = () => ({ decisions: [], figures: [], questions: [], risks: [], actions: [] });

describe('deriveTopicLabel', () => {
  it('uses the representative key_figure label whose tokens overlap the discussion', () => {
    const b = {
      ...emptyBucket(),
      decisions: [{ text: 'プロプランを3,480円に値上げする' }],
      figures: [{ label: 'プロプラン新価格', value: '3,480円' }],
    };
    expect(deriveTopicLabel(b, 0)).toBe('プロプラン新価格');
  });

  it('prefers the figure that overlaps the discussion over a peripheral figure', () => {
    const b = {
      ...emptyBucket(),
      decisions: [{ text: 'バックエンドエンジニアを1名のみ採用する' }],
      figures: [
        { label: 'ランウェイ', value: '14ヶ月' }, // peripheral (no token overlap)
        { label: '新規バックエンド採用コスト', value: '1,040万円' }, // overlaps バックエンド
      ],
    };
    expect(deriveTopicLabel(b, 0)).toBe('新規バックエンド採用コスト');
  });

  it('uses the dominant recurring proper-noun when there are no figures', () => {
    const b = {
      ...emptyBucket(),
      decisions: [{ text: 'CustomerLoopへ乗り換えを決定' }],
      actions: [{ text: 'CustomerLoopへ移行する' }, { text: 'CustomerLoopのリージョンを確認' }],
    };
    expect(deriveTopicLabel(b, 0)).toBe('CustomerLoop');
  });

  it('falls back to a numbered label when the bucket has no proper nouns or figures', () => {
    const b = { ...emptyBucket(), decisions: [{ text: '値上げする方針で合意した' }] };
    expect(deriveTopicLabel(b, 2)).toBe('議題3');
  });

  it('never emits a mid-sentence fragment label (no post-cue raw text)', () => {
    // The phase1-b-flat regression: labels like "トップラインですけど、Q3末のMRRが4,200".
    const b = {
      ...emptyBucket(),
      decisions: [{ text: 'トップラインですけど、Q3末のMRRが4,200万円になりました' }],
      figures: [{ label: 'Q3末MRR', value: '4,200万円' }],
    };
    const label = deriveTopicLabel(b, 0);
    expect(label).toBe('Q3末MRR');
    expect(label).not.toContain('ですけど');
    expect(label).not.toContain('。');
  });
});

// ---------------------------------------------------------------------------
// Task 4: assembleMeetingNote round-trip
// ---------------------------------------------------------------------------

it('assembles a schema-valid MeetingNote from two chunks (round-trips through post-decode)', () => {
  const transcript = tx([seg(0, '料金改定について'), seg(80, '次は、解約対策です')]);
  const assembled = assembleMeetingNote(
    [
      {
        tsRange: [0, 60],
        atoms: MeetingExtractSchema.parse({
          title: 'Q3会議', purpose: '進捗確認',
          decisions: [{ text: 'プロプランを3,480円に値上げ', ts: 10 }],
          action_items: [{ task: '負荷試験を実施', owner: 1, ts: 20 }],
          key_figures: [{ label: 'MRR', value: '4,200万円', ts: 5 }],
          open_questions: [], risks: [],
        }),
      },
      {
        tsRange: [60, 140],
        atoms: MeetingExtractSchema.parse({
          decisions: [{ text: '解約9社をウィンバック', ts: 90 }],
          action_items: [], key_figures: [], open_questions: [{ text: '英語版は？', ts: 100 }], risks: [],
        }),
      },
    ],
    transcript,
  );
  expect(assembled.family).toBe('meeting');
  expect((assembled.decisions as unknown[]).length).toBe(2);
  expect((assembled.topic_arc as unknown[]).length).toBeGreaterThanOrEqual(1);
  expect(typeof assembled.executive_summary).toBe('string');
  // The assembled note (no `from`) must validate after runPostDecodePipeline fills provenance.
  const note = runPostDecodePipeline(JSON.stringify(assembled), MeetingFamilyCore, transcript);
  expect(() => MeetingNoteSchema.parse(note)).not.toThrow();
});

it('weaves DEDUPED key_figures into key_points (a figure in two chunks appears once)', () => {
  const transcript = tx([seg(0, '売上について'), seg(80, '次は、解約の話')]);
  const assembled = assembleMeetingNote(
    [
      {
        tsRange: [0, 60],
        atoms: MeetingExtractSchema.parse({
          decisions: [], action_items: [],
          key_figures: [
            { label: 'MRR', value: '4,200万円', ts: 10 },
            { label: 'Proプラン', value: '3,480円', ts: 12 },
          ],
          open_questions: [], risks: [],
        }),
      },
      {
        tsRange: [60, 140],
        atoms: MeetingExtractSchema.parse({
          decisions: [], action_items: [],
          key_figures: [{ label: 'MRR', value: '4,200万円', ts: 90 }], // SAME figure, second chunk
          open_questions: [], risks: [],
        }),
      },
    ],
    transcript,
  );
  const allKeyPoints = (assembled.discussions as Array<{ key_points?: string[] }>)
    .flatMap((d) => d.key_points ?? []);
  // Deduped across chunks → exactly one, AND the distinct figure also present.
  expect(allKeyPoints.filter((k) => k === 'MRR: 4,200万円')).toHaveLength(1);
  expect(allKeyPoints).toContain('Proプラン: 3,480円');
});

it('topic_arc labels are concise keywords, not mid-sentence fragments', () => {
  const transcript = tx([seg(0, '料金改定について'), seg(80, '次は、ベンダー選定です')]);
  const assembled = assembleMeetingNote(
    [
      {
        tsRange: [0, 60],
        atoms: MeetingExtractSchema.parse({
          decisions: [{ text: 'プロプランを3,480円に値上げする', ts: 10 }],
          action_items: [], key_figures: [{ label: 'プロプラン新価格', value: '3,480円', ts: 5 }],
          open_questions: [], risks: [],
        }),
      },
      {
        tsRange: [60, 140],
        atoms: MeetingExtractSchema.parse({
          decisions: [{ text: 'CustomerLoopへ乗り換えを決定', ts: 90 }],
          action_items: [{ task: 'CustomerLoopへ移行する', ts: 100 }],
          key_figures: [], open_questions: [], risks: [],
        }),
      },
    ],
    transcript,
  );
  const topics = (assembled.topic_arc as Array<{ topic: string }>).map((t) => t.topic);
  expect(topics).toContain('プロプラン新価格');
  expect(topics).toContain('CustomerLoop');
  for (const t of topics) {
    expect(t).not.toContain('。');
    expect(t).not.toContain('ですけど');
  }
});

it('executive_summary reports the capped decision count, not the pre-cap union count', () => {
  const transcript = tx([seg(0, '議題について')]);
  // 22 distinct decisions (per-chunk extract cap is 15 → split 11+11) → union
  // keeps 22, mapped caps to MAX_DECISIONS (20).
  const mk = (lo: number, hi: number) =>
    Array.from({ length: hi - lo }, (_, k) => ({ text: `案件${lo + k}を${lo + k + 100}万円で承認する`, ts: lo + k + 1 }));
  const assembled = assembleMeetingNote(
    [
      { tsRange: [0, 30], atoms: MeetingExtractSchema.parse({ decisions: mk(0, 11), action_items: [], key_figures: [], open_questions: [], risks: [] }) },
      { tsRange: [30, 60], atoms: MeetingExtractSchema.parse({ decisions: mk(11, 22), action_items: [], key_figures: [], open_questions: [], risks: [] }) },
    ],
    transcript,
  );
  const summary = assembled.executive_summary as string;
  const mappedCount = (assembled.decisions as unknown[]).length;
  expect(mappedCount).toBe(20);
  expect(summary).toContain('20件の決定');
  expect(summary).not.toContain('22件');
});

it('caps topic_arc speakers_involved to MAX_PARTICIPANTS (12)', () => {
  // 14 distinct made_by refs in one topic bucket — schema caps speakers_involved
  // at 12, so the synthesis must slice (else schema.parse throws too_big once
  // diarization is enabled). Distinct numbers/text → no dedup, all 14 survive.
  const transcript = tx([seg(0, '議題について議論する')]);
  const decisions = Array.from({ length: 14 }, (_, i) => ({ text: `決定${i}を承認する`, made_by: i, ts: 5 }));
  const assembled = assembleMeetingNote(
    [{ tsRange: [0, 30], atoms: MeetingExtractSchema.parse({ decisions, action_items: [], key_figures: [], open_questions: [], risks: [] }) }],
    transcript,
  );
  for (const t of assembled.topic_arc as Array<{ speakers_involved: number[] }>) {
    expect(t.speakers_involved.length).toBeLessThanOrEqual(12);
  }
});

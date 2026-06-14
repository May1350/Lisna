/**
 * Shared helpers for the 30-min Lecture stress test pair
 * (`lecture-30min-stress.test.ts` + `.real.test.ts`).
 *
 * DENSITY MATH (verified by sanity test (1a) in `.test.ts` — if it fails,
 * retune `JA_VOCAB` average length and/or seg count below):
 *   estimateTokens for CJK is 0.6 t/char. Vocab averages 22 chars (all CJK)
 *   → ~13 tokens per segment. 900 segs × 13 = ~11,700 content tokens,
 *   ~3.9× the 3000 production default (lowered 2026-06-11 for memory-pressure
 *   multi-chunking — see `desktop/src/shared/models/profiles.ts`
 *   perFamily.lecture.recommendedChunkTokens). chunkTranscript splits into
 *   4 chunks (with silence-snap shifting boundaries ±30s).
 *   EXPECTED_CHUNKS_AT_DEFAULT=4.
 *   900 segs × 3s = 2700s = 45 min recording — "30+ min" principle holds.
 *
 *   NOTE: chunkTranscript counts ONLY segment text (~13 t/seg). The
 *   telemetry.totalTokensIn counts RENDERED chunks `[ts] text` and is
 *   higher (~15 t/seg, adds the timestamp ASCII prefix). Don't conflate.
 */
import type { GrammarCapableSidecar } from '../main/sidecar/grammar-call';
import type { SessionTranscript } from '../shared/note-schema/transcript';

// Constants pinned by hand math, NOT by calling the SUT — both the chunker
// and the synth-density math must hold for sanity test (1a) to pass.
export const EXPECTED_CHUNKS_AT_DEFAULT = 4;
export const PROD_LECTURE_BUDGET = 3000;

// ─── Synthetic 45-min JA transcript (deterministic) ─────────────────────────

const JA_VOCAB = [
  '今日は機械学習の基礎について話していきます',
  'ニューラルネットワークの構造を詳しく見ていきます',
  '入力層と隠れ層と出力層の三層構成が基本です',
  '誤差逆伝播法によって重みが更新されます',
  '学習率の値が収束速度に大きく影響します',
  'バッチサイズと汎化性能の関係を考えます',
  '過学習を防ぐためにドロップアウトを使います',
  '正則化の手法を合わせて理解しましょう',
  '画像分類のタスクを実例として取り上げます',
  '畳み込み層が特徴を抽出する仕組みを学びます',
];

export function makeSynthetic30MinTranscript(): SessionTranscript {
  const segments: SessionTranscript['transcriptSegments'] = [];
  let ts = 0;
  for (let i = 0; i < 900; i++) {
    const text = JA_VOCAB[i % JA_VOCAB.length]!;
    const segDur = 3;
    const endTs = ts + segDur;
    segments.push({ ts, endTs, text, speakerId: 0 });
    // Every 12th seg carries a 3s silence gap (ts skip before the next
    // segment). ~75 silence candidates across the recording — enough for
    // findSilenceGaps to find real boundaries in the ±30s slack window.
    const silence = i % 12 === 11 ? 3 : 0;
    ts = endTs + silence;
  }
  return {
    sessionId: 'synth-30min-lecture',
    speakers: [{ id: 0 }],
    transcriptSegments: segments,
  };
}

// ─── Canned LectureNote builder for the mocked sidecar ──────────────────────
//
// Mirrors `lecture-orchestrator.test.ts::makeLectureNoteJson`: no `from`
// provenance (Stage 3 fills it). Each canned response uses a DISTINCT
// heading so the mock test can assert every chunk's content survived merge
// (exact-set equality on the headings).
export function makeLectureNoteJson(sectionHeading: string, sectionTs: number): string {
  return JSON.stringify({
    schemaVersion: 1,
    family: 'lecture',
    title: 'テスト講義',
    generatedAt: new Date().toISOString(),
    generatedBy: { model: 'llama-3.2-3b-q4-km', promptVersion: 1 },
    language: 'ja',
    durationSec: 1800,
    sections: [
      {
        heading: sectionHeading,
        ts: sectionTs,
        summary: 'チャンクごとの要約です。',
        key_terms: [{ term: '概念', definition: '定義', ts: sectionTs }],
        examples: [],
        points: [{ text: '重要な点', ts: sectionTs, important: true }],
      },
    ],
  });
}

/** Canned PASS-1 free-prose: grounded JA over the 100-char language floor so
 *  pass-1 always advances to pass-2 (per-chunk 2-pass, 2026-06-14). */
const PASS1_PROSE = 'この講義チャンクの要約です。重要な概念と具体例を順に説明しています。' + 'あ'.repeat(120);

// ─── Mock sidecar that serves one canned response per PASS-2 call ────────────
//
// 2-pass aware (per-chunk fabrication fix, 2026-06-14): PASS-1 calls (empty
// grammar) get canned JA prose recorded in `pass1Calls`; PASS-2 (grammar)
// calls are indexed into `responses[]` and recorded in `calls`. So `calls`
// length still equals the number of structuring calls (≈ chunk count) and the
// `responses[]` per-chunk indexing is preserved exactly. The mock falls back
// to the last response on overflow so a `.length` mismatch surfaces as a test
// assertion failure rather than an undefined-pointer exception.
export function mockSidecarPerChunk(responses: string[]): GrammarCapableSidecar & {
  calls: Array<{ prompt: string; seed: number }>;
  pass1Calls: Array<{ prompt: string; seed: number }>;
} {
  const calls: Array<{ prompt: string; seed: number }> = [];
  const pass1Calls: Array<{ prompt: string; seed: number }> = [];
  let idx = 0;
  return {
    calls,
    pass1Calls,
    async generateWithGrammar(req) {
      if (req.grammar === '') {
        pass1Calls.push({ prompt: req.prompt, seed: req.seed });
        return { text: PASS1_PROSE, seed: req.seed };
      }
      calls.push({ prompt: req.prompt, seed: req.seed });
      const text = responses[idx] ?? responses[responses.length - 1]!;
      idx++;
      return { text, seed: req.seed };
    },
  };
}

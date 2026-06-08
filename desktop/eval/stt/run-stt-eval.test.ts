import { it, expect } from 'vitest';
import { runSttEval, formatSttScorecard, type SttFn } from './run-stt-eval';

// Stub STT: clean → perfect, degraded → 1 substitution. No sidecar.
const ref = '静電ポテンシャルの計算';
const makeStub = (degradedReturnsWorse: boolean): SttFn => async (_pcm, _sr, condition) =>
  condition === 'clean' || !degradedReturnsWorse ? ref : '静電ポテンシャルの計X';

it('scores each condition and reports clean vs far-field CER', async () => {
  const audio = Float32Array.from({ length: 1600 }, () => 0.01);
  const noise = Float32Array.from({ length: 1600 }, (_, i) => Math.sin(i));
  const card = await runSttEval({
    sampleRate: 16000, audio, reference: ref, noise, snrDb: 5,
    conditions: ['clean', 'far-field-synth'], stt: makeStub(true),
  });
  expect(card.rows.find(r => r.condition === 'clean')!.cer).toBe(0);
  expect(card.rows.find(r => r.condition === 'far-field-synth')!.cer).toBeGreaterThan(0);
});

it('throws when far-field-real is requested without realAudio', async () => {
  const audio = Float32Array.from({ length: 100 }, () => 0.01);
  const noise = Float32Array.from({ length: 100 }, (_, i) => Math.sin(i));
  await expect(runSttEval({
    sampleRate: 16000, audio, reference: ref, noise, snrDb: 5,
    conditions: ['far-field-real'], stt: makeStub(true),
  })).rejects.toThrow('realAudio');
});

it('formatSttScorecard renders one line per condition with CER/WER %', () => {
  const out = formatSttScorecard({
    reference: 'あいう',
    rows: [
      { condition: 'clean', modelId: 'kotoba-q5_0', cer: 0, wer: 0, hyp: 'あいう' },
      { condition: 'far-field-synth', modelId: 'kotoba-q5_0', cer: 0.3333, wer: 1, hyp: 'あいX' },
    ],
  });
  expect(out).toContain('ref 3 chars');
  expect(out).toContain('clean');
  expect(out).toContain('CER=33.3%');
});

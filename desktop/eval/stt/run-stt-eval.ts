import { cer, wer } from './metrics';
import { degradeFarField } from './degrade';

export type SttCondition = 'clean' | 'far-field-synth' | 'far-field-real';

/** Pluggable STT. Tests pass a stub; the GATED real run passes a sidecar-backed
 *  fn (plan Task 7). `condition` lets a stub vary output by condition. */
export type SttFn = (pcm: Float32Array, sampleRate: number, condition: SttCondition) => Promise<string>;

export interface SttRow {
  condition: SttCondition;
  modelId: string;
  cer: number;
  wer: number;
  hyp: string;
}
export interface SttScorecard {
  reference: string;
  rows: SttRow[];
}

export interface RunSttEvalInput {
  sampleRate: number;
  audio: Float32Array; // clean PCM
  reference: string;
  noise: Float32Array; // noise bed for synthetic far-field
  snrDb: number;
  conditions: SttCondition[];
  stt: SttFn;
  modelId?: string;
  realAudio?: Float32Array; // required only for 'far-field-real'
}

export async function runSttEval(input: RunSttEvalInput): Promise<SttScorecard> {
  const rows: SttRow[] = [];
  for (const condition of input.conditions) {
    let pcm: Float32Array;
    if (condition === 'clean') {
      pcm = input.audio;
    } else if (condition === 'far-field-synth') {
      pcm = degradeFarField(input.audio, { noise: input.noise, snrDb: input.snrDb });
    } else {
      if (!input.realAudio) throw new Error('far-field-real condition requires realAudio (the mic recording)');
      pcm = input.realAudio;
    }
    const hyp = await input.stt(pcm, input.sampleRate, condition);
    rows.push({
      condition,
      modelId: input.modelId ?? 'unknown',
      cer: cer(input.reference, hyp),
      wer: wer(input.reference, hyp),
      hyp,
    });
  }
  return { reference: input.reference, rows };
}

export function formatSttScorecard(card: SttScorecard): string {
  const head = `STT eval (ref ${[...card.reference].length} chars)`;
  const body = card.rows
    .map((r) => `  ${r.condition.padEnd(16)} ${r.modelId.padEnd(22)} CER=${(r.cer * 100).toFixed(1)}%  WER=${(r.wer * 100).toFixed(1)}%`)
    .join('\n');
  return `${head}\n${body}`;
}

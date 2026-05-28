// desktop/eval/judges/pairwise-judge.ts
import OpenAI from 'openai';
import type { FixtureTranscript } from '../fixtures/_schema';
import type { NoteFamily } from './judge-types';

export interface PairwiseDecision {
  preferred: 'A' | 'B' | 'TIE';
  confidence: number;          // 0..1
  reasoning: string;
}

export interface PairwiseMatch {
  a: string;
  b: string;
  winner: 'A' | 'B' | 'TIE';
}

const SYSTEM_PROMPT = (family: NoteFamily) => `あなたは ${family} note の2つのバージョンを比較するペアワイズ採点者です。
入力: transcript + note_A + note_B。
出力は JSON のみ:
{ "preferred": "A" | "B" | "TIE", "confidence": <0..1>, "reasoning": "..." }
判定軸: 内容の充実度、構造の論理性、transcript への忠実度、簡潔性。`;

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

let _client: OpenAI | undefined;
function client(): OpenAI {
  if (!_client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set');
    _client = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
  }
  return _client;
}

export function __testOnly_parsePairwiseResponse(text: string): PairwiseDecision {
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { parsed = {}; }
  const preferred = parsed.preferred === 'A' ? 'A' : parsed.preferred === 'B' ? 'B' : 'TIE';
  return {
    preferred,
    confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
  };
}

export async function judgePairwise(input: {
  family: NoteFamily;
  noteA: any;
  noteB: any;
  transcript: FixtureTranscript;
  judgeModelId?: string;
}): Promise<PairwiseDecision> {
  const modelId = input.judgeModelId ?? DEFAULT_MODEL;
  const transcriptText = input.transcript.transcripts.map(b => `[${b.ts}s] ${b.text}`).join('\n');
  const userPrompt = `transcript:\n${transcriptText}\n\nnote_A:\n${JSON.stringify(input.noteA, null, 2)}\n\nnote_B:\n${JSON.stringify(input.noteB, null, 2)}`;
  const res = await client().chat.completions.create({
    model: modelId,
    messages: [{ role: 'system', content: SYSTEM_PROMPT(input.family) }, { role: 'user', content: userPrompt }],
    response_format: { type: 'json_object' },
    temperature: 0,
  });
  return __testOnly_parsePairwiseResponse(res.choices[0]?.message?.content ?? '{}');
}

// Bradley-Terry: simple iterative MLE over match outcomes.
// p_i / (p_i + p_j) = win-rate of i vs j. Returns log-strengths.
export function computeBradleyTerry(matches: PairwiseMatch[], iterations = 100): Record<string, number> {
  const players = new Set<string>();
  for (const m of matches) { players.add(m.a); players.add(m.b); }
  const ps: Record<string, number> = {};
  for (const p of players) ps[p] = 1.0;
  for (let it = 0; it < iterations; it++) {
    const next: Record<string, number> = {};
    const denomCount: Record<string, number> = {};
    for (const p of players) { next[p] = 0; denomCount[p] = 0; }
    for (const m of matches) {
      const wa = m.winner === 'A' ? 1 : m.winner === 'TIE' ? 0.5 : 0;
      const wb = 1 - wa;
      const denom = ps[m.a] + ps[m.b];
      next[m.a] += wa;
      next[m.b] += wb;
      denomCount[m.a] += 1 / denom;
      denomCount[m.b] += 1 / denom;
    }
    for (const p of players) {
      if (denomCount[p] > 0) ps[p] = next[p] / denomCount[p];
    }
  }
  // Return log-strengths for additive ranking comparisons.
  // Guard against log(0) when a player has zero wins — use MIN_STRENGTH floor
  // so that a totally-dominated player still gets a finite (very negative) rank.
  const MIN_STRENGTH = 1e-9;
  return Object.fromEntries(Object.entries(ps).map(([k, v]) => [k, Math.log(Math.max(v, MIN_STRENGTH))]));
}

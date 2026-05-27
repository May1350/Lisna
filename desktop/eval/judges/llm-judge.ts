// desktop/eval/judges/llm-judge.ts
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { JudgeRequest, JudgeResult, NoteFamily, JudgeAxisScores } from './judge-types';
import { LECTURE_JUDGE_PROMPT } from './families/lecture-judge';
import { MEETING_JUDGE_PROMPT } from './families/meeting-judge';
import { INTERVIEW_JUDGE_PROMPT } from './families/interview-judge';
import { BRAINSTORM_JUDGE_PROMPT } from './families/brainstorm-judge';

const DEFAULT_JUDGE_MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_JUDGE_MODEL = 'llama-3.1-8b-instant';
const JUDGE_TRANSCRIPT_CHAR_BUDGET = 10_000;

const COMMON_AXIS_KEYS = ['coverage', 'accuracy', 'hierarchy', 'conciseness', 'importance', 'provenance'] as const;
const FAMILY_AXIS_KEYS: Record<NoteFamily, readonly string[]> = {
  lecture: ['sectionCoherence', 'contentFidelity'],
  meeting: ['decisionCapture', 'actionItemClarity', 'participantAttribution'],
  interview: ['qaParity', 'themeExtraction', 'quotableSelection'],
  brainstorm: ['clusterCoherence', 'ideaDiversity', 'argumentChainDepth'],
};

const FAMILY_PROMPTS: Record<NoteFamily, string> = {
  lecture: LECTURE_JUDGE_PROMPT,
  meeting: MEETING_JUDGE_PROMPT,
  interview: INTERVIEW_JUDGE_PROMPT,
  brainstorm: BRAINSTORM_JUDGE_PROMPT,
};

let _groqClient: OpenAI | undefined;
let _anthClient: Anthropic | undefined;

function groq(): OpenAI {
  if (!_groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set');
    _groqClient = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
  }
  return _groqClient;
}

function anth(): Anthropic {
  if (!_anthClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    _anthClient = new Anthropic({ apiKey });
  }
  return _anthClient;
}

export function __testOnly_clamp(n: unknown): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
}

export function __testOnly_parseJudgeResponse<F extends NoteFamily>(family: F, text: string): JudgeResult<F> {
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { parsed = {}; }
  const axes: any = {};
  for (const k of COMMON_AXIS_KEYS) axes[k] = __testOnly_clamp(parsed[k] ?? 0);
  for (const k of FAMILY_AXIS_KEYS[family]) axes[k] = __testOnly_clamp(parsed[k] ?? 0);
  return {
    family,
    judgeModelId: parsed.judgeModelId ?? DEFAULT_JUDGE_MODEL,
    axes: axes as JudgeAxisScores<F>,
    overall: __testOnly_clamp(parsed.overall ?? 0),
    issues: Array.isArray(parsed.issues) ? parsed.issues.filter((s: unknown) => typeof s === 'string') : [],
    wins: Array.isArray(parsed.wins) ? parsed.wins.filter((s: unknown) => typeof s === 'string') : [],
  };
}

function tailWindowTranscript(req: JudgeRequest): string {
  const kept: typeof req.transcript.transcripts = [];
  let used = 0;
  for (let i = req.transcript.transcripts.length - 1; i >= 0; i--) {
    const cost = req.transcript.transcripts[i].text.length + 12;
    if (kept.length > 0 && used + cost > JUDGE_TRANSCRIPT_CHAR_BUDGET) break;
    kept.unshift(req.transcript.transcripts[i]);
    used += cost;
  }
  const dropped = req.transcript.transcripts.length - kept.length;
  return kept.map(b => `[${b.ts}s] ${b.text}`).join('\n')
    + (dropped > 0 ? `\n\n[NOTE: 古い ${dropped} chunk omitted — note still scored against full structure]` : '');
}

export async function judgeNote<F extends NoteFamily>(req: JudgeRequest<F>): Promise<JudgeResult<F>> {
  const judgeModelId = req.judgeModelId ?? DEFAULT_JUDGE_MODEL;
  const systemPrompt = FAMILY_PROMPTS[req.family];
  const transcript = tailWindowTranscript(req);
  const noteJson = JSON.stringify(req.note, null, 2);
  const gtJson = req.groundTruth ? JSON.stringify(req.groundTruth, null, 2) : '(no ground truth)';
  const userPrompt = `transcript:\n${transcript}\n\nnote (score this):\n${noteJson}\n\nground_truth:\n${gtJson}`;
  if (judgeModelId.startsWith('claude-')) {
    return judgeViaAnthropic(req.family, judgeModelId, systemPrompt, userPrompt);
  }
  try {
    return await judgeViaGroq(req.family, judgeModelId, systemPrompt, userPrompt);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
    if (!(msg.includes('429') || msg.includes('503') || msg.includes('500'))) throw e;
    return judgeViaGroq(req.family, FALLBACK_JUDGE_MODEL, systemPrompt, userPrompt);
  }
}

async function judgeViaGroq<F extends NoteFamily>(family: F, modelId: string, systemPrompt: string, userPrompt: string): Promise<JudgeResult<F>> {
  const res = await groq().chat.completions.create({
    model: modelId,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    response_format: { type: 'json_object' },
    temperature: 0,
  });
  const text = res.choices[0]?.message?.content ?? '{}';
  const parsed = __testOnly_parseJudgeResponse(family, text);
  parsed.judgeModelId = modelId;
  return parsed;
}

async function judgeViaAnthropic<F extends NoteFamily>(family: F, modelId: string, systemPrompt: string, userPrompt: string): Promise<JudgeResult<F>> {
  const res = await anth().messages.create({
    model: modelId,
    max_tokens: 1500,
    system: systemPrompt + '\n\nReturn ONLY a JSON object — no prose, no markdown fences.',
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = res.content.map(c => c.type === 'text' ? c.text : '').join('').trim();
  // Strip ```json fences if present (defensive — Anthropic sometimes adds despite instruction)
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  const parsed = __testOnly_parseJudgeResponse(family, cleaned);
  parsed.judgeModelId = modelId;
  return parsed;
}

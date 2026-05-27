// desktop/eval/judges/content-fidelity-judge.ts
import OpenAI from 'openai';
import type { FixtureTranscript, FixtureGroundTruth } from '../fixtures/_schema';
import type { NoteFamily } from './judge-types';

export interface ContentFidelityResult {
  score: number;        // 0-10
  parroting: boolean;   // true = exemplar parroting suspected
  evidence: string[];   // anchor-based citations
  judgeModelId: string;
}

const SYSTEM_PROMPT = `あなたは AI 生成 note が transcript の実内容に grounded か判定する厳しい検査官です。
入力: transcript の bucket列 + note の specific-content fields (key_terms/extras/decisions/qa_pairs/ideas など).
出力は JSON のみ。

判定基準:
- "score" 0-10: note の specific-content fields が transcript の内容に grounded である度合い。
- "parroting" boolean: prompt exemplar (例: 物理講義 transcript に対して "E=mc^2", 簿記講義に対して "F=ma") が transcript と無関係なまま note に流出している → true。
- "evidence" array: 「[03:20] X が transcript にあり note の Y に対応」のような anchor 付き根拠を 3-5 個。

例:
- transcript: 静電ポテンシャル, 電位. note.formula: "E = mc^2" → parroting=true, score≤2.
- transcript: F = qE は重要. note.formula: "F = qE" → parroting=false, score≥7.

出力:
{ "score": <0-10>, "parroting": <true|false>, "evidence": ["...", "..."] }`;

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

let _groq: OpenAI | undefined;
function groq(): OpenAI {
  if (!_groq) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set');
    _groq = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
  }
  return _groq;
}

export function __testOnly_parseContentFidelity(text: string): ContentFidelityResult {
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { parsed = {}; }
  return {
    score: typeof parsed.score === 'number' ? Math.max(0, Math.min(10, Math.round(parsed.score * 10) / 10)) : 0,
    parroting: parsed.parroting === false ? false : true, // safe default = assume parroting
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.filter((s: unknown) => typeof s === 'string') : [],
    judgeModelId: DEFAULT_MODEL,
  };
}

// Extract specific-content fields per family — these are the fields the LLM can parrot
function extractContentFields(family: NoteFamily, note: any): string {
  const out: Record<string, unknown> = {};
  if (family === 'lecture') {
    out.key_terms = (note.sections ?? []).flatMap((s: any) => s.key_terms ?? []);
    out.extras = (note.sections ?? []).flatMap((s: any) => s.extras ?? []);
  } else if (family === 'meeting') {
    out.decisions = note.decisions ?? [];
    out.proposals = note.proposals ?? [];
    out.action_items = note.next_steps ?? [];
  } else if (family === 'interview') {
    out.qa_pairs = note.qa_pairs ?? [];
    out.quotable_lines = note.quotable_lines ?? [];
    out.themes = note.themes ?? [];
  } else if (family === 'brainstorm') {
    out.idea_clusters = note.idea_clusters ?? [];
    out.parking_lot = note.parking_lot ?? [];
  }
  return JSON.stringify(out, null, 2);
}

export async function judgeContentFidelity(input: {
  family: NoteFamily;
  note: any;
  transcript: FixtureTranscript;
  groundTruth?: FixtureGroundTruth;
  judgeModelId?: string;
}): Promise<ContentFidelityResult> {
  const modelId = input.judgeModelId ?? DEFAULT_MODEL;
  const transcriptText = input.transcript.transcripts.map(b => `[${b.ts}s] ${b.text}`).join('\n');
  const contentJson = extractContentFields(input.family, input.note);
  const gtAllowlist = input.groundTruth?.expectedFormulas
    ? `\n\nground-truth allowlist (these literal strings are OK even if not in transcript):\n${input.groundTruth.expectedFormulas.join('\n')}`
    : '';
  const userPrompt = `transcript:\n${transcriptText}\n\nnote.specific_content:\n${contentJson}${gtAllowlist}`;
  const res = await groq().chat.completions.create({
    model: modelId,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
    response_format: { type: 'json_object' },
    temperature: 0,
  });
  const text = res.choices[0]?.message?.content ?? '{}';
  const parsed = __testOnly_parseContentFidelity(text);
  parsed.judgeModelId = modelId;
  return parsed;
}

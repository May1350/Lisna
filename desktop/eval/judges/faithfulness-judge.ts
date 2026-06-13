// desktop/eval/judges/faithfulness-judge.ts
//
// Faithfulness GATE judge (Phase 1, founder's #1 criterion: "any fabrication =
// fail"). Checks every note claim against the fixture's authored facts[] and
// returns PER-CLAIM verdicts. Default model = Claude (the strong judge); Groq
// 70b is the cheap fallback. Separate from llm-judge.ts because the result is a
// per-claim verdict array + a hard PASS/FAIL gate, NOT a 0-10 axis map — bolting
// it into JudgeResult.axes (Record<string,number>) would corrupt that contract.
// Reuses llm-judge.ts's Anthropic/Groq clients (the spec's "reuse its client
// pattern"). Mirrors content-fidelity-judge.ts's __testOnly_parse* seam.

import { groqClient, anthropicClient } from './llm-judge';
import type { FixtureGroundTruth } from '../fixtures/_schema';
import type { NoteFamily } from './judge-types';

export type ClaimVerdictKind = 'supported' | 'unsupported' | 'partial';

export interface ClaimVerdict {
  claim: string;
  verdict: ClaimVerdictKind;
  span: string;   // cited note substring/path, or '' if none
}

export interface FaithfulnessResult {
  verdicts: ClaimVerdict[];
  unsupportedCount: number;
  overall: 'PASS' | 'FAIL';
  judgeModelId: string;
}

/** Founder: "any fabrication = fail." A named const so the gate is tunable in
 *  one place. */
export const FAITHFULNESS_UNSUPPORTED_TOLERANCE = 0;

const DEFAULT_JUDGE_MODEL = 'claude-3-5-sonnet-latest';
const GROQ_FALLBACK_MODEL = 'llama-3.3-70b-versatile';

export function gateFromVerdicts(unsupportedCount: number): 'PASS' | 'FAIL' {
  return unsupportedCount > FAITHFULNESS_UNSUPPORTED_TOLERANCE ? 'FAIL' : 'PASS';
}

function coerceVerdict(v: unknown): ClaimVerdictKind {
  return v === 'supported' || v === 'partial' ? v : 'unsupported'; // safe default
}

export function __testOnly_parseFaithfulness(text: string, judgeModelId = DEFAULT_JUDGE_MODEL): FaithfulnessResult {
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { parsed = {}; }
  const rawVerdicts: any[] = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
  const verdicts: ClaimVerdict[] = rawVerdicts.map(v => ({
    claim: typeof v?.claim === 'string' ? v.claim : '',
    verdict: coerceVerdict(v?.verdict),
    span: typeof v?.span === 'string' ? v.span : '',
  }));
  const unsupportedCount = verdicts.filter(v => v.verdict === 'unsupported').length;
  // Empty verdicts (malformed JSON OR a valid {} / missing verdicts array) → FAIL.
  // A judge that returns nothing must NEVER silently PASS (the Task 5 sanity guard
  // asserts __testOnly_parseFaithfulness('{}').overall === 'FAIL').
  const overall = verdicts.length === 0 ? 'FAIL' : gateFromVerdicts(unsupportedCount);
  return { verdicts, unsupportedCount, overall, judgeModelId };
}

const SYSTEM_PROMPT = `あなたは AI 生成 note が「事実」に忠実かを検査する厳しい検査官です。
入力: facts[] (この録音から確認された真の事実の完全なリスト) + note の user-visible content fields.
出力は JSON のみ。

判定ルール:
- note 内の各「主張」(qa_pairs の Q/A・themes・key_takeaways・decisions・ideas など) を facts[] と照合する。
- facts[] のいずれかに entail される主張 = "supported"。
- facts[] と矛盾する、または facts[] に存在しない新情報を述べる主張 = "unsupported" (= 捏造)。
- facts[] の内容を部分的にしか反映していない、曖昧な主張 = "partial"。
- 言語が転倒している (日本語の録音なのに note が英語で書かれている) 場合、その英語主張は内容が合っていても "unsupported" とする。

例:
- facts: ["売上は前年比で減少した"]. note.theme: "Revenue grew 30% YoY" → verdict=unsupported (矛盾+言語転倒).
- facts: ["原価率の改善を最優先にする"]. note.key_takeaway: "原価率を下げる方針" → verdict=supported.

出力 (verdicts は note 内の主張ごとに 1 エントリ):
{ "verdicts": [ { "claim": "<note の主張>", "verdict": "supported|unsupported|partial", "span": "<note 内の該当箇所>" } ] }`;

// Extract the user-visible content fields per family that the judge scores.
// Mirrors content-fidelity-judge.ts::extractContentFields.
function extractClaims(family: NoteFamily, note: any): string {
  const out: Record<string, unknown> = {};
  if (family === 'lecture') {
    out.section_summaries = (note.sections ?? []).map((s: any) => ({ heading: s.heading, summary: s.summary }));
    out.key_terms = (note.sections ?? []).flatMap((s: any) => s.key_terms ?? []);
  } else if (family === 'meeting') {
    out.executive_summary = note.executive_summary;
    out.decisions = note.decisions ?? [];
    out.next_steps = note.next_steps ?? [];
  } else if (family === 'interview') {
    out.qa_pairs = note.qa_pairs ?? [];
    out.themes = note.themes ?? [];
    out.key_takeaways = note.key_takeaways ?? [];
    out.quotable_lines = note.quotable_lines ?? [];
  } else if (family === 'brainstorm') {
    out.idea_clusters = note.idea_clusters ?? [];
    out.conclusions = note.conclusions ?? [];
  }
  return JSON.stringify(out, null, 2);
}

export interface FaithfulnessJudgeInput {
  family: NoteFamily;
  note: any;
  groundTruth: FixtureGroundTruth;   // MUST carry facts[]; caller guards
  judgeModelId?: string;
}

export async function judgeFaithfulness(input: FaithfulnessJudgeInput): Promise<FaithfulnessResult> {
  const facts = input.groundTruth.facts ?? [];
  const claimsJson = extractClaims(input.family, input.note);
  const userPrompt = `facts (この録音で確認された真の事実の完全なリスト):\n${facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\nnote.claims (これを採点する):\n${claimsJson}`;
  const modelId = input.judgeModelId ?? DEFAULT_JUDGE_MODEL;
  if (modelId.startsWith('claude-')) {
    return judgeViaAnthropic(modelId, userPrompt);
  }
  return judgeViaGroq(modelId, userPrompt);
}

async function judgeViaAnthropic(modelId: string, userPrompt: string): Promise<FaithfulnessResult> {
  const res = await anthropicClient().messages.create({
    model: modelId,
    max_tokens: 2000,
    system: SYSTEM_PROMPT + '\n\nReturn ONLY a JSON object — no prose, no markdown fences.',
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = res.content.map(c => (c.type === 'text' ? c.text : '')).join('').trim();
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return __testOnly_parseFaithfulness(cleaned, modelId);
}

async function judgeViaGroq(modelId: string, userPrompt: string): Promise<FaithfulnessResult> {
  const res = await groqClient().chat.completions.create({
    model: modelId,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
    response_format: { type: 'json_object' },
    temperature: 0,
  });
  const text = res.choices[0]?.message?.content ?? '{}';
  return __testOnly_parseFaithfulness(text, modelId);
}

export { GROQ_FALLBACK_MODEL, DEFAULT_JUDGE_MODEL };

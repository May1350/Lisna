// desktop/eval/contract/anti-parroting.ts
import type { ContractRule } from './contract-test';
import type { FixtureTranscript, FixtureGroundTruth } from '../fixtures/_schema';

export interface ParrotingFinding {
  expression: string;
  label?: string;
  sectionHeading?: string;
}

export interface ParrotingReport {
  total: number;
  parroted: ParrotingFinding[];
  inTranscript: ParrotingFinding[];
  inAllowlist: ParrotingFinding[];
  parrotRatio: number;
}

// Normalize for substring matching across whitespace/notation variants.
// Notable: ^2 → ², LaTeX-ish forms, kana-internal whitespace.
function normalize(s: string): string {
  return s
    .replace(/\s+/g, '')
    .replace(/\^2/g, '²')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2')
    .toLowerCase();
}

function appearsInTranscript(expr: string, transcript: FixtureTranscript): boolean {
  const normExpr = normalize(expr);
  if (normExpr.length === 0) return false;
  return transcript.transcripts.some(b => normalize(b.text).includes(normExpr));
}

function appearsInAllowlist(expr: string, groundTruth?: FixtureGroundTruth): boolean {
  if (!groundTruth?.expectedFormulas) return false;
  const normExpr = normalize(expr);
  return groundTruth.expectedFormulas.some(f => normalize(f) === normExpr);
}

export function detectParrotedFormulas(
  note: any,
  transcript: FixtureTranscript,
  groundTruth?: FixtureGroundTruth,
): ParrotingReport {
  const sections: any[] = note.sections ?? [];
  const allFindings: ParrotingFinding[] = [];
  const parroted: ParrotingFinding[] = [];
  const inTranscript: ParrotingFinding[] = [];
  const inAllowlist: ParrotingFinding[] = [];
  for (const section of sections) {
    for (const extra of section.extras ?? []) {
      if (extra?.type !== 'formula') continue;
      for (const item of extra.items ?? []) {
        const expression = String(item?.expression ?? '').trim();
        if (!expression) continue;
        const finding: ParrotingFinding = { expression, label: item?.label, sectionHeading: section.heading };
        allFindings.push(finding);
        if (appearsInTranscript(expression, transcript)) inTranscript.push(finding);
        else if (appearsInAllowlist(expression, groundTruth)) inAllowlist.push(finding);
        else parroted.push(finding);
      }
    }
  }
  const total = allFindings.length;
  const parrotRatio = total === 0 ? 0 : parroted.length / total;
  return { total, parroted, inTranscript, inAllowlist, parrotRatio };
}

// Severity ladder:
//   parrotRatio ≤ 0.30 → pass
//   parrotRatio  > 0.30 → warning (Plan 6 prompt design needs work)
//   parrotRatio  > 0.70 → still warning (we keep severity=warning per Plan 7
//                          to avoid blocking a Plan 6 prompt iteration on
//                          this heuristic alone; the LLM judge in Task 13
//                          carries the harder signal)
export const parrotingRule: ContractRule = {
  id: 'lecture-anti-parroting',
  severity: 'warning',
  description: 'Formula expressions that do not appear in transcript AND are not in ground-truth allowlist look like exemplar parroting.',
  run: ({ note, transcript, groundTruth }) => {
    const r = detectParrotedFormulas(note, transcript, groundTruth);
    if (r.total === 0) return { pass: true, message: 'no formula extras — rule N/A' };
    const pass = r.parrotRatio <= 0.30;
    return {
      pass,
      message: pass
        ? `parrot ratio ${(r.parrotRatio * 100).toFixed(0)}% ≤ 30% (${r.parroted.length}/${r.total})`
        : `parrot ratio ${(r.parrotRatio * 100).toFixed(0)}% > 30% — ${r.parroted.map(p => p.expression).join(', ')}`,
      detail: r,
    };
  },
};

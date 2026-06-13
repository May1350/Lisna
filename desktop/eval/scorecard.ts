import type { FixtureResult } from './baseline/format';
import type { BaselineDiff } from './baseline/diff';

export function formatScorecard(results: FixtureResult[], diff?: BaselineDiff): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════════');
  lines.push('  V2 NOTE EVAL — Scorecard');
  lines.push('═══════════════════════════════════════════════════════════════════');
  for (const r of results) {
    lines.push('');
    lines.push(`▶ ${r.fixtureId} [${r.family}]`);
    if (r.contractTest.schemaParse === 'FAIL') {
      lines.push(`    CONTRACT FAIL: schema parse failed — ${r.contractTest.schemaParseError ?? '(no detail)'}`);
      continue;
    }
    if (r.contractTest.overall === 'FAIL') {
      lines.push('    CONTRACT FAIL: error-severity rule(s) failed');
    } else {
      lines.push('    contract: PASS');
    }
    for (const f of r.contractTest.findings) {
      const marker = f.pass ? '  OK' : (f.severity === 'error' ? 'FAIL' : 'WARN');
      lines.push(`    ${marker}  ${f.ruleId}: ${f.message}`);
    }
    if (r.judge) {
      const d = diff?.perFixture.find(x => x.fixtureId === r.fixtureId);
      const deltaStr = (k: string): string => {
        const dd = d?.axisDelta?.[k];
        return dd === undefined ? '' : ` (${dd >= 0 ? '+' : ''}${dd.toFixed(1)})`;
      };
      lines.push(`    overall      ${r.judge.overall.toFixed(1)}${d ? ` (${d.overallDelta >= 0 ? '+' : ''}${d.overallDelta.toFixed(1)})` : ''}`);
      for (const [k, v] of Object.entries(r.judge.axes)) {
        lines.push(`    ${k.padEnd(22)} ${v.toFixed(1)}${deltaStr(k)}`);
      }
      if (r.judge.issues.length) {
        lines.push('    issues:');
        for (const x of r.judge.issues) lines.push(`      - ${x}`);
      }
      if (r.judge.wins.length) {
        lines.push('    wins:');
        for (const x of r.judge.wins) lines.push(`      + ${x}`);
      }
    }
    if (r.contentFidelity) {
      const flag = r.contentFidelity.parroting ? ' ⚠ PARROTING' : '';
      lines.push(`    content-fidelity   ${r.contentFidelity.score.toFixed(1)}${flag}`);
    }
    if (r.faithfulness) {
      lines.push(`    FAITHFULNESS: ${r.faithfulness.gate}`);
      const p = r.faithfulness.prepass;
      if (p.languageFlip) {
        lines.push(`      pre-pass: language flip (jaRatio ${p.jaRatio.toFixed(2)} < 0.15) — note is not in the expected language`);
      } else {
        lines.push(`      pre-pass: jaRatio ${p.jaRatio.toFixed(2)} groundingJa ${p.groundingJa.toFixed(2)}`);
      }
      if (r.faithfulness.judge) {
        const unsupported = r.faithfulness.judge.verdicts.filter(v => v.verdict === 'unsupported');
        lines.push(`      judge (${r.faithfulness.judge.judgeModelId}): ${r.faithfulness.judge.unsupportedCount} unsupported claim(s)`);
        for (const v of unsupported) lines.push(`        ✗ ${v.claim}  [${v.span}]`);
      }
    }
    if (r.coverage) {
      lines.push(`    coverage           ${r.coverage.captured}/${r.coverage.total} (${(r.coverage.ratio * 100).toFixed(0)}%)`);
      if (r.coverage.missing.length) lines.push(`      missing: ${r.coverage.missing.join('; ')}`);
    }
    if (r.retryHistogram) {
      const bins = Object.entries(r.retryHistogram.attemptsByBin).map(([k, v]) => `${k}:${v}`).join(' ');
      lines.push(`    retry-histogram    samples=${r.retryHistogram.samples} mean=${r.retryHistogram.attemptsMean} {${bins}}`);
    }
    if (r.slotDistribution) {
      const byType = Object.entries(r.slotDistribution.byType).map(([k, v]) => `${k}:${v}`).join(' ');
      lines.push(`    slot-distribution  types=${r.slotDistribution.slotTypes} emerged=${r.slotDistribution.slotsEmerged} {${byType}}`);
    }
    lines.push(`    runMs              ${r.runMs}`);
  }
  if (results.length > 1) {
    const n = results.length;
    const judgedResults = results.filter(r => r.judge);
    const meanOverall = judgedResults.length === 0
      ? 0
      : judgedResults.reduce((s, r) => s + (r.judge?.overall ?? 0), 0) / judgedResults.length;
    lines.push('');
    lines.push('───────────────────────────────────────────────────────────────────');
    lines.push(`  AGGREGATE over ${n} fixture(s)`);
    lines.push(`    mean overall          ${meanOverall.toFixed(2)}`);
    if (diff) {
      lines.push(`    mean delta vs baseline ${diff.summary.meanOverallDelta >= 0 ? '+' : ''}${diff.summary.meanOverallDelta.toFixed(2)}`);
      if (diff.summary.regression) lines.push('    REGRESSION DETECTED — see per-fixture deltas above');
      for (const w of diff.warnings) lines.push(`    warn: ${w}`);
    }
    lines.push('───────────────────────────────────────────────────────────────────');
  }
  return lines.join('\n');
}

/** Suite-level faithfulness gate: FAIL if ANY fixture with a faithfulness block
 *  failed its gate. Fixtures without a faithfulness block (no facts[]) are not
 *  gated. Used by the CLI to set a non-zero exit code. */
export function __testOnly_gateVerdict(results: FixtureResult[]): 'PASS' | 'FAIL' {
  return results.some(r => r.faithfulness?.gate === 'FAIL') ? 'FAIL' : 'PASS';
}

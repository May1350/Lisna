import type { BaselineFile } from './format';

export interface PerFixtureDiff {
  fixtureId: string;
  family: string;
  overallDelta: number;
  axisDelta: Record<string, number>;
  contractTestRegression: boolean;  // A PASS → B FAIL
  fidelityRegression: boolean;      // A score - B score > 1
}

export interface BaselineDiff {
  perFixture: PerFixtureDiff[];
  summary: {
    n: number;
    meanOverallDelta: number;
    regression: boolean;            // true if any fixture has overallDelta < -0.3
  };
  warnings: string[];
}

const REGRESSION_OVERALL_THRESHOLD = -0.3;
const REGRESSION_FIDELITY_THRESHOLD = -1.0;

export function diffBaselines(before: BaselineFile, after: BaselineFile): BaselineDiff {
  const warnings: string[] = [];
  if (before.modelId !== after.modelId) warnings.push(`modelId mismatch: ${before.modelId} → ${after.modelId} (comparison is cross-model)`);
  if (before.promptVariantId !== after.promptVariantId) warnings.push(`promptVariantId mismatch: ${before.promptVariantId} → ${after.promptVariantId} (intended for prompt A/B)`);
  if (before.judgeModelId !== after.judgeModelId) warnings.push(`judgeModelId mismatch: ${before.judgeModelId} → ${after.judgeModelId} — score calibration drift expected`);

  const beforeByFixture = new Map(before.results.map(r => [r.fixtureId, r]));
  const perFixture: PerFixtureDiff[] = [];

  for (const b of after.results) {
    const a = beforeByFixture.get(b.fixtureId);
    if (!a) continue;

    const overallDelta = (b.judge?.overall ?? 0) - (a.judge?.overall ?? 0);
    const axisDelta: Record<string, number> = {};
    const axesA = a.judge?.axes ?? {};
    const axesB = b.judge?.axes ?? {};
    for (const k of new Set([...Object.keys(axesA), ...Object.keys(axesB)])) {
      axisDelta[k] = (axesB[k] ?? 0) - (axesA[k] ?? 0);
    }

    perFixture.push({
      fixtureId: b.fixtureId,
      family: b.family,
      overallDelta: round1(overallDelta),
      axisDelta: Object.fromEntries(Object.entries(axisDelta).map(([k, v]) => [k, round1(v)])),
      contractTestRegression: a.contractTest.overall === 'PASS' && b.contractTest.overall === 'FAIL',
      fidelityRegression: ((b.contentFidelity?.score ?? 10) - (a.contentFidelity?.score ?? 10)) < REGRESSION_FIDELITY_THRESHOLD,
    });
  }

  const meanOverallDelta = perFixture.length === 0 ? 0 : perFixture.reduce((s, d) => s + d.overallDelta, 0) / perFixture.length;
  const regression =
    perFixture.some(d => d.overallDelta < REGRESSION_OVERALL_THRESHOLD)
    || perFixture.some(d => d.contractTestRegression)
    || perFixture.some(d => d.fidelityRegression);

  return {
    perFixture,
    summary: { n: perFixture.length, meanOverallDelta: round1(meanOverallDelta), regression },
    warnings,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

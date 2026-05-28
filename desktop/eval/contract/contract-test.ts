// desktop/eval/contract/contract-test.ts
import type { z } from 'zod';
import type { FixtureTranscript, FixtureGroundTruth } from '../fixtures/_schema';

export type NoteFamily = 'lecture' | 'meeting' | 'interview' | 'brainstorm';
export type Severity = 'error' | 'warning';

export interface RuleInput {
  family: NoteFamily;
  note: any;                              // already Zod-parsed when rule.run is called
  transcript: FixtureTranscript;
  groundTruth?: FixtureGroundTruth;
}

export interface RuleResult {
  pass: boolean;
  message: string;
  detail?: unknown;                       // optional structured payload for debugging
}

export interface ContractRule {
  id: string;
  severity: Severity;
  description?: string;
  run: (input: RuleInput) => RuleResult;
}

export interface ContractFinding extends RuleResult {
  ruleId: string;
  severity: Severity;
}

export interface ContractTestResult {
  family: NoteFamily;
  schemaParse: 'PASS' | 'FAIL';
  schemaParseError?: string;
  findings: ContractFinding[];
  overall: 'PASS' | 'FAIL';
}

export interface ContractTestInput {
  family: NoteFamily;
  schema: z.ZodType;
  note: unknown;
  rules: ContractRule[];
  transcript: FixtureTranscript;
  groundTruth?: FixtureGroundTruth;
}

export function runContractTest(input: ContractTestInput): ContractTestResult {
  const parsed = input.schema.safeParse(input.note);
  // findings stay empty on schema-parse failure — rule findings are rule-driven only;
  // parse error surfaces via schemaParseError (matches BaselineFile shape in Task 14).
  if (!parsed.success) {
    return {
      family: input.family,
      schemaParse: 'FAIL',
      schemaParseError: parsed.error.message,
      findings: [],
      overall: 'FAIL',
    };
  }
  const findings: ContractFinding[] = input.rules.map(rule => {
    let result: RuleResult;
    try {
      result = rule.run({
        family: input.family,
        note: parsed.data,
        transcript: input.transcript,
        groundTruth: input.groundTruth,
      });
    } catch (e) {
      result = {
        pass: false,
        message: `rule threw: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    return { ...result, ruleId: rule.id, severity: rule.severity };
  });
  const anyErrorFailed = findings.some(f => f.severity === 'error' && !f.pass);
  return {
    family: input.family,
    schemaParse: 'PASS',
    findings,
    overall: anyErrorFailed ? 'FAIL' : 'PASS',
  };
}

// desktop/eval/contract/contract-test.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { runContractTest, type ContractRule } from './contract-test';

const TrivialSchema = z.object({ family: z.literal('lecture'), title: z.string() });

describe('runContractTest', () => {
  it('reports schemaParse=FAIL on invalid input', () => {
    const result = runContractTest({
      family: 'lecture',
      schema: TrivialSchema,
      note: { family: 'lecture' /* missing title */ },
      rules: [],
      transcript: { transcripts: [] } as never,
      groundTruth: undefined,
    });
    expect(result.schemaParse).toBe('FAIL');
    expect(result.findings.length).toBe(0);
    expect(result.overall).toBe('FAIL');
  });

  it('reports schemaParse=PASS and runs rules when input is valid', () => {
    const titleRule: ContractRule = {
      id: 'title-non-empty',
      severity: 'error',
      run: ({ note }) => ({
        pass: typeof note.title === 'string' && note.title.length > 0,
        message: 'title must be non-empty',
      }),
    };
    const result = runContractTest({
      family: 'lecture',
      schema: TrivialSchema,
      note: { family: 'lecture', title: 'My Lecture' },
      rules: [titleRule],
      transcript: { transcripts: [] } as never,
      groundTruth: undefined,
    });
    expect(result.schemaParse).toBe('PASS');
    expect(result.findings.find(f => f.ruleId === 'title-non-empty')?.pass).toBe(true);
    expect(result.overall).toBe('PASS');
  });

  it('marks overall=FAIL when any error-severity rule fails', () => {
    const failingRule: ContractRule = {
      id: 'always-fails',
      severity: 'error',
      run: () => ({ pass: false, message: 'fails always' }),
    };
    const result = runContractTest({
      family: 'lecture',
      schema: TrivialSchema,
      note: { family: 'lecture', title: 'X' },
      rules: [failingRule],
      transcript: { transcripts: [] } as never,
      groundTruth: undefined,
    });
    expect(result.overall).toBe('FAIL');
  });

  it('marks overall=PASS when only warning-severity rules fail', () => {
    const warningRule: ContractRule = {
      id: 'warns-only',
      severity: 'warning',
      run: () => ({ pass: false, message: 'soft fail' }),
    };
    const result = runContractTest({
      family: 'lecture',
      schema: TrivialSchema,
      note: { family: 'lecture', title: 'X' },
      rules: [warningRule],
      transcript: { transcripts: [] } as never,
      groundTruth: undefined,
    });
    expect(result.overall).toBe('PASS');
    expect(result.findings.find(f => f.ruleId === 'warns-only')?.pass).toBe(false);
  });

  it('catches a rule that throws and records as failure', () => {
    const throwingRule: ContractRule = {
      id: 'throws',
      severity: 'error',
      run: () => { throw new Error('boom'); },
    };
    const result = runContractTest({
      family: 'lecture',
      schema: TrivialSchema,
      note: { family: 'lecture', title: 'X' },
      rules: [throwingRule],
      transcript: { transcripts: [] } as never,
      groundTruth: undefined,
    });
    const f = result.findings.find(x => x.ruleId === 'throws')!;
    expect(f.pass).toBe(false);
    expect(f.message).toContain('boom');
    expect(result.overall).toBe('FAIL');
  });
});

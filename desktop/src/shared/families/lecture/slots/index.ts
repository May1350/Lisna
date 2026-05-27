import { z } from 'zod';
import { procedureStepsSlot, ProcedureStepsSchema } from './procedure-steps';
import { argumentChainSlot, ArgumentChainSchema } from './argument-chain';
import { formulaSlot, FormulaSchema } from './formula';
import { timelineSlot, TimelineSchema } from './timeline';

export { ProcedureStepsSchema, type ProcedureSteps } from './procedure-steps';
export { ArgumentChainSchema, type ArgumentChain } from './argument-chain';
export { FormulaSchema, type Formula } from './formula';
export { TimelineSchema, type Timeline } from './timeline';

export const LECTURE_SLOTS = [
  procedureStepsSlot,
  argumentChainSlot,
  formulaSlot,
  timelineSlot,
] as const;

export const LectureSlotInstanceSchema = z.discriminatedUnion('type', [
  ProcedureStepsSchema,
  ArgumentChainSchema,
  FormulaSchema,
  TimelineSchema,
]);

export type LectureSlotInstance = z.infer<typeof LectureSlotInstanceSchema>;

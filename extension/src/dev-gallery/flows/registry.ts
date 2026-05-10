import type { FlowGraph } from './types'
import { onboardingFlow } from './scenes/01-onboarding'
import { recordingFlow } from './scenes/02-recording'
import { quotaFlow } from './scenes/03-quota'
import { errorsFlow } from './scenes/04-errors'
import { historyFlow } from './scenes/05-history'
import { optionsFlow } from './scenes/06-options'

// Registry of all flows shown in the Flow view. Add new flows here.
// Order determines the tab order in the header.
export const FLOWS: FlowGraph[] = [
  onboardingFlow,
  recordingFlow,
  quotaFlow,
  errorsFlow,
  historyFlow,
  optionsFlow,
]

import type { FlowGraph } from './types'
import { onboardingFlow } from './scenes/01-onboarding'

// Registry of all flows shown in the Flow view. Add new flows here.
// Order determines the tab order in the header.
export const FLOWS: FlowGraph[] = [
  onboardingFlow,
  // recordingFlow,    // Phase 2
  // quotaFlow,        // Phase 2
  // errorsFlow,       // Phase 2
  // historyFlow,      // Phase 2
  // optionsFlow,      // Phase 2
]

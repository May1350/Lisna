/** Per spec section 4.0 and section 4 item 10. */
export interface ModelProfile {
  id: string;
  displayName: string;
  filename: string;
  chatTemplate: 'llama-3.2' | 'qwen-2.5' | 'phi-3.5' | 'auto';
  contextWindow: number;
  recommendedChunkTokens: number;
  grammarDialect: 'llama-cpp' | 'llama-cpp-strict';
  bosTokenFix?: 'dormant-bos';
  recommendedTemp: number;
  warmupRequired: boolean;
  ramBudgetMB: number;
}

/**
 * Runtime profile registry. Alpha ships with one entry; Plan 6 may add
 * `qwen-2.5-3b` if Spike 0.2 Path E shows it's worth swapping.
 *
 * n_ctx=16384 chosen per memory feedback_llm_chat_template_sidecar:
 * 32K caused 8GB OOM. 8K = recommendedChunkTokens (half-ctx leaves
 * room for system prompt + generated tokens).
 */
export const modelProfiles: Record<string, ModelProfile> = {
  'llama-3.2-3b-q4-km': {
    id: 'llama-3.2-3b-q4-km',
    displayName: 'Llama 3.2 3B (Q4_K_M)',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    chatTemplate: 'llama-3.2',
    contextWindow: 16384,
    recommendedChunkTokens: 8000,
    grammarDialect: 'llama-cpp',
    bosTokenFix: 'dormant-bos',
    recommendedTemp: 0.4,
    warmupRequired: true,
    ramBudgetMB: 3072,
  },
};

/** Throws on unknown id — caller's bug, not a runtime fallback case. */
export function getModelProfile(id: string): ModelProfile {
  const p = modelProfiles[id];
  if (!p) throw new Error(`Unknown model profile: ${id}`);
  return p;
}

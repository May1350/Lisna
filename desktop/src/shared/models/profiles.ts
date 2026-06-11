import type { NoteFamily } from '@shared/note-schema';

/** Family-specific runtime tuning. Per spec §2.3 + decision-0.2-path-f.md.
 *
 * `tier: 'default'` = picker recommends this model for this family.
 * `tier: 'fallback'` = lower-RAM Macs only; quality is acceptable-but-degraded
 * until prompt-engineering work (Plan 6 Task 16) re-evaluates.
 */
export interface PerFamilyTuning {
  recommendedChunkTokens: number;
  maxGenTokens: number;
  temperature: number;
  tier: 'default' | 'fallback';
}

/** Per spec section 4.0 and section 4 item 10. */
export interface ModelProfile {
  id: string;
  displayName: string;
  filename: string;
  chatTemplate: 'llama-3.2' | 'qwen-2.5' | 'phi-3.5' | 'auto';
  contextWindow: number;
  grammarDialect: 'llama-cpp' | 'llama-cpp-strict';
  bosTokenFix?: 'dormant-bos';
  warmupRequired: boolean;
  ramBudgetMB: number;
  perFamily: Record<NoteFamily, PerFamilyTuning>;
}

/**
 * Runtime profile registry. Two entries alpha-ships with:
 *
 * - `llama-3.2-3b-q4-km` — default for Lecture (Path F: 1B quality FAIL on Lecture).
 * - `llama-3.2-1b-q4-km` — fallback tier on ≤12 GB RAM Macs until Plan 6
 *   Task 16 prompt-engineering re-evaluation.
 *
 * n_ctx=16384 chosen per memory feedback_llm_chat_template_sidecar:
 * 32K caused 8GB OOM.
 *
 * recommendedChunkTokens=3000 for every family on the 3B (default) profile.
 * Lowered 2026-06-11 from 8000 (lecture/meeting) / 7000 (interview/brainstorm):
 * a single ~7000-token prefill dies under 8 GB memory pressure (v0.1.4 retest —
 * a 17.4-min interview finalized 3× with zero output). Smaller chunks keep each
 * prefill survivable; partials then merge deterministically (lecture/meeting:
 * concat-dedup) or via the tested interview/brainstorm merge. Reliability over
 * nominal wall-time — a multi-chunk note that completes beats a single chunk
 * that stalls. The 1B profile keeps its prior values until the adaptive-infra
 * design phase sets its chunk size alongside RAM-based model selection.
 *
 * maxGenTokens=3000 calibrated per decision-0.2-path-f.md (reduced from
 * spike's 4096 — tail-risk mitigation).
 */
export const modelProfiles: Record<string, ModelProfile> = {
  'llama-3.2-3b-q4-km': {
    id: 'llama-3.2-3b-q4-km',
    displayName: 'Llama 3.2 3B (Q4_K_M)',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    chatTemplate: 'llama-3.2',
    contextWindow: 16384,
    grammarDialect: 'llama-cpp',
    bosTokenFix: 'dormant-bos',
    warmupRequired: true,
    ramBudgetMB: 3072,
    perFamily: {
      lecture:    { recommendedChunkTokens: 3000, maxGenTokens: 3000, temperature: 0.4, tier: 'default'  },
      meeting:    { recommendedChunkTokens: 3000, maxGenTokens: 3000, temperature: 0.4, tier: 'default'  },
      interview:  { recommendedChunkTokens: 3000, maxGenTokens: 3500, temperature: 0.4, tier: 'default'  },
      brainstorm: { recommendedChunkTokens: 3000, maxGenTokens: 3500, temperature: 0.5, tier: 'default'  },
    },
  },
  'llama-3.2-1b-q4-km': {
    id: 'llama-3.2-1b-q4-km',
    displayName: 'Llama 3.2 1B (Q4_K_M)',
    filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    chatTemplate: 'llama-3.2',
    contextWindow: 16384,
    grammarDialect: 'llama-cpp',
    bosTokenFix: 'dormant-bos',
    warmupRequired: true,
    ramBudgetMB: 1024,
    // Chunk budgets here are still the pre-2026-06-11 values — the 1B profile is
    // dev-only (no models.json multi-path / RAM detection yet), so they're inert
    // in production. The adaptive-infra design phase sets the 1B chunk size.
    perFamily: {
      lecture:    { recommendedChunkTokens: 8000, maxGenTokens: 3000, temperature: 0.4, tier: 'fallback' },
      meeting:    { recommendedChunkTokens: 8000, maxGenTokens: 3000, temperature: 0.4, tier: 'fallback' },
      interview:  { recommendedChunkTokens: 7000, maxGenTokens: 3500, temperature: 0.4, tier: 'fallback' },
      brainstorm: { recommendedChunkTokens: 7000, maxGenTokens: 3500, temperature: 0.5, tier: 'fallback' },
    },
  },
};

/** Throws on unknown id — caller's bug, not a runtime fallback case. */
export function getModelProfile(id: string): ModelProfile {
  const p = modelProfiles[id];
  if (!p) throw new Error(`Unknown model profile: ${id}`);
  return p;
}

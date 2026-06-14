import type { NoteFamily } from '@shared/note-schema';
import type { SamplingParams } from '../ipc-protocol';

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
  /**
   * Sampler configuration sent with EVERY generate call (spec
   * sampler-alignment section 5 — TS is the single source of truth; the C++
   * defaults are a safety net only). Aligned to llama.cpp common defaults
   * (common.h:214-243) + DRY enabled — the configuration the known-good
   * llama-completion runs used, minus their looping (DRY covers that).
   */
  sampling: Required<SamplingParams>;
  perFamily: Record<NoteFamily, PerFamilyTuning>;
}

/**
 * llama.cpp common-default parity + DRY enabled. WHY these exact values:
 * the 2026-06-12 fabrication isolation matrix proved the CLI path
 * (common_sampler, NO sampler flags → these defaults, penalty OFF) produces
 * grounded JA where the sidecar chain (top_k 50 / top_p 0.9 / penalty 1.1
 * post-truncation) produces English fabrication. DRY (multiplier 0.8 — the
 * one deliberate deviation from "disabled" upstream default) targets the
 * phrase-looping the CLI runs still showed. See spec sections 1+4.
 */
export const ALIGNED_SAMPLING: Required<SamplingParams> = {
  topK: 40,
  topP: 0.95,
  minP: 0.05,
  repeatPenalty: 1.0,
  repeatLastN: 64,
  dryMultiplier: 0.8,
  dryBase: 1.75,
  dryAllowedLength: 2,
  dryPenaltyLastN: -1,
};

/**
 * Mirrors main's legacy sampler chain — repeat-penalty ON (1.1), DRY OFF.
 * Used by lecture, which runs SINGLE-PASS: the lecture model needs a grounded
 * decode (real-3B 2-pass validation showed it echoing its own prompt back as
 * garbage). The penalty curbs the lecture model's phrase-looping without the
 * DRY interaction that destabilizes the single-pass structuring decode.
 * Conversation families keep ALIGNED_SAMPLING (penalty off + DRY) on their
 * 2-pass path. Same field set as SamplingParams / ALIGNED_SAMPLING.
 */
export const BESPOKE_SAMPLING: Required<SamplingParams> = {
  topK: 50,
  topP: 0.9,
  minP: 0.0,
  repeatPenalty: 1.1,
  repeatLastN: 64,
  dryMultiplier: 0.0,
  dryBase: 1.75,
  dryAllowedLength: 2,
  dryPenaltyLastN: -1,
};

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
    sampling: ALIGNED_SAMPLING,
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
    sampling: ALIGNED_SAMPLING,
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

import type { ModelDescriptor } from '../types';

/**
 * Canonical default model catalog — the single source of truth for which
 * on-device models Lisna ships/recommends.
 *
 * The resolver (`main/model-resolver.ts`) is purely path-based: the user
 * picks the file once at first-run, or an env-var / `models.json` supplies an
 * absolute path. This catalog does NOT auto-download — the backend
 * model-download path (Plan A, PR #45, flag=off) is archived. It is the
 * canonical reference that onboarding docs, the (dormant) backend manifest,
 * and any future downloader read from, so "the default STT model" is named in
 * exactly one place instead of drifting across `models.json`, docs, and the
 * manifest.
 *
 * `sizeBytes` + `sha256` are measured from the exact files distributed to
 * alpha testers; `source.url` is the verified upstream provenance. Re-verify
 * the hash after any fresh download before trusting it for integrity (the
 * binding url→sha256 is not asserted here — no runtime check consumes it yet).
 */

/**
 * Default STT model. `large-v3-turbo` (multilingual, large-v3 family) replaced
 * the JA-distilled `kotoba-whisper-v2.0` on 2026-06-15: on far-field JA it cut
 * CER 17.8% → 4.4% (`scripts/eval-stt.ts`, synthetic SNR5) and turned a
 * repetition-loop hallucination into a coherent transcript on real audio,
 * while barely degrading clean (6.7% → 3.7%). Multilingual, so no single
 * `language`.
 */
export const DEFAULT_STT_MODEL: ModelDescriptor = {
  kind: 'stt',
  filename: 'ggml-large-v3-turbo-q5_0.bin',
  sizeBytes: 574_041_195,
  sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
  source: {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
  },
};

/** Default note-generation LLM. Qwen3-4B-Instruct-2507 (Apache-2.0, non-thinking)
 *  replaced Llama-3.2-3B on 2026-07 — it breaks the 3B "reorganization ceiling",
 *  synthesizing topics/decisions instead of echoing transcript fragments
 *  (STEP-2 eval, meeting/q3-allhands-noisy-ja gold). Same Qwen3 arch as the
 *  sidecar already supports — no C++ rebuild. */
export const DEFAULT_LLM_MODEL: ModelDescriptor = {
  kind: 'llm',
  filename: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
  sizeBytes: 2_497_281_120,
  sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597',
  source: {
    url: 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
  },
};

/** Both default slots, keyed by `ModelDescriptor.kind`. */
export const DEFAULT_MODELS = {
  stt: DEFAULT_STT_MODEL,
  llm: DEFAULT_LLM_MODEL,
} as const;

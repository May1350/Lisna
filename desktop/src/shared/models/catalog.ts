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

/** Default note-generation LLM. Unchanged from alpha; listed here so the
 *  catalog is the complete picture of Lisna's two on-device models. */
export const DEFAULT_LLM_MODEL: ModelDescriptor = {
  kind: 'llm',
  filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
  sizeBytes: 2_019_377_696,
  sha256: '6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff',
  source: {
    url: 'https://huggingface.co/hugging-quants/Llama-3.2-3B-Instruct-Q4_K_M-GGUF/resolve/main/llama-3.2-3b-instruct-q4_k_m.gguf',
  },
};

/** Both default slots, keyed by `ModelDescriptor.kind`. */
export const DEFAULT_MODELS = {
  stt: DEFAULT_STT_MODEL,
  llm: DEFAULT_LLM_MODEL,
} as const;

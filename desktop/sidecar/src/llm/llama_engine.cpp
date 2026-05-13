#include "llama_engine.h"
#include "memory/os_reclaim.h"
#include <llama.h>
#include <algorithm>
#include <vector>

namespace lisna::llm {

struct LlamaEngine::Impl {
  llama_model* model = nullptr;
  llama_context* ctx = nullptr;
  const llama_vocab* vocab = nullptr;
};

LlamaEngine::LlamaEngine() : impl_(std::make_unique<Impl>()) {}
LlamaEngine::~LlamaEngine() { unload(); }

bool LlamaEngine::loaded() const { return impl_->ctx != nullptr; }

bool LlamaEngine::load(const std::string& path) {
  unload();
  llama_model_params mp = llama_model_default_params();
  mp.n_gpu_layers = 999; // offload all layers to Metal
  impl_->model = llama_model_load_from_file(path.c_str(), mp);
  if (!impl_->model) return false;

  llama_context_params cp = llama_context_default_params();
  cp.n_ctx = 131072; // 128K
  impl_->ctx = llama_init_from_model(impl_->model, cp);
  if (!impl_->ctx) {
    llama_model_free(impl_->model);
    impl_->model = nullptr;
    return false;
  }
  impl_->vocab = llama_model_get_vocab(impl_->model);
  return true;
}

void LlamaEngine::unload() {
  if (!impl_->ctx && !impl_->model) return; // skip the 2s RSS-poll for the no-op case (dtor after failed load).
  // Snapshot RSS once before both frees — combined model+ctx is the thing we
  // want the OS to actually reclaim before resolving unload() upstream.
  const size_t before = lisna::memory::process_rss_bytes();
  if (impl_->ctx) {
    llama_free(impl_->ctx);
    impl_->ctx = nullptr;
  }
  if (impl_->model) {
    llama_model_free(impl_->model);
    impl_->model = nullptr;
  }
  impl_->vocab = nullptr;
  const size_t target = std::max<size_t>(before / 4,
                                         static_cast<size_t>(100) * 1024 * 1024);
  lisna::memory::advise_release_and_wait(nullptr, 0, target, 2000);
}

void LlamaEngine::generate(const std::string& prompt, const GenOpts& opts,
                           const std::function<void(const std::string&)>& onToken) {
  if (!impl_->ctx || !impl_->vocab) return;

  // Tokenize prompt. Two-pass: probe size, then fill.
  // add_special=true: include BOS. parse_special=true: chat-template markers
  // (e.g. Gemma <start_of_turn>) tokenize as their special IDs, not literal text.
  const int n_prompt_probe = -llama_tokenize(
      impl_->vocab, prompt.c_str(), static_cast<int32_t>(prompt.size()),
      nullptr, 0, true, true);
  std::vector<llama_token> tokens(n_prompt_probe);
  const int n_prompt = llama_tokenize(
      impl_->vocab, prompt.c_str(), static_cast<int32_t>(prompt.size()),
      tokens.data(), n_prompt_probe, true, true);
  if (n_prompt < 0) return;
  tokens.resize(n_prompt);

  llama_sampler_chain_params sparams = llama_sampler_chain_default_params();
  llama_sampler* smpl = llama_sampler_chain_init(sparams);
  llama_sampler_chain_add(smpl, llama_sampler_init_top_k(50));
  llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.9f, 1));
  llama_sampler_chain_add(smpl, llama_sampler_init_temp(opts.temperature));
  llama_sampler_chain_add(smpl, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

  llama_batch batch = llama_batch_get_one(tokens.data(), static_cast<int32_t>(tokens.size()));
  int generated = 0;
  llama_token new_token = 0;
  char piece_buf[256];

  while (generated < opts.maxTokens) {
    if (llama_decode(impl_->ctx, batch) != 0) break;
    new_token = llama_sampler_sample(smpl, impl_->ctx, -1);
    if (llama_vocab_is_eog(impl_->vocab, new_token)) break;

    // special=false: chat-template markers (e.g. <end_of_turn>) render as
    // empty so they don't leak into the streamed token JSON.
    const int32_t n = llama_token_to_piece(
        impl_->vocab, new_token, piece_buf, sizeof(piece_buf), 0, false);
    if (n > 0) onToken(std::string(piece_buf, n));

    ++generated;
    batch = llama_batch_get_one(&new_token, 1);
  }

  llama_sampler_free(smpl);
}

} // namespace lisna::llm

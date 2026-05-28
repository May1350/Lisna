#include "llama_engine.h"
#include "chat_prompt.h"
#include "ipc/json_protocol.h"  // emit_event for structured log lines
#include "memory/os_reclaim.h"
#include "json.hpp"
#include <llama.h>
#include <algorithm>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

namespace lisna::llm {

namespace {

// Shared fallback for both the tmpl==nullptr and `needed < 0` paths.
// Role-tagged concatenation, no BOS. Caller MUST drive add_special=true at
// tokenize time because this shape lacks any embedded BOS token.
std::string fallback_concat(const std::vector<ChatMessage>& messages) {
  std::string out;
  for (const auto& m : messages) {
    out += "[" + m.role + "]\n" + m.content + "\n";
  }
  out += "[assistant]\n";
  return out;
}

} // namespace

std::pair<std::string, bool> format_chat_prompt(
    const char* tmpl,
    const std::vector<ChatMessage>& messages) {
  if (tmpl == nullptr) {
    // Model carries no embedded chat template. Surface a warning and return
    // the raw-concat shape with applied=false so the caller knows BOS must
    // come from the tokenizer (add_special=true).
    lisna::ipc::emit_event(nlohmann::json{
        {"type", "log"}, {"level", "warn"}, {"source", "system"},
        {"message", "no_chat_template_in_gguf — falling back to raw concatenation; output quality will degrade"}
    }.dump());
    return {fallback_concat(messages), false};
  }

  // Borrow c_str() into llama_chat_message[]; `messages` outlives the call.
  std::vector<llama_chat_message> cmsgs;
  cmsgs.reserve(messages.size());
  for (const auto& m : messages) {
    cmsgs.push_back(llama_chat_message{m.role.c_str(), m.content.c_str()});
  }

  // Two-pass alloc. Header recommends 2 * total_chars; we grow on underflow.
  size_t total_chars = 0;
  for (const auto& m : messages) total_chars += m.role.size() + m.content.size();
  std::vector<char> buf(std::max<size_t>(256, total_chars * 2));
  int32_t needed = llama_chat_apply_template(tmpl, cmsgs.data(), cmsgs.size(),
                                             /*add_ass=*/true,
                                             buf.data(),
                                             static_cast<int32_t>(buf.size()));
  if (needed > static_cast<int32_t>(buf.size())) {
    buf.resize(needed);
    needed = llama_chat_apply_template(tmpl, cmsgs.data(), cmsgs.size(),
                                       /*add_ass=*/true,
                                       buf.data(),
                                       static_cast<int32_t>(buf.size()));
  }
  if (needed < 0) {
    // Template is present but not in llama.cpp's pre-defined supported list
    // (llama.h:1159). Same fallback shape as the nullptr case — and critically
    // applied=false, so the caller adds BOS via the tokenizer. Pre-fix the
    // caller decided add_special from (tmpl != nullptr) alone, missing this
    // branch and silently dropping BOS.
    lisna::ipc::emit_event(nlohmann::json{
        {"type", "log"}, {"level", "warn"}, {"source", "system"},
        {"message", "llama_chat_apply_template returned negative; falling back to raw concatenation"}
    }.dump());
    return {fallback_concat(messages), false};
  }
  return {std::string(buf.data(), needed), true};
}

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
  // 16K. Previously 131072 (128K) and then 32768, both of which caused
  // `llama_decode failed ret=-3` for 3B Q4_K_M on M1 8GB (Metal compute
  // graph couldn't allocate). 16K still covers ~1.5hrs of JA transcription
  // at ~10 tokens/sec, well past the longest plausible single recording.
  // 2026-05-15 smoke confirmed 3B succeeds at 16K; bump only on profiled need.
  cp.n_ctx = 16384;
  impl_->ctx = llama_init_from_model(impl_->model, cp);
  if (!impl_->ctx) {
    llama_model_free(impl_->model);
    impl_->model = nullptr;
    return false;
  }
  impl_->vocab = llama_model_get_vocab(impl_->model);

  // One-shot debug log: which chat template did the GGUF carry? The pointer
  // is owned by the model; safe to dereference while the model is loaded.
  // For exotic quants this may be nullptr — that case is handled per-call.
  const char* tmpl = llama_model_chat_template(impl_->model, nullptr);
  std::string tmpl_preview = tmpl
      ? std::string(tmpl).substr(0, 200)
      : std::string("(none — fallback to raw-text mode)");
  lisna::ipc::emit_event(nlohmann::json{
      {"type", "log"}, {"level", "debug"}, {"source", "system"},
      {"message", std::string("llm chat_template: ") + tmpl_preview}
  }.dump());
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

void LlamaEngine::generate(const std::vector<ChatMessage>& messages, const GenOpts& opts,
                           const std::function<void(const std::string&)>& onToken) {
  if (!impl_->ctx || !impl_->vocab || messages.empty()) return;

  // Apply chat template (or fallback). Single source of truth for whether the
  // template was actually applied — pre-fix this came from a second
  // `llama_model_chat_template` call that knew tmpl-existence but not
  // apply-success, so the `needed < 0` fallback path silently dropped BOS.
  const char* tmpl = llama_model_chat_template(impl_->model, nullptr);
  auto [prompt, applied] = format_chat_prompt(tmpl, messages);

  // Tokenize formatted prompt. Two-pass: probe size, then fill.
  // - parse_special=true so chat-template markers (`<|begin_of_text|>`,
  //   `<|start_header_id|>`, `<|eot_id|>` for Llama 3.2; `<start_of_turn>`
  //   for Gemma) tokenize as their special IDs, not literal text.
  // - add_special: true iff the formatted string came from the raw-concat
  //   fallback. The applied path has BOS already; the fallback path doesn't.
  const bool add_special = !applied;
  const int n_prompt_probe = -llama_tokenize(
      impl_->vocab, prompt.c_str(), static_cast<int32_t>(prompt.size()),
      nullptr, 0, add_special, true);
  std::vector<llama_token> tokens(n_prompt_probe);
  const int n_prompt = llama_tokenize(
      impl_->vocab, prompt.c_str(), static_cast<int32_t>(prompt.size()),
      tokens.data(), n_prompt_probe, add_special, true);
  if (n_prompt < 0) return;
  tokens.resize(n_prompt);

  // Sampler chain. Order matters: penalties header says "apply top-k or top-p
  // first" — we keep penalties between top_p and temp so they operate on the
  // already-filtered candidate set.
  // - top_k=50 / top_p=0.9: standard chat-tuned defaults
  // - penalties(64, 1.1, 0, 0): mild repetition penalty over the last 64
  //   tokens. 1.0 = off, 1.3 = aggressive; 1.1 was chosen to dampen the
  //   infinite-loop failure mode (2026-05-15 1B catastrophe) without
  //   distorting natural JA phrasing where short fillers ("はい", "ね")
  //   recur legitimately. Frequency and presence penalties stay 0 — we
  //   intentionally tune one knob at a time.
  // - temp / dist: standard tail of the chain.
  llama_sampler_chain_params sparams = llama_sampler_chain_default_params();
  llama_sampler* smpl = llama_sampler_chain_init(sparams);
  llama_sampler_chain_add(smpl, llama_sampler_init_top_k(50));
  llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.9f, 1));
  llama_sampler_chain_add(smpl, llama_sampler_init_penalties(64, 1.1f, 0.0f, 0.0f));
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

    // special=false: chat-template markers (e.g. `<|eot_id|>`) render as
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

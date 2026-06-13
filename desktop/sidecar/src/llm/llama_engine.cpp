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

static_assert(0xFFFFFFFFu == LLAMA_DEFAULT_SEED,
              "GenOpts.seed default (llama_engine.h) must equal LLAMA_DEFAULT_SEED; "
              "llama.cpp changed the constant — update the header default.");

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
  // P0-1 (2026-06-09): match logical batch ceiling to the context window.
  // llama.cpp's default is n_batch=2048; our `generate()` builds a single
  // `llama_batch_get_one(tokens, N)` for the entire prompt, so any prompt
  // tokenizing to >2048 trips the upstream assert
  //   GGML_ASSERT(n_tokens_all <= cparams.n_batch)
  // (llama-context.cpp:1599) and the process aborts with SIGABRT. Real
  // 30-min Interview transcripts render to ~8000 tokens after chat-template
  // formatting → 100% repro before this fix (founder smoke 2026-06-09).
  // Setting n_batch=n_ctx is free here: we run one decode at a time (no
  // parallel batching), and `n_ubatch` (the physical kernel batch, default
  // 512) is unchanged, so per-token throughput is unaffected. The only
  // thing this widens is the gate on per-call prompt token count.
  // DO NOT REVERT to the default without rerunning a 30-min stress prompt.
  cp.n_batch = cp.n_ctx;
  // q8_0 KV cache: halves the 16K KV from ~1.8GB (fp16) to ~0.9GB. On 8GB
  // machines fp16 KV + ~2GB weights left so little headroom that decode
  // pages were evicted mid-generate — founder retest 2026-06-11: two
  // stall→restart cycles burned 178s of a 212s finalize, and tokPerSec
  // rose 6.8→11.3 as concurrent apps closed (memory pressure, not compute,
  // is the decode bottleneck). Quantized V requires Flash Attention, which
  // resolves on under AUTO for this model on Metal; if a backend resolves
  // FA off, init returns nullptr and we retry with fp16 KV below — a slow
  // load must never become a failed load (sidecar load failure has been an
  // alpha-killing P0 twice).
  cp.type_k = GGML_TYPE_Q8_0;
  cp.type_v = GGML_TYPE_Q8_0;
  impl_->ctx = llama_init_from_model(impl_->model, cp);
  if (!impl_->ctx) {
    lisna::ipc::emit_event(nlohmann::json{
        {"type", "log"}, {"level", "warn"}, {"source", "system"},
        {"message", "llm ctx init with q8_0 KV cache failed — retrying with fp16 KV"}
    }.dump());
    cp.type_k = GGML_TYPE_F16;
    cp.type_v = GGML_TYPE_F16;
    impl_->ctx = llama_init_from_model(impl_->model, cp);
  }
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

bool LlamaEngine::generate(const std::vector<ChatMessage>& messages, const GenOpts& opts,
                           const std::function<void(const std::string&)>& onToken) {
  if (!impl_->ctx || !impl_->vocab || messages.empty()) return false;

  // Reset the KV cache so each generate() decodes into a FRESH context.
  // Every call receives the full system+user message set (the caller never
  // sends an incremental turn; cross-chunk merge is deterministic TS, not
  // model state) — so cross-call KV continuity is never intended. Without
  // this clear, llama_batch_get_one + llama_decode auto-continue token
  // positions from the prior call's head (llama.h: "position tracked
  // automatically by llama_decode"), so an N-chunk finalize grows the KV
  // monotonically until it crosses n_ctx (16384) — empirically at the 3rd
  // ~5.4k-token chunk of an 84-min lecture — and llama_decode then fails on
  // the first prefill decode, breaking the loop with 0 tokens (silent empty
  // output → JSON.parse("") → CHUNK_FAILED). See pitfalls.md (llm-overflow).
  llama_memory_clear(llama_get_memory(impl_->ctx), /*data=*/true);

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
  if (n_prompt < 0) return false;
  tokens.resize(n_prompt);

  // Sampler chain — aligned to llama.cpp common defaults (spec
  // 2026-06-12-v2-track2-sampler-alignment section 4). Order mirrors
  // upstream common_sampler: penalties → dry → top_k → top_p → min_p →
  // temp → dist. Values arrive via GenOpts (TS profiles.ts is the single
  // source of truth; the header defaults are the aligned safety net).
  //
  // The old hardcoded chain (top_k 50 → top_p 0.9 → penalties(64, 1.1) →
  // temp → dist) is GONE: the 1.1 post-truncation repeat penalty is the
  // prime suspect for the 2026-06-12 JA→English fabrication (it
  // systematically down-weights recurring JA subword tokens inside
  // grammar-masked JSON; English alternates win). Penalties stay reachable
  // via opts.repeatPenalty > 1.0 ONLY so the eval rig can reproduce the
  // legacy config in the falsification matrix — production sends 1.0.
  //
  // DRY (sequence-repetition penalty) replaces it as the anti-loop device:
  // it penalizes only tokens that EXTEND a repeated sequence (>= allowed
  // length), so it cannot bias the language of fresh content the way a
  // token-recurrence penalty can. The `"` sequence breaker resets matching
  // at JSON string boundaries. Disabled when multiplier == 0 (rig knob).
  //
  // Grammar stays FIRST (single-pass hard mask; candidate set cannot
  // empty). NOTE: the known-good CLI ran grammar_first=false (lazy
  // rejection-resample) — grammar mode is deliberately NOT changed here;
  // it is the B-fallback variable (spec section 7).
  llama_sampler_chain_params sparams = llama_sampler_chain_default_params();
  llama_sampler* smpl = llama_sampler_chain_init(sparams);

  if (!opts.grammar.empty()) {
    llama_sampler* grmr = llama_sampler_init_grammar(impl_->vocab, opts.grammar.c_str(), "root");
    if (!grmr) {
      lisna::ipc::emit_event(nlohmann::json{
          {"type", "log"}, {"level", "error"}, {"source", "system"},
          {"message", "grammar_parse_failed — llama grammar parser rejected the GBNF"}
      }.dump());
      llama_sampler_free(smpl);
      return false;   // protocol layer emits a stream error → callWithGrammar retries → CHUNK_FAILED
    }
    llama_sampler_chain_add(smpl, grmr);
  }
  if (opts.repeatPenalty > 1.0f) {
    llama_sampler_chain_add(smpl, llama_sampler_init_penalties(
        opts.repeatLastN, opts.repeatPenalty, 0.0f, 0.0f));
  }
  if (opts.dryMultiplier > 0.0f) {
    // Upstream default breakers (common.h:243). `"` confines DRY matching
    // within one JSON string slot; `:`/`\n` break across structural tokens.
    static const char* kDryBreakers[] = {"\n", ":", "\"", "*"};
    llama_sampler_chain_add(smpl, llama_sampler_init_dry(
        impl_->vocab, llama_model_n_ctx_train(impl_->model),
        opts.dryMultiplier, opts.dryBase,
        opts.dryAllowedLength, opts.dryPenaltyLastN,
        kDryBreakers, 4));
  }
  llama_sampler_chain_add(smpl, llama_sampler_init_top_k(opts.topK));
  llama_sampler_chain_add(smpl, llama_sampler_init_top_p(opts.topP, 1));
  llama_sampler_chain_add(smpl, llama_sampler_init_min_p(opts.minP, 1));
  llama_sampler_chain_add(smpl, llama_sampler_init_temp(opts.temperature));
  llama_sampler_chain_add(smpl, llama_sampler_init_dist(opts.seed));

  llama_batch batch = llama_batch_get_one(tokens.data(), static_cast<int32_t>(tokens.size()));
  int generated = 0;
  llama_token new_token = 0;
  char piece_buf[256];

  // Wrap the decode loop so smpl is freed even if onToken throws (e.g. the
  // Utf8Carry belt-and-braces JSON emit — any gap would re-expose the
  // type_error.316 hang without this guard).
  try {
    while (generated < opts.maxTokens) {
      if (llama_decode(impl_->ctx, batch) != 0) {
        // Make n_ctx overflow / backend decode failure LOUD. Historically
        // this break left an empty stream with a normal `done`, so TS saw a
        // clean-but-empty result and the cause was misdiagnosed across
        // multiple sessions (pitfalls.md llm-overflow). With the top-of-call
        // KV clear above this should not fire for correctly-sized chunks;
        // if it ever does, the log names it instead of hiding it.
        lisna::ipc::emit_event(nlohmann::json{
            {"type", "log"}, {"level", "error"}, {"source", "system"},
            {"message", "llama_decode failed (likely n_ctx overflow) — generation truncated"},
            {"generated", generated}
        }.dump());
        break;
      }
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
  } catch (...) {
    llama_sampler_free(smpl);
    throw;
  }

  llama_sampler_free(smpl);
  return true;
}

} // namespace lisna::llm

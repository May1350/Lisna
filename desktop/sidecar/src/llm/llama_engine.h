#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace lisna::llm {

struct GenOpts {
  int maxTokens = 1024;
  float temperature = 0.4f;
  std::string grammar = "";       // GBNF source; empty = no grammar sampler (plain path)
  uint32_t seed = 0xFFFFFFFFu;    // == LLAMA_DEFAULT_SEED (random). Literal here so this
                                  // header need not include <llama.h> (see header note above).
};

/**
 * Chat message envelope, mirrors the TS-side `ChatMessage` and llama.cpp's
 * `llama_chat_message`. We keep our own POD here rather than forwarding the
 * llama_chat_message struct because doing so would force every translation
 * unit that includes this header to pull in <llama.h>.
 */
struct ChatMessage {
  std::string role;     // "system" | "user" | "assistant"
  std::string content;
};

class LlamaEngine {
public:
  LlamaEngine();
  ~LlamaEngine();

  LlamaEngine(const LlamaEngine&) = delete;
  LlamaEngine& operator=(const LlamaEngine&) = delete;

  bool load(const std::string& ggufPath);
  void unload();
  bool loaded() const;
  // onToken: per-decode-step callback (streaming). `messages` is converted to
  // a single prompt string via the GGUF-embedded chat template before
  // tokenization; if the model carries no template, a structured warning is
  // emitted and the engine concatenates contents as a fallback.
  void generate(const std::vector<ChatMessage>& messages, const GenOpts& opts,
                const std::function<void(const std::string&)>& onToken);

private:
  struct Impl;
  // NOTE: Impl is incomplete here; the destructor MUST be defined in the .cpp
  // (where Impl is complete) so unique_ptr can call ~Impl. Do not inline ~LlamaEngine.
  std::unique_ptr<Impl> impl_;
};

} // namespace lisna::llm

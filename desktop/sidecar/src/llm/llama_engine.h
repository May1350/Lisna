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

  // Sampler knobs (spec 2026-06-12-v2-track2-sampler-alignment section 5).
  // Defaults = llama.cpp common defaults (common.h:214-243) + DRY enabled —
  // an envelope that omits `sampling` gets ALIGNED behavior, never the
  // legacy chain (top_k 50 / top_p 0.9 / penalty 1.1) that drove the
  // 2026-06-12 English-fabrication incident.
  int topK = 40;
  float topP = 0.95f;
  float minP = 0.05f;
  float repeatPenalty = 1.0f;     // 1.0 = penalties sampler OMITTED from the chain
  int repeatLastN = 64;           // inert while repeatPenalty == 1.0
  float dryMultiplier = 0.8f;     // 0.0 = DRY sampler omitted
  float dryBase = 1.75f;
  int dryAllowedLength = 2;
  int dryPenaltyLastN = -1;       // -1 = scan whole context
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
  // Returns false ONLY on a setup failure the caller must surface (bad input,
  // tokenize failure, or GBNF that the grammar parser rejects). Returns true on
  // normal completion, including an early stop from a mid-stream decode error
  // (partial output already streamed via onToken).
  bool generate(const std::vector<ChatMessage>& messages, const GenOpts& opts,
                const std::function<void(const std::string&)>& onToken);

private:
  struct Impl;
  // NOTE: Impl is incomplete here; the destructor MUST be defined in the .cpp
  // (where Impl is complete) so unique_ptr can call ~Impl. Do not inline ~LlamaEngine.
  std::unique_ptr<Impl> impl_;
};

} // namespace lisna::llm

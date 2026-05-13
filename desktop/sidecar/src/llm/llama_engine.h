#pragma once
#include <functional>
#include <memory>
#include <string>

namespace lisna::llm {

struct GenOpts {
  int maxTokens = 1024;
  float temperature = 0.4f;
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
  // onToken: per-decode-step callback (streaming).
  void generate(const std::string& prompt, const GenOpts& opts,
                const std::function<void(const std::string&)>& onToken);

private:
  struct Impl;
  // NOTE: Impl is incomplete here; the destructor MUST be defined in the .cpp
  // (where Impl is complete) so unique_ptr can call ~Impl. Do not inline ~LlamaEngine.
  std::unique_ptr<Impl> impl_;
};

} // namespace lisna::llm

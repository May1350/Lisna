#pragma once
#include <memory>
#include <string>
#include <vector>

namespace lisna::stt {

struct Segment {
  double startSec;
  double endSec;
  std::string text;
};

class WhisperEngine {
public:
  WhisperEngine();
  ~WhisperEngine();

  WhisperEngine(const WhisperEngine&) = delete;
  WhisperEngine& operator=(const WhisperEngine&) = delete;

  bool load(const std::string& ggufPath, const std::string& languageCode);
  void unload();
  std::vector<Segment> transcribe(const float* samples, size_t n, int sampleRate);
  bool loaded() const;

private:
  struct Impl;
  // NOTE: Impl is incomplete here; the destructor MUST be defined in the .cpp
  // (where Impl is complete) so unique_ptr can call ~Impl. Do not inline ~WhisperEngine.
  std::unique_ptr<Impl> impl_;
};

} // namespace lisna::stt

#pragma once
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
  Impl* impl_;
};

} // namespace lisna::stt

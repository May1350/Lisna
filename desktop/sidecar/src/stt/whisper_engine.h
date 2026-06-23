#pragma once
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace lisna::stt {

struct Segment {
  double startSec;
  double endSec;
  std::string text;
  double noSpeechProb;  // per-chunk value from whisper_full_get_segment_no_speech_prob (whisper.cpp src/whisper.cpp:7633 — state-level, identical for every segment in one whisper_full call)
};

class WhisperEngine {
public:
  WhisperEngine();
  ~WhisperEngine();

  WhisperEngine(const WhisperEngine&) = delete;
  WhisperEngine& operator=(const WhisperEngine&) = delete;

  bool load(const std::string& ggufPath, const std::string& languageCode);
  void unload();
  // `initialPrompt` (STT Phase 1) seeds whisper's decoder context with
  // proper-noun spellings for THIS call; empty = no bias. Must outlive the
  // call (whisper.cpp keeps a const char* into it through whisper_full).
  // `onProgress` (when set) receives whisper's integer 0..100 progress during
  // transcription; default {} = no callback (existing call sites unchanged).
  std::vector<Segment> transcribe(const float* samples, size_t n, int sampleRate,
                                  const std::string& initialPrompt = "",
                                  const std::function<void(int)>& onProgress = {});
  bool loaded() const;

private:
  struct Impl;
  // NOTE: Impl is incomplete here; the destructor MUST be defined in the .cpp
  // (where Impl is complete) so unique_ptr can call ~Impl. Do not inline ~WhisperEngine.
  std::unique_ptr<Impl> impl_;
};

} // namespace lisna::stt

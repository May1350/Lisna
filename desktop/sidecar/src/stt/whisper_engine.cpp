#include "whisper_engine.h"
#include <whisper.h>
#include <cstring>

namespace lisna::stt {

struct WhisperEngine::Impl {
  whisper_context* ctx = nullptr;
  std::string lang;
};

WhisperEngine::WhisperEngine() : impl_(std::make_unique<Impl>()) {}
WhisperEngine::~WhisperEngine() { unload(); } // unique_ptr handles Impl delete

bool WhisperEngine::loaded() const { return impl_->ctx != nullptr; }

bool WhisperEngine::load(const std::string& path, const std::string& langCode) {
  unload();
  whisper_context_params cp = whisper_context_default_params();
  cp.use_gpu = true; // Metal
  impl_->ctx = whisper_init_from_file_with_params(path.c_str(), cp);
  impl_->lang = langCode;
  return impl_->ctx != nullptr;
}

void WhisperEngine::unload() {
  if (impl_->ctx) {
    whisper_free(impl_->ctx);
    impl_->ctx = nullptr;
  }
}

std::vector<Segment> WhisperEngine::transcribe(const float* samples, size_t n, int sampleRate) {
  std::vector<Segment> out;
  (void)sampleRate; // caller guarantees 16kHz Float32 (Task 2.6 adapter will validate)
  if (!impl_->ctx) return out;
  whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
  // Empty langCode → explicit "auto" so the auto-detect path is visible at the
  // call site (whisper.cpp treats "" the same way, but we want intent on record).
  p.language = impl_->lang.empty() ? "auto" : impl_->lang.c_str();
  p.translate = false;
  p.print_realtime = false;
  p.print_progress = false;
  if (whisper_full(impl_->ctx, p, samples, static_cast<int>(n)) != 0) return out;
  const int nSeg = whisper_full_n_segments(impl_->ctx);
  for (int i = 0; i < nSeg; ++i) {
    Segment s;
    s.startSec = whisper_full_get_segment_t0(impl_->ctx, i) / 100.0;
    s.endSec   = whisper_full_get_segment_t1(impl_->ctx, i) / 100.0;
    s.text     = whisper_full_get_segment_text(impl_->ctx, i);
    out.push_back(std::move(s));
  }
  return out;
}

} // namespace lisna::stt

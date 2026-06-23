#include "whisper_engine.h"
#include "memory/os_reclaim.h"
#include <whisper.h>
#include <algorithm>
#include <cstring>
#include <functional>

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
  if (!impl_->ctx) return; // skip the 2s RSS-poll for the no-op case (dtor after failed load).
  // Snapshot RSS first so the post-free poll can confirm the kernel actually
  // returned pages (KO/ZH path transitions STT 1.5GB → LLM 2.5GB; without this
  // confirmation the user briefly swaps).
  const size_t before = lisna::memory::process_rss_bytes();
  whisper_free(impl_->ctx);
  impl_->ctx = nullptr;
  // Target: a quarter of pre-free RSS (model is the dominant allocation), with
  // a 100MB floor so small models don't make this trivially satisfied.
  const size_t target = std::max<size_t>(before / 4,
                                         static_cast<size_t>(100) * 1024 * 1024);
  lisna::memory::advise_release_and_wait(nullptr, 0, target, 2000);
}

std::vector<Segment> WhisperEngine::transcribe(const float* samples, size_t n, int sampleRate,
                                               const std::string& initialPrompt,
                                               const std::function<void(int)>& onProgress) {
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
  // STT Phase 1 — proper-noun bias. whisper.cpp tokenizes initial_prompt into
  // the decoder's prompt context for THIS call (a lexical nudge, bounded by the
  // acoustics — it cannot invent words). The default is nullptr; only set it
  // when non-empty. `initialPrompt` (a const ref to the caller's string) must
  // stay alive through whisper_full — it does.
  if (!initialPrompt.empty()) p.initial_prompt = initialPrompt.c_str();
  // Optional progress reporting (used by the finalize whole-file path). whisper's
  // C callback is a bare function pointer + void* user-data, so we bridge through
  // a small stack struct that points at the caller's std::function. Both `pc` and
  // `onProgress` outlive the synchronous whisper_full call below.
  struct ProgCtx { const std::function<void(int)>* cb; };
  ProgCtx pc{ onProgress ? &onProgress : nullptr };
  if (pc.cb) {
    p.progress_callback = [](whisper_context*, whisper_state*, int progress, void* ud) {
      auto* c = static_cast<ProgCtx*>(ud);
      if (c && c->cb && *c->cb) (*c->cb)(progress);
    };
    p.progress_callback_user_data = &pc;
  }
  if (whisper_full(impl_->ctx, p, samples, static_cast<int>(n)) != 0) return out;
  const int nSeg = whisper_full_n_segments(impl_->ctx);
  for (int i = 0; i < nSeg; ++i) {
    Segment s;
    s.startSec = whisper_full_get_segment_t0(impl_->ctx, i) / 100.0;
    s.endSec   = whisper_full_get_segment_t1(impl_->ctx, i) / 100.0;
    s.text     = whisper_full_get_segment_text(impl_->ctx, i);
    // Per whisper.cpp src/whisper.cpp:7633 — state-level no_speech_prob attached
    // identically to every segment in result_all. Reading per-i is safe (no UB
    // when nSeg==0 because loop body doesn't execute) and matches the per-segment
    // getter pattern used for t0/t1/text above.
    s.noSpeechProb = static_cast<double>(
      whisper_full_get_segment_no_speech_prob(impl_->ctx, i));
    out.push_back(std::move(s));
  }
  return out;
}

} // namespace lisna::stt

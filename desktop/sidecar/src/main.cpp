#include <iostream>
#include <string>
#include <unistd.h>
#include <whisper.h>
#include <ggml.h>
#include "ipc/json_protocol.h"
#include "lifecycle/parent_watchdog.h"
#include "json.hpp"

namespace {

// Route whisper.cpp / ggml internal logs through the IPC channel as structured
// {"type":"log",...} events. Without this, whisper writes lines like
//   whisper_init_from_file_with_params_no_state: loading model from ...
// directly to stdout — corrupting the NDJSON contract the renderer/main IPC
// parser depends on. The callback is invoked on whatever thread whisper/ggml
// is running on; nlohmann::json::dump + std::cout writes are independent per
// call, so contention is bounded to interleaved (but still complete) lines.
void lisna_log_callback(ggml_log_level level, const char* text, void* /*user*/) {
  if (!text) return;
  const char* level_str = "info";
  if (level == GGML_LOG_LEVEL_ERROR)      level_str = "error";
  else if (level == GGML_LOG_LEVEL_WARN)  level_str = "warn";
  else if (level == GGML_LOG_LEVEL_DEBUG) level_str = "debug";
  // whisper/ggml append a trailing newline; strip so the JSON is one line.
  std::string msg(text);
  while (!msg.empty() && (msg.back() == '\n' || msg.back() == '\r')) msg.pop_back();
  if (msg.empty()) return;
  lisna::ipc::emit_event(nlohmann::json{
      {"type", "log"},
      {"level", level_str},
      {"source", "whisper"},
      {"message", msg}
  }.dump());
}

} // namespace

int main() {
  // Zombie-defense Layer A: self-exit when the Electron parent dies without
  // closing our stdin (jetsam, SIGKILL, crash — pipe EOF never observed).
  // Installed FIRST so even a failure during model load can't orphan us.
  lisna::lifecycle::install_parent_watchdog(getppid());

  // Install log callbacks BEFORE any whisper/ggml call so the very first log
  // line (model load info, init failures, Metal backend selection) is captured.
  whisper_log_set(lisna_log_callback, nullptr);
  ggml_log_set(lisna_log_callback, nullptr);

  lisna::ipc::emit_event(
      std::string(R"({"type":"ready","pid":)") + std::to_string(getpid()) +
      R"(,"version":"0.0.2"})"
  );
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    std::cout << lisna::ipc::dispatch_or_error(line) << "\n" << std::flush;
  }
  return 0;
}

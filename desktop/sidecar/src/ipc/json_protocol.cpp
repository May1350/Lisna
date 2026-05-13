#include "json_protocol.h"
#include "base64.h"
#include "stt/whisper_engine.h"
#include <iostream>
#include <memory>
#include "json.hpp"

namespace lisna::ipc {

namespace {
// Process-level STT singleton. Owned by an unnamed namespace so it is invisible
// outside this translation unit. Lazily instantiated on first STT load.
std::unique_ptr<lisna::stt::WhisperEngine> g_stt;
} // namespace

std::string dispatch(const std::string& jsonLine) {
  auto req = nlohmann::json::parse(jsonLine);
  const std::string id = req.value("id", "-");
  const std::string type = req.value("type", "");

  auto err = [&](const char* code, const std::string& msg) {
    return nlohmann::json{
        {"id", id}, {"type", "error"}, {"code", code}, {"message", msg}
    }.dump();
  };

  if (type == "ping") {
    return nlohmann::json{{"id", id}, {"type", "ok"}}.dump();
  }

  if (type == "load") {
    const std::string kind = req.value("kind", "");
    if (kind == "stt") {
      if (!req.contains("path") || !req.contains("language")) {
        return err("missing_field", "path/language required");
      }
      if (!g_stt) g_stt = std::make_unique<lisna::stt::WhisperEngine>();
      if (!g_stt->load(req["path"].get<std::string>(),
                       req["language"].get<std::string>())) {
        return err("load_failed", "whisper_init returned null");
      }
      return nlohmann::json{{"id", id}, {"type", "ok"}}.dump();
    }
    return err("unimpl", "load kind=" + kind);
  }

  if (type == "unload") {
    const std::string kind = req.value("kind", "");
    if (kind == "stt") {
      if (g_stt) g_stt->unload();
      return nlohmann::json{{"id", id}, {"type", "ok"}}.dump();
    }
    return err("unimpl", "unload kind=" + kind);
  }

  if (type == "transcribe") {
    if (!g_stt || !g_stt->loaded()) {
      return err("not_loaded", "stt model not loaded");
    }
    if (!req.contains("audioBase64") || !req.contains("sampleRate")) {
      return err("missing_field", "audioBase64/sampleRate required");
    }
    auto raw = b64_decode(req["audioBase64"].get<std::string>());
    if (raw.empty()) return err("invalid_payload", "audioBase64 decoded to empty");
    if (raw.size() % sizeof(float) != 0) {
      return err("invalid_payload", "audioBase64 length not float-aligned");
    }
    const float* samples = reinterpret_cast<const float*>(raw.data());
    const size_t n = raw.size() / sizeof(float);
    auto segs = g_stt->transcribe(samples, n, req["sampleRate"].get<int>());
    auto arr = nlohmann::json::array();
    for (const auto& s : segs) {
      arr.push_back({{"startSec", s.startSec},
                     {"endSec", s.endSec},
                     {"text", s.text}});
    }
    return nlohmann::json{{"id", id}, {"type", "segments"}, {"segments", arr}}.dump();
  }

  return nlohmann::json{
      {"id", id}, {"type", "error"}, {"code", "unimpl"}, {"message", type}
  }.dump();
}

std::string dispatch_or_error(const std::string& jsonLine) {
  try {
    return dispatch(jsonLine);
  } catch (const std::exception& e) {
    // nlohmann::json escapes the string content safely (handles ", \, control chars, UTF-8)
    return nlohmann::json{
        {"id", "-"},
        {"type", "error"},
        {"code", "parse"},
        {"message", e.what()}
    }.dump();
  }
}

void emit_event(const std::string& jsonLine) {
  std::cout << jsonLine << "\n" << std::flush;
}

} // namespace lisna::ipc

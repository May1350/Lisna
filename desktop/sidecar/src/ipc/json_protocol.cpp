#include "json_protocol.h"
#include "base64.h"
#include "llm/llama_engine.h"
#include "stt/whisper_engine.h"
#include <cstring>
#include <iostream>
#include <memory>
#include "json.hpp"

namespace lisna::ipc {

namespace {
// Process-level STT + LLM singletons. Owned by an unnamed namespace so they
// stay invisible outside this translation unit. Lazily instantiated on first
// load. Single-threaded: dispatch assumes one in-flight request at a time; do
// not parallelize without adding a request mutex.
std::unique_ptr<lisna::stt::WhisperEngine> g_stt;
std::unique_ptr<lisna::llm::LlamaEngine> g_llm;
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
      // Explicit type guards — without these, `.get<std::string>()` throws a
      // type_error that bounces out through dispatch_or_error as `code:parse`,
      // which is misleading (the JSON was valid, the field type was wrong).
      if (!req["path"].is_string()) return err("invalid_type", "path must be string");
      if (!req["language"].is_string()) return err("invalid_type", "language must be string");
      if (!g_stt) g_stt = std::make_unique<lisna::stt::WhisperEngine>();
      if (!g_stt->load(req["path"].get<std::string>(),
                       req["language"].get<std::string>())) {
        return err("load_failed", "whisper_init returned null");
      }
      return nlohmann::json{{"id", id}, {"type", "ok"}}.dump();
    }
    if (kind == "llm") {
      if (!req.contains("path")) return err("missing_field", "path required");
      if (!req["path"].is_string()) return err("invalid_type", "path must be string");
      if (!g_llm) g_llm = std::make_unique<lisna::llm::LlamaEngine>();
      if (!g_llm->load(req["path"].get<std::string>())) {
        return err("load_failed", "llama init failed");
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
    if (kind == "llm") {
      if (g_llm) g_llm->unload();
      return nlohmann::json{{"id", id}, {"type", "ok"}}.dump();
    }
    return err("unimpl", "unload kind=" + kind);
  }

  if (type == "transcribe") {
    // Validate input shape BEFORE engine state — symmetric with the load
    // branch, and makes wrong-type cases testable from an unloaded state.
    if (!req.contains("audioBase64") || !req.contains("sampleRate")) {
      return err("missing_field", "audioBase64/sampleRate required");
    }
    if (!req["audioBase64"].is_string()) {
      return err("invalid_type", "audioBase64 must be string");
    }
    if (!req["sampleRate"].is_number_integer()) {
      return err("invalid_type", "sampleRate must be integer");
    }
    if (!g_stt || !g_stt->loaded()) {
      return err("not_loaded", "stt model not loaded");
    }
    auto raw = b64_decode(req["audioBase64"].get<std::string>());
    if (raw.empty()) return err("invalid_payload", "audioBase64 decoded to empty");
    if (raw.size() % sizeof(float) != 0) {
      return err("invalid_payload", "audioBase64 length not float-aligned");
    }
    // raw.data() is uint8_t* (1-byte aligned). reinterpret_cast<const float*>
    // would be UB on stricter ARM stacks even if it works on Apple Silicon.
    // memcpy into a properly-aligned std::vector<float> — one allocation,
    // defined behavior.
    std::vector<float> samples_aligned(raw.size() / sizeof(float));
    std::memcpy(samples_aligned.data(), raw.data(), raw.size());
    auto segs = g_stt->transcribe(samples_aligned.data(),
                                  samples_aligned.size(),
                                  req["sampleRate"].get<int>());
    auto arr = nlohmann::json::array();
    for (const auto& s : segs) {
      arr.push_back({{"startSec", s.startSec},
                     {"endSec", s.endSec},
                     {"text", s.text},
                     {"noSpeechProb", s.noSpeechProb}});
    }
    return nlohmann::json{{"id", id}, {"type", "segments"}, {"segments", arr}}.dump();
  }

  if (type == "generate") {
    // Validate input shape BEFORE engine state — symmetric with the transcribe
    // branch above. A wrong-shape `generate` against an unloaded engine should
    // surface the *shape* error, not a misleading `not_loaded`.
    //
    // Two accepted shapes:
    //   1. Preferred: { messages: [{role, content}, ...] } — sidecar applies
    //      the GGUF chat template before tokenization.
    //   2. Legacy (back-compat): { prompt: "..." } — wrapped into a single
    //      user message + deprecation warning. Will be removed in v2.1.
    std::vector<lisna::llm::ChatMessage> msgs;
    if (req.contains("messages")) {
      if (!req["messages"].is_array()) return err("invalid_type", "messages must be array");
      if (req["messages"].empty()) return err("invalid_payload", "messages array must not be empty");
      for (const auto& m : req["messages"]) {
        if (!m.is_object()) return err("invalid_type", "messages[] entries must be objects");
        if (!m.contains("role") || !m["role"].is_string())
          return err("missing_field", "messages[].role required and must be string");
        if (!m.contains("content") || !m["content"].is_string())
          return err("missing_field", "messages[].content required and must be string");
        msgs.push_back({m["role"].get<std::string>(), m["content"].get<std::string>()});
      }
    } else if (req.contains("prompt")) {
      if (!req["prompt"].is_string()) return err("invalid_type", "prompt must be string");
      // Emit a one-shot deprecation log so callers notice they're on the
      // legacy path. The wrapped message is given the `user` role — that's
      // the closest semantic match for a flat prompt; using `system` would
      // bypass the assistant-header trailer the template emits.
      emit_event(nlohmann::json{
          {"type", "log"}, {"level", "warn"}, {"source", "system"},
          {"message", "generate: legacy `prompt` field used; switch to `messages` array"}
      }.dump());
      msgs.push_back({"user", req["prompt"].get<std::string>()});
    } else {
      return err("missing_field", "messages or prompt required");
    }
    // grammar/seed shape guards live here (before the engine-state check) so a
    // wrong-type field surfaces a shape error regardless of load state.
    if (req.contains("grammar") && !req["grammar"].is_string())
      return err("invalid_type", "grammar must be string");
    if (req.contains("seed") && !req["seed"].is_number_integer())
      return err("invalid_type", "seed must be integer");
    // Engine-state check runs AFTER shape validation so callers get accurate
    // diagnostics regardless of order.
    if (!g_llm || !g_llm->loaded()) return err("not_loaded", "llm not loaded");
    lisna::llm::GenOpts opts;
    opts.maxTokens = req.value("maxTokens", 1024);
    opts.temperature = req.value("temperature", 0.4f);
    opts.grammar = req.value("grammar", std::string{});
    if (req.contains("seed")) opts.seed = req["seed"].get<uint32_t>();
    const bool ok = g_llm->generate(msgs, opts,
                    [&](const std::string& tok) {
      emit_event(nlohmann::json{
          {"id", id}, {"type", "token"}, {"token", tok}
      }.dump());
    });
    if (!ok) return err("grammar_setup", "generation setup failed (see prior log line)");
    return nlohmann::json{{"id", id}, {"type", "done"}}.dump();
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

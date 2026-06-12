#include "json_protocol.h"
#include "base64.h"
#include "llm/llama_engine.h"
#include "stt/whisper_engine.h"
#include <algorithm>
#include <chrono>
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

// ---------------------------------------------------------------------------
// Utf8Carry — implementation
// ---------------------------------------------------------------------------

// Returns the number of continuation bytes (0x80-0xBF) required after a
// given lead byte to complete one code point, or -1 if the byte is not a
// valid lead byte.
//   0xxxxxxx → 0   (ASCII, self-contained)
//   110xxxxx → 1
//   1110xxxx → 2
//   11110xxx → 3   (max valid Unicode lead)
//   10xxxxxx → -1  (continuation — not a lead byte)
//   11111xxx → -1  (overlong/invalid)
static int utf8_continuation_count(unsigned char b) {
  if (b < 0x80) return 0;
  if (b < 0xC0) return -1; // continuation byte
  if (b < 0xE0) return 1;
  if (b < 0xF0) return 2;
  if (b < 0xF8) return 3;
  return -1; // 0xF8-0xFF: invalid
}

// Scan the tail of `s` (at most 3 bytes from the end) for an incomplete
// leading sequence: a lead byte that does not yet have all its required
// continuation bytes. Returns the index of that lead byte, or s.size()
// if the tail is structurally complete.
static size_t find_incomplete_lead(const std::string& s) {
  const size_t len = s.size();
  // Walk backwards at most 3 bytes (max continuations for a 4-byte seq).
  for (size_t i = 1; i <= std::min<size_t>(3, len); ++i) {
    size_t pos = len - i;
    unsigned char b = static_cast<unsigned char>(s[pos]);
    int need = utf8_continuation_count(b);
    if (need < 0) {
      // It's a continuation byte — keep scanning backwards for the lead.
      continue;
    }
    // It's a lead (or ASCII). Count how many continuation bytes follow it.
    int have = static_cast<int>(i) - 1;
    if (have < need) {
      // Lead byte at `pos` is incomplete: it needs `need` continuations but
      // only `have` follow it within the current buffer tail.
      return pos;
    }
    // Complete — the tail starting at `pos` is a valid, closed code point.
    break;
  }
  return len; // tail is complete
}

// Validate bytes [begin, end) as structurally valid UTF-8 walking forward.
// Drops (skips) any byte sequence that is structurally invalid (bad lead byte
// or wrong number of continuations). Returns only the bytes that form valid
// complete code points.
static std::string utf8_keep_valid(const std::string& s, size_t begin, size_t end) {
  std::string out;
  out.reserve(end - begin);
  size_t i = begin;
  while (i < end) {
    unsigned char b = static_cast<unsigned char>(s[i]);
    int need = utf8_continuation_count(b);
    if (need < 0) {
      // Stray continuation byte — drop and advance.
      ++i;
      continue;
    }
    // need == 0: ASCII self-contained; need > 0: multi-byte lead.
    size_t seq_end = i + 1 + static_cast<size_t>(need);
    if (seq_end > end) {
      // Would run past the buffer — incomplete, drop.
      break;
    }
    // Verify the required continuation bytes.
    bool ok = true;
    for (size_t j = i + 1; j < seq_end; ++j) {
      unsigned char c = static_cast<unsigned char>(s[j]);
      if (c < 0x80 || c > 0xBF) { ok = false; break; }
    }
    if (ok) {
      out.append(s, i, static_cast<size_t>(need) + 1);
    }
    i = seq_end;
  }
  return out;
}

std::string Utf8Carry::take(const std::string& piece) {
  pending_ += piece;
  // Find whether the tail of pending_ ends mid-code-point.
  size_t split = find_incomplete_lead(pending_);
  // Everything before `split` is a complete run; validate it for structural
  // validity (drops any garbage bytes) then carry only the tail [split, end).
  std::string emit_candidate = utf8_keep_valid(pending_, 0, split);
  pending_ = pending_.substr(split); // keep incomplete tail (max 3 bytes)
  return emit_candidate;
}

std::string Utf8Carry::flush() {
  // Validate whatever remains; an incomplete trailing sequence is dropped.
  size_t split = find_incomplete_lead(pending_);
  std::string out = utf8_keep_valid(pending_, 0, split);
  pending_.clear();
  return out;
}

// ---------------------------------------------------------------------------
// dispatch / dispatch_or_error
// ---------------------------------------------------------------------------

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
    // sampling shape guard (spec sampler-alignment section 5): object of
    // numeric fields. Validated BEFORE engine state like grammar/seed above.
    if (req.contains("sampling")) {
      if (!req["sampling"].is_object())
        return err("invalid_type", "sampling must be object");
      for (const auto& [k, v] : req["sampling"].items()) {
        if (!v.is_number())
          return err("invalid_type", "sampling." + k + " must be number");
      }
    }
    // Engine-state check runs AFTER shape validation so callers get accurate
    // diagnostics regardless of order.
    if (!g_llm || !g_llm->loaded()) return err("not_loaded", "llm not loaded");
    lisna::llm::GenOpts opts = gen_opts_from(req);
    // Decode-speed instrumentation (1-min note target, 2026-06-10): count
    // sampled tokens + wall time so the TS telemetry can compute tok/s per
    // attempt. tokens_out is incremented on every lambda CALL (one per sampled
    // token) so tok/s stays sampled-token-based even though the Utf8Carry may
    // merge pieces into fewer emitted lines.
    const auto gen_t0 = std::chrono::steady_clock::now();
    size_t tokens_out = 0;
    Utf8Carry carry;
    try {
      const bool ok = g_llm->generate(msgs, opts,
                      [&](const std::string& tok) {
        ++tokens_out;  // count every sampled token call, not emitted lines
        const std::string out = carry.take(tok);
        if (out.empty()) return;
        // Belt-and-braces: replace overload so even a logic gap in Utf8Carry
        // can never throw type_error.316 mid-stream and hang the client again.
        emit_event(nlohmann::json{
            {"id", id}, {"type", "token"}, {"token", out}
        }.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace));
      });
      if (!ok) return err("grammar_setup", "generation setup failed (see prior log line)");
    } catch (const std::exception& e) {
      // Binds the real request id so the client rejects immediately instead of
      // hanging 300s waiting for a matching id on the error line (the old path
      // emitted id:"-" via dispatch_or_error's catch, which the client ignored).
      return err("generate_failed", std::string("generation threw: ") + e.what());
    }
    // Flush any carry remainder (model stopped mid-char — rare but possible).
    const std::string rest = carry.flush();
    if (!rest.empty()) {
      emit_event(nlohmann::json{
          {"id", id}, {"type", "token"}, {"token", rest}
      }.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace));
    }
    const auto gen_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - gen_t0).count();
    return nlohmann::json{{"id", id}, {"type", "done"},
        {"stats", {{"tokensOut", tokens_out}, {"genMs", gen_ms}}}}.dump();
  }

  return nlohmann::json{
      {"id", id}, {"type", "error"}, {"code", "unimpl"}, {"message", type}
  }.dump();
}

lisna::llm::GenOpts gen_opts_from(const nlohmann::json& req) {
  lisna::llm::GenOpts opts;
  opts.maxTokens = req.value("maxTokens", opts.maxTokens);
  opts.temperature = req.value("temperature", opts.temperature);
  opts.grammar = req.value("grammar", std::string{});
  if (req.contains("seed")) opts.seed = req["seed"].get<uint32_t>();
  if (req.contains("sampling")) {
    const auto& s = req["sampling"];
    opts.topK = s.value("topK", opts.topK);
    opts.topP = s.value("topP", opts.topP);
    opts.minP = s.value("minP", opts.minP);
    opts.repeatPenalty = s.value("repeatPenalty", opts.repeatPenalty);
    opts.repeatLastN = s.value("repeatLastN", opts.repeatLastN);
    opts.dryMultiplier = s.value("dryMultiplier", opts.dryMultiplier);
    opts.dryBase = s.value("dryBase", opts.dryBase);
    opts.dryAllowedLength = s.value("dryAllowedLength", opts.dryAllowedLength);
    opts.dryPenaltyLastN = s.value("dryPenaltyLastN", opts.dryPenaltyLastN);
  }
  return opts;
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

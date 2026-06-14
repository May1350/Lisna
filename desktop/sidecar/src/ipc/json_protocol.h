#pragma once
#include <string>
#include "llm/llama_engine.h"
#include "json.hpp"

namespace lisna::ipc {
  std::string dispatch(const std::string& jsonLine);
  std::string dispatch_or_error(const std::string& jsonLine);  // wraps dispatch; never throws
  void emit_event(const std::string& jsonLine);

  // Buffers raw token-piece bytes so emitted strings are always valid UTF-8.
  // Llama-3 byte-fallback tokens split multi-byte JA chars across pieces;
  // nlohmann::json::dump() throws on invalid UTF-8 (type_error.316), which
  // killed the decode loop mid-stream and hung the client for the full
  // no-progress window (matrix diagnosis 2026-06-13). take() returns the
  // longest valid-UTF-8 prefix of pending+piece and carries the tail bytes
  // (< one code point, max 3) forward; flush() returns any valid remainder
  // and DROPS a trailing incomplete sequence (the model stopped mid-char).
  // Structurally invalid bytes (impossible continuation) are dropped, not
  // emitted — emitting them is exactly the original bug.
  class Utf8Carry {
   public:
    std::string take(const std::string& piece);
    std::string flush();
   private:
    std::string pending_;
  };
  // Build engine GenOpts from a validated `generate` request. Exposed for
  // unit tests — value-level proof that sampling fields reach the struct.
  // PRECONDITION: shape guards already ran (sampling is an object if present).
  // Unknown sampling keys are silently ignored (matches top-level field leniency).
  lisna::llm::GenOpts gen_opts_from(const nlohmann::json& req);
}

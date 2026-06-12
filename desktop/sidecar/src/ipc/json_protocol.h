#pragma once
#include <string>
#include "llm/llama_engine.h"
#include "json.hpp"

namespace lisna::ipc {
  std::string dispatch(const std::string& jsonLine);
  std::string dispatch_or_error(const std::string& jsonLine);  // wraps dispatch; never throws
  void emit_event(const std::string& jsonLine);

  // Build engine GenOpts from a validated `generate` request. Exposed for
  // unit tests — value-level proof that sampling fields reach the struct.
  // PRECONDITION: shape guards already ran (sampling is an object if present).
  lisna::llm::GenOpts gen_opts_from(const nlohmann::json& req);
}

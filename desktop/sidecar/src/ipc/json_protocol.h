#pragma once
#include <string>

namespace lisna::ipc {
  std::string dispatch(const std::string& jsonLine);
  std::string dispatch_or_error(const std::string& jsonLine);  // wraps dispatch; never throws
  void emit_event(const std::string& jsonLine);
}

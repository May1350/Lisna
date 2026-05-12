#pragma once
#include <string>

namespace lisna::ipc {
  std::string dispatch(const std::string& jsonLine);
  void emit_event(const std::string& jsonLine);
}

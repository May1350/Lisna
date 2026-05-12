#include "json_protocol.h"
#include <iostream>
#include "json.hpp"

namespace lisna::ipc {
  std::string dispatch(const std::string& jsonLine) {
    auto req = nlohmann::json::parse(jsonLine);
    const std::string id = req.value("id", "-");
    const std::string type = req.value("type", "");
    if (type == "ping") {
      return nlohmann::json{{"id", id}, {"type", "ok"}}.dump();
    }
    return nlohmann::json{{"id", id}, {"type", "error"}, {"code", "unimpl"}, {"message", type}}.dump();
  }
  void emit_event(const std::string& jsonLine) {
    std::cout << jsonLine << "\n" << std::flush;
  }
}

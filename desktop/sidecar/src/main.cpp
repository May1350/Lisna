#include <iostream>
#include <string>
#include <unistd.h>
#include "ipc/json_protocol.h"

int main() {
  lisna::ipc::emit_event(
    std::string(R"({"type":"ready","pid":)") + std::to_string(getpid()) +
    R"(,"version":"0.0.1"})"
  );
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    std::cout << lisna::ipc::dispatch_or_error(line) << "\n" << std::flush;
  }
  return 0;
}
